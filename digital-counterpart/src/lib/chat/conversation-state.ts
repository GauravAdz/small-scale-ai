import type { Topic } from "./intent";

/**
 * The only conversation memory trusted by factual routing. It stores stable
 * references, never prose or propositions copied from chat history.
 */
export type ConversationState = Readonly<{
  activeProjectSlug?: string;
  activeEvidenceIds?: readonly string[];
  activeTopic?: Topic;
  activeProposition?: string;
  activeReferent?: ActiveReferent;
}>;

export type ActiveReferent =
  | Readonly<{ kind: "project"; slug: string }>
  | Readonly<{ kind: "education"; institution?: string }>
  | Readonly<{ kind: "skill"; id?: string }>
  | Readonly<{ kind: "experience" }>
  | Readonly<{ kind: "profile" }>
  | Readonly<{ kind: "assistant" }>
  | Readonly<{ kind: "surface" }>
  | Readonly<{ kind: "portfolio" }>
  | null;

export const emptyConversationState: ConversationState = Object.freeze({});

/**
 * State changes are explicit about their authority. Only a verified evidence
 * event may introduce evidence IDs; raw assistant text is deliberately inert.
 */
export type ConversationStateEvent =
  | Readonly<{
      kind: "resolved-reference";
      projectSlug?: string;
      topic?: Topic;
      proposition?: string;
      referent?: ActiveReferent;
    }>
  | Readonly<{
      kind: "verified-evidence";
      evidenceIds: readonly string[];
      projectSlug?: string;
      topic?: Topic;
    }>
  | Readonly<{
      kind: "untrusted-assistant-text";
      text: string;
    }>;

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function uniqueEvidenceIds(ids: readonly string[]): readonly string[] | undefined {
  const normalized = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  return normalized.length > 0 ? Object.freeze(normalized) : undefined;
}

export function advanceConversationState(
  state: ConversationState,
  event: ConversationStateEvent,
): ConversationState {
  switch (event.kind) {
    case "resolved-reference":
      return Object.freeze({
        ...state,
        activeProjectSlug: nonEmpty(event.projectSlug),
        ...(nonEmpty(event.proposition) ? { activeProposition: nonEmpty(event.proposition) } : {}),
        ...(event.referent !== undefined ? { activeReferent: event.referent } : {}),
        ...(event.topic ? { activeTopic: event.topic } : {}),
      });

    case "verified-evidence": {
      const activeEvidenceIds = uniqueEvidenceIds(event.evidenceIds);
      return Object.freeze({
        ...state,
        activeEvidenceIds,
        ...(nonEmpty(event.projectSlug)
          ? { activeProjectSlug: nonEmpty(event.projectSlug) }
          : {}),
        ...(event.topic ? { activeTopic: event.topic } : {}),
      });
    }

    case "untrusted-assistant-text":
      return state;

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
