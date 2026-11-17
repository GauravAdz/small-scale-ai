import { loadEvalCases } from "../src/lib/evals/dataset";
import { runEvalCases } from "../src/lib/evals/runner";
import { reliabilityVersionSummary } from "../src/lib/versions";
import { inferenceIsLabelled, predictionFailures } from "../src/lib/evals/validation";
import { Retriever } from "../src/lib/rag/retriever";

async function main(): Promise<void> {
  const cases = loadEvalCases().filter((item) => !item.tags.includes("synthetic-fixture") && !item.tags.includes("integrity"));
  const predictions = new Map((await runEvalCases(cases)).map((item) => [item.id, item]));
  const evidenceParents = new Map(Retriever.fromIndexFile().allEvidence().map((record) => [record.id, `evidence:${record.docId}`]));
  const failures: string[] = [];
  let requiredValues = 0;
  let correctValues = 0;
  let expectedClauses = 0;
  let returnedClauses = 0;
  let inferenceCases = 0;
  let labelledInferenceCases = 0;
  let factualClaims = 0;
  let unsupportedFactualClaims = 0;
  for (const item of cases) {
    const prediction = predictions.get(item.id);
    if (prediction) failures.push(...predictionFailures(item, prediction, evidenceParents));
    else failures.push(`${item.id}: missing prediction`);
    const answer = prediction?.answer ?? "";
    for (const fact of item.expected.requiredFacts ?? []) {
      requiredValues += 1;
      if (answer.includes(fact)) correctValues += 1;
      if (!answer.includes(fact)) failures.push(`${item.id}: missing exact value ${JSON.stringify(fact)}`);
    }
    for (const claim of item.expected.forbiddenClaims ?? []) {
      if (answer.toLowerCase().includes(claim.toLowerCase())) failures.push(`${item.id}: contains forbidden claim ${JSON.stringify(claim)}`);
    }
    if (item.expected.expectedVisual && prediction?.visual !== item.expected.expectedVisual) {
      failures.push(`${item.id}: expected visual ${item.expected.expectedVisual}, got ${prediction?.visual ?? "none"}`);
    }
    for (const slug of item.expected.expectedProjectSlugs ?? []) {
      if (!prediction?.projectSlugs?.includes(slug)) {
        failures.push(`${item.id}: missing expected project visual ${slug}`);
      }
    }
    expectedClauses += item.expected.clauses?.length ?? 0;
    returnedClauses += Math.min(item.expected.clauses?.length ?? 0, prediction?.clauses?.length ?? 0);
    for (const claim of prediction?.claims ?? []) {
      if (claim.kind === "fact") {
        factualClaims += 1;
        if (claim.evidenceIds.length === 0) unsupportedFactualClaims += 1;
      }
    }
    if (item.tags.includes("inference")) {
      inferenceCases += 1;
      if (inferenceIsLabelled(item, prediction)) {
        labelledInferenceCases += 1;
      } else failures.push(`${item.id}: inference not labelled`);
    }
  }
  console.log(
    `Answer: passed=${cases.length - new Set(failures.map((failure) => failure.split(":")[0])).size}/${cases.length}` +
      ` unsupported-factual-claim-rate=${(factualClaims ? unsupportedFactualClaims / factualClaims : 0).toFixed(3)}` +
      ` exact-value-accuracy=${(requiredValues ? correctValues / requiredValues : 1).toFixed(3)}` +
      ` multi-clause-completeness=${(expectedClauses ? returnedClauses / expectedClauses : 1).toFixed(3)}` +
      ` inference-labelling=${(inferenceCases ? labelledInferenceCases / inferenceCases : 1).toFixed(3)}`,
  );
  console.log(reliabilityVersionSummary());
  for (const failure of failures) console.error(failure);
  if (failures.length > 0 || unsupportedFactualClaims > 0 || correctValues !== requiredValues || returnedClauses !== expectedClauses) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
