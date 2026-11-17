import type { FactualAnswerPlan } from "./answer-plan";
import { RELIABILITY_VERSIONS } from "@/lib/versions";
import type { ResponseShape } from "@/lib/chat/query-understanding";

export const RENDERER_VERSION = RELIABILITY_VERSIONS.renderer;

export interface VoiceRenderer {
  readonly kind: string;
  render(plan: FactualAnswerPlan): Promise<string>;
}

/**
 * The safe default is deliberately deterministic. It cannot introduce a proposition
 * because every output sentence is copied from the approved factual plan.
 */
export class DeterministicVoiceRenderer implements VoiceRenderer {
  readonly kind = "deterministic";

  async render(plan: FactualAnswerPlan): Promise<string> {
    return plan.clauses
      .flatMap((clause) => clause.claims.map((claim) => claim.text.trim()))
      .filter(Boolean)
      .join(" ");
  }
}

export async function renderFactualPlan(
  plan: FactualAnswerPlan,
  shape: ResponseShape = { mode: "normal" },
): Promise<string> {
  const claims = plan.clauses
    .flatMap((clause) => clause.claims.map((claim) => claim.text.trim()))
    .filter(Boolean);
  const prose = claims.join(" ");

  if (shape.mode === "sentence") {
    const propositions = claims.map((claim) => claim.replace(/[.!?]+$/, ""));
    return propositions.length > 0 ? `${propositions.join("; ")}.` : prose;
  }

  if (shape.mode === "keywords") {
    const candidate = claims.length === 1 ? claims[0] : "";
    const words = candidate.match(/[\p{L}\p{N}][\p{L}\p{N}.+#/-]*/gu) ?? [];
    const hasSentenceVerb = /\b(?:am|are|be|been|being|can|could|did|do|does|had|has|have|is|might|must|should|was|were|will|would)\b/i.test(candidate);
    if (candidate && !hasSentenceVerb && words.length === shape.count) return candidate;
    return claims.length >= 3 ? claims.map((claim) => `- ${claim}`).join("\n") : prose;
  }

  const bulletThreshold = shape.mode === "brief" ? 2 : 3;
  return claims.length >= bulletThreshold
    ? claims.map((claim) => `- ${claim}`).join("\n")
    : prose;
}
