import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupervisorState, WorldAnalysis } from "./types.js";

export class StateStore {
  public constructor(private readonly file: string, private readonly maximumCycles: number) {}

  public async load(): Promise<SupervisorState> {
    try { return JSON.parse(await readFile(this.file, "utf8")) as SupervisorState; }
    catch { return this.empty(); }
  }

  public async save(state: SupervisorState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.file);
  }

  public async saveReport(loopId: string, cycleNumber: number, markdown: string): Promise<void> {
    const file = this.reportFile(loopId, cycleNumber);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, markdown, "utf8");
    await rename(temporary, file);
  }

  public async readReport(loopId: string, cycleNumber: number): Promise<string> {
    return readFile(this.reportFile(loopId, cycleNumber), "utf8");
  }

  public async saveCorrection(loopId: string, cycleNumber: number, markdown: string): Promise<void> {
    const file = this.correctionFile(loopId, cycleNumber);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, markdown, "utf8");
    await rename(temporary, file);
  }

  public async readCorrection(loopId: string, cycleNumber: number): Promise<string> {
    return readFile(this.correctionFile(loopId, cycleNumber), "utf8");
  }

  public async saveBaseline(loopId: string, cycleNumber: number, analysis: WorldAnalysis): Promise<void> {
    await this.saveArtifact(this.baselineFile(loopId, cycleNumber), JSON.stringify(analysis, null, 2));
  }

  public async readBaseline(loopId: string, cycleNumber: number): Promise<WorldAnalysis> {
    return JSON.parse(await readFile(this.baselineFile(loopId, cycleNumber), "utf8")) as WorldAnalysis;
  }

  public async saveOpenAiTrace(loopId: string, cycleNumber: number, trace: string): Promise<void> {
    await this.saveArtifact(this.openAiTraceFile(loopId, cycleNumber), trace);
  }

  public async readOpenAiTrace(loopId: string, cycleNumber: number): Promise<string> {
    return readFile(this.openAiTraceFile(loopId, cycleNumber), "utf8");
  }

  private reportFile(loopId: string, cycleNumber: number): string {
    if (!/^[0-9a-f-]{36}$/i.test(loopId) || !Number.isInteger(cycleNumber) || cycleNumber < 1) {
      throw new Error("Identifiant de rapport invalide");
    }
    return path.join(path.dirname(this.file), "reports", `${loopId}-cycle-${cycleNumber}.md`);
  }

  private correctionFile(loopId: string, cycleNumber: number): string {
    if (!/^[0-9a-f-]{36}$/i.test(loopId) || !Number.isInteger(cycleNumber) || cycleNumber < 1) {
      throw new Error("Identifiant de correction invalide");
    }
    return path.join(path.dirname(this.file), "corrections", `${loopId}-cycle-${cycleNumber}.md`);
  }

  private baselineFile(loopId: string, cycleNumber: number): string {
    if (!/^[0-9a-f-]{36}$/i.test(loopId) || !Number.isInteger(cycleNumber) || cycleNumber < 1) throw new Error("Identifiant de baseline invalide");
    return path.join(path.dirname(this.file), "baselines", `${loopId}-cycle-${cycleNumber}.json`);
  }

  private openAiTraceFile(loopId: string, cycleNumber: number): string {
    if (!/^[0-9a-f-]{36}$/i.test(loopId) || !Number.isInteger(cycleNumber) || cycleNumber < 1) throw new Error("Identifiant de trace OpenAI invalide");
    return path.join(path.dirname(this.file), "openai-inputs", `${loopId}-cycle-${cycleNumber}.json`);
  }

  private async saveArtifact(file: string, content: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, file);
  }

  public empty(): SupervisorState {
    return { loopId: null, status: "idle", activeWorldId: null, currentCycle: 0, maximumCycles: this.maximumCycles, startedAt: null, completedAt: null, message: "Prêt", preparationTasks: [], cycles: [] };
  }
}
