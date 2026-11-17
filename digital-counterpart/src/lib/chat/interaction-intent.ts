import type { ProfileLinkChannel } from "./visual-types";
import { normalizeQuerySurface } from "./query-surface";
import {
  asksForProjectLink,
  asksForProjectRepositoryDiscovery,
  contactActionIntent,
  detectTopics,
  matchProjectSlug,
  wantsEvidenceCase,
  wantsHiringCase,
  type Topic,
} from "./intent";

export type InteractionTarget =
  | { kind: "profile" }
  | { kind: "portfolio" }
  | { kind: "project"; slug: string }
  | { kind: "education"; institution?: string }
  | { kind: "skill"; id?: string }
  | { kind: "experience" }
  | { kind: "assistant" }
  | { kind: "surface" }
  | { kind: "unknown" };

export const interactionIntentKinds = [
  "profile-overview",
  "contact-info",
  "contact-message",
  "profile-link",
  "project-link",
  "project-repository-discovery",
  "hiring-evidence",
  "hiring-availability",
  "evidence-case",
  "evidence-challenge",
  "project-detail",
  "philosophy",
  "projects",
  "skills",
  "education",
  "experience",
  "about",
  "unknown",
] as const;

export type InteractionIntentKind = (typeof interactionIntentKinds)[number];

export type InteractionIntent = Readonly<{
  kind: InteractionIntentKind;
  target: InteractionTarget;
  channel?: ProfileLinkChannel;
}>;

type ProjectRef = Readonly<{ slug: string; title: string }>;
type BroadTopicIntentKind = "projects" | "skills" | "education" | "experience" | "about";

const TOPIC_PRIORITY: readonly BroadTopicIntentKind[] = [
  "projects",
  "skills",
  "education",
  "experience",
  "about",
];

/**
 * Domain phrases whose specific meaning should beat a generic overlapping word.
 *
 * "background" is usually experience, while "education background" is plainly
 * education. Likewise "work" often means projects, but "work experience" means
 * experience. Keep these as semantic phrase classes rather than prompt-specific
 * strings so nearby wording follows the same rule.
 */
const EXPLICIT_DOMAIN_LANGUAGE: ReadonlyArray<readonly [BroadTopicIntentKind, RegExp]> = [
  [
    "education",
    /\b(?:education|educational|schooling|academic (?:background|history|record))\b/i,
  ],
  [
    "experience",
    /\b(?:work experience|professional (?:experience|background)|career (?:background|history)|employment (?:history|background))\b/i,
  ],
];

function broadTopicIntent(topic: BroadTopicIntentKind): InteractionIntent {
  return {
    kind: topic,
    target: topic === "projects"
      ? { kind: "portfolio" }
      : topic === "education"
        ? { kind: "education" }
        : topic === "skills"
          ? { kind: "skill" }
          : topic === "experience"
            ? { kind: "experience" }
            : { kind: "profile" },
  };
}

/**
 * Convert the interaction decision into the stable topic stored in conversation
 * state. History must use the same precedence as the current turn instead of
 * relying on Set insertion order from raw keyword matches.
 */
export function primaryTopicForInteraction(intent: InteractionIntent): Topic | undefined {
  switch (intent.kind) {
    case "project-link":
    case "project-repository-discovery":
    case "project-detail":
    case "projects":
      return "projects";
    case "skills":
      return "skills";
    case "education":
      return "education";
    case "experience":
      return "experience";
    case "hiring-evidence":
    case "hiring-availability":
      return "hiring";
    case "contact-message":
    case "contact-info":
      return "contact";
    case "profile-link":
      return intent.channel === "resume" ? "experience" : "contact";
    case "profile-overview":
    case "about":
      return "about";
    case "philosophy":
      return "philosophy";
    case "evidence-case":
    case "evidence-challenge":
    case "unknown":
      return undefined;
  }
}

/**
 * One deterministic interpretation of what the visitor is trying to do.
 *
 * This is intentionally narrower than semantic support verification: it decides
 * application actions and UI shape, not whether a factual proposition is true.
 * Specific actions win over broad topics, and project context wins over the
 * profile channel that happens to host a project's source code.
 */
export function interpretInteraction(
  query: string,
  projects: readonly ProjectRef[],
): InteractionIntent {
  const normalizedQuery = normalizeQuerySurface(query);
  const topics = detectTopics(normalizedQuery);
  const contactAction = contactActionIntent(normalizedQuery, projects);
  const slug = matchProjectSlug(normalizedQuery, projects);

  if (topics.has("about") && topics.has("contact")) {
    return { kind: "profile-overview", target: { kind: "profile" } };
  }

  if (contactAction?.kind === "message") {
    return { kind: "contact-message", target: { kind: "profile" } };
  }

  if (contactAction?.kind === "info") {
    return { kind: "contact-info", target: { kind: "profile" } };
  }

  if (slug && asksForProjectLink(normalizedQuery)) {
    return { kind: "project-link", target: { kind: "project", slug } };
  }

  if (contactAction?.kind === "profile-link") {
    return {
      kind: "profile-link",
      target: { kind: "profile" },
      channel: contactAction.channel,
    };
  }

  if (asksForProjectRepositoryDiscovery(normalizedQuery)) {
    return {
      kind: "project-repository-discovery",
      target: { kind: "portfolio" },
    };
  }

  if (wantsHiringCase(normalizedQuery)) {
    return { kind: "hiring-evidence", target: { kind: "profile" } };
  }

  if (topics.has("hiring")) {
    return { kind: "hiring-availability", target: { kind: "profile" } };
  }

  if (wantsEvidenceCase(normalizedQuery)) {
    return { kind: "evidence-case", target: { kind: "profile" } };
  }

  if (slug) {
    return { kind: "project-detail", target: { kind: "project", slug } };
  }

  if (topics.has("contact")) {
    return { kind: "contact-info", target: { kind: "profile" } };
  }

  if (topics.has("philosophy")) {
    return { kind: "philosophy", target: { kind: "profile" } };
  }

  for (const [topic, pattern] of EXPLICIT_DOMAIN_LANGUAGE) {
    if (pattern.test(normalizedQuery)) return broadTopicIntent(topic);
  }

  for (const topic of TOPIC_PRIORITY) {
    if (topics.has(topic)) return broadTopicIntent(topic);
  }

  return { kind: "unknown", target: { kind: "unknown" } };
}
