/** Explicit paid, complete-flow evaluation. Prints public portfolio answers only. */
import { answerPortfolioQuestion } from "../src/lib/chat/pipeline";
import { readEnv } from "../src/lib/config";
import { loadProfile, loadProjects } from "../src/lib/knowledge/loader";
import { Retriever } from "../src/lib/rag/retriever";
import { loadEvalCases } from "../src/lib/evals/dataset";
import { auditCitations, predictionFailures } from "../src/lib/evals/validation";
import { operationalMetrics, recordOperations, type OperationalTurn } from "../src/lib/evals/operations";
import { MemoryAnswerCache } from "../src/lib/llm/answer-cache";
import { AiNaturalAnswerModel, type NaturalAnswerModel } from "../src/lib/llm/natural-answer";
import { InMemoryVerificationCache } from "../src/lib/evidence/verification-cache";
import { runtimeFacts } from "../src/lib/runtime/facts";
import type { EvalPrediction } from "../src/lib/evals/schema";
import { EvidenceVerificationError, ProviderUnavailableError } from "../src/lib/errors";

async function main() {
  const env = readEnv({ ...process.env, LLM_RENDERER_ENABLED: "true",
    LLM_RENDERER_PROVIDER: process.env.LLM_RENDERER_PROVIDER || process.env.LLM_VERIFIER_PROVIDER,
    LLM_RENDERER_MODEL: process.env.LLM_RENDERER_MODEL || process.env.LLM_VERIFIER_MODEL });
  const retriever = Retriever.fromIndexFile(undefined, env);
  const profile = loadProfile(); const projects = loadProjects();
  const answerCache = new MemoryAnswerCache(env.naturalAnswers);
  const verificationCache = new InMemoryVerificationCache(env.verificationCache);
  const validEvidence = new Set([...retriever.allEvidence().map(({ id }) => id), ...runtimeFacts(env).map(({ evidence }) => evidence.id)]);
  const parents = new Map(retriever.allEvidence().map((e) => [e.id, `evidence:${e.docId}`]));
  const understanding = process.argv.includes("--understanding");
  const cases = loadEvalCases(understanding ? "evals/understanding" : undefined).filter((c) => !c.tags.includes("synthetic-fixture") && !c.tags.includes("integrity"));
  const inspect = process.argv.includes("--inspect-rewrites");
  const selected = process.argv.slice(2).filter((arg) => !["--inspect-rewrites", "--understanding"].includes(arg));
  if (selected.some((id) => !cases.some((item) => item.id === id))) throw new Error("Unknown evaluation case ID");
  const failures: string[] = []; const turns: OperationalTurn[] = [];
  let natural = 0; let answers = 0;
  for (const item of cases.filter((c) => !selected.length || selected.includes(c.id))) {
    const operations = recordOperations(); turns.push(operations.turn);
    const ai = new AiNaturalAnswerModel(env, operations.observe);
    const naturalAnswerModel: NaturalAnswerModel | undefined = inspect ? {
      rewrite: (input, signal, feedback) => ai.rewrite(input, signal, feedback),
      review: async (input, rewrite, signal) => {
        const review = await ai.review(input, rewrite, signal);
        console.log(JSON.stringify({ id: item.id, source: input, rewrite, review }));
        return review;
      },
    } : undefined;
    const result = await answerPortfolioQuestion({ question: item.question,
      history: (item.history ?? []).map((turn, i) => ({ id: `history-${i}`, role: turn.role, parts: [{ type: "text", text: turn.text }] })),
      env, profile, projects, retriever, answerCache, verificationCache, naturalAnswerModel, onVerificationEvent: operations.observe });
    if (result.kind === "local") {
      failures.push(...predictionFailures(item, { id: item.id, route: "local", answer: result.text })); continue;
    }
    answers++; if (result.answer.rendering === "natural") natural++;
    const a = result.answer;
    const prediction: EvalPrediction = { id: item.id, route: "answer", resolvedQuestion: a.resolvedQuestion,
      supportAssessed: true, clauses: a.assessments.map(({ questionId, status, evidenceIds }) => ({ questionId, status, evidenceIds: [...evidenceIds] })),
      claims: a.renderedClaims.map((c) => ({ ...c, evidenceIds: [...c.evidenceIds] })), answer: a.text,
      citations: a.citations.map((c) => ({ claimId: c.claimId!, evidenceId: c.evidenceId! })),
      visual: a.visual?.kind,
      projectSlugs: a.visual?.kind === "projects" ? a.visual.projects.map((p) => p.slug)
        : a.visual?.kind === "project-detail" ? [a.visual.project.slug]
        : a.visual?.kind === "evidence-atlas" ? a.visual.data.projects.map((p) => p.slug) : [],
    };
    // Literal phrase expectations apply to the factual plan, not its synonym-
    // allowing paraphrase. The independent runtime review checks all rewritten
    // propositions; provenance checks below use the ACTUAL displayed claims.
    const canonical = a.assessments.flatMap(({ claims }) => claims.map(({ text }) => text)).join(" ");
    failures.push(...predictionFailures({ ...item, expected: { ...item.expected, requiredFacts: [] } }, prediction, parents));
    for (const fact of item.expected.requiredFacts ?? []) if (!canonical.includes(fact)) failures.push(`${item.id}: source missing required fact`);
    failures.push(...auditCitations([prediction], validEvidence).failures);
    for (const citation of a.citations) {
      if (a.renderedClaims.find((c) => c.id === citation.claimId)?.text !== citation.claimText) failures.push(`${item.id}: citation text drift`);
    }
    console.log(JSON.stringify({ id: item.id, rendering: a.rendering, answer: a.text,
      fallbacks: operations.turn.events.filter((event) => event.name === "renderer_fallback").map((event) => event.rendererFallbackStage) }));
  }
  // Different visitors, different wording, same verified role-interest facts.
  const warm = recordOperations();
  const repeat = await answerPortfolioQuestion({ question: "What kind of roles is Gaurav interested in?", history: [], env, profile, projects, retriever, answerCache, verificationCache });
  const paraphrase = await answerPortfolioQuestion({ question: "Which types of jobs interest Gaurav?", history: [], env, profile, projects, retriever, answerCache, verificationCache, onVerificationEvent: warm.observe });
  if (repeat.kind !== "answer" || paraphrase.kind !== "answer" || repeat.answer.text !== paraphrase.answer.text ||
      !warm.turn.events.some((e) => e.name === "renderer_cache_hit") || warm.turn.events.some((e) => ["renderer_llm", "renderer_review_llm", "verification_llm"].includes(e.name))) {
    failures.push("Equivalent role questions did not reuse the approved answer without model calls");
  }
  if (answers === 0 || natural / answers < 0.9) failures.push("Fewer than 90% of factual answers used accepted natural wording");
  console.log(JSON.stringify({ evaluated: turns.length, answers, natural, paraphraseCacheHit: failures.every((f) => !f.startsWith("Equivalent")),
    operations: operationalMetrics(turns), failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error({ error_type: error instanceof Error ? error.name : "unknown",
    ...(error instanceof EvidenceVerificationError ? { reason: error.message } : {}),
    ...(error instanceof ProviderUnavailableError ? { provider: error.provider, model: error.model, code: error.code } : {}),
  });
  process.exitCode = 1;
});
