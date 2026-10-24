import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../src/store.js";

test("persiste puis recharge l'état de la boucle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "node26-supervisor-"));
  const file = path.join(directory, "state.json");
  const store = new StateStore(file, 3);
  const state = store.empty();
  state.status = "completed";
  state.message = "ok";
  await store.save(state);
  assert.equal((await store.load()).message, "ok");
  assert.equal(JSON.parse(await readFile(file, "utf8")).status, "completed");
});

test("persiste le rapport OpenAI séparément de l'état", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "node26-supervisor-"));
  const store = new StateStore(path.join(directory, "state.json"), 3);
  const loopId = "123e4567-e89b-12d3-a456-426614174000";
  await store.saveReport(loopId, 2, "# Rapport\n\nAnalyse détaillée");
  assert.equal(await store.readReport(loopId, 2), "# Rapport\n\nAnalyse détaillée");
});

test("persiste le compte rendu de correction séparément de l'état", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "node26-supervisor-"));
  const store = new StateStore(path.join(directory, "state.json"), 3);
  const loopId = "123e4567-e89b-12d3-a456-426614174000";
  await store.saveCorrection(loopId, 1, "# Corrections\n\nDeux fichiers modifiés");
  assert.equal(await store.readCorrection(loopId, 1), "# Corrections\n\nDeux fichiers modifiés");
});

test("persiste le baseline immuable d'un cycle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "node26-supervisor-"));
  const store = new StateStore(path.join(directory, "state.json"), 3);
  const loopId = "123e4567-e89b-12d3-a456-426614174000";
  const baseline = { worldId: "world", status: "FINISHED", currentRound: 10, maxRounds: 10, totalEvents: 4, totalActions: 2, totalPeons: 1, alivePeons: 1, deadPeons: 0, behavioralTrends: [] };
  await store.saveBaseline(loopId, 1, baseline);
  assert.deepEqual(await store.readBaseline(loopId, 1), baseline);
});

test("archive exactement les données envoyées à OpenAI", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "node26-supervisor-"));
  const store = new StateStore(path.join(directory, "state.json"), 3);
  const loopId = "123e4567-e89b-12d3-a456-426614174000";
  const trace = JSON.stringify({ model: "model", inputs: ["données"] });
  await store.saveOpenAiTrace(loopId, 1, trace);
  assert.equal(await store.readOpenAiTrace(loopId, 1), trace);
});
