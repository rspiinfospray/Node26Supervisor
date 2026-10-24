import express from "express";
import { z } from "zod";
import { CodexAgent } from "./codex-agent.js";
import { config } from "./config.js";
import { Evaluator } from "./evaluator.js";
import { EventHub } from "./events.js";
import { Node26Client } from "./node26-client.js";
import { OpenAiAnalyst } from "./openai-analyst.js";
import { StateStore } from "./store.js";
import { Supervisor } from "./supervisor.js";
import { Workspace } from "./workspace.js";

const events = new EventHub();
const client = new Node26Client(config.node26ApiUrl, config.apiTimeoutMs);
const analyst = new OpenAiAnalyst(config.openAiApiKey, config.openAiModel, config.openAiEndpoint, config.apiTimeoutMs, config.openAiPromptFile, events);
const workspace = new Workspace(config.node26ProjectPath);
const codex = new CodexAgent(config.node26ProjectPath, config.promptFile, events);
const store = new StateStore(config.stateFile, config.maximumCycles);
const evaluator = new Evaluator();
const supervisor = new Supervisor(client, workspace, analyst, codex, evaluator, store, events, config.maximumCycles, config.worldTimeoutMs, config.pollIntervalMs, config.deployReadyTimeoutMs);
await supervisor.initialize();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(`${config.projectDirectory}/public`));

app.get("/api/health", (_request, response) => response.json({ status: "UP", node26ApiUrl: config.node26ApiUrl, node26ProjectPath: config.node26ProjectPath }));
app.get("/api/worlds", async (_request, response, next) => { try { response.json(await client.listWorlds()); } catch (error) { next(error); } });
app.get("/api/state", (_request, response) => response.json({ state: supervisor.snapshot(), events: events.recent() }));
app.get("/api/loops/:loopId/cycles/:cycleNumber/report", async (request, response, next) => {
  try {
    const input = z.object({ loopId: z.string().uuid(), cycleNumber: z.coerce.number().int().min(1) }).parse(request.params);
    response.type("text/markdown; charset=utf-8").send(await supervisor.report(input.loopId, input.cycleNumber));
  } catch (error) { next(error); }
});
app.get("/api/loops/:loopId/cycles/:cycleNumber/correction", async (request, response, next) => {
  try {
    const input = z.object({ loopId: z.string().uuid(), cycleNumber: z.coerce.number().int().min(1) }).parse(request.params);
    response.type("text/markdown; charset=utf-8").send(await supervisor.correction(input.loopId, input.cycleNumber));
  } catch (error) { next(error); }
});
app.get("/api/events", (_request, response) => events.subscribe(response));
app.post("/api/loops", async (request, response, next) => {
  try {
    const input = z.object({ worldId: z.string().uuid(), maximumCycles: z.number().int().min(1).max(10).optional() }).parse(request.body);
    response.status(202).json(await supervisor.start(input.worldId, input.maximumCycles));
  } catch (error) { next(error); }
});
app.post("/api/loops/stop", async (_request, response, next) => { try { response.json(await supervisor.stop()); } catch (error) { next(error); } });
app.post("/api/loops/resume", async (_request, response, next) => { try { response.status(202).json(await supervisor.resume()); } catch (error) { next(error); } });
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  response.status(error instanceof z.ZodError ? 400 : 500).json({ error: message });
});

app.listen(config.port, () => events.emit("success", "server.started", `node26Supervisor disponible sur http://localhost:${config.port}`));
