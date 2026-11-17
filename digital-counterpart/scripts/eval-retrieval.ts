import { performance } from "node:perf_hooks";

import { expandRetrievalQuery } from "../src/lib/chat/intent";
import { loadEvalCases } from "../src/lib/evals/dataset";
import {
  meanReciprocalRank,
  ndcgAtK,
  recallAtK,
  type RetrievalEvaluation,
} from "../src/lib/evals/metrics";
import { retrievalQuery } from "../src/lib/rag/query";
import { Retriever } from "../src/lib/rag/retriever";
import { reliabilityVersionSummary } from "../src/lib/versions";

const MIN_RETRIEVAL_CASES = 45;

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

async function main(): Promise<void> {
  const cases = loadEvalCases().filter(
    (item) => item.tags.includes("retrieval") && item.expected.clauses?.some((clause) => clause.evidenceIds?.length),
  );
  if (cases.length < MIN_RETRIEVAL_CASES) {
    throw new Error(
      `Retrieval evaluation requires at least ${MIN_RETRIEVAL_CASES} evidence-backed cases; found ${cases.length}.`,
    );
  }
  const retriever = Retriever.fromIndexFile();
  const evaluations: RetrievalEvaluation[] = [];
  const latenciesMs: number[] = [];
  for (const item of cases) {
    const startedAt = performance.now();
    const result = await retriever.retrieve(
      retrievalQuery(item.question, expandRetrievalQuery(item.question)),
      10,
    );
    latenciesMs.push(performance.now() - startedAt);
    const expectedIds = item.expected.clauses?.flatMap((clause) => clause.evidenceIds ?? []) ?? [];
    const expected = new Set(expectedIds);
    evaluations.push({
      expectedIds,
      // One chunk is one rank even though it links both its precise excerpt and
      // canonical parent record.
      rankedIds: result.candidates.map(({ chunk }) =>
        chunk.evidenceIds.find((id) => expected.has(id)) ?? chunk.evidenceIds[0],
      ),
    });
  }
  const recall = recallAtK(evaluations, 10);
  const mrr = meanReciprocalRank(evaluations);
  const ndcg = ndcgAtK(evaluations, 10);
  const p50LatencyMs = percentile(latenciesMs, 0.5);
  const p95LatencyMs = percentile(latenciesMs, 0.95);
  console.log(
    `Retrieval: Recall@10=${recall.toFixed(3)} MRR=${mrr.toFixed(3)} NDCG@10=${ndcg.toFixed(3)} ` +
      `latency-p50=${p50LatencyMs.toFixed(2)}ms latency-p95=${p95LatencyMs.toFixed(2)}ms (${cases.length} cases)`,
  );
  console.log(reliabilityVersionSummary());
  if (recall < 0.99) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
