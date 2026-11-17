import type { EvidenceRecord, VerifiedClaim } from "./types";

export type ClaimCitation = Readonly<{
  claimId: string;
  evidenceId: string;
  source: string;
  headingPath?: readonly string[];
  startLine?: number;
  endLine?: number;
  jsonPointer?: string;
  excerpt: string;
}>;

export function buildClaimCitations(
  claims: readonly VerifiedClaim[],
  evidence: readonly EvidenceRecord[],
): ClaimCitation[] {
  const byId = new Map(evidence.map((record) => [record.id, record]));
  return claims.flatMap((claim) =>
    claim.evidenceIds.map((evidenceId) => {
      const record = byId.get(evidenceId);
      if (!record) throw new Error(`Unknown evidence ID ${evidenceId} for claim ${claim.id}`);
      return {
        claimId: claim.id,
        evidenceId,
        source: record.locator.source,
        headingPath: record.locator.headingPath,
        startLine: record.locator.startLine,
        endLine: record.locator.endLine,
        jsonPointer: record.locator.jsonPointer,
        excerpt: record.text,
      };
    }),
  );
}

