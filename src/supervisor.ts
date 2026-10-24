import { createHash, randomUUID } from "node:crypto";
import type { CodexAgent } from "./codex-agent.js";
import type { Evaluator } from "./evaluator.js";
import type { EventHub } from "./events.js";
import type { Node26Client } from "./node26-client.js";
import type { GeneratedBehaviorReport, OpenAiAnalyst } from "./openai-analyst.js";
import type { StateStore } from "./store.js";
import type { CycleRecord, CycleTask, CycleTaskId, LoopStatus, PreparationTask, PreparationTaskId, SupervisorState, WorldAnalysis } from "./types.js";
import type { Workspace } from "./workspace.js";

export class Supervisor {
  private state!: SupervisorState;
  private abortController: AbortController | null = null;

  public constructor(
    private readonly client: Node26Client, private readonly workspace: Workspace, private readonly analyst: OpenAiAnalyst, private readonly codex: CodexAgent,
    private readonly evaluator: Evaluator, private readonly store: StateStore, private readonly events: EventHub,
    private readonly maximumCycles: number, private readonly worldTimeoutMs: number, private readonly pollIntervalMs: number,
    private readonly deployReadyTimeoutMs: number
  ) {}

  public async initialize(): Promise<void> {
    this.state = await this.store.load();
    this.state.preparationTasks ??= [];
    this.state.cycles.forEach(cycle => { cycle.tasks ??= createCycleTasks(); });
    if (this.state.loopId) {
      for (const cycle of this.state.cycles) {
        if (cycle.codexSummary) {
          await this.store.saveCorrection(this.state.loopId, cycle.number, cycle.codexSummary);
          cycle.correctionAvailable = true;
          delete cycle.codexSummary;
        }
      }
    }
    await this.store.save(this.state);
    if (!["idle", "completed", "failed", "stopped"].includes(this.state.status)) {
      const interruptedTask = this.state.cycles.at(-1)?.tasks.find(task => task.status === "running");
      if (interruptedTask) { interruptedTask.status = "failed"; interruptedTask.completedAt = new Date().toISOString(); interruptedTask.detail = "Étape interrompue par l'arrêt du superviseur"; }
      const interruptedCycle = this.state.cycles.at(-1);
      if (interruptedCycle?.status === "running") { interruptedCycle.status = "failed"; interruptedCycle.error = "Exécution interrompue"; interruptedCycle.completedAt = new Date().toISOString(); }
      this.state.status = "failed";
      this.state.message = "La précédente exécution a été interrompue par l'arrêt du superviseur";
      this.state.completedAt = new Date().toISOString();
      await this.store.save(this.state);
    }
  }

  public snapshot(): SupervisorState { return structuredClone(this.state); }
  public isRunning(): boolean { return !["idle", "completed", "failed", "stopped"].includes(this.state.status); }

  public async start(worldId: string, maximumCycles?: number): Promise<SupervisorState> {
    if (this.isRunning()) throw new Error("Une boucle de correction est déjà en cours");
    this.abortController = new AbortController();
    this.state = {
      loopId: randomUUID(), status: "preparing", activeWorldId: worldId, currentCycle: 0,
      maximumCycles: Math.max(1, maximumCycles ?? this.maximumCycles), startedAt: new Date().toISOString(), completedAt: null,
      message: "Préparation du monde", preparationTasks: createPreparationTasks(), cycles: []
    };
    await this.persist("info", "loop.started", `Boucle démarrée depuis le monde ${worldId}`);
    void this.run(worldId, this.abortController.signal);
    return this.snapshot();
  }

  public async stop(): Promise<SupervisorState> {
    if (!this.isRunning()) return this.snapshot();
    this.abortController?.abort();
    await this.transition("stopped", "Arrêt demandé par l'utilisateur");
    return this.snapshot();
  }

  public async resume(): Promise<SupervisorState> {
    if (this.isRunning()) throw new Error("Une boucle de correction est déjà en cours");
    const cycle = this.state.cycles.at(-1);
    const failedTask = cycle?.tasks.find(task => task.status === "failed");
    if (this.state.status !== "failed" || !this.state.loopId || !cycle || !failedTask) {
      throw new Error("Aucune étape de cycle en échec ne peut être reprise");
    }
    if (failedTask.id === "correcting" && cycle.codeBeforeHash) this.assertHash(await this.workspace.snapshot(), cycle.codeBeforeHash, "code antérieur à la correction interrompue");
    failedTask.status = "pending";
    failedTask.startedAt = undefined;
    failedTask.completedAt = undefined;
    failedTask.detail = failedTask.description;
    cycle.status = "running";
    cycle.error = undefined;
    cycle.completedAt = undefined;
    this.state.completedAt = null;
    this.state.status = failedTask.id;
    this.state.message = `Reprise du cycle ${cycle.number} : ${failedTask.label}`;
    this.abortController = new AbortController();
    await this.persist("info", "cycle.resumed", `Reprise du cycle ${cycle.number} à l'étape « ${failedTask.label} »`);
    void this.resumeRun(cycle, failedTask.id, this.abortController.signal);
    return this.snapshot();
  }

  private async run(initialWorldId: string, signal: AbortSignal): Promise<void> {
    let sourceWorldId = initialWorldId;
    try {
      const world = await this.runPreparationTask("loading-world", () => this.client.world(sourceWorldId));
      if (world.status !== "FINISHED") throw new Error("La boucle ne peut partir que d'un monde terminé");
      let baseline = await this.runPreparationTask("loading-analysis", () => this.client.analysis(sourceWorldId));
      const [diagnostics, gameRules] = await this.runPreparationTask("loading-diagnostics", () => Promise.all([this.client.diagnostics(sourceWorldId, world), this.client.configuration()]));
      let report = await this.runPreparationTask("generating-report", () => this.analyst.behaviorReport(world, baseline, diagnostics, gameRules, signal));
      await this.runCycles(sourceWorldId, baseline, report, 1, signal);
      await this.transition("completed", `Boucle terminée après ${this.state.maximumCycles} cycle(s)`);
    } catch (error) {
      await this.recordFailure(error, signal);
    } finally { this.abortController = null; }
  }

  private async resumeRun(cycle: CycleRecord, taskId: CycleTaskId, signal: AbortSignal): Promise<void> {
    try {
      if (!cycle.baselineAvailable || !cycle.baselineHash) throw new Error("Baseline immuable absente : cette reprise ne peut pas garantir la cohérence du cycle");
      const baseline = await this.store.readBaseline(this.state.loopId!, cycle.number);
      this.assertAnalysisWorld(baseline, cycle.sourceWorldId, "baseline persistée");
      this.assertHash(baseline, cycle.baselineHash, "baseline persistée");
      const report = taskId === "correcting" ? await this.store.readReport(this.state.loopId!, cycle.number) : "";
      if (taskId === "correcting") {
        this.assertHash(report, cycle.reportHash, "rapport OpenAI");
        if (!cycle.openAiTraceAvailable) throw new Error("Trace des entrées OpenAI absente : reprise non sûre");
        this.assertHash(await this.store.readOpenAiTrace(this.state.loopId!, cycle.number), cycle.openAiInputHash, "données envoyées à OpenAI");
      }
      const result = await this.executeCycle(cycle, baseline, report, cycle.tasks.findIndex(task => task.id === taskId), signal);
      await this.runCycles(result.sourceWorldId, result.baseline, result.report, cycle.number + 1, signal);
      await this.transition("completed", `Boucle terminée après ${this.state.maximumCycles} cycle(s)`);
    } catch (error) {
      await this.recordFailure(error, signal);
    } finally { this.abortController = null; }
  }

  private async runCycles(sourceWorldId: string, baseline: WorldAnalysis, report: GeneratedBehaviorReport, firstNumber: number, signal: AbortSignal): Promise<void> {
    for (let number = firstNumber; number <= this.state.maximumCycles; number++) {
      if (signal.aborted) throw new Error("Boucle arrêtée par l'utilisateur");
      const cycle: CycleRecord = { number, sourceWorldId, startedAt: new Date().toISOString(), status: "running", changedFiles: [], tasks: createCycleTasks() };
      if (report.sourceWorldId !== sourceWorldId) throw new Error(`Rapport OpenAI incohérent : monde attendu ${sourceWorldId}, reçu ${report.sourceWorldId}`);
      this.assertAnalysisWorld(baseline, sourceWorldId, "analyse source");
      cycle.sourceSequenceNumber = Number(baseline.sequenceNumber);
      if (Number.isFinite(cycle.sourceSequenceNumber) && report.sourceSequenceNumber !== cycle.sourceSequenceNumber) throw new Error("Rapport OpenAI produit depuis une séquence différente de l'analyse source");
      await this.store.saveBaseline(this.state.loopId!, number, baseline);
      cycle.baselineAvailable = true;
      cycle.baselineHash = hash(baseline);
      this.state.currentCycle = number;
      this.state.cycles.push(cycle);
      await this.store.saveReport(this.state.loopId!, number, report.markdown);
      await this.store.saveOpenAiTrace(this.state.loopId!, number, report.inputArchive);
      cycle.reportAvailable = true;
      cycle.reportHash = hash(report.markdown);
      cycle.openAiInputHash = report.inputHash;
      cycle.openAiTraceAvailable = true;
      cycle.openAiPromptHash = report.promptHash;
      cycle.openAiModel = report.model;
      const result = await this.executeCycle(cycle, baseline, report.markdown, 0, signal);
      sourceWorldId = result.sourceWorldId;
      baseline = result.baseline;
      report = result.report;
    }
  }

  private async executeCycle(cycle: CycleRecord, baseline: WorldAnalysis, report: string, startIndex: number, signal: AbortSignal): Promise<{ sourceWorldId: string; baseline: WorldAnalysis; report: GeneratedBehaviorReport }> {
    const number = cycle.number;
    if (startIndex > 0) {
      if (!cycle.codeAfterHash) throw new Error("Empreinte du code corrigé absente : reprise non sûre");
      this.assertHash(await this.workspace.snapshot(), cycle.codeAfterHash, "état du code Node26");
    }
    if (startIndex <= 0) {
      await this.transition("correcting", `Cycle ${number} : correction par Codex`);
      const beforeFiles = await this.workspace.snapshot();
      cycle.codeBeforeHash = hash(beforeFiles);
      await this.store.save(this.state);
      const correction = await this.codex.correct(report, number, signal);
      cycle.threadId = correction.threadId ?? undefined;
      await this.store.saveCorrection(this.state.loopId!, number, correction.summary);
      cycle.correctionAvailable = true;
      cycle.correctionHash = hash(correction.summary);
      cycle.changedFiles = await this.workspace.changedSince(beforeFiles);
      cycle.codeAfterHash = hash(await this.workspace.snapshot());
      this.completeCurrentTask(cycle, `${cycle.changedFiles.length} fichier(s) modifié(s)`);
      if (!cycle.changedFiles.some(file => file.startsWith("src/main/java/") || file.startsWith("src/test/java/"))) throw new Error("Codex n'a produit aucune modification Java de production ou de test");
    }
    if (startIndex <= 1) {
      await this.transition("testing", `Cycle ${number} : compilation et tests Docker`);
      await this.workspace.buildAndTest();
      this.completeCurrentTask(cycle, "Compilation et tests réussis");
    }
    if (startIndex <= 2) {
      await this.transition("deploying", `Cycle ${number} : déploiement de Node26`);
      await this.workspace.deploy();
      this.state.message = `Cycle ${number} : attente de l'API Node26`;
      await this.persist("info", "deployment.waiting", "Conteneur démarré, attente de la disponibilité HTTP de Node26");
      await this.client.awaitReady(cycle.sourceWorldId, this.deployReadyTimeoutMs, this.pollIntervalMs, signal);
      this.events.emit("success", "deployment.ready", "API Node26 disponible");
      this.completeCurrentTask(cycle, "Node26 déployé et API disponible");
    }
    let finished;
    if (startIndex <= 3) {
      await this.transition("simulating", `Cycle ${number} : simulation de contrôle`);
      if (cycle.resultWorldId) {
        const existing = await this.client.world(cycle.resultWorldId);
        finished = existing.status === "FINISHED" ? existing : await this.client.awaitFinished(existing.id, this.worldTimeoutMs, this.pollIntervalMs, signal);
      } else {
        const template = await this.client.world(cycle.sourceWorldId);
        const created = await this.client.createAndStartFrom(template, number);
        cycle.resultWorldId = created.id;
        cycle.resultSequenceNumber = Number(created.sequenceNumber);
        await this.store.save(this.state);
        finished = await this.client.awaitFinished(created.id, this.worldTimeoutMs, this.pollIntervalMs, signal);
      }
      this.completeCurrentTask(cycle, `Monde terminé au round ${finished.currentRound}`);
      cycle.resultSequenceNumber = Number(finished.sequenceNumber);
      this.events.emit("success", "simulation.finished", `${finished.name} terminé au round ${finished.currentRound}`, { worldId: finished.id });
    } else {
      if (!cycle.resultWorldId) throw new Error("Monde de contrôle introuvable pour reprendre ce cycle");
      finished = await this.client.world(cycle.resultWorldId);
    }
    let after = startIndex > 4 && cycle.evaluation ? await this.client.analysis(finished.id) : undefined;
    if (startIndex <= 4) {
      await this.transition("evaluating", `Cycle ${number} : évaluation du correctif`);
      after = await this.client.analysis(finished.id);
      this.assertAnalysisWorld(after, finished.id, "analyse du monde de contrôle");
      cycle.evaluation = await this.evaluator.evaluate(baseline, after);
      this.completeCurrentTask(cycle, `Survie ${after.alivePeons}/${after.totalPeons} · ${cycle.evaluation.score} % · ${cycle.evaluation.verdict}`);
    }
    if (!after) after = await this.client.analysis(finished.id);
    this.assertAnalysisWorld(after, finished.id, "analyse utilisée pour le rapport suivant");
    this.state.message = `Cycle ${number} : génération du rapport du monde de contrôle`;
    await this.persist("info", "control-report.started", this.state.message, { worldId: finished.id, cycle: number });
    const [nextDiagnostics, gameRules] = await Promise.all([this.client.diagnostics(finished.id, finished), this.client.configuration()]);
    const nextReport = await this.analyst.behaviorReport(finished, after, nextDiagnostics, gameRules, signal);
    if (nextReport.sourceWorldId !== finished.id) throw new Error("Rapport du monde de contrôle associé au mauvais monde");
    await this.store.saveControlReport(this.state.loopId!, number, nextReport.markdown);
    await this.store.saveControlOpenAiTrace(this.state.loopId!, number, nextReport.inputArchive);
    cycle.controlReportAvailable = true;
    cycle.controlReportHash = hash(nextReport.markdown);
    cycle.controlOpenAiInputHash = nextReport.inputHash;
    cycle.controlOpenAiTraceAvailable = true;
    cycle.status = "completed";
    cycle.completedAt = new Date().toISOString();
    await this.persist("success", "cycle.completed", `Cycle ${number} : ${cycle.evaluation?.score ?? "?"} % de survie`, cycle.evaluation);
    return { sourceWorldId: finished.id, baseline: after, report: nextReport };
  }

  private assertAnalysisWorld(analysis: WorldAnalysis, expectedWorldId: string, label: string): void {
    if (analysis.worldId !== expectedWorldId) throw new Error(`${label} incohérente : monde attendu ${expectedWorldId}, reçu ${analysis.worldId}`);
  }

  private assertHash(value: unknown, expected: string | undefined, label: string): void {
    if (!expected || hash(value) !== expected) throw new Error(`${label} modifié ou associé au mauvais cycle`);
  }

  private async recordFailure(error: unknown, signal: AbortSignal): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const cycle = this.state.cycles.at(-1);
    const preparationTask = this.state.preparationTasks.find(item => item.status === "running");
    if (preparationTask) {
      preparationTask.status = signal.aborted ? "stopped" : "failed";
      preparationTask.detail = message;
      preparationTask.completedAt = new Date().toISOString();
    }
    if (cycle?.status === "running") {
      cycle.status = signal.aborted ? "stopped" : "failed";
      cycle.error = message;
      cycle.completedAt = new Date().toISOString();
      const task = cycle.tasks.find(item => item.status === "running");
      if (task) { task.status = signal.aborted ? "stopped" : "failed"; task.detail = message; task.completedAt = cycle.completedAt; }
    }
    if (this.state.status !== "stopped") await this.transition(signal.aborted ? "stopped" : "failed", message);
    else await this.persist("warning", "cycle.stopped", message);
  }

  public async report(loopId: string, cycleNumber: number): Promise<string> {
    const loop = this.state.loopId === loopId ? this.state : await this.store.loadLoop(loopId);
    const cycle = loop.cycles.find(item => item.number === cycleNumber);
    if (!cycle?.reportAvailable) throw new Error("Rapport OpenAI introuvable pour ce cycle");
    return this.store.readReport(loopId, cycleNumber);
  }

  public async correction(loopId: string, cycleNumber: number): Promise<string> {
    const loop = this.state.loopId === loopId ? this.state : await this.store.loadLoop(loopId);
    const cycle = loop.cycles.find(item => item.number === cycleNumber);
    if (!cycle?.correctionAvailable) throw new Error("Compte rendu de correction introuvable pour ce cycle");
    return this.store.readCorrection(loopId, cycleNumber);
  }

  public async controlReport(loopId: string, cycleNumber: number): Promise<string> {
    const loop = this.state.loopId === loopId ? this.state : await this.store.loadLoop(loopId);
    const cycle = loop.cycles.find(item => item.number === cycleNumber);
    if (!cycle?.controlReportAvailable) throw new Error("Rapport du monde de contrôle introuvable pour ce cycle");
    return this.store.readControlReport(loopId, cycleNumber);
  }

  public async history(worldId: string): Promise<SupervisorState[]> {
    const loops = await this.store.listLoops();
    if (this.state.loopId && !loops.some(loop => loop.loopId === this.state.loopId)) loops.push(this.snapshot());
    return loops.filter(loop => loop.activeWorldId === worldId || loop.cycles.some(cycle => cycle.sourceWorldId === worldId || cycle.resultWorldId === worldId))
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
  }

  private async transition(status: LoopStatus, message: string): Promise<void> {
    this.state.status = status;
    this.state.message = message;
    if (isCycleTask(status)) this.startTask(this.state.cycles.at(-1), status, message);
    if (["completed", "failed", "stopped"].includes(status)) this.state.completedAt = new Date().toISOString();
    await this.persist(status === "failed" ? "error" : status === "completed" ? "success" : "info", `loop.${status}`, message);
  }

  private startTask(cycle: CycleRecord | undefined, id: CycleTaskId, detail: string): void {
    if (!cycle) return;
    const task = cycle.tasks.find(item => item.id === id);
    if (task && task.status === "pending") { task.status = "running"; task.startedAt = new Date().toISOString(); task.detail = detail; }
  }

  private completeCurrentTask(cycle: CycleRecord, detail: string): void {
    const task = cycle.tasks.find(item => item.status === "running");
    if (task) { task.status = "completed"; task.completedAt = new Date().toISOString(); task.detail = detail; }
  }

  private async runPreparationTask<T>(id: PreparationTaskId, operation: () => Promise<T>): Promise<T> {
    const task = this.state.preparationTasks.find(item => item.id === id);
    if (!task) throw new Error(`Sous-tâche de préparation absente : ${id}`);
    task.status = "running";
    task.startedAt = new Date().toISOString();
    task.detail = task.description;
    this.state.message = task.label;
    await this.persist("info", `preparation.${id}.started`, task.label, { taskId: id });
    const result = await operation();
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.detail = `${task.label} terminé`;
    await this.persist("success", `preparation.${id}.completed`, task.detail, { taskId: id });
    return result;
  }

  private async persist(level: "info" | "success" | "warning" | "error", type: string, message: string, data?: unknown): Promise<void> {
    await this.store.save(this.state);
    this.events.emit(level, type, message, data);
  }
}

function hash(value: unknown): string {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(content).digest("hex");
}

function isCycleTask(status: LoopStatus): status is CycleTaskId {
  return ["correcting", "testing", "deploying", "simulating", "evaluating"].includes(status);
}

export function createCycleTasks(): CycleTask[] {
  return [
    { id: "correcting", label: "Correction Codex", description: "Analyse du rapport et modification du code", status: "pending" },
    { id: "testing", label: "Compilation & tests", description: "Validation des changements dans Docker", status: "pending" },
    { id: "deploying", label: "Déploiement", description: "Mise à jour du backend Node26", status: "pending" },
    { id: "simulating", label: "Simulation de contrôle", description: "Exécution d'un monde avec la même graine", status: "pending" },
    { id: "evaluating", label: "Évaluation", description: "Comparaison avant/après et notation", status: "pending" }
  ];
}

export function createPreparationTasks(): PreparationTask[] {
  return [
    { id: "loading-world", label: "Chargement du monde", description: "Lecture et validation du monde source via l'API Node26", status: "pending" },
    { id: "loading-analysis", label: "Analyse initiale", description: "Calcul des métriques de référence du monde", status: "pending" },
    { id: "loading-diagnostics", label: "Diagnostics des péons", description: "Lecture des synthèses comportementales via l'API Node26", status: "pending" },
    { id: "generating-report", label: "Rapport OpenAI", description: "Analyse des données Node26 avec le modèle configuré", status: "pending" }
  ];
}
