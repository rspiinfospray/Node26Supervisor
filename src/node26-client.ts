import type { PeonDeathContext, PeonSummary, WorldAnalysis, WorldAnalysisContext, WorldSummary } from "./types.js";

export class Node26Client {
  public constructor(private readonly baseUrl: string, private readonly timeoutMs = 300_000, private readonly deathContextSequenceLimit = 20) {}

  public listWorlds(): Promise<WorldSummary[]> { return this.request("GET", "/api/worlds"); }
  public async world(id: string): Promise<WorldSummary> {
    const world = await this.request<WorldSummary>("GET", `/api/worlds/${id}`);
    if (world.id !== id) throw new Error(`API Node26 : monde attendu ${id}, reçu ${world.id}`);
    return world;
  }
  public async analysis(id: string): Promise<WorldAnalysis> {
    const analysis = await this.request<WorldAnalysis>("GET", `/api/worlds/${id}/analysis`);
    if (analysis.worldId !== id) throw new Error(`API Node26 : analyse attendue pour ${id}, reçue pour ${analysis.worldId}`);
    return analysis;
  }
  public async analysisContext(id: string): Promise<WorldAnalysisContext> {
    const context = await this.request<WorldAnalysisContext>("GET", `/api/worlds/${id}/analysis-context`);
    if (context.id !== id) throw new Error(`API Node26 : contexte attendu pour ${id}, reçu pour ${context.id}`);
    return context;
  }

  public configuration(): Promise<Record<string, unknown>> { return this.request("GET", "/api/config"); }

  public peons(id: string): Promise<PeonSummary[]> { return this.request("GET", `/api/worlds/${id}/peons`); }

  public async deathContexts(id: string): Promise<PeonDeathContext[]> {
    const deadPeons = (await this.peons(id)).filter(peon => peon.status === "MORT");
    return Promise.all(deadPeons.map(async peon => {
      const context = await this.request<PeonDeathContext>("GET", `/api/worlds/${id}/peons/${peon.id}/death-context?sequenceLimit=${this.deathContextSequenceLimit}`);
      if (context.worldId !== id || context.peon.id !== peon.id) throw new Error(`Contexte de décès incohérent pour le péon ${peon.id} du monde ${id}`);
      return context;
    }));
  }

  public async createAndStartFrom(template: WorldSummary, cycle: number): Promise<WorldSummary> {
    const teams = Object.values(template.teams as Record<string, { id: string; name: string }>);
    const peons = Object.values(template.peons as Record<string, { teamId: string }>);
    const body = {
      name: controlWorldName(template.name, cycle),
      width: template.width, height: template.height, rockPercentage: template.rockPercentage,
      generateRiver: template.riverGenerationEnabled, treePercentage: template.treePercentage,
      foodCellPercentage: template.foodCellPercentage, minFoodPerCell: template.minFoodPerCell,
      maxFoodPerCell: template.maxFoodPerCell, sheepCount: template.sheepCount,
      hungerHealthLossPerTurn: template.hungerHealthLossPerTurn, maxRounds: template.maxRounds,
      seed: template.seed,
      teams: teams.map(team => ({ name: team.name, peonCount: peons.filter(peon => peon.teamId === team.id).length }))
    };
    const created = await this.request<WorldSummary>("POST", "/api/worlds", body);
    return this.request("POST", `/api/worlds/${created.id}/start`);
  }

  public async awaitReady(worldId: string, timeoutMs: number, pollMs: number, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "aucune réponse";
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error("Boucle arrêtée par l'utilisateur");
      try {
        await this.request("GET", `/api/worlds/${worldId}`, undefined, signal, Math.min(5_000, timeoutMs));
        return;
      } catch (error) {
        if (signal.aborted) throw new Error("Boucle arrêtée par l'utilisateur");
        lastError = error instanceof Error ? error.message : String(error);
        await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())), signal);
      }
    }
    throw new Error(`Node26 n'est pas disponible après ${Math.round(timeoutMs / 1000)} s : ${lastError}`);
  }

  public async awaitFinished(id: string, timeoutMs: number, pollMs: number, signal: AbortSignal): Promise<WorldSummary> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error("Boucle arrêtée par l'utilisateur");
      const world = await this.world(id);
      if (world.status === "FINISHED") return world;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, pollMs);
        signal.addEventListener("abort", () => { clearTimeout(timeout); reject(new Error("Boucle arrêtée par l'utilisateur")); }, { once: true });
      });
    }
    throw new Error(`Le monde ${id} n'est pas terminé dans le délai imparti`);
  }

  private async request<T>(method: string, route: string, body?: unknown, signal?: AbortSignal, timeoutMs = this.timeoutMs): Promise<T> {
    let response: Response;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      response = await fetch(`${this.baseUrl}${route}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal });
    } catch (error) {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new Error(`API Node26 ${method} ${route} : délai dépassé après ${Math.round(timeoutMs / 1000)} s`);
      }
      throw new Error(`API Node26 ${method} ${route} inaccessible : ${networkErrorMessage(error)}`);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`API Node26 ${method} ${route} (${response.status}) : ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export function controlWorldName(templateName: string, cycle: number, timestamp = Date.now()): string {
  const suffix = `-supervisor-${cycle}-${timestamp.toString().slice(-6)}`;
  const rootName = templateName.replace(/(?:-supervisor-\d+-\d{6})+$/u, "");
  return `${rootName.slice(0, Math.max(0, 80 - suffix.length))}${suffix}`;
}

function networkErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return [error.message, cause?.code, cause?.message].filter(Boolean).join(" · ");
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timeout); reject(new Error("Boucle arrêtée par l'utilisateur")); };
    const timeout = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
