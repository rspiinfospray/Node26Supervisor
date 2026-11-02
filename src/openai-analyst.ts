import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { EventHub } from "./events.js";
import type { PeonDeathContext, WorldAnalysisContext } from "./types.js";

interface ResponsesApiResponse {
  id?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}

export interface GeneratedBehaviorReport { markdown: string; sourceWorldId: string; sourceSequenceNumber: number; inputHash: string; inputArchive: string; promptHash: string; model: string; }

export class OpenAiAnalyst {
  public constructor(
    private readonly apiKey: string, private readonly model: string, private readonly endpoint: string,
    private readonly timeoutMs: number, private readonly promptFile: string, private readonly events: EventHub
  ) {}

  public async behaviorReport(worldContext: WorldAnalysisContext, deathContexts: PeonDeathContext[], gameRules: Record<string, unknown>, signal: AbortSignal): Promise<GeneratedBehaviorReport> {
    if (!this.apiKey.trim()) throw new Error("OPENAI_API_KEY n'est pas configurée dans le superviseur");
    const template = await readFile(this.promptFile, "utf8");
    const { instructions, inputTemplate } = parsePromptTemplate(template);
    this.events.emit("info", "openai.analysis.started", `Analyse des causes de décès de ${deathContexts.length} péon(s) avec ${this.model}`);
    const sections: string[] = [];
    const serializedInputs: string[] = [];
    for (const [index, deathContext] of deathContexts.entries()) {
      if (signal.aborted) throw new Error("Boucle arrêtée par l'utilisateur");
      const peonName = String(deathContext.peon.name ?? deathContext.peon.id ?? `Péon ${index + 1}`);
      this.events.emit("info", "openai.analysis.peon", `Analyse OpenAI de ${peonName} (${index + 1}/${deathContexts.length})`);
      const input = inputTemplate
        .replaceAll("{{WORLD_CONTEXT}}", JSON.stringify(worldContext))
        .replaceAll("{{GAME_RULES}}", JSON.stringify(gameRules))
        .replaceAll("{{DEATH_CONTEXT}}", JSON.stringify(deathContext));
      serializedInputs.push(input);
      sections.push(`## ${peonName}\n\n${await this.request(instructions, input, signal)}`);
    }
    const reportBody = sections.length > 0 ? sections.join("\n\n") : "Aucun décès à analyser dans ce monde.";
    const report = `# Analyse comportementale du monde ${worldContext.name}\n\n- Identifiant : \`${worldContext.id}\`\n- Fin de simulation : tour ${worldContext.simulation.currentRound} sur ${worldContext.simulation.maxRounds}\n- Péons : ${worldContext.population.totalPeons}, survivants : ${worldContext.population.alivePeons}\n- Décès analysés : ${deathContexts.length}\n- Modèle OpenAI : \`${this.model}\`\n\n${reportBody}`;
    this.events.emit("success", "openai.analysis.completed", `Rapport Markdown détaillé généré avec ${this.model}`, { peons: deathContexts.length, model: this.model });
    const inputArchive = JSON.stringify({ sourceWorldId: worldContext.id, sourceSequenceNumber: Number(worldContext.simulation.sequenceNumber), model: this.model, prompt: template, inputs: serializedInputs }, null, 2);
    return {
      markdown: report,
      sourceWorldId: worldContext.id,
      sourceSequenceNumber: Number(worldContext.simulation.sequenceNumber),
      inputHash: sha256(inputArchive),
      inputArchive,
      promptHash: sha256(template),
      model: this.model
    };
  }

  private async request(instructions: string, input: string, signal: AbortSignal): Promise<string> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST", signal: combinedSignal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, instructions, input })
      });
    } catch (error) {
      if (timeoutSignal.aborted && !signal.aborted) throw new Error(`API OpenAI : délai dépassé après ${Math.round(this.timeoutMs / 1000)} s`);
      throw error;
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`API OpenAI (${response.status}) : ${this.safeApiError(text)}`);
    const payload = JSON.parse(text) as ResponsesApiResponse;
    const report = extractOutputText(payload);
    if (!report) throw new Error("L'API OpenAI n'a produit aucun rapport textuel");
    return report;
  }

  private safeApiError(text: string): string {
    try {
      const payload = JSON.parse(text) as { error?: { message?: string } };
      return payload.error?.message ?? `réponse de ${text.length} caractères`;
    } catch { return text.slice(0, 500); }
  }
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function parsePromptTemplate(template: string): { instructions: string; inputTemplate: string } {
  const instructions = template.match(/<instructions>\s*([\s\S]*?)\s*<\/instructions>/)?.[1]?.trim();
  const inputTemplate = template.match(/<input>\s*([\s\S]*?)\s*<\/input>/)?.[1]?.trim();
  if (!instructions || !inputTemplate) throw new Error("Le prompt OpenAI doit contenir les sections <instructions> et <input>");
  return { instructions, inputTemplate };
}

export function extractOutputText(payload: ResponsesApiResponse): string {
  return (payload.output ?? []).flatMap(item => item.type === "message" ? item.content ?? [] : [])
    .filter(content => content.type === "output_text" && content.text)
    .map(content => content.text!.trim()).filter(Boolean).join("\n\n");
}
