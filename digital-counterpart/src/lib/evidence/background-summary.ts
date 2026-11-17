import type { AtomicQuestion } from "./question";
import type { FactStore } from "./fact-store";
import { supportAssessmentSchema, type SupportAssessment } from "./support";
import type { VerifiedClaim } from "./types";
import { matchProjectSlug } from "@/lib/chat/intent";

/** Narrowly matches short biography/background-summary requests. */
export function isCanonicalBackgroundSummaryQuestion(question: string): boolean {
  const normalized = question.trim();
  const asksForBackground = /\b(background|bio(?:graphy)?|overview)\b/i.test(normalized);
  const asksForSummary =
    /\b(30[ -]?second|quick|brief|summary|summari[sz]e|version|give me)\b/i.test(normalized);
  return asksForBackground && asksForSummary;
}

function citedClaim(
  store: FactStore,
  claim: Omit<VerifiedClaim, "evidenceIds"> & { evidenceId: string },
): VerifiedClaim | null {
  if (!store.evidenceById.has(claim.evidenceId)) return null;
  return {
    id: claim.id,
    text: claim.text,
    kind: claim.kind,
    evidenceIds: [claim.evidenceId],
  };
}

/**
 * A deterministic, citation-bearing answer for the product-authored background
 * prompt. Values come from canonical profile fields or a selected authored
 * experience record; retrieval rank is never treated as proof.
 */
export function answerCanonicalBackgroundSummary(
  question: AtomicQuestion,
  store: FactStore,
): SupportAssessment | null {
  if (!isCanonicalBackgroundSummaryQuestion(question.text)) return null;
  // A named project is more specific than generic words such as "overview".
  // Let the project fact path answer it from that project's authored record.
  if (matchProjectSlug(question.text, store.projects)) return null;

  const claims: VerifiedClaim[] = [];
  if (store.profile.bio) {
    const claim = citedClaim(store, {
      id: `${question.id}:background:bio`,
      text: store.profile.bio,
      kind: "fact",
      evidenceId: "evidence:profile:bio",
    });
    if (claim) claims.push(claim);
  }

  const currentEducation =
    store.profile.education.find(({ end }) => end?.toLowerCase() === "present") ??
    store.profile.education[0];
  if (currentEducation) {
    const claim = citedClaim(store, {
      id: `${question.id}:background:education`,
      text: `Gaurav is studying ${currentEducation.credential} at ${currentEducation.school}.`,
      kind: "fact",
      evidenceId: "evidence:profile:education",
    });
    if (claim) claims.push(claim);
  }

  const experience = [...store.evidenceById.values()].find(
    (record) =>
      record.docId === "experience" &&
      record.locator.headingPath?.some((heading) => /^overview$/i.test(heading)) &&
      /paid science teaching/i.test(record.text) &&
      /independent AI and product development/i.test(record.text),
  );
  if (experience) {
    const claim = citedClaim(store, {
      id: `${question.id}:background:experience`,
      text: "Gaurav's experience spans paid science teaching, technical mentoring, student and robotics leadership, and independent AI and product development.",
      kind: "fact",
      evidenceId: experience.id,
    });
    if (claim) claims.push(claim);
  }

  if (claims.length === 0) return null;
  return supportAssessmentSchema.parse({
    questionId: question.id,
    question: question.text,
    status: "supported",
    claims,
    evidenceIds: claims.flatMap(({ evidenceIds }) => evidenceIds),
    method: "canonical-summary",
  });
}
