import assert from "node:assert/strict";
import test from "node:test";
import { Evaluator } from "../src/evaluator.js";
import type { WorldAnalysis } from "../src/types.js";

function analysis(alivePeons: number, totalPeons = 10): WorldAnalysis {
  return { worldId: "world", status: "FINISHED", currentRound: 10, maxRounds: 10, totalEvents: 0, totalActions: 0, totalPeons, alivePeons, deadPeons: totalPeons - alivePeons, behavioralTrends: [] };
}

test("note uniquement le taux de survie du monde de contrôle", async () => {
  const evaluation = await new Evaluator().evaluate(analysis(5), analysis(8));
  assert.equal(evaluation.score, 80);
  assert.deepEqual(evaluation.breakdown, { survival: 80 });
  assert.equal(evaluation.verdict, "promising");
});

test("signale une régression dès que le taux de survie baisse", async () => {
  const evaluation = await new Evaluator().evaluate(analysis(10), analysis(9));
  assert.equal(evaluation.score, 90);
  assert.equal(evaluation.verdict, "regression");
});

test("gère un monde sans péon sans division par zéro", async () => {
  const evaluation = await new Evaluator().evaluate(analysis(0, 0), analysis(0, 0));
  assert.equal(evaluation.score, 0);
  assert.equal(evaluation.verdict, "insufficient");
});
