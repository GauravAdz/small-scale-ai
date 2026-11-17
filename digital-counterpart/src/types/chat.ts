import type { UIMessage } from "ai";

import type { FollowUp, TurnStatus, Visual } from "@/lib/chat/visual-types";
import type { Citation as RetrievalCitation } from "@/lib/rag/types";

/**
 * Presentation-safe provenance streamed with an answer.
 *
 * `claimId` links the source to an approved factual claim; `evidenceId` links
 * it to the evidence registry. Both remain optional while old persisted chat
 * messages are still renderable. `claimText` is display context only and must
 * come from the factual plan rather than being inferred by the client.
 */
export type ClaimCitation = RetrievalCitation & {
  claimId?: string;
  evidenceId?: string;
  claimText?: string;
  headingPath?: readonly string[];
};

/**
 * Custom data parts streamed alongside the text. Typing the `UIMessage`
 * generic here is what makes `part.type === "data-visual"` narrow correctly
 * on the client.
 *
 * There are no tool parts any more. Visuals used to arrive as tool output,
 * which meant the model had to decide and then report — two model steps for a
 * card the application could pick itself. They now arrive as data parts written
 * before the model is even called.
 */
export type CounterpartDataParts = {
  sources: ClaimCitation[];
  visual: Visual;
  followups: FollowUp[];
  status: TurnStatus;
};

export type CounterpartMessage = UIMessage<never, CounterpartDataParts>;

/** @deprecated Prefer ClaimCitation for streamed answer provenance. */
export type Citation = ClaimCitation;

export type { FollowUp, TurnStatus, Visual };
