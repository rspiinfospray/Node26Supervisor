import type { Evaluation, WorldAnalysis } from "./types.js";

export class Evaluator {
  public async evaluate(before: WorldAnalysis, after: WorldAnalysis): Promise<Evaluation> {
    const beforeRate = this.rate(before.alivePeons, before.totalPeons);
    const afterRate = this.rate(after.alivePeons, after.totalPeons);
    const survivalDelta = afterRate - beforeRate;
    const score = Math.round(afterRate * 100);
    const verdict = survivalDelta < 0 ? "regression" : score >= 85 ? "excellent" : score >= 65 ? "promising" : "insufficient";
    const deltaPoints = Math.round(survivalDelta * 100);
    const evolution = deltaPoints > 0 ? `+${deltaPoints}` : String(deltaPoints);
    const summary = `${after.alivePeons}/${after.totalPeons} péons survivants (${score} %), évolution de ${evolution} point(s) par rapport au monde initial.`;
    const strengths = survivalDelta > 0 ? [`Le taux de survie progresse de ${deltaPoints} point(s).`] : survivalDelta === 0 ? ["Le taux de survie est maintenu."] : [];
    const weaknesses = after.deadPeons > 0 ? [`${after.deadPeons} péon(s) sont morts pendant la simulation de contrôle.`] : [];
    return { score, verdict, breakdown: { survival: score }, summary, strengths, weaknesses };
  }

  private rate(value: number, total: number): number { return total === 0 ? 0 : value / total; }
}
