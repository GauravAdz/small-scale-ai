/** Paid, explicit opt-in comparison using the same dataset schema and support metrics. */
import { readEnv } from "../src/lib/config";
import { loadEvalCases } from "../src/lib/evals/dataset";
import { supportMetrics, type SupportEvaluation } from "../src/lib/evals/metrics";
import { operationalMetrics, recordOperations, type OperationalTurn } from "../src/lib/evals/operations";
import { runEvalCases } from "../src/lib/evals/runner";
import { AiSdkEvidenceVerifier } from "../src/lib/evidence/model-verifier";
import { CachedEvidenceVerifier } from "../src/lib/evidence/cached-verifier";
import { InMemoryVerificationCache } from "../src/lib/evidence/verification-cache";
import { Retriever } from "../src/lib/rag/retriever";
import { providerErrorType } from "../src/lib/observability/verification";
import { ProviderUnavailableError } from "../src/lib/errors";
import { auditCitations, predictionFailures } from "../src/lib/evals/validation";
import { runtimeFacts } from "../src/lib/runtime/facts";

async function main() {
  const specs = process.argv.slice(2);
  if (!specs.length) throw new Error("Pass provider:model:inputUSDPerMillion:outputUSDPerMillion[:cachedInputUSDPerMillion]. No models are selected by default.");
  const directCases = loadEvalCases("evals/dataset/verifier");
  const portfolioCases = loadEvalCases().filter((item) => !item.tags.includes("synthetic-fixture") && !item.tags.includes("integrity"));
  const reports = [];
  for (const spec of specs) {
    const [provider, model, inputPrice, outputPrice, cachedPrice] = spec.split(":");
    if (!provider || !model) throw new Error("A provider and model are required.");
    const pricing = inputPrice !== undefined && outputPrice !== undefined
      ? { inputPerMillion: Number(inputPrice), outputPerMillion: Number(outputPrice), cachedInputPerMillion: Number(cachedPrice ?? inputPrice) }
      : undefined;
    if (pricing && Object.values(pricing).some((price) => !Number.isFinite(price) || price < 0)) throw new Error("Invalid model pricing.");
    const env = readEnv({ ...process.env, LLM_VERIFIER_PROVIDER: provider, LLM_VERIFIER_MODEL: model, LLM_RENDERER_ENABLED: "false" });
    const retriever = Retriever.fromIndexFile(undefined, env);
    const evidenceParents = new Map(retriever.allEvidence().map((record) => [record.id, `evidence:${record.docId}`]));
    const validEvidence = new Set([
      ...retriever.allEvidence().map(({ id }) => id),
      ...runtimeFacts(env).map(({ evidence }) => evidence.id),
    ]);
    const cache = new InMemoryVerificationCache(env.verificationCache);
    const turns: OperationalTurn[] = [];
    const evaluations: SupportEvaluation[] = [];
    const failures: string[] = [];
    let completed = 0;
    let unavailable = false;
    console.log(`Evaluating ${provider}/${model}: ${directCases.length} direct verifier cases + ${portfolioCases.length} portfolio cases.`);

    for (const item of directCases) {
      const operations = recordOperations();
      turns.push(operations.turn);
      try {
        const evidence = retriever.evidence(item.contextEvidenceIds ?? []);
        if (evidence.length !== item.contextEvidenceIds?.length) throw new Error("Evaluation context references missing evidence.");
        const verifier = new CachedEvidenceVerifier({
          env, indexDigest: retriever.stats.indexDigest, cache, observe: operations.observe,
          verifier: new AiSdkEvidenceVerifier(env, operations.observe),
        });
        const input = { question: { id: item.id, text: item.question, kind: "unknown" as const }, candidateEvidence: evidence };
        const assessment = await verifier.verify(input);
        const expected = item.expected.clauses![0];
        evaluations.push({ expected: expected.status, actual: assessment.status });
        if (expected.status !== assessment.status) failures.push(`${item.id}: expected ${expected.status}, received ${assessment.status}`);
        if (item.tags.includes("inference") && (expected.status === "supported" || expected.status === "partially-supported") && !assessment.claims.some(({ kind }) => kind === "inference")) failures.push(`${item.id}: inference not labelled`);
        for (const id of expected.evidenceIds ?? []) if (!assessment.evidenceIds.includes(id)) failures.push(`${item.id}: missing required citation ${id}`);
        const answer = assessment.claims.map(({ text }) => text).join(" ").toLowerCase();
        for (const fact of item.expected.requiredFacts ?? []) if (!answer.includes(fact.toLowerCase())) failures.push(`${item.id}: missing required fact`);
        for (const fact of item.expected.forbiddenClaims ?? []) if (answer.includes(fact.toLowerCase())) failures.push(`${item.id}: forbidden claim`);
        // Every successful result must be replayable without a second provider call.
        await verifier.verify(input);
        completed++;
      } catch (error) {
        operations.turn.failed = true;
        failures.push(`${item.id}: ${providerErrorType(error)}`);
        if (error instanceof ProviderUnavailableError) { unavailable = true; break; }
      }
    }
    if (!unavailable) for (const item of portfolioCases) {
      try {
        const [prediction] = await runEvalCases([item], { env, live: true, cache, onOperations: (turn) => turns.push(turn) });
        failures.push(...predictionFailures(item, prediction, evidenceParents), ...auditCitations([prediction], validEvidence).failures);
        for (const [index, expected] of (item.expected.clauses ?? []).entries()) {
          const actual = prediction.clauses?.[index]?.status;
          if (prediction.route === "local" && expected.status === "insufficient") continue;
          if (!actual) continue;
          evaluations.push({ expected: expected.status, actual });
        }
        completed++;
      } catch (error) {
        failures.push(`${item.id}: ${providerErrorType(error)}`);
        if (error instanceof ProviderUnavailableError) break;
      }
    }
    const reliable = failures.length === 0 && completed === directCases.length + portfolioCases.length;
    const report = { provider, model, completed, reliable, assessedClauses: evaluations.length, support: evaluations.length ? supportMetrics(evaluations) : null, operations: operationalMetrics(turns, pricing), failures };
    reports.push(report);
    console.log(JSON.stringify(report, null, 2));
  }
  const eligible = reports.filter((report) => report.reliable && report.operations.estimatedCostPer100Questions !== null)
    .sort((a, b) => a.operations.estimatedCostPer100Questions! - b.operations.estimatedCostPer100Questions!);
  console.log(eligible.length ? `Lowest measured cost passing candidate: ${eligible[0].provider}/${eligible[0].model}` : "No fully evaluated candidate met the reliability gate with measured cost. Production model selection remains open.");
  if (!eligible.length) process.exitCode = 1;
}
main().catch((error) => { console.error({ error_type: providerErrorType(error) }); process.exitCode = 1; });
