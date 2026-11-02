import assert from "node:assert/strict";
import test from "node:test";
import { EventHub } from "../src/events.js";
import { extractOutputText, OpenAiAnalyst, parsePromptTemplate } from "../src/openai-analyst.js";

test("extrait uniquement le texte produit par la Responses API", () => {
  const text = extractOutputText({ output: [
    { type: "reasoning" },
    { type: "message", content: [{ type: "output_text", text: "# Rapport" }, { type: "refusal", text: "ignoré" }] },
    { type: "message", content: [{ type: "output_text", text: "Conclusion" }] }
  ] });
  assert.equal(text, "# Rapport\n\nConclusion");
});

test("renvoie une chaîne vide sans message textuel", () => {
  assert.equal(extractOutputText({ output: [{ type: "reasoning" }] }), "");
});

test("sépare les instructions et les données du prompt OpenAI", () => {
  assert.deepEqual(parsePromptTemplate("<instructions>Consignes</instructions>\n<input>Données</input>"), { instructions: "Consignes", inputTemplate: "Données" });
});

test("transmet à OpenAI uniquement le contexte compact du monde et du décès", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "### Résumé\nComportement analysé" }] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const analyst = new OpenAiAnalyst("key", "model", "https://openai.test", 1_000, "prompts/openia.md", new EventHub());
    const context = { id: "world", name: "Monde", status: "FINISHED", simulation: { currentRound: 80, maxRounds: 80, sequenceNumber: 12 }, population: { totalPeons: 1, alivePeons: 0, deadPeons: 1 }, dimensions: { width: 50, height: 40 } };
    const deathContext = { worldId: "world", peon: { id: "peon", name: "Ada", teamId: "team" }, window: { fromSequence: 1, toSequence: 12, deathSequence: 12, deathRound: 80, sequenceCount: 2, peonActionCount: 1, sequences: [1, 12] }, death: { reason: "HUNGER", attackerPeonId: null, attackerName: null, position: null }, healthEvolution: [{ cause: "HUNGER" }], decisions: [{ action: "SE_DEPLACER" }], relevantRules: { hungerHealthLossPerTurn: 5 } };
    const report = await analyst.behaviorReport(context, [deathContext], { hungerHealthLossPerTurn: 5 }, new AbortController().signal);
    const input = String(requests[0]?.input);
    assert.match(input, /CONTEXTE_MONDE_COMPACT=.*"name":"Monde"/);
    assert.match(input, /REGLES_DU_JEU=\{"hungerHealthLossPerTurn":5\}/);
    assert.match(input, /CONTEXTE_DECES_PEON=.*"reason":"HUNGER"/);
    assert.doesNotMatch(input, /PEON_FINAL_STATE|DIAGNOSTIC_EVENTS/);
    assert.match(String(requests[0]?.instructions), /Chronologie comportementale/);
    assert.match(report.markdown, /## Ada/);
    assert.equal(report.sourceWorldId, "world");
    assert.equal(report.model, "model");
    assert.match(report.inputHash, /^[a-f0-9]{64}$/);
    assert.match(report.inputArchive, /"sourceWorldId": "world"/);
  } finally { globalThis.fetch = originalFetch; }
});
