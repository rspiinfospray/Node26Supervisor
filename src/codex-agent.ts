import { readFile } from "node:fs/promises";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import type { EventHub } from "./events.js";

export interface CorrectionResult { threadId: string | null; summary: string; }

export class CodexAgent {
  private readonly codex = new Codex();

  public constructor(private readonly workingDirectory: string, private readonly promptFile: string, private readonly events: EventHub) {}

  public async correct(report: string, cycle: number, signal: AbortSignal): Promise<CorrectionResult> {
    const template = await readFile(this.promptFile, "utf8");
    const prompt = template.replaceAll("{{CYCLE_NUMBER}}", String(cycle)).replace("{{REPORT}}", report);
    const thread = this.codex.startThread({ workingDirectory: this.workingDirectory, sandboxMode: "danger-full-access", approvalPolicy: "never", networkAccessEnabled: true });
    const streamed = await thread.runStreamed(prompt, { signal });
    let finalResponse = "";
    for await (const event of streamed.events) {
      this.forward(event, cycle);
      if (event.type === "item.completed" && event.item.type === "agent_message") finalResponse = event.item.text;
    }
    if (!finalResponse.trim()) throw new Error("Codex n'a produit aucun compte rendu");
    return { threadId: thread.id, summary: finalResponse };
  }

  private forward(event: ThreadEvent, cycle: number): void {
    if (event.type === "thread.started") this.events.emit("info", "codex.thread", `Thread Codex démarré pour le cycle ${cycle}`, { threadId: event.thread_id });
    if (event.type === "item.completed" && event.item.type === "file_change") this.events.emit("success", "codex.files", `${event.item.changes.length} modification(s) appliquée(s)`, event.item.changes);
    if (event.type === "item.completed" && event.item.type === "command_execution") this.events.emit(event.item.status === "completed" ? "info" : "error", "codex.command", event.item.command, { exitCode: event.item.exit_code });
    if (event.type === "item.completed" && event.item.type === "agent_message") this.events.emit("success", "codex.response", "Codex a terminé sa correction");
    if (event.type === "turn.failed" || event.type === "error") this.events.emit("error", "codex.error", event.type === "error" ? event.message : event.error.message);
  }
}
