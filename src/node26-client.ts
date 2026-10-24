import type { PeonAnalysisDossier, WorldAnalysis, WorldSummary } from "./types.js";

export class Node26Client {
  public constructor(private readonly baseUrl: string, private readonly timeoutMs = 300_000) {}

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
  public configuration(): Promise<Record<string, unknown>> { return this.request("GET", "/api/config"); }

  public async diagnostics(id: string, world: WorldSummary): Promise<PeonAnalysisDossier[]> {
    const peons = Object.values(world.peons as Record<string, Record<string, unknown> & { id: string }>);
    return Promise.all(peons.map(async peon => {
      const diagnosticEvents = await this.peonEvents(id, peon.id);
      const diagnosticSummary = await this.request<Record<string, unknown>>("GET", `/api/worlds/${id}/peons/${peon.id}/diagnostic/summary`);
      if (diagnosticSummary.worldId !== id || diagnosticSummary.peonId !== peon.id) throw new Error(`Diagnostic incohérent pour le péon ${peon.id} du monde ${id}`);
      return { peonFinalState: peon, diagnosticEvents, diagnosticSummary };
    }));
  }

  private async peonEvents(worldId: string, peonId: string): Promise<unknown[]> {
    const events: Array<Record<string, unknown>> = [];
    let after = 0;
    while (true) {
      const page = await this.request<Array<Record<string, unknown>>>("GET", `/api/worlds/${worldId}/events?after=${after}&limit=2000&peonId=${peonId}`);
      events.push(...page);
      if (page.length < 2000) return events;
      const lastSequence = Number(page.at(-1)?.sequenceNumber);
      if (!Number.isFinite(lastSequence) || lastSequence <= after) throw new Error(`Pagination des événements bloquée pour le péon ${peonId}`);
      after = lastSequence;
    }
  }

  public async createAndStartFrom(template: WorldSummary, cycle: number): Promise<WorldSummary> {
    const teams = Object.values(template.teams as Record<string, { id: string; name: string }>);
    const peons = Object.values(template.peons as Record<string, { teamId: string }>);
    const body = {
      name: `${template.name}-supervisor-${cycle}-${Date.now().toString().slice(-6)}`,
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
