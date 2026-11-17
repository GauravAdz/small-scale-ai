import type { EvalCase, EvalPrediction } from "./schema";

/** Citation validity means the exact claim/evidence pair, not two valid IDs. */
export function auditCitations(predictions: readonly EvalPrediction[], evidenceIds: ReadonlySet<string>) {
  const failures: string[] = [];
  let totalCitations = 0;
  let validCitations = 0;
  let citableClaims = 0;
  let citedClaims = 0;
  for (const prediction of predictions) {
    const claims = new Map(prediction.claims?.map((claim) => [claim.id, claim]) ?? []);
    if (claims.size !== (prediction.claims?.length ?? 0)) failures.push(`${prediction.id}: duplicate claim IDs`);
    for (const citation of prediction.citations ?? []) {
      totalCitations++;
      const claim = claims.get(citation.claimId);
      if (claim?.evidenceIds.includes(citation.evidenceId) && evidenceIds.has(citation.evidenceId)) validCitations++;
      else failures.push(`${prediction.id}: invalid citation pair ${citation.claimId}/${citation.evidenceId}`);
    }
    for (const claim of claims.values()) {
      if (claim.kind === "uncertainty") continue;
      citableClaims++;
      const complete = claim.evidenceIds.length > 0 && claim.evidenceIds.every((evidenceId) =>
        evidenceIds.has(evidenceId) && prediction.citations?.some((citation) =>
          citation.claimId === claim.id && citation.evidenceId === evidenceId),
      );
      if (complete) citedClaims++;
      else failures.push(`${prediction.id}: missing or invalid claim citations ${claim.id}`);
    }
  }
  return { failures, totalCitations, validCitations, citableClaims, citedClaims };
}

export function inferenceIsLabelled(item: EvalCase, prediction: EvalPrediction | undefined): boolean {
  const claims = prediction?.claims ?? [];
  const expectsInference = item.expected.clauses?.some(({ status }) =>
    status === "supported" || status === "partially-supported",
  );
  return expectsInference
    ? claims.some(({ kind }) => kind === "inference") && claims.every(({ kind }) => kind === "inference" || kind === "uncertainty")
    : claims.every(({ kind }) => kind === "uncertainty");
}

/** Reuse dataset expectations for live candidates, including conversation/visual gates. */
export function predictionFailures(
  item: EvalCase,
  prediction: EvalPrediction,
  evidenceParents: ReadonlyMap<string, string> = new Map(),
): string[] {
  const failures: string[] = [];
  const fail = (reason: string) => failures.push(`${item.id}: ${reason}`);
  const expected = item.expected;
  if (expected.route && prediction.route !== expected.route) fail("incorrect route");
  if (expected.mustAssessSupport && !prediction.supportAssessed) fail("support assessment bypassed");
  if (expected.resolvedQuestion && prediction.resolvedQuestion !== expected.resolvedQuestion) fail("incorrect resolved question");
  const localAbstention = prediction.route === "local" && !expected.mustAssessSupport &&
    expected.clauses?.every(({ status }) => status === "insufficient");
  if (expected.clauses && !localAbstention) {
    if (prediction.clauses?.length !== expected.clauses.length) fail("incorrect clause count");
    for (const [index, clause] of expected.clauses.entries()) {
      const actual = prediction.clauses?.[index];
      if (!actual || !(clause.acceptableStatuses ?? [clause.status]).includes(actual.status)) fail(`expected ${(clause.acceptableStatuses ?? [clause.status]).join(" or ")}, received ${actual?.status ?? "no assessment"}`);
      for (const id of clause.evidenceIds ?? []) {
        // A source expectation may be satisfied by its indexed excerpt. Exact
        // excerpt expectations cannot be satisfied by a sibling or parent.
        if (!actual?.evidenceIds?.some((actualId) => actualId === id || evidenceParents.get(actualId) === id)) {
          fail(`missing required evidence ${id}`);
        }
      }
    }
  }
  const answer = prediction.answer ?? "";
  for (const fact of expected.requiredFacts ?? []) if (!answer.includes(fact)) fail("missing required fact");
  for (const fact of expected.forbiddenClaims ?? []) if (answer.toLowerCase().includes(fact.toLowerCase())) fail("forbidden claim");
  if (expected.expectedVisual && prediction.visual !== expected.expectedVisual) fail("incorrect visual");
  for (const slug of expected.expectedProjectSlugs ?? []) if (!prediction.projectSlugs?.includes(slug)) fail(`missing project visual ${slug}`);
  if (item.tags.includes("inference") && !inferenceIsLabelled(item, prediction)) fail("inference not labelled");
  return failures;
}
