import { loadEvalCases } from "../src/lib/evals/dataset";
import { supportMetrics } from "../src/lib/evals/metrics";
import { runEvalCases } from "../src/lib/evals/runner";
import { reliabilityVersionSummary } from "../src/lib/versions";

async function main(): Promise<void> {
  const cases = loadEvalCases().filter(
    (item) => !item.tags.includes("synthetic-fixture") && !item.tags.includes("integrity") && item.expected.clauses?.length,
  );
  const predictions = new Map((await runEvalCases(cases)).map((item) => [item.id, item]));
  const evaluations = cases.flatMap((item) => {
    const actual = predictions.get(item.id)?.clauses ?? [];
    return (item.expected.clauses ?? []).map((clause, index) => ({
      expected: clause.status,
      actual: actual[index]?.status ?? "insufficient" as const,
    }));
  });
  const metrics = supportMetrics(evaluations);
  let statusMismatches = 0;
  console.log(
    `Support: precision=${metrics.precision.toFixed(3)} recall=${metrics.recall.toFixed(3)} false-support=${metrics.falseSupportRate.toFixed(3)} false-abstention=${metrics.falseAbstentionRate.toFixed(3)}` +
      ` contradiction-accuracy=${metrics.contradictionAccuracy.toFixed(3)} exact-status-accuracy=${metrics.exactStatusAccuracy.toFixed(3)}`,
  );
  console.log(reliabilityVersionSummary());
  cases.forEach((item) => {
    const actual = predictions.get(item.id)?.clauses ?? [];
    (item.expected.clauses ?? []).forEach((expected, index) => {
      if (
        expected.status !== actual[index]?.status &&
        !(predictions.get(item.id)?.route === "local" && expected.status === "insufficient")
      ) {
        statusMismatches += 1;
        console.error(`${item.id}[${index}]: expected ${expected.status}, got ${actual[index]?.status ?? "missing"}`);
      }
    });
  });
  if (metrics.falseSupportRate > 0 || statusMismatches > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
