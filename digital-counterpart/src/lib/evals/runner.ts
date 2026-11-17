import { answerPortfolioQuestion } from "@/lib/chat/pipeline";
import { readEnv, type EnvConfig } from "@/lib/config";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { Retriever } from "@/lib/rag/retriever";
import type { CounterpartMessage } from "@/types/chat";
import type { EvalCase, EvalPrediction } from "./schema";
import { abstainingOfflineVerifier } from "./offline-verifier";
import type { VerificationCache } from "@/lib/evidence/verification-cache";
import { recordOperations, type OperationalTurn } from "./operations";

function historyMessages(item: EvalCase): CounterpartMessage[] {
  return (item.history ?? []).map((turn, index) => ({
    id: `eval-history-${index}`,
    role: turn.role,
    parts: [{ type: "text", text: turn.text }],
  }));
}

export async function runEvalCases(cases: readonly EvalCase[], options: {
  env?: EnvConfig;
  live?: boolean;
  cache?: VerificationCache;
  onOperations?: (turn: OperationalTurn) => void;
} = {}): Promise<EvalPrediction[]> {
  const configured = options.env ?? readEnv();
  // Offline checks never spend tokens on the writer or contaminate its cache.
  const env = options.live ? configured : {
    ...configured,
    naturalAnswers: { ...configured.naturalAnswers, enabled: false },
    semanticRecovery: { ...configured.semanticRecovery, enabled: false },
  };
  const profile = loadProfile();
  const projects = loadProjects();
  const retriever = Retriever.fromIndexFile(undefined, env);
  const predictions: EvalPrediction[] = [];

  for (const item of cases) {
    if (item.tags.includes("synthetic-fixture") || item.tags.includes("integrity")) continue;
    const operations = recordOperations();
    const outcome = await answerPortfolioQuestion({
      question: item.question,
      history: historyMessages(item),
      profile,
      projects,
      env,
      retriever,
      complexVerifier: options.live ? undefined : abstainingOfflineVerifier,
      verificationCache: options.cache,
      onVerificationEvent: operations.observe,
    }).catch((error) => {
      operations.turn.failed = true;
      throw error;
    }).finally(() => options.onOperations?.(operations.turn));
    if (outcome.kind === "local") {
      predictions.push({ id: item.id, route: "local", supportAssessed: false, answer: outcome.text });
      continue;
    }
    predictions.push({
      id: item.id,
      route: "answer",
      resolvedQuestion: outcome.answer.resolvedQuestion,
      supportAssessed: outcome.answer.assessments.length > 0,
      supportAssessmentQuestions: outcome.answer.assessments.map(({ question }) => question),
      clauses: outcome.answer.assessments.map(({ questionId, status, evidenceIds }) => ({
        questionId,
        status,
        evidenceIds,
      })),
      claims: outcome.answer.renderedClaims.map((claim) => ({ ...claim, evidenceIds: [...claim.evidenceIds] })),
      answer: outcome.answer.text,
      visual: outcome.answer.visual?.kind,
      projectSlugs:
        outcome.answer.visual?.kind === "projects"
          ? outcome.answer.visual.projects.map(({ slug }) => slug)
          : outcome.answer.visual?.kind === "project-detail"
            ? [outcome.answer.visual.project.slug]
            : outcome.answer.visual?.kind === "evidence-atlas"
              ? outcome.answer.visual.data.projects.map(({ slug }) => slug)
              : outcome.answer.visual?.kind === "experience"
                ? outcome.answer.visual.data.selfDirected.map(({ slug }) => slug)
                : [],
      citations: outcome.answer.citations.flatMap((citation) =>
        citation.claimId && citation.evidenceId
          ? [{ claimId: citation.claimId, evidenceId: citation.evidenceId }]
          : [],
      ),
    });
  }
  return predictions;
}
