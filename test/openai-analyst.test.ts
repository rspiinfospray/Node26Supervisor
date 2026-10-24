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

test("transmet à OpenAI le contexte historique complet de chaque péon", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "### Résumé\nComportement analysé" }] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const analyst = new OpenAiAnalyst("key", "model", "https://openai.test", 1_000, "prompts/openia.md", new EventHub());
    const world = { id: "world", name: "Monde", status: "FINISHED", currentRound: 80, maxRounds: 80, sequenceNumber: 12, width: 50, height: 40, seed: 7, rockPercentage: 20, treePercentage: 15, foodCellPercentage: 10, sheepCount: 4, riverGenerationEnabled: true, teams: {}, houses: { house: {} }, granaries: {}, wheatFields: {}, sheep: {} };
    const analysis = { worldId: "world", status: "FINISHED", currentRound: 80, maxRounds: 80, totalEvents: 12, totalActions: 4, totalPeons: 1, alivePeons: 1, deadPeons: 0, behavioralTrends: [], eventsByType: { PEON_DECISION_MADE: 4 } };
    const dossier = { peonFinalState: { id: "peon", firstName: "Ada", personality: { courage: 0.8 }, mentalMap: { "0:0": {} }, actionHistory: [{ reward: 2 }] }, diagnosticEvents: [{ sequenceNumber: 1, eventType: "PEON_DECISION_MADE" }], diagnosticSummary: { anomalies: [] } };
    const report = await analyst.behaviorReport(world, analysis, [dossier], { moveHealthCost: 5 }, new AbortController().signal);
    const input = String(requests[0]?.input);
    assert.match(input, /REGLES_DU_JEU=\{"moveHealthCost":5\}/);
    assert.match(input, /ETAT_FINAL_DU_PEON=.*"firstName":"Ada"/);
    assert.match(input, /EVENEMENTS_DIAGNOSTIQUES=.*PEON_DECISION_MADE/);
    assert.match(input, /SYNTHESE_DIAGNOSTIQUE=\{"anomalies":\[\]\}/);
    assert.match(String(requests[0]?.instructions), /Chronologie comportementale/);
    assert.match(report.markdown, /## Ada/);
    assert.equal(report.sourceWorldId, "world");
    assert.equal(report.model, "model");
    assert.match(report.inputHash, /^[a-f0-9]{64}$/);
    assert.match(report.inputArchive, /"sourceWorldId": "world"/);
  } finally { globalThis.fetch = originalFetch; }
});
