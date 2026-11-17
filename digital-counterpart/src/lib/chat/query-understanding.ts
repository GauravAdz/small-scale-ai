import { z } from "zod";

import {
  SemanticRecoveryInvalidError,
  SemanticRecoveryUnavailableError,
} from "@/lib/errors";
import {
  interactionIntentKinds,
  interpretInteraction,
  type InteractionIntent,
  type InteractionIntentKind,
  type InteractionTarget,
} from "./interaction-intent";
import {
  describesRememberedWork,
  detectTopics,
  isGreeting,
  isIdentityQuestion,
  offDomainReason,
} from "./intent";
import type { ProfileLinkChannel } from "./visual-types";

export const queryAspects = [
  "overview",
  "repository",
  "technology-stack",
  "status",
  "role",
  "skills",
  "proficiency",
  "contact",
] as const;

export type QueryAspect = (typeof queryAspects)[number];
export type DomainMembership = "portfolio" | "external" | "ambiguous";
export type LocationRelation =
  | "based"
  | "lives"
  | "from"
  | "origin"
  | "nationality"
  | "birthplace";
export type ResponseShape = Readonly<{
  mode: "normal" | "keywords" | "sentence" | "brief";
  count?: number;
}>;
export type SemanticTarget = Readonly<{
  kind: "profile" | "project" | "education" | "skill" | "experience" | "portfolio" | "assistant" | "surface" | "unknown";
  id?: string;
}>;
export type QueryQualifiers = Readonly<{
  institution?: string;
  locationRelation?: LocationRelation;
  contactChannel?: ProfileLinkChannel;
}>;
export type InterpretationSource = "deterministic" | "semantic-recovery";
export type RecoveryOutcome =
  | "not-needed"
  | "disabled"
  | "accepted"
  | "ambiguous"
  | "low-confidence"
  | "unknown"
  | "invalid"
  | "failed";

export type UnderstoodQuery = Readonly<{
  originalQuery: string;
  resolvedQuery: string;
  canonicalQuery: string;
  domain: DomainMembership;
  interaction: InteractionIntent;
  target: SemanticTarget;
  qualifiers: QueryQualifiers;
  responseShape: ResponseShape;
  aspect?: QueryAspect;
  source: InterpretationSource;
  confidence: number;
  ambiguous: boolean;
  recoveryOutcome: RecoveryOutcome;
}>;

export const semanticInterpretationSchema = z.object({
  canonicalQuery: z.string().trim().min(1).max(500),
  domain: z.enum(["portfolio", "external", "ambiguous"]),
  intent: z.enum(interactionIntentKinds),
  targetKind: z.enum(["profile", "portfolio", "project", "education", "skill", "experience", "assistant", "surface", "unknown"]),
  projectSlug: z.string().trim().min(1).max(100).nullable(),
  channel: z.enum(["github", "linkedin", "email", "website", "resume"]).nullable(),
  aspect: z.enum(queryAspects).nullable(),
  confidence: z.number().min(0).max(1),
  ambiguous: z.boolean(),
}).strict();

export type SemanticInterpretation = z.infer<typeof semanticInterpretationSchema>;

export type SemanticInterpretationInput = Readonly<{
  resolvedQuery: string;
  deterministicIntent: InteractionIntent;
  projects: readonly Readonly<{ slug: string; title: string }>[];
  skillNames: readonly string[];
  institutions?: readonly string[];
}>;

export interface SemanticQueryInterpreter {
  interpret(input: SemanticInterpretationInput): Promise<unknown>;
}

export type UnderstandingEvent = Readonly<{
  name:
    | "semantic_recovery_attempted"
    | "semantic_recovery_accepted"
    | "semantic_recovery_ambiguous"
    | "semantic_recovery_low_confidence"
    | "semantic_recovery_unknown"
    | "semantic_recovery_invalid"
    | "semantic_recovery_failed";
  confidence?: number;
  interaction?: InteractionIntent;
  providerErrorType?: "configuration" | "timeout" | "rate-limit" | "provider-unavailable";
  validationFailure?: SemanticRecoveryInvalidError["reason"];
}>;

export type QueryUnderstandingResult =
  | Readonly<{ kind: "understood"; query: UnderstoodQuery }>
  | Readonly<{ kind: "clarification"; query: UnderstoodQuery }>;

const TARGET_FOR_INTENT: Readonly<Record<InteractionIntentKind, InteractionTarget["kind"]>> = {
  "profile-overview": "profile",
  "contact-info": "profile",
  "contact-message": "profile",
  "profile-link": "profile",
  "project-link": "project",
  "project-repository-discovery": "portfolio",
  "hiring-evidence": "profile",
  "hiring-availability": "profile",
  "evidence-case": "profile",
  "evidence-challenge": "profile",
  "project-detail": "project",
  philosophy: "profile",
  projects: "portfolio",
  skills: "skill",
  education: "education",
  experience: "experience",
  about: "profile",
  unknown: "unknown",
};

const ALLOWED_ASPECTS: Readonly<Partial<Record<InteractionIntentKind, readonly QueryAspect[]>>> = {
  "profile-overview": ["overview"],
  "contact-info": ["contact"],
  "contact-message": ["contact"],
  "profile-link": ["contact"],
  "project-link": ["repository"],
  "project-repository-discovery": ["repository"],
  "hiring-evidence": ["role", "skills"],
  "hiring-availability": ["role"],
  "project-detail": ["overview", "repository", "technology-stack", "status", "role", "skills"],
  projects: ["overview", "repository", "technology-stack", "skills"],
  skills: ["skills", "proficiency"],
  education: ["overview"],
  experience: ["overview", "role"],
  about: ["overview"],
};

function targetFrom(
  kind: SemanticInterpretation["targetKind"],
  projectSlug: string | null,
): InteractionTarget {
  switch (kind) {
    case "profile":
      return { kind };
    case "portfolio":
      return { kind };
    case "project":
      if (!projectSlug) {
        throw new SemanticRecoveryInvalidError(
          "Recovered project target has no slug.",
          "unknown_project_slug",
        );
      }
      return { kind, slug: projectSlug };
    case "education":
    case "skill":
    case "experience":
    case "assistant":
    case "surface":
      return { kind };
    case "unknown":
      return { kind };
  }
}

/** Validate model output against relationships the wire schema cannot express. */
export function validateSemanticInterpretation(
  value: unknown,
  projects: readonly Readonly<{ slug: string; title: string }>[],
): { canonicalQuery: string; domain: DomainMembership; interaction: InteractionIntent; aspect?: QueryAspect; confidence: number; ambiguous: boolean } {
  const parsed = semanticInterpretationSchema.safeParse(value);
  if (!parsed.success) {
    const invalidFields = new Set(parsed.error.issues.map(({ path }) => path[0]));
    const reason = invalidFields.has("confidence")
      ? "invalid_confidence"
      : invalidFields.has("channel")
        ? "invalid_channel"
        : invalidFields.has("aspect")
          ? "invalid_aspect"
          : "schema_parse_failure";
    throw new SemanticRecoveryInvalidError(
      "Semantic recovery returned malformed structured output.",
      reason,
    );
  }

  const candidate = parsed.data;
  if (TARGET_FOR_INTENT[candidate.intent] !== candidate.targetKind) {
    throw new SemanticRecoveryInvalidError(
      "Semantic recovery returned an impossible intent and target combination.",
      "invalid_intent_target_pair",
    );
  }
  if (candidate.targetKind === "project") {
    if (!candidate.projectSlug || !projects.some(({ slug }) => slug === candidate.projectSlug)) {
      throw new SemanticRecoveryInvalidError(
        "Semantic recovery returned an unknown project slug.",
        "unknown_project_slug",
      );
    }
  } else if (candidate.projectSlug !== null) {
    throw new SemanticRecoveryInvalidError(
      "Semantic recovery attached a project slug to a non-project target.",
      "unknown_project_slug",
    );
  }
  if (candidate.intent === "profile-link") {
    if (!candidate.channel) {
      throw new SemanticRecoveryInvalidError(
        "Recovered profile-link intent has no channel.",
        "invalid_channel",
      );
    }
  } else if (candidate.channel !== null) {
    throw new SemanticRecoveryInvalidError(
      "Semantic recovery attached a channel to a non-profile-link intent.",
      "invalid_channel",
    );
  }
  if (candidate.aspect) {
    const allowed = ALLOWED_ASPECTS[candidate.intent];
    if (!allowed?.includes(candidate.aspect)) {
      throw new SemanticRecoveryInvalidError(
        "Semantic recovery returned an incompatible aspect.",
        "invalid_aspect",
      );
    }
  }
  if (candidate.domain === "external" && (candidate.intent !== "unknown" || candidate.targetKind !== "unknown")) {
    throw new SemanticRecoveryInvalidError(
      "External recovery cannot attach a portfolio intent.",
      "invalid_intent_target_pair",
    );
  }
  if (candidate.domain === "ambiguous" && !candidate.ambiguous) {
    throw new SemanticRecoveryInvalidError(
      "Ambiguous domain requires an ambiguous result.",
      "invalid_confidence",
    );
  }

  return {
    canonicalQuery: candidate.canonicalQuery,
    domain: candidate.domain,
    interaction: {
      kind: candidate.intent,
      target: targetFrom(candidate.targetKind, candidate.projectSlug),
      ...(candidate.channel ? { channel: candidate.channel as ProfileLinkChannel } : {}),
    },
    ...(candidate.aspect ? { aspect: candidate.aspect } : {}),
    confidence: candidate.confidence,
    ambiguous: candidate.ambiguous,
  };
}

function semanticTarget(interaction: InteractionIntent): SemanticTarget {
  return interaction.target.kind === "project"
    ? { kind: "project", id: interaction.target.slug }
    : { kind: interaction.target.kind };
}

function responseShape(query: string): ResponseShape {
  const words = query.match(/\b(?:in|using)\s+(\d{1,2})\s+words?\b/i);
  if (words) {
    const count = Number(words[1]);
    if (count >= 1 && count <= 12) return { mode: "keywords", count };
  }
  if (/\b(?:in|using) (?:one|a single) sentence\b/i.test(query)) {
    return { mode: "sentence" };
  }
  if (/\b(?:briefly|brief|concise(?:ly)?|short answer)\b/i.test(query)) {
    return { mode: "brief" };
  }
  return { mode: "normal" };
}

function locationRelation(query: string): LocationRelation | undefined {
  if (/\bnationality\b/i.test(query)) return "nationality";
  if (/\b(?:born|birthplace|place of birth)\b/i.test(query)) return "birthplace";
  if (/\borigin\b/i.test(query)) return "origin";
  if (/\bfrom\b/i.test(query)) return "from";
  if (/\b(?:live|lives|living)\b/i.test(query)) return "lives";
  if (/\b(?:currently located|current location|located in|location)\b/i.test(query)) return "based";
  if (/\bwhere\b.{0,40}\bbased\b|\bbased in\b/i.test(query)) return "based";
  return undefined;
}

function institutionQualifier(
  query: string,
  institutions: readonly string[],
): string | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalized = normalize(query);
  const exact = institutions.find((institution) =>
    (` ${normalized} `).includes(` ${normalize(institution)} `));
  if (exact) return exact;
  const acronym = institutions.find((institution) => {
    const words = institution.match(/[A-Za-z0-9]+/g) ?? [];
    const university = words.findIndex((word) => word.toLowerCase() === "university");
    const meaningful = university >= 0 ? words.slice(0, university + 1) : words;
    const alias = meaningful.map((word) => word[0]).join("");
    return alias.length >= 2 && new RegExp(`\\b${alias}\\b`, "i").test(query);
  });
  if (acronym) return acronym;
  return query.match(/\b(?:[A-Z][\w’'-]*\s+){0,5}(?:School|University|College|Institute)\b/)?.[0]?.trim();
}

function qualifiersFor(
  query: string,
  interaction: InteractionIntent,
  institutions: readonly string[],
): QueryQualifiers {
  const institution = institutionQualifier(query, institutions);
  const relation = locationRelation(query);
  return {
    ...(institution ? { institution } : {}),
    ...(relation ? { locationRelation: relation } : {}),
    ...(interaction.channel ? { contactChannel: interaction.channel } : {}),
  };
}

function domainFor(
  query: string,
  interaction: InteractionIntent,
  forceRecovery: boolean,
): DomainMembership {
  if (offDomainReason(query)) return "external";
  if (isGreeting(query) || isIdentityQuestion(query)) return "portfolio";
  if (forceRecovery || interaction.kind === "unknown") return "ambiguous";
  return "portfolio";
}

function uncertainDeterministicInterpretation(
  query: string,
  interaction: InteractionIntent,
): boolean {
  if (interaction.kind === "unknown") return true;
  const topics = detectTopics(query);
  if (topics.has("contact") && (topics.has("skills") || topics.has("projects"))) return true;
  if (
    interaction.kind === "projects" &&
    interaction.target.kind === "portfolio" &&
    describesRememberedWork(query)
  ) {
    return true;
  }
  const terseExperience = query
    .trim()
    .replace(/[?!.]+$/, "")
    .match(/^([a-z][a-z0-9+#.-]*(?:\s+[a-z][a-z0-9+#.-]*)?)\s+experience$/i)?.[1]
    ?.toLowerCase();
  return Boolean(terseExperience && !["work", "professional", "career", "employment"].includes(terseExperience));
}

function deterministicQuery(
  originalQuery: string,
  resolvedQuery: string,
  projects: readonly Readonly<{ slug: string; title: string }>[],
  institutions: readonly string[] = [],
  forceRecovery = false,
): UnderstoodQuery {
  const interaction = interpretInteraction(resolvedQuery, projects);
  const uncertain = forceRecovery || uncertainDeterministicInterpretation(resolvedQuery, interaction);
  return {
    originalQuery,
    resolvedQuery,
    canonicalQuery: resolvedQuery,
    domain: domainFor(resolvedQuery, interaction, forceRecovery),
    interaction,
    target: semanticTarget(interaction),
    qualifiers: qualifiersFor(resolvedQuery, interaction, institutions),
    responseShape: responseShape(originalQuery),
    source: "deterministic",
    confidence: uncertain ? 0.35 : 1,
    ambiguous: false,
    recoveryOutcome: uncertain ? "disabled" : "not-needed",
  };
}

function semanticRecoveryErrorType(
  error: SemanticRecoveryUnavailableError,
): NonNullable<UnderstandingEvent["providerErrorType"]> {
  if (error.code === "missing_configuration") return "configuration";
  if (error.code === "TimeoutError" || error.code === "AbortError" || error.code === "http_408") {
    return "timeout";
  }
  if (error.code === "http_429") return "rate-limit";
  return "provider-unavailable";
}

export function deterministicUnderstoodQuery(input: {
  originalQuery: string;
  resolvedQuery: string;
  projects: readonly Readonly<{ slug: string; title: string }>[];
  institutions?: readonly string[];
  forceRecovery?: boolean;
}): UnderstoodQuery {
  return deterministicQuery(
    input.originalQuery,
    input.resolvedQuery,
    input.projects,
    input.institutions ?? [],
    input.forceRecovery,
  );
}

/**
 * Resolve meaning before evidence work. Provider failures retain the resolved
 * proposition, so semantic recovery can improve comprehension but never become
 * a prerequisite for the existing evidence pipeline.
 */
export async function understandQuery(input: {
  originalQuery: string;
  resolvedQuery: string;
  projects: readonly Readonly<{ slug: string; title: string }>[];
  skillNames: readonly string[];
  institutions?: readonly string[];
  enabled: boolean;
  /** Reference resolution could not bind a deictic phrase deterministically. */
  forceRecovery?: boolean;
  interpreter?: SemanticQueryInterpreter;
  acceptConfidence: number;
  clarifyConfidence: number;
  observe?: (event: UnderstandingEvent) => void;
}): Promise<QueryUnderstandingResult> {
  const deterministic = deterministicQuery(
    input.originalQuery,
    input.resolvedQuery,
    input.projects,
    input.institutions ?? [],
    input.forceRecovery,
  );
  if (deterministic.recoveryOutcome === "not-needed") {
    return { kind: "understood", query: deterministic };
  }
  if (!input.enabled || !input.interpreter) {
    return { kind: "understood", query: deterministic };
  }

  input.observe?.({ name: "semantic_recovery_attempted", interaction: deterministic.interaction });
  try {
    const recovered = validateSemanticInterpretation(await input.interpreter.interpret({
      resolvedQuery: input.resolvedQuery,
      deterministicIntent: deterministic.interaction,
      projects: input.projects,
      skillNames: input.skillNames,
      institutions: input.institutions ?? [],
    }), input.projects);
    const semantic: UnderstoodQuery = {
      ...deterministic,
      canonicalQuery: recovered.canonicalQuery,
      domain: recovered.domain,
      interaction: recovered.interaction,
      target: semanticTarget(recovered.interaction),
      qualifiers: qualifiersFor(
        recovered.canonicalQuery,
        recovered.interaction,
        input.institutions ?? [],
      ),
      responseShape: responseShape(input.originalQuery),
      ...(recovered.aspect ? { aspect: recovered.aspect } : {}),
      source: "semantic-recovery",
      confidence: recovered.confidence,
      ambiguous: recovered.ambiguous,
      recoveryOutcome: "accepted",
    };

    if (recovered.ambiguous || (
      recovered.interaction.kind !== "unknown" &&
      recovered.confidence >= input.clarifyConfidence &&
      recovered.confidence < input.acceptConfidence
    )) {
      const query = { ...semantic, ambiguous: true, recoveryOutcome: "ambiguous" as const };
      input.observe?.({ name: "semantic_recovery_ambiguous", confidence: recovered.confidence, interaction: recovered.interaction });
      return { kind: "clarification", query };
    }
    if (recovered.domain === "external") {
      if (recovered.confidence < input.acceptConfidence) {
        input.observe?.({ name: "semantic_recovery_low_confidence", confidence: recovered.confidence, interaction: recovered.interaction });
        return { kind: "understood", query: { ...deterministic, recoveryOutcome: "low-confidence" } };
      }
      input.observe?.({ name: "semantic_recovery_accepted", confidence: recovered.confidence, interaction: recovered.interaction });
      return { kind: "understood", query: semantic };
    }
    if (recovered.interaction.kind === "unknown") {
      input.observe?.({ name: "semantic_recovery_unknown", confidence: recovered.confidence, interaction: recovered.interaction });
      return { kind: "understood", query: { ...deterministic, recoveryOutcome: "unknown" } };
    }
    if (recovered.confidence < input.acceptConfidence) {
      input.observe?.({ name: "semantic_recovery_low_confidence", confidence: recovered.confidence, interaction: recovered.interaction });
      return { kind: "understood", query: { ...deterministic, recoveryOutcome: "low-confidence" } };
    }

    input.observe?.({ name: "semantic_recovery_accepted", confidence: recovered.confidence, interaction: recovered.interaction });
    return { kind: "understood", query: semantic };
  } catch (error) {
    if (error instanceof SemanticRecoveryInvalidError) {
      input.observe?.({
        name: "semantic_recovery_invalid",
        validationFailure: error.reason,
      });
      return { kind: "understood", query: { ...deterministic, recoveryOutcome: "invalid" } };
    }
    if (error instanceof SemanticRecoveryUnavailableError) {
      input.observe?.({
        name: "semantic_recovery_failed",
        providerErrorType: semanticRecoveryErrorType(error),
      });
      return { kind: "understood", query: { ...deterministic, recoveryOutcome: "failed" } };
    }
    // The interpreter interface guarantees classified operational failures.
    // Do not turn unrelated programming defects into a misleading safe fallback.
    throw error;
  }
}
