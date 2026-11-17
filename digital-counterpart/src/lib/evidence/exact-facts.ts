import type { AtomicQuestion } from "./question";
import type { FactStore } from "./fact-store";
import { lookupExactFact } from "./fact-store";
import type { SupportAssessment } from "./support";
import { normalizeQuerySurface } from "@/lib/chat/query-surface";
import type { UnderstoodQuery } from "@/lib/chat/query-understanding";

/**
 * Normalize harmless surface wording before deterministic fact lookup.
 *
 * This never changes the proposition stored in the assessment and never creates
 * evidence. It only lets equivalent conversational forms reach deterministic
 * facts that the portfolio already owns.
 */
export function normalizeExactFactLookup(text: string): string {
  const trimmed = normalizeQuerySurface(text);

  // Natural inflections should not force a known portfolio-work question into
  // the model verifier just because the authored matcher uses the noun "work".
  const normalizedWork = trimmed.replace(/\bworks\b/gi, "work").replace(/\bworking\b/gi, "work");

  // Provider provenance is more specific than generic model identity. Check it
  // first so wording such as "are you an LLM from OpenAI?" resolves to the
  // configured provider rather than merely reporting the configured model.
  if (
    /\b(?:are|is)\s+(?:you|this|gauravgpt)\b/i.test(normalizedWork) &&
    /\b(?:llm|language model|model|ai)\b/i.test(normalizedWork) &&
    /\b(?:open\s*ai|anthropic|google|azure|mistral|groq)\b/i.test(normalizedWork)
  ) {
    return "who powers you model";
  }

  // Runtime identity is configuration, not portfolio evidence. Answer natural
  // yes/no model questions from the same deterministic runtime fact as
  // "what model are you?" rather than spending a verifier call.
  if (
    /\b(?:are|is)\s+(?:you|this|gauravgpt)\b/i.test(normalizedWork) &&
    /\b(?:gpt(?:[- .]?\d+(?:\.\d+)?(?:[- ]?[a-z]+)?)?|llm|language model|chat model)\b/i.test(normalizedWork)
  ) {
    return "what model are you";
  }

  return normalizedWork;
}

export function answerExactFact(
  question: AtomicQuestion,
  store: FactStore,
  understood?: UnderstoodQuery,
): SupportAssessment | null {
  // Opinions need authored evidence; "work philosophy" is not a project list.
  if (question.kind === "opinion" && !store.projectSelection) return null;
  const negated = /\b(?:not|never|without|didn['’]?t|doesn['’]?t|hasn['’]?t|haven['’]?t|isn['’]?t|aren['’]?t)\b/i.test(
    question.text,
  );
  const result = lookupExactFact(
    normalizeExactFactLookup(question.text),
    store,
    `${question.id}:fact`,
    understood,
  );
  switch (result.kind) {
    case "matched": {
      if (negated) {
        const directCanonicalRefutation =
          (/\bnever\b/i.test(question.text) && result.refutes === "skill") ||
          (/\bwithout\b/i.test(question.text) && result.refutes === "project-tag");
        if (!directCanonicalRefutation) return null;
        return {
          questionId: question.id,
          question: question.text,
          status: "contradicted",
          claims: [{
            ...result.claim,
            text: `That premise is incorrect: ${result.claim.text}`,
            evidenceIds: [...result.claim.evidenceIds],
          }],
          evidenceIds: [...result.claim.evidenceIds],
          method: "exact-fact",
        };
      }
      return {
        questionId: question.id,
        question: question.text,
        status: "supported",
        claims: [{ ...result.claim, evidenceIds: [...result.claim.evidenceIds] }],
        evidenceIds: [...result.claim.evidenceIds],
        method: "exact-fact",
      };
    }
    case "not-recorded":
      return {
        questionId: question.id,
        question: question.text,
        status: "not-recorded",
        claims: [],
        evidenceIds: [],
        method: "exhaustive-absence",
        reason: `${result.field} is absent from its canonical structured owner`,
      };
    case "not-exact":
      return null;
  }
}
