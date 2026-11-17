import type { SupportStatus } from "@/lib/evidence/support";

export type RetrievalEvaluation = Readonly<{
  expectedIds: readonly string[];
  rankedIds: readonly string[];
}>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function recallAtK(evaluations: readonly RetrievalEvaluation[], k: number): number {
  if (k <= 0 || evaluations.length === 0) return 0;
  const eligible = evaluations.filter(({ expectedIds }) => expectedIds.length > 0);
  if (eligible.length === 0) return 0;
  return (
    eligible.reduce((sum, item) => {
      const expected = new Set(unique(item.expectedIds));
      const retrieved = new Set(item.rankedIds.slice(0, k));
      let hits = 0;
      for (const id of expected) if (retrieved.has(id)) hits += 1;
      return sum + hits / expected.size;
    }, 0) / eligible.length
  );
}

export function meanReciprocalRank(evaluations: readonly RetrievalEvaluation[]): number {
  if (evaluations.length === 0) return 0;
  const eligible = evaluations.filter(({ expectedIds }) => expectedIds.length > 0);
  if (eligible.length === 0) return 0;
  return (
    eligible.reduce((sum, item) => {
      const expected = new Set(item.expectedIds);
      const rank = item.rankedIds.findIndex((id) => expected.has(id));
      return sum + (rank < 0 ? 0 : 1 / (rank + 1));
    }, 0) / eligible.length
  );
}

export function ndcgAtK(evaluations: readonly RetrievalEvaluation[], k: number): number {
  if (k <= 0 || evaluations.length === 0) return 0;
  const eligible = evaluations.filter(({ expectedIds }) => expectedIds.length > 0);
  if (eligible.length === 0) return 0;
  return (
    eligible.reduce((sum, item) => {
      const expected = new Set(unique(item.expectedIds));
      const ranked = unique(item.rankedIds).slice(0, k);
      const dcg = ranked.reduce(
        (score, id, index) => score + (expected.has(id) ? 1 / Math.log2(index + 2) : 0),
        0,
      );
      const idealHits = Math.min(expected.size, k);
      let ideal = 0;
      for (let index = 0; index < idealHits; index += 1) ideal += 1 / Math.log2(index + 2);
      return sum + (ideal === 0 ? 0 : dcg / ideal);
    }, 0) / eligible.length
  );
}

const establishesSupport = (status: SupportStatus): boolean =>
  status === "supported" || status === "partially-supported";

export type SupportEvaluation = Readonly<{ expected: SupportStatus; actual: SupportStatus }>;

export type SupportMetrics = Readonly<{
  precision: number;
  recall: number;
  falseSupportRate: number;
  falseAbstentionRate: number;
  contradictionAccuracy: number;
  exactStatusAccuracy: number;
}>;

export function supportMetrics(evaluations: readonly SupportEvaluation[]): SupportMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let exact = 0;
  let contradictions = 0;
  let correctContradictions = 0;
  for (const item of evaluations) {
    const expectedPositive = establishesSupport(item.expected);
    const actualPositive = establishesSupport(item.actual);
    if (expectedPositive && actualPositive) truePositive += 1;
    else if (!expectedPositive && actualPositive) falsePositive += 1;
    else if (expectedPositive) falseNegative += 1;
    else trueNegative += 1;
    if (item.expected === item.actual) exact += 1;
    if (item.expected === "contradicted") {
      contradictions += 1;
      if (item.actual === "contradicted") correctContradictions += 1;
    }
  }
  const ratio = (numerator: number, denominator: number, empty = 1) =>
    denominator === 0 ? empty : numerator / denominator;
  return {
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
    falseSupportRate: ratio(falsePositive, falsePositive + trueNegative, 0),
    falseAbstentionRate: ratio(falseNegative, truePositive + falseNegative, 0),
    contradictionAccuracy: ratio(correctContradictions, contradictions),
    exactStatusAccuracy: ratio(exact, evaluations.length),
  };
}

export type CriticalGate = Readonly<{ name: string; failures: number; total: number }>;

export function criticalZeroRateGates(gates: readonly CriticalGate[]): Readonly<{
  passed: boolean;
  failed: CriticalGate[];
}> {
  const failed = gates.filter((gate) => gate.failures !== 0);
  return { passed: failed.length === 0, failed };
}

export function fraction(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
