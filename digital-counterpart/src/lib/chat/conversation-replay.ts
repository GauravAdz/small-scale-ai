import counterpartConfig from "../../../counterpart.config";
import type { CounterpartMessage } from "@/types/chat";
import {
  advanceConversationState,
  emptyConversationState,
  type ActiveReferent,
  type ConversationState,
} from "./conversation-state";
import { isEvidenceChallenge } from "./intent";
import { interpretInteraction, primaryTopicForInteraction } from "./interaction-intent";
import { normalizeQuerySurface } from "./query-surface";
import { resolveQuestion, type ProjectReference } from "./resolve-question";

function messageText(message: CounterpartMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function referentFromResolution(
  resolution: ReturnType<typeof resolveQuestion>,
  interaction: ReturnType<typeof interpretInteraction>,
  state: ConversationState,
): ActiveReferent {
  if (resolution.kind === "resolved-project-reference") {
    return { kind: "project", slug: resolution.projectSlug };
  }
  if (resolution.kind === "resolved-semantic-reference") {
    return resolution.referentClass === "assistant"
      ? { kind: "assistant" }
      : { kind: "surface" };
  }
  if (resolution.kind === "unresolved-reference") return state.activeReferent ?? null;
  if (interaction.target.kind === "project") {
    return { kind: "project", slug: interaction.target.slug };
  }
  return interaction.target.kind === "unknown"
    ? state.activeReferent ?? null
    : { kind: interaction.target.kind };
}

/**
 * Rebuild trusted conversational state by resolving each historical user turn
 * against the state accumulated before it. Assistant text and data stay inert.
 */
export function conversationContextFromMessages(
  messages: readonly CounterpartMessage[],
  projects: readonly ProjectReference[],
): { state: ConversationState; projectCandidates: ProjectReference[] } {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .slice(-counterpartConfig.chat.historyWindow);
  let state = emptyConversationState;
  let projectCandidates: ProjectReference[] = [];

  for (const message of userMessages) {
    const text = normalizeQuerySurface(messageText(message));
    if (!text || isEvidenceChallenge(text)) continue;
    const resolution = resolveQuestion({
      question: text,
      state,
      projectCandidates: projectCandidates.length > 0 ? projectCandidates : projects,
      knownProjects: projects,
    });
    const interaction = interpretInteraction(resolution.resolved, projects);
    const topic = primaryTopicForInteraction(interaction);
    const referent = referentFromResolution(resolution, interaction, state);
    const projectSlug = referent?.kind === "project" ? referent.slug : undefined;
    const preservesUnresolvedSubject = resolution.kind === "unresolved-reference";

    state = advanceConversationState(state, {
      kind: "resolved-reference",
      projectSlug: projectSlug ?? (preservesUnresolvedSubject ? state.activeProjectSlug : undefined),
      topic: topic ?? state.activeTopic,
      proposition: resolution.resolved,
      referent,
    });

    if (projectSlug) {
      const project = projects.find(({ slug }) => slug === projectSlug);
      if (project) projectCandidates = [project];
    } else if (preservesUnresolvedSubject) {
      continue;
    } else if (interaction.target.kind === "portfolio") {
      projectCandidates = [...projects];
    } else if (interaction.target.kind !== "unknown") {
      projectCandidates = [];
    }
  }

  return { state, projectCandidates };
}
