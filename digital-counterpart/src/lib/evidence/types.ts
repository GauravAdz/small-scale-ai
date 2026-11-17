export const evidenceKinds = [
  "fact",
  "authored-opinion",
  "preference",
  "experience",
  "project-evidence",
  "runtime-fact",
  "narrative",
] as const;

export type EvidenceKind = (typeof evidenceKinds)[number];

export const evidenceAuthorities = [
  "profile",
  "project-record",
  "education-record",
  "experience-record",
  "faq",
  "philosophy",
  "repository-derived",
  "runtime",
] as const;

export type EvidenceAuthority = (typeof evidenceAuthorities)[number];

export type EvidenceLocator = Readonly<{
  source: string;
  headingPath?: readonly string[];
  startLine?: number;
  endLine?: number;
  jsonPointer?: string;
}>;

/** Truth and provenance record. Retrieval chunks are projections of these records. */
export type EvidenceRecord = Readonly<{
  id: string;
  docId: string;
  kind: EvidenceKind;
  authority: EvidenceAuthority;
  text: string;
  subject?: string;
  predicate?: string;
  value?: unknown;
  locator: EvidenceLocator;
  sourceHash: string;
  verifiedAt?: string;
  validFrom?: string;
  validUntil?: string;
}>;

export const claimKinds = ["fact", "authored-opinion", "inference", "uncertainty"] as const;
export type ClaimKind = (typeof claimKinds)[number];

export type VerifiedClaim = Readonly<{
  id: string;
  text: string;
  kind: ClaimKind;
  evidenceIds: readonly string[];
}>;

