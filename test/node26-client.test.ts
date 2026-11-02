import assert from "node:assert/strict";
import test from "node:test";
import { controlWorldName, Node26Client } from "../src/node26-client.js";

test("construit un nom de monde de contrôle borné sans accumuler les suffixes des cycles", () => {
  const previous = "iter-supervisor-1-252957-supervisor-2-817989-supervisor-3-136151";
  assert.equal(controlWorldName(previous, 4, 1_725_578_781), "iter-supervisor-4-578781");
  const longName = "monde-".repeat(20);
  const generated = controlWorldName(longName, 12, 1_725_578_781);
  assert.equal(generated.length, 80);
  assert.match(generated, /-supervisor-12-578781$/u);
});

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

test("charge uniquement les contextes compacts des péons morts", async () => {
  const originalFetch = globalThis.fetch;
  const routes: string[] = [];
  globalThis.fetch = (async input => {
    const route = String(input);
    routes.push(route);
    if (route.endsWith("/peons")) return new Response(JSON.stringify([{ id: "peon-1", name: "Ada", status: "MORT", deathSequence: 4 }, { id: "peon-2", name: "Bob", status: "VIVANT", deathSequence: null }]), { status: 200 });
    if (route.includes("/peons/peon-1/death-context?sequenceLimit=12")) return new Response(JSON.stringify({ worldId: "world-1", peon: { id: "peon-1", name: "Ada", teamId: "team-1" }, window: { sequenceCount: 12 }, death: { reason: "HUNGER" }, healthEvolution: [], decisions: [], relevantRules: {} }), { status: 200 });
    throw new Error(`Route inattendue : ${route}`);
  }) as typeof fetch;
  try {
    const client = new Node26Client("http://node26.test", 100, 12);
    const contexts = await client.deathContexts("world-1");
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]?.peon.id, "peon-1");
    assert.ok(routes.some(route => route.includes("death-context?sequenceLimit=12")));
    assert.ok(!routes.some(route => route.includes("peon-2/death-context")));
  } finally { globalThis.fetch = originalFetch; }
});
