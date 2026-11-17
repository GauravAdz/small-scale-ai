import type { ConversationState } from "./conversation-state";
import {
  describesRememberedWork,
  hasGauravReference,
  isContextualFollowUp,
  isEvidenceChallenge,
  isIdentityQuestion,
  isProjectRepositoryFollowUp,
  matchProjectSlug,
} from "./intent";
import { RELIABILITY_VERSIONS } from "@/lib/versions";

export const RESOLVER_VERSION = RELIABILITY_VERSIONS.resolver;

export type ProjectReference = Readonly<{
  slug: string;
  title: string;
}>;

export type QuestionResolution =
  | Readonly<{
      kind: "standalone";
      original: string;
      resolved: string;
    }>
  | Readonly<{
      kind: "resolved-project-reference";
      original: string;
      resolved: string;
      projectSlug: string;
    }>
  | Readonly<{
      kind: "resolved-semantic-reference";
      original: string;
      resolved: string;
      referentClass: "portfolio-surface" | "assistant";
    }>
  | Readonly<{
      kind: "resolved-evidence-challenge";
      original: string;
      resolved: string;
      challengedProposition: string;
    }>
  | Readonly<{
      kind: "unresolved-reference";
      original: string;
      resolved: string;
      reason:
        | "missing-active-project"
        | "missing-project-candidates"
        | "ambiguous-other"
        | "unresolved-explicit-referent"
        | "missing-challenged-proposition";
    }>;

export type ResolveQuestionInput = Readonly<{
  question: string;
  state: ConversationState;
  /** Ordered, trusted project references from the last verified plan or visual. */
  projectCandidates?: readonly ProjectReference[];
  /** Complete authored project names, used only to recognize an explicit subject. */
  knownProjects?: readonly ProjectReference[];
}>;

const ORDINAL_REFERENCE =
  /\b(?:the\s+)?(first|1st|second|2nd|last|other)\s+(?:one|project)\b/i;
const SINGULAR_PROJECT_REFERENCE =
  /\b(?:that project|this project|that app|this app|that one|this one|the same one|same one|it|its|that|this)\b/i;
const PLURAL_PROJECT_REFERENCE =
  /\b(?:those projects|these projects|those apps|these apps|those|these|them)\b/i;
const ELLIPTICAL_FOLLOW_UP =
  /^(?:and\s+|but\s+)?(?:why|how so|what about|tell me more|go deeper|more details|anything else)[?!.]?$/i;

export type DeicticReferentClass =
  | "portfolio-surface"
  | "assistant"
  | "project-context"
  | "project-collection"
  | "bare"
  | "unresolved-explicit"
  | "none";

export type DeicticReferent = Readonly<{
  kind: DeicticReferentClass;
  reference?: string;
}>;

const EXPLICIT_DEICTIC_HEAD =
  /\b(this|that|these|those)\s+(website|site|page|project|projects|app|apps|chatbot|bot)\b/i;
const BARE_DEICTIC_REFERENCE =
  /\b(?:that one|this one|the same one|same one|it|its|that|this)\b/i;

/**
 * Classify the noun governed by a deictic determiner before consulting chat
 * context. The semantic head is authoritative: `this website` cannot become
 * the active project merely because the broader word `this` also matches.
 */
export function classifyDeicticReferent(question: string): DeicticReferent {
  const explicit = question.match(EXPLICIT_DEICTIC_HEAD);
  if (explicit) {
    const [reference, determiner, rawHead] = explicit;
    const head = rawHead.toLowerCase();
    if (["website", "site", "page"].includes(head)) {
      return {
        kind: determiner.toLowerCase() === "this" ? "portfolio-surface" : "unresolved-explicit",
        reference,
      };
    }
    if (["chatbot", "bot"].includes(head)) {
      return {
        kind: determiner.toLowerCase() === "this" ? "assistant" : "unresolved-explicit",
        reference,
      };
    }
    return {
      kind: ["projects", "apps"].includes(head) ? "project-collection" : "project-context",
      reference,
    };
  }
  const plural = question.match(PLURAL_PROJECT_REFERENCE)?.[0];
  if (plural) return { kind: "project-collection", reference: plural };
  const bare = question.match(BARE_DEICTIC_REFERENCE)?.[0];
  return bare ? { kind: "bare", reference: bare } : { kind: "none" };
}

function uniqueProjects(projects: readonly ProjectReference[]): ProjectReference[] {
  const seen = new Set<string>();
  return projects.filter(({ slug }) => {
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}

function projectBySlug(
  slug: string | undefined,
  projects: readonly ProjectReference[],
): ProjectReference | undefined {
  return slug ? projects.find((project) => project.slug === slug) : undefined;
}

function ordinalProject(
  ordinal: string,
  projects: readonly ProjectReference[],
  activeProjectSlug: string | undefined,
): ProjectReference | "ambiguous-other" | undefined {
  switch (ordinal.toLowerCase()) {
    case "first":
    case "1st":
      return projects.at(0);
    case "second":
    case "2nd":
      return projects.at(1);
    case "last":
      return projects.at(-1);
    case "other": {
      const alternatives = projects.filter(({ slug }) => slug !== activeProjectSlug);
      if (alternatives.length === 1) return alternatives[0];
      return alternatives.length > 1 ? "ambiguous-other" : undefined;
    }
    default: {
      const exhaustive: never = ordinal as never;
      return exhaustive;
    }
  }
}

function possessiveTitle(title: string): string {
  return title.endsWith("s") ? `${title}'` : `${title}'s`;
}

function replaceReference(question: string, pattern: RegExp, replacement: string): string {
  const resolved = question.replace(pattern, replacement).replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(resolved) ? resolved : `${resolved}?`;
}

function literalReferencePattern(reference: string): RegExp {
  return new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function resolveSemanticReferent(
  original: string,
  referentClass: "portfolio-surface" | "assistant",
  reference: string,
): QuestionResolution {
  const replacement = referentClass === "portfolio-surface"
    ? "Gaurav's portfolio website"
    : "GauravGPT";
  return {
    kind: "resolved-semantic-reference",
    original,
    resolved: replaceReference(original, literalReferencePattern(reference), replacement),
    referentClass,
  };
}

function resolveToProject(
  original: string,
  project: ProjectReference,
  pattern?: RegExp,
): QuestionResolution {
  let resolved: string;

  if (pattern) {
    const match = original.match(pattern)?.[0]?.toLowerCase();
    const replacement = match === "its" ? possessiveTitle(project.title) : project.title;
    resolved = replaceReference(original, pattern, replacement);
  } else if (isProjectRepositoryFollowUp(original)) {
    resolved = `What is ${possessiveTitle(project.title)} repository URL?`;
  } else {
    const stem = original.trim().replace(/[?!.]+$/g, "");
    resolved = `${stem} about ${project.title}?`;
  }

  return {
    kind: "resolved-project-reference",
    original,
    resolved,
    projectSlug: project.slug,
  };
}

/** Resolve a contextual project question without treating chat prose as facts. */
export function resolveQuestion(input: ResolveQuestionInput): QuestionResolution {
  const original = input.question.trim();
  if (isEvidenceChallenge(original)) {
    const challengedProposition = input.state.activeProposition?.trim();
    return challengedProposition
      ? {
          kind: "resolved-evidence-challenge",
          original,
          resolved: challengedProposition,
          challengedProposition,
        }
      : {
          kind: "unresolved-reference",
          original,
          resolved: original,
          reason: "missing-challenged-proposition",
        };
  }
  const referent = classifyDeicticReferent(original);
  if (
    (referent.kind === "portfolio-surface" || referent.kind === "assistant") &&
    referent.reference
  ) {
    return resolveSemanticReferent(original, referent.kind, referent.reference);
  }
  if (referent.kind === "unresolved-explicit") {
    return {
      kind: "unresolved-reference",
      original,
      resolved: original,
      reason: "unresolved-explicit-referent",
    };
  }
  // Product identity owns its deictic words before project-reference matching;
  // a prior project must never rewrite "this" in an assistant identity turn.
  if (isIdentityQuestion(original)) {
    return { kind: "standalone", original, resolved: original };
  }
  // A named project supplies its own subject. This check must run before bare
  // deictic matching because a legitimate title may contain words such as
  // "Its", and an explicit new project must beat stale context.
  if (matchProjectSlug(original, input.knownProjects ?? [])) {
    return { kind: "standalone", original, resolved: original };
  }
  // An explicit semantic head owns the reference before stale project state.
  // "that kind of studies" is an education turn, not a project pronoun.
  if (/\b(?:stud(?:y|ies|ying|ied)|education|degree|school|university|academic|course|subject|module)\b/i.test(original)) {
    return { kind: "standalone", original, resolved: original };
  }
  // A descriptive noun phrase supplies its own clues, even with "that" or
  // "this". Do not replace it with an unrelated previous project or require a
  // prior turn before the evidence model can interpret it.
  if (describesRememberedWork(original) && original.split(/\s+/).length >= 7 && !ORDINAL_REFERENCE.test(original)) {
    return { kind: "standalone", original, resolved: original };
  }
  if (!isContextualFollowUp(original)) {
    return { kind: "standalone", original, resolved: original };
  }

  const projects = uniqueProjects(input.projectCandidates ?? []);
  const ordinal = original.match(ORDINAL_REFERENCE);

  if (ordinal) {
    if (projects.length === 0) {
      return {
        kind: "unresolved-reference",
        original,
        resolved: original,
        reason: "missing-project-candidates",
      };
    }

    const project = ordinalProject(ordinal[1], projects, input.state.activeProjectSlug);
    if (project === "ambiguous-other") {
      return {
        kind: "unresolved-reference",
        original,
        resolved: original,
        reason: "ambiguous-other",
      };
    }
    if (!project) {
      return {
        kind: "unresolved-reference",
        original,
        resolved: original,
        reason: "missing-project-candidates",
      };
    }
    return resolveToProject(original, project, ORDINAL_REFERENCE);
  }

  const activeProjectSlug = input.state.activeReferent?.kind === "project"
    ? input.state.activeReferent.slug
    : input.state.activeReferent
      ? undefined
      : input.state.activeProjectSlug;
  const activeProject = projectBySlug(activeProjectSlug, projects);
  if (!activeProject) {
    // Without an active project, a bare “GitHub?” is a standalone profile
    // request. With an active project, the same turn resolves to its repo.
    if (isProjectRepositoryFollowUp(original)) {
      return { kind: "standalone", original, resolved: original };
    }
    // A proposition that explicitly names Gaurav may contain a possessive
    // pronoun without referring to prior chat ("his app ... its growth"). It
    // still needs normal evidence assessment, not a reference-resolution exit.
    if (hasGauravReference(original)) {
      return { kind: "standalone", original, resolved: original };
    }
    return {
      kind: "unresolved-reference",
      original,
      resolved: original,
      reason: "missing-active-project",
    };
  }

  if (isProjectRepositoryFollowUp(original)) {
    return resolveToProject(original, activeProject);
  }

  if (referent.kind === "project-context" || referent.kind === "bare") {
    return resolveToProject(original, activeProject, SINGULAR_PROJECT_REFERENCE);
  }

  if (referent.kind === "project-collection") {
    if (projects.length < 2) {
      return {
        kind: "unresolved-reference",
        original,
        resolved: original,
        reason: "missing-project-candidates",
      };
    }
    const titles = projects.map(({ title }) => title);
    const joined = `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
    return resolveToProject(
      original,
      { slug: activeProject.slug, title: joined },
      PLURAL_PROJECT_REFERENCE,
    );
  }

  if (ELLIPTICAL_FOLLOW_UP.test(original)) {
    return resolveToProject(original, activeProject);
  }

  return { kind: "standalone", original, resolved: original };
}
