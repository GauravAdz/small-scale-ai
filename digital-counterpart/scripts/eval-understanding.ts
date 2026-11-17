/** Bounded paid semantic checks; fixtures alone cannot measure comprehension. */
import { readEnv } from "../src/lib/config";
import { loadEvalCases } from "../src/lib/evals/dataset";
import { runEvalCases } from "../src/lib/evals/runner";
import { auditCitations, predictionFailures } from "../src/lib/evals/validation";
import { Retriever } from "../src/lib/rag/retriever";
import { ProviderUnavailableError } from "../src/lib/errors";

async function main() {
  if (process.env.COUNTERPART_PAID_CHECKS !== "1") throw new Error("Use node scripts/verification/paid.mjs understanding --allow-paid.");
  const env = readEnv({ ...process.env, LLM_RENDERER_ENABLED: "false" });
  const records = Retriever.fromIndexFile(undefined, env).allEvidence();
  const parents = new Map(records.map((record) => [record.id, `evidence:${record.docId}`]));
  const ids = new Set(records.map(({ id }) => id));
  const requested = process.argv.slice(2);
  const allCases = loadEvalCases("evals/understanding");
  if (requested.some((id) => !allCases.some((item) => item.id === id))) throw new Error("Unknown semantic evaluation case ID.");
  const cases = requested.length ? allCases.filter(({ id }) => requested.includes(id)) : allCases;
  const failures: string[] = [];
  console.log(`Checking ${cases.length} remembered descriptions with ${env.models.verifier.provider}/${env.models.verifier.model}; writer disabled.`);
  for (const item of cases) {
    const [prediction] = await runEvalCases([item], { env, live: true });
    const errors = [...predictionFailures(item, prediction, parents), ...auditCitations([prediction], ids).failures];
    // A single-subject expectation must not acquire unrelated cards.
    if (item.expected.expectedProjectSlugs && JSON.stringify([...(prediction.projectSlugs ?? [])].sort()) !==
        JSON.stringify([...item.expected.expectedProjectSlugs].sort())) errors.push(`${item.id}: unrelated project visual`);
    if (item.expected.clauses?.every(({ status }) => status === "insufficient") && prediction.visual) errors.push(`${item.id}: unsupported visual`);
    failures.push(...errors);
    console.log(JSON.stringify({ id: item.id, passed: !errors.length, answer: prediction.answer, projects: prediction.projectSlugs, errors }));
  }
  console.log(`${cases.length - new Set(failures.map((f) => f.split(":")[0])).size}/${cases.length} semantic cases passed.`);
  if (failures.length) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof ProviderUnavailableError
    ? { error: error.name, provider: error.provider, model: error.model, code: error.code, upstreamErrorClass: error.upstreamErrorClass }
    : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
