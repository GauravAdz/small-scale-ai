import { loadEvalCases } from "../src/lib/evals/dataset";
import { runEvalCases } from "../src/lib/evals/runner";
import { reliabilityVersionSummary } from "../src/lib/versions";

async function main(): Promise<void> {
  const cases = loadEvalCases().filter((item) => item.tags.includes("followup") || item.tags.includes("history"));
  const predictions = new Map((await runEvalCases(cases)).map((item) => [item.id, item]));
  const failures: string[] = [];
  let resolutionCases = 0;
  let correctResolutions = 0;
  let historyCases = 0;
  let falseHistoryGrounding = 0;
  for (const item of cases) {
    const prediction = predictions.get(item.id);
    if (item.expected.mustAssessSupport && !prediction?.supportAssessed) failures.push(`${item.id}: support assessment bypassed`);
    if (item.expected.resolvedQuestion && prediction?.resolvedQuestion !== item.expected.resolvedQuestion) {
      failures.push(`${item.id}: resolved to ${JSON.stringify(prediction?.resolvedQuestion)}`);
    }
    if (item.expected.resolvedQuestion) {
      resolutionCases += 1;
      if (prediction?.resolvedQuestion === item.expected.resolvedQuestion) correctResolutions += 1;
    }
    if (item.tags.includes("history") && prediction?.citations?.some(({ evidenceId }) => evidenceId === "evidence:fake")) {
      failures.push(`${item.id}: assistant history became evidence`);
      falseHistoryGrounding += 1;
    }
    if (item.tags.includes("history")) historyCases += 1;
  }
  console.log(
    `Conversation: resolution-accuracy=${(resolutionCases ? correctResolutions / resolutionCases : 1).toFixed(3)}` +
      ` false-history-grounding-rate=${(historyCases ? falseHistoryGrounding / historyCases : 0).toFixed(3)}` +
      ` bypasses=${failures.filter((item) => item.includes("bypassed")).length}`,
  );
  console.log(reliabilityVersionSummary());
  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
