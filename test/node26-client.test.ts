import assert from "node:assert/strict";
import test from "node:test";
import { Node26Client } from "../src/node26-client.js";

test("attend que Node26 soit réellement disponible après le déploiement", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    if (attempts < 3) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return new Response(JSON.stringify({ id: "world", status: "FINISHED" }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new Node26Client("http://node26.test", 100);
    await client.awaitReady("world", 200, 1, new AbortController().signal);
    assert.equal(attempts, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("construit un dossier détaillé avec état final, événements et synthèse", async () => {
  const originalFetch = globalThis.fetch;
  const routes: string[] = [];
  globalThis.fetch = (async input => {
    const route = String(input);
    routes.push(route);
    if (route.includes("/events?")) return new Response(JSON.stringify([{ sequenceNumber: 4, eventType: "PEON_DECISION_MADE" }]), { status: 200 });
    if (route.endsWith("/diagnostic/summary")) return new Response(JSON.stringify({ worldId: "world-1", peonId: "peon-1", anomalies: [{ type: "DEATH" }] }), { status: 200 });
    throw new Error(`Route inattendue : ${route}`);
  }) as typeof fetch;
  try {
    const client = new Node26Client("http://node26.test", 100);
    const peon = { id: "peon-1", firstName: "Ada", mentalMap: { "0:0": {} }, actionHistory: [{ reward: 1 }] };
    const dossiers = await client.diagnostics("world-1", { id: "world-1", name: "Monde", status: "FINISHED", currentRound: 10, maxRounds: 10, sequenceNumber: 4, peons: { one: peon } });
    assert.deepEqual(dossiers[0]?.peonFinalState, peon);
    assert.equal(dossiers[0]?.diagnosticEvents.length, 1);
    assert.deepEqual(dossiers[0]?.diagnosticSummary, { worldId: "world-1", peonId: "peon-1", anomalies: [{ type: "DEATH" }] });
    assert.ok(routes.some(route => route.includes("limit=2000&peonId=peon-1")));
  } finally { globalThis.fetch = originalFetch; }
});
