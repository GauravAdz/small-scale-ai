/** Instant conversational actions and explicit out-of-scope requests.
 * Substantive questions proceed to evidence assessment regardless of retrieval scores.
 */

import counterpartConfig from "../../../counterpart.config";
import { INSTRUCTION_BOUNDARY_RESPONSE } from "./instruction-boundary";
import {
  asksForPrivateOrUnrecordedDetail,
  isGreeting,
  isIdentityQuestion,
  offDomainReason,
} from "./intent";

export type ScopeVerdict =
  /** Hand it to the model. */
  | { kind: "answer" }
  /** The application answers, with this text. No model call. */
  | { kind: "local"; reason: LocalReason; text: string };

export type LocalReason = "greeting" | "identity" | "knowledge-gap" | "out-of-scope";

/** Result of the cheap, pre-retrieval pass. */
export function guardBeforeRetrieval(
  query: string,
  { profileName }: { profileName: string },
): ScopeVerdict {
  if (isGreeting(query)) {
    return {
      kind: "local",
      reason: "greeting",
      text: `Hey — I'm GauravGPT, ${profileName}'s digital counterpart. Ask me about his projects, what he's good at, what he's studying, or what he's looking for.`,
    };
  }

  if (isIdentityQuestion(query)) {
    return {
      kind: "local",
      reason: "identity",
      text: `I'm GauravGPT — an AI counterpart of ${profileName}, not ${profileName} himself. Personal factual claims are checked against his current records and linked to their evidence. If those records are insufficient, I'll say so rather than guess.`,
    };
  }

  if (asksForPrivateOrUnrecordedDetail(query)) {
    return {
      kind: "local",
      reason: "knowledge-gap",
      text: counterpartConfig.scope.knowledgeGap,
    };
  }

  const reason = offDomainReason(query);
  if (reason) {
    if (reason === "override") {
      return { kind: "local", reason: "out-of-scope", text: INSTRUCTION_BOUNDARY_RESPONSE };
    }
    return { kind: "local", reason: "out-of-scope", text: counterpartConfig.scope.redirect };
  }

  return { kind: "answer" };
}
