import { loadEvalCases } from "../src/lib/evals/dataset";
import { runEvalCases } from "../src/lib/evals/runner";
import { Retriever } from "../src/lib/rag/retriever";
import { reliabilityVersionSummary } from "../src/lib/versions";
import { auditCitations } from "../src/lib/evals/validation";
import { runtimeFacts } from "../src/lib/runtime/facts";
import { readEnv } from "../src/lib/config";

async function main(): Promise<void> {
  const cases = loadEvalCases().filter((item) => !item.tags.includes("synthetic-fixture") && !item.tags.includes("integrity"));
  const predictions = await runEvalCases(cases);
  const valid = new Set([
    ...Retriever.fromIndexFile().allEvidence().map(({ id }) => id),
    ...runtimeFacts(readEnv()).map(({ evidence }) => evidence.id),
  ]);
  const { failures, totalCitations, validCitations, citableClaims, citedClaims } = auditCitations(predictions, valid);
  console.log(
    `Citations: precision=${(totalCitations ? validCitations / totalCitations : 1).toFixed(3)}` +
      ` recall=${(citableClaims ? citedClaims / citableClaims : 1).toFixed(3)}` +
      ` invalid-evidence-ID-rate=${(totalCitations ? (totalCitations - validCitations) / totalCitations : 0).toFixed(3)}`,
  );
  console.log(reliabilityVersionSummary());
  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
