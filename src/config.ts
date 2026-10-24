import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  projectDirectory,
  port: positiveInteger(process.env.PORT, 8090),
  node26ApiUrl: (process.env.NODE26_API_URL ?? "http://localhost:8080").replace(/\/$/, ""),
  node26ProjectPath: path.resolve(process.env.NODE26_PROJECT_PATH ?? path.join(projectDirectory, "..", "Node26")),
  maximumCycles: positiveInteger(process.env.SUPERVISOR_MAX_CYCLES, 3),
  pollIntervalMs: positiveInteger(process.env.SUPERVISOR_POLL_MS, 2000),
  apiTimeoutMs: positiveInteger(process.env.SUPERVISOR_API_TIMEOUT_MS, 300_000),
  deployReadyTimeoutMs: positiveInteger(process.env.SUPERVISOR_DEPLOY_READY_TIMEOUT_MS, 120_000),
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-6-luna",
  openAiEndpoint: process.env.OPENAI_RESPONSES_ENDPOINT ?? "https://api.openai.com/v1/responses",
  worldTimeoutMs: positiveInteger(process.env.SUPERVISOR_WORLD_TIMEOUT_MS, 900_000),
  stateFile: path.join(projectDirectory, "data", "state.json"),
  promptFile: path.join(projectDirectory, "prompts", "fix.md"),
  openAiPromptFile: path.join(projectDirectory, "prompts", "openia.md")
};
