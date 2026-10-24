export type LoopStatus = "idle" | "preparing" | "correcting" | "testing" | "deploying" | "simulating" | "evaluating" | "reporting" | "completed" | "failed" | "stopped";

export interface WorldSummary {
  id: string;
  name: string;
  status: string;
  currentRound: number;
  maxRounds: number;
  sequenceNumber: number;
  [key: string]: unknown;
}

export interface WorldAnalysis {
  worldId: string;
  status: string;
  currentRound: number;
  maxRounds: number;
  totalEvents: number;
  totalActions: number;
  totalPeons: number;
  alivePeons: number;
  deadPeons: number;
  behavioralTrends: string[];
  [key: string]: unknown;
}

export interface PeonAnalysisDossier {
  peonFinalState: Record<string, unknown>;
  diagnosticEvents: unknown[];
  diagnosticSummary: unknown;
}

export interface Evaluation {
  score: number;
  verdict: "excellent" | "promising" | "insufficient" | "regression";
  breakdown: Record<string, number>;
  summary: string;
  strengths: string[];
  weaknesses: string[];
}

export type PreparationTaskId = "loading-world" | "loading-analysis" | "loading-diagnostics" | "generating-report";
export type CycleTaskId = "correcting" | "testing" | "deploying" | "simulating" | "evaluating";
export type CycleTaskStatus = "pending" | "running" | "completed" | "failed" | "stopped";

export interface CycleTask {
  id: CycleTaskId;
  label: string;
  description: string;
  status: CycleTaskStatus;
  startedAt?: string;
  completedAt?: string;
  detail?: string;
}

export interface PreparationTask extends Omit<CycleTask, "id"> {
  id: PreparationTaskId;
}

export interface CycleRecord {
  number: number;
  sourceWorldId: string;
  resultWorldId?: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "stopped";
  threadId?: string;
  changedFiles: string[];
  tasks: CycleTask[];
  reportAvailable?: boolean;
  correctionAvailable?: boolean;
  sourceSequenceNumber?: number;
  resultSequenceNumber?: number;
  baselineAvailable?: boolean;
  baselineHash?: string;
  reportHash?: string;
  correctionHash?: string;
  openAiInputHash?: string;
  openAiTraceAvailable?: boolean;
  openAiPromptHash?: string;
  openAiModel?: string;
  codeBeforeHash?: string;
  codeAfterHash?: string;
  controlReportAvailable?: boolean;
  controlReportHash?: string;
  controlOpenAiInputHash?: string;
  controlOpenAiTraceAvailable?: boolean;
  codexSummary?: string;
  evaluation?: Evaluation;
  error?: string;
}

export interface SupervisorState {
  loopId: string | null;
  status: LoopStatus;
  activeWorldId: string | null;
  currentCycle: number;
  maximumCycles: number;
  startedAt: string | null;
  completedAt: string | null;
  message: string;
  preparationTasks: PreparationTask[];
  cycles: CycleRecord[];
}

export interface SupervisorEvent {
  id: number;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  type: string;
  message: string;
  data?: unknown;
}
