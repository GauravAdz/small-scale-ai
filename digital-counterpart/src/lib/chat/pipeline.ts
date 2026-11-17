import type { EnvConfig } from "@/lib/config";
import { citationsForPlan } from "@/lib/evidence/citations";
import { answerExactFact } from "@/lib/evidence/exact-facts";
import { createFactStore } from "@/lib/evidence/fact-store";
import { decomposeQuestion, type AtomicQuestion } from "@/lib/evidence/question";
import {
  selectProjectsForQuestion,
  type ProjectSelection,
} from "@/lib/evidence/project-ranking";
import {
  isInstructionBoundaryDecision,
  type SupportAssessment,
  type SupportStatus,
} from "@/lib/evidence/support";
import { DefaultEvidenceVerifier, type ComplexEvidenceVerifier } from "@/lib/evidence/verifier";
import { AiSdkEvidenceVerifier } from "@/lib/evidence/model-verifier";
import { answerCanonicalBackgroundSummary } from "@/lib/evidence/background-summary";
import { skillParts, type Profile, type ProjectSummary } from "@/lib/knowledge/schema";
import { buildFactualPlan, claimsFromPlan } from "@/lib/llm/answer-plan";
import { naturalAnswerPlan, type NaturalAnswerModel } from "@/lib/llm/natural-answer";
import type { AnswerCache } from "@/lib/llm/answer-cache";
import type { VerifiedClaim } from "@/lib/evidence/types";
import { renderFactualPlan } from "@/lib/llm/renderer";
import { retrievalQuery } from "@/lib/rag/query";
import type { Citation } from "@/lib/rag/types";
import type { Retriever } from "@/lib/rag/retriever";
import type { CounterpartMessage } from "@/types/chat";
import { conversationContextFromMessages } from "./conversation-replay";
import { describesRememberedWork, expandRetrievalQuery } from "./intent";
import { projectVisual, projectsVisual } from "./visual-data";
import { resolveQuestion } from "./resolve-question";
import { guardBeforeRetrieval } from "./scope-guard";
import { chooseVisual, followUpsFor } from "./visual-intent";
import type { FollowUp, Visual } from "./visual-types";
import { sha256 } from "@/lib/knowledge/manifest";
import { traced, TRACE_NAMES } from "@/lib/observability/tracing";
import { RELIABILITY_VERSIONS } from "@/lib/versions";
import counterpartConfig from "../../../counterpart.config";
import { selectUnderstandingEvidence } from "@/lib/rag/verification-context";
import { CachedEvidenceVerifier } from "@/lib/evidence/cached-verifier";
import { sharedVerificationCache, type VerificationCache } from "@/lib/evidence/verification-cache";
import { verificationObserver, type VerificationObserver } from "@/lib/observability/verification";
import type { TurnStage } from "./visual-types";
import { mapIndependentClauses } from "./clause-concurrency";
import { INSTRUCTION_BOUNDARY_RESPONSE } from "./instruction-boundary";
import { normalizeQuerySurface } from "./query-surface";
import { AiSdkSemanticQueryInterpreter } from "./model-query-interpreter";
import {
  deterministicUnderstoodQuery,
  understandQuery,
  type SemanticQueryInterpreter,
  type UnderstoodQuery,
} from "./query-understanding";

export const PIPELINE_VERSION = RELIABILITY_VERSIONS.pipeline;
export type PresentationMode = "direct-safe" | "naturalize" | "synthesize";

export type PipelineAnswer = Readonly<{
  text: string;
  citations: Citation[];
  visual: Visual | null;
  followUps: FollowUp[];
  support: SupportStatus | "mixed";
  detail: string;
  assessments: readonly SupportAssessment[];
  resolvedQuestion: string;
  renderedClaims: readonly VerifiedClaim[];
  rendering: "natural" | "deterministic";
  presentation: PresentationMode;
  understoodQuery: UnderstoodQuery;
}>;

export type PipelineOutcome =
  | { kind: "local"; text: string; understoodQuery?: UnderstoodQuery }
  | { kind: "answer"; answer: PipelineAnswer };

function combinedSupport(assessments: readonly SupportAssessment[]): SupportStatus | "mixed" {
  const statuses = new Set(assessments.map(({ status }) => status));
  return statuses.size === 1 ? assessments[0].status : "mixed";
}

function presentationMode(assessments: readonly SupportAssessment[]): PresentationMode {
  const claims = assessments.flatMap(({ claims }) => claims);
  if (
    assessments.every(({ method }) => method === "exact-fact") &&
    claims.every(({ kind }) => kind === "fact" || kind === "uncertainty")
  ) {
    return "direct-safe";
  }
  if (
    assessments.length > 1 ||
    assessments.some(({ method }) => method === "model") ||
    claims.some(({ kind }) => kind === "inference")
  ) {
    return "synthesize";
  }
  return "naturalize";
}

function attachProjectRelevance(
  visual: Visual,
  assessments: readonly SupportAssessment[],
): Visual {
  const claims = assessments.flatMap(({ claims: approved }) => approved);
  const attach = <T extends { evidenceIds: string[] }>(project: T): T => {
    const relevance = claims.find((claim) =>
      project.evidenceIds.some((evidenceId) => claim.evidenceIds.includes(evidenceId)),
    );
    return relevance ? { ...project, relevanceClaimId: relevance.id } : project;
  };

  switch (visual.kind) {
    case "projects":
      return { ...visual, projects: visual.projects.map(attach) };
    case "project-detail":
      return { ...visual, project: attach(visual.project) };
    case "evidence-atlas":
      {
        const projects = visual.data.projects.map(attach);
        const relevantProjects = projects.filter(({ relevanceClaimId }) => relevanceClaimId);
        if (relevantProjects.length === 0) {
          return { ...visual, data: { ...visual.data, projects } };
        }
        const relevantSlugs = new Set(relevantProjects.map(({ slug }) => slug));
        const capabilities = visual.data.capabilities
          .map((capability) => ({
            ...capability,
            projectSlugs: capability.projectSlugs.filter((slug) => relevantSlugs.has(slug)),
          }))
          .filter(({ projectSlugs }) => projectSlugs.length > 0);
        return {
          ...visual,
          data: { ...visual.data, capabilities, projects: relevantProjects },
        };
      }
    case "experience":
      return { ...visual, data: { ...visual.data, selfDirected: visual.data.selfDirected.map(attach) } };
    case "skills":
    case "education":
    case "availability":
    case "profile":
    case "profile-link":
    case "contact-form":
      return visual;
  }
}

function evidenceAwareVisual(
  assessments: readonly SupportAssessment[],
  projects: readonly ProjectSummary[],
  clauses: readonly AtomicQuestion[],
  understoodQuery: UnderstoodQuery,
  projectSelection: ProjectSelection | null,
): Visual | null {
  if (!assessments.some(({ status }) => status === "supported" || status === "partially-supported")) {
    return null;
  }
  // Unsupported clauses have no authority to select a card. Otherwise a mixed
  // question about a known location and an unknown technology could display a
  // broad skills visual that appears to support the unknown capability.
  const supportedQuestion = assessments
    .filter(({ status }) => status === "supported" || status === "partially-supported")
    .map(({ question: clauseQuestion }) => clauseQuestion)
    .join(" ");
  if (projectSelection) {
    const supportedEvidenceIds = assessments
      .filter(({ status }) => status === "supported" || status === "partially-supported")
      .flatMap(({ claims }) => claims.flatMap(({ evidenceIds }) => evidenceIds));
    const selectedSlugs = projectSelection.projects
      .map(({ slug }) => slug)
      .filter((slug) => supportedEvidenceIds.some((id) =>
        id === `evidence:projects/${slug}` || id.startsWith(`evidence:projects/${slug}#`)));
    if (selectedSlugs.length > 0) {
      return attachProjectRelevance({
        kind: "projects",
        heading: projectSelection.kind === "ranking"
          ? "Strongest work"
          : projectSelection.mode === "editorial" ? "Projects" : "Relevant projects",
        projects: projectsVisual(selectedSlugs),
      }, assessments);
    }
  }
  // Semantic identity comes from the assessed evidence, not a second guess
  // based on the visitor's approximate name or a retrieval ranking.
  const interpreted = assessments.filter(({ method, status }) => method === "model" &&
    (status === "supported" || status === "partially-supported"));
  // A disambiguation inference can cite a rejected alternative for contrast.
  // Prefer subjects supplying the actual answer facts over those comparison citations.
  const factIds = interpreted.flatMap(({ claims }) => claims.filter(({ kind }) => kind === "fact")
    .flatMap(({ evidenceIds }) => evidenceIds)).filter((id) => id.startsWith("evidence:projects/"));
  const focusIds = factIds.length ? factIds : interpreted.flatMap(({ evidenceIds }) => evidenceIds);
  const citedProjects = projects.filter(({ slug }) =>
    focusIds.some((id) => id === `evidence:projects/${slug}` || id.startsWith(`evidence:projects/${slug}#`)));
  const supportedQuestionIds = new Set(
    assessments
      .filter(({ status }) => status === "supported" || status === "partially-supported")
      .map(({ questionId }) => questionId),
  );
  const asksForCapabilityEvidence = clauses.some(
    ({ id, kind }) => supportedQuestionIds.has(id) && kind === "capability",
  );
  if (
    interpreted.length &&
    (describesRememberedWork(supportedQuestion) || asksForCapabilityEvidence)
  ) {
    if (!citedProjects.length) return null;
    const slugs = citedProjects.map(({ slug }) => slug);
    const single = slugs.length === 1 ? projectVisual(slugs[0]) : null;
    return attachProjectRelevance(single
      ? { kind: "project-detail", project: single }
      : { kind: "projects", heading: "Related work", projects: projectsVisual(slugs) }, assessments);
  }
  const everyClauseSupported = assessments.every(
    ({ status }) => status === "supported" || status === "partially-supported",
  );
  const visual = everyClauseSupported
    ? chooseVisual(understoodQuery)
    : chooseVisual(supportedQuestion);
  return visual ? attachProjectRelevance(visual, assessments) : null;
}

export type AnswerPortfolioQuestionInput = Readonly<{
  question: string;
  history: readonly CounterpartMessage[];
  profile: Profile;
  projects: readonly ProjectSummary[];
  env: EnvConfig;
  retriever: Retriever;
  /** Test/eval seam; production omits this and uses the configured provider. */
  complexVerifier?: ComplexEvidenceVerifier;
  requestId?: string;
  verificationCache?: VerificationCache;
  answerCache?: AnswerCache;
  naturalAnswerModel?: NaturalAnswerModel;
  /** Test/eval seam; production uses the configured structured interpreter. */
  semanticInterpreter?: SemanticQueryInterpreter;
  onVerificationEvent?: VerificationObserver;
  onProgress?: (stage: TurnStage) => void;
  abortSignal?: AbortSignal;
}>;

async function answerPortfolioQuestionInternal(
  input: AnswerPortfolioQuestionInput,
): Promise<PipelineOutcome> {
  const emit = verificationObserver(input.env, input.onVerificationEvent);
  let semanticRecoveryStarted: number | undefined;
  const observe: VerificationObserver = (event) => {
    if (event.name === "semantic_recovery_attempted") semanticRecoveryStarted = Date.now();
    emit(event);
    if (
      semanticRecoveryStarted !== undefined &&
      [
        "semantic_recovery_accepted",
        "semantic_recovery_ambiguous",
        "semantic_recovery_low_confidence",
        "semantic_recovery_unknown",
        "semantic_recovery_invalid",
        "semantic_recovery_failed",
      ].includes(event.name)
    ) {
      emit({ name: "semantic_recovery_ms", value: Date.now() - semanticRecoveryStarted });
      semanticRecoveryStarted = undefined;
    }
  };
  const observeLocalDecision = (query: UnderstoodQuery, method: string) => observe({
    name: "pipeline_decision",
    domain: query.domain,
    interactionKind: query.interaction.kind,
    targetKind: query.target.kind,
    targetId: query.target.id ?? query.qualifiers.institution,
    targetProject: query.target.kind === "project" ? query.target.id : undefined,
    channel: query.qualifiers.contactChannel,
    confidence: query.confidence,
    supportStatus: "local",
    verificationMethod: method,
    visualKind: "none",
    presentation: "direct-safe",
  });
  input.onProgress?.("resolving");
  const projectRefs = input.projects.map(({ slug, title }) => ({ slug, title }));
  const surfaceQuery = normalizeQuerySurface(input.question);
  const conversation = conversationContextFromMessages(
    input.history,
    projectRefs,
  );
  const baseTraceAttributes = {
    request_id: input.requestId ?? "unassigned",
    embedding_fingerprint: input.retriever.stats.embedding.fingerprint,
    index_digest: input.retriever.stats.indexDigest,
    model_provider: input.env.models.verifier.provider,
    model_name: input.env.models.verifier.model,
    pipeline_version: RELIABILITY_VERSIONS.pipeline,
    resolver_version: RELIABILITY_VERSIONS.resolver,
    retrieval_version: RELIABILITY_VERSIONS.retrieval,
    verifier_version: RELIABILITY_VERSIONS.verifier,
    verifier_prompt_version: RELIABILITY_VERSIONS.verifierPrompt,
    renderer_version: RELIABILITY_VERSIONS.renderer,
    renderer_prompt_version: RELIABILITY_VERSIONS.rendererPrompt,
    chunker_version: RELIABILITY_VERSIONS.chunker,
  };
  const resolutionStarted = Date.now();
  const resolution = await traced(input.env, TRACE_NAMES.resolution, {
    ...baseTraceAttributes,
    question_hash: sha256(input.question),
  }, () =>
    resolveQuestion({
      question: surfaceQuery,
      state: conversation.state,
      projectCandidates:
        conversation.projectCandidates.length > 0 ? conversation.projectCandidates : projectRefs,
      knownProjects: projectRefs,
    }),
  );
  observe({ name: "resolution_ms", value: Date.now() - resolutionStarted });
  const traceAttributes = {
    ...baseTraceAttributes,
    resolved_question_hash: sha256(resolution.resolved),
  };
  const unresolvedReference = resolution.kind === "unresolved-reference";

  const deterministicInterpretation = deterministicUnderstoodQuery({
    originalQuery: input.question,
    resolvedQuery: resolution.resolved,
    projects: projectRefs,
    institutions: input.profile.education.map(({ school }) => school),
    forceRecovery: unresolvedReference,
  });
  const initialScope = guardBeforeRetrieval(resolution.resolved, { profileName: input.profile.name });
  // Knowledge gaps still need a clause-level support result; scope/UI responses do not.
  if (initialScope.kind === "local" && initialScope.reason !== "knowledge-gap") {
    observeLocalDecision(deterministicInterpretation, initialScope.reason);
    return {
      kind: "local",
      text: initialScope.text,
      understoodQuery: deterministicInterpretation,
    };
  }

  const interpretationStarted = Date.now();
  const understanding = await traced(
    input.env,
    TRACE_NAMES.interpretation,
    {
      ...traceAttributes,
      deterministic_intent: deterministicInterpretation.interaction.kind,
      semantic_recovery_attempted:
        deterministicInterpretation.recoveryOutcome === "disabled" && input.env.semanticRecovery.enabled,
    },
    async (span) => {
      const result = await understandQuery({
        originalQuery: input.question,
        resolvedQuery: resolution.resolved,
        projects: projectRefs,
        skillNames: input.profile.skills.flatMap((group) =>
          group.items.map((item) => skillParts(item).name)),
        institutions: input.profile.education.map(({ school }) => school),
        enabled: input.env.semanticRecovery.enabled,
        forceRecovery: unresolvedReference,
        interpreter: input.semanticInterpreter ?? (
          input.env.semanticRecovery.enabled
            ? new AiSdkSemanticQueryInterpreter(input.env, input.abortSignal, observe)
            : undefined
        ),
        acceptConfidence: input.env.semanticRecovery.acceptConfidence,
        clarifyConfidence: input.env.semanticRecovery.clarifyConfidence,
        observe: (event) => {
          const target = event.interaction?.target;
          observe({
            name: event.name,
            confidence: event.confidence,
            interactionKind: event.interaction?.kind,
            targetKind: target?.kind,
            targetId: target?.kind === "project" ? target.slug
              : target?.kind === "education" ? target.institution
                : target?.kind === "skill" ? target.id : undefined,
            targetProject: target?.kind === "project" ? target.slug : undefined,
            channel: event.interaction?.channel,
            providerErrorType: event.providerErrorType,
            validationFailure: event.validationFailure,
          });
        },
      });
      span?.setAttributes({
        interpretation_source: result.query.source,
        semantic_recovery_result: result.query.recoveryOutcome,
        semantic_recovery_confidence: result.query.confidence,
        interaction_kind: result.query.interaction.kind,
        target_kind: result.query.interaction.target.kind,
        ...(result.query.interaction.target.kind === "project"
          ? { target_project: result.query.interaction.target.slug }
          : {}),
        ...(result.query.interaction.channel
          ? { channel: result.query.interaction.channel }
          : {}),
      });
      return result;
    },
  );
  observe({ name: "interpretation_ms", value: Date.now() - interpretationStarted });
  if (understanding.kind === "clarification") {
    observeLocalDecision(understanding.query, "clarification");
    return {
      kind: "local",
      text: counterpartConfig.scope.clarification,
      understoodQuery: understanding.query,
    };
  }
  const understoodQuery: UnderstoodQuery = resolution.kind === "resolved-evidence-challenge"
    ? {
        ...understanding.query,
        originalQuery: input.question,
        interaction: {
          kind: "evidence-challenge",
          target: understanding.query.interaction.target,
        },
      }
    : understanding.query;
  if (unresolvedReference && understoodQuery.source !== "semantic-recovery") {
    observeLocalDecision(understoodQuery, "unresolved-reference");
    return {
      kind: "local",
      text: "I can't resolve which recorded project that refers to. Name the project and I'll check it normally.",
      understoodQuery,
    };
  }
  if (understoodQuery.domain === "external") {
    observeLocalDecision(understoodQuery, "external");
    return {
      kind: "local",
      text: counterpartConfig.scope.redirect,
      understoodQuery,
    };
  }
  const early = guardBeforeRetrieval(understoodQuery.canonicalQuery, { profileName: input.profile.name });
  if (early.kind === "local" && early.reason !== "knowledge-gap") {
    observeLocalDecision(understoodQuery, early.reason);
    return { kind: "local", text: early.text, understoodQuery };
  }

  const projectSelection = understoodQuery.interaction.kind === "projects"
    ? selectProjectsForQuestion(understoodQuery.canonicalQuery, input.projects)
    : null;
  const factStore = createFactStore({
    profile: input.profile,
    projects: input.projects,
    evidence: input.retriever.allEvidence(),
    env: input.env,
    ...(projectSelection ? { projectSelection } : {}),
  });
  // Strict verification always owns a model verifier, even when configuration
  // is missing. Deterministic paths never call it; narrative paths surface a
  // typed provider failure instead of pretending the evidence is insufficient.
  const complexVerifier = input.env.features.claimVerification.kind === "strict"
    ? new CachedEvidenceVerifier({
        verifier: input.complexVerifier ?? new AiSdkEvidenceVerifier(input.env, observe, input.abortSignal),
        env: input.env,
        indexDigest: input.retriever.stats.indexDigest,
        observe,
        // Injected evaluators must explicitly supply a cache to avoid mixing
        // offline judgments with the real provider's process cache.
        cache: input.env.verificationCache.enabled
          ? input.verificationCache ?? (input.complexVerifier ? undefined : sharedVerificationCache(input.env.verificationCache))
          : undefined,
      })
    : undefined;
  const verifier = new DefaultEvidenceVerifier(factStore, complexVerifier);
  const clauses = decomposeQuestion(understoodQuery.canonicalQuery);
  input.onProgress?.("searching");
  let verifying = false;
  const results = await mapIndependentClauses(clauses, input.env.verificationBudget.concurrency, async (clause) => {
    const started = Date.now();
    try {
    input.abortSignal?.throwIfAborted();
    const backgroundSummary = answerCanonicalBackgroundSummary(clause, factStore);
    if (backgroundSummary) {
      observe({ name: "verification_deterministic" });
      observe({ name: "verification_ms", value: Date.now() - started });
      return { decision: backgroundSummary };
    }
    const exact = answerExactFact(
      clause,
      factStore,
      clauses.length === 1 ? understoodQuery : undefined,
    );
    if (exact) {
      observe({ name: "verification_deterministic" });
      observe({ name: "verification_ms", value: Date.now() - started });
      return { decision: exact };
    }
    const retrievalStarted = Date.now();
    const retrieval = await traced(
      input.env,
      TRACE_NAMES.retrieval,
      { ...traceAttributes, resolved_question_hash: sha256(clause.text) },
      async (span) => {
        const result = await input.retriever.retrieve(
          retrievalQuery(clause.text, expandRetrievalQuery(clause.text)),
          counterpartConfig.retrieval.candidateK,
        );
        span?.setAttributes({
          retrieval_mode: result.diagnostics.mode,
          candidate_count: result.candidates.length,
          fallback_reason: result.diagnostics.fallbackReason ?? "none",
        });
        return result;
      },
    );
    observe({ name: "retrieval_ms", value: Date.now() - retrievalStarted });
    observe({ name: "retrieval_candidate_count", value: retrieval.candidates.length });
    const evidenceLimit = Math.min(counterpartConfig.retrieval.verificationK, input.env.verificationBudget.maxEvidenceItemsPerCall);
    const evidence = selectUnderstandingEvidence(
      retrieval,
      input.retriever.allEvidence(),
      evidenceLimit,
      counterpartConfig.retrieval.verificationMaxCharacters,
    );
    observe({ name: "verification_evidence_count", value: evidence.length });
    if (input.env.features.claimVerification.kind === "exact-only") {
      observe({ name: "verification_deterministic" });
      observe({ name: "verification_ms", value: 0 });
      return { decision: {
        questionId: clause.id,
        question: clause.text,
        status: "insufficient",
        claims: [],
        evidenceIds: [],
        method: "extractive",
        reason: "Narrative claim verification is disabled; exact facts remain available.",
      } satisfies SupportAssessment };
    }
    if (!verifying) {
      input.onProgress?.("verifying");
      verifying = true;
    }
    const verificationStarted = Date.now();
    const decision = await traced(
        input.env,
        TRACE_NAMES.verification,
        { ...traceAttributes, candidate_count: evidence.length },
        async (span) => {
          const decision = await verifier.verify({ question: clause, candidateEvidence: evidence });
          if (decision.method !== "model") observe({ name: "verification_deterministic" });
          span?.setAttributes({
            support_status: isInstructionBoundaryDecision(decision) ? "instruction-boundary" : decision.status,
            evidence_count: isInstructionBoundaryDecision(decision) ? 0 : decision.evidenceIds.length,
            verification_method: decision.method,
          });
          return decision;
        },
      );
    observe({ name: "verification_ms", value: Date.now() - verificationStarted });
    return { decision };
    } finally {
      observe({ name: "verification_latency_ms", value: Date.now() - started });
    }
  });
  if (results.some(({ decision }) => isInstructionBoundaryDecision(decision))) {
    input.onProgress?.("writing");
    input.onProgress?.("done");
    observeLocalDecision(understoodQuery, "instruction-boundary");
    return { kind: "local", text: INSTRUCTION_BOUNDARY_RESPONSE };
  }
  const assessments = results.map(({ decision }) => decision as SupportAssessment);

  if (assessments.length === 0) {
    observeLocalDecision(understoodQuery, "empty-assessment");
    return { kind: "local", text: "Ask me a specific question about Gaurav's recorded work or background." };
  }

  const planningStarted = Date.now();
  const { plan, visual } = await traced(input.env, TRACE_NAMES.planning, traceAttributes, () => {
    const selectedVisual = evidenceAwareVisual(
      assessments,
      input.projects,
      clauses,
      understoodQuery,
      projectSelection,
    );
    return {
      visual: selectedVisual,
      plan: buildFactualPlan(assessments, {
        show: Boolean(selectedVisual),
        ...(selectedVisual?.kind === "projects"
          ? { projectSlugs: selectedVisual.projects.map(({ slug }) => slug) }
          : selectedVisual?.kind === "project-detail"
            ? { projectSlugs: [selectedVisual.project.slug] }
            : {}),
      }),
    };
  });
  observe({ name: "planning_ms", value: Date.now() - planningStarted });
  input.onProgress?.("writing");
  const presentation = presentationMode(assessments);
  const renderingStarted = Date.now();
  const renderedPlan = presentation === "direct-safe"
    ? plan
    : await traced(input.env, TRACE_NAMES.rendering, traceAttributes, () =>
        naturalAnswerPlan(plan, {
          env: input.env, indexDigest: input.retriever.stats.indexDigest,
          cache: input.answerCache, model: input.naturalAnswerModel,
          observe, abortSignal: input.abortSignal,
        }),
      );
  observe({ name: "rendering_ms", value: Date.now() - renderingStarted });
  const text = await renderFactualPlan(renderedPlan, understoodQuery.responseShape);
  const citations = await traced(input.env, TRACE_NAMES.citations, traceAttributes, () =>
    citationsForPlan(renderedPlan, [...factStore.evidenceById.values()]),
  );
  const support = combinedSupport(assessments);
  const supportedCount = assessments.filter(
    ({ status }) => status === "supported" || status === "partially-supported",
  ).length;
  const methods = [...new Set(assessments.map(({ method }) => method))];
  observe({
    name: "pipeline_decision",
    domain: understoodQuery.domain,
    interactionKind: understoodQuery.interaction.kind,
    targetKind: understoodQuery.target.kind,
    targetId: understoodQuery.target.id ?? understoodQuery.qualifiers.institution,
    targetProject: understoodQuery.target.kind === "project" ? understoodQuery.target.id : undefined,
    channel: understoodQuery.qualifiers.contactChannel,
    confidence: understoodQuery.confidence,
    supportStatus: support,
    verificationMethod: methods.join(","),
    visualKind: visual?.kind ?? "none",
    presentation,
  });
  input.onProgress?.("done");
  return {
    kind: "answer",
    answer: {
      text,
      citations,
      visual,
      followUps: followUpsFor(visual),
      support,
      detail: `${supportedCount}/${assessments.length} clause${assessments.length === 1 ? "" : "s"} supported`,
      assessments,
      resolvedQuestion: understoodQuery.canonicalQuery,
      renderedClaims: claimsFromPlan(renderedPlan),
      rendering: renderedPlan === plan ? "deterministic" : "natural",
      presentation,
      understoodQuery,
    },
  };
}

export async function answerPortfolioQuestion(
  input: AnswerPortfolioQuestionInput,
): Promise<PipelineOutcome> {
  const started = Date.now();
  try {
    return await answerPortfolioQuestionInternal(input);
  } finally {
    verificationObserver(input.env, input.onVerificationEvent)({
      name: "request_total_ms",
      value: Date.now() - started,
    });
  }
}
