import type { ClaimCitation } from "@/types/chat";

export type CitationReference = Readonly<{
  citation: ClaimCitation;
  number: number;
  referenceKey: string;
}>;

export type CitationClaimGroup = Readonly<{
  claimId?: string;
  claimText?: string;
  references: readonly CitationReference[];
}>;

export type CitationSource = Readonly<{
  key: string;
  source: string;
  title: string;
  url?: string;
}>;

export type CitationViewModel = Readonly<{
  groups: readonly CitationClaimGroup[];
  references: readonly CitationReference[];
  sources: readonly CitationSource[];
}>;

function evidenceKey(citation: ClaimCitation): string {
  return citation.evidenceId ?? citation.id;
}

function claimKey(citation: ClaimCitation): string {
  return citation.claimId ?? "__answer";
}

/**
 * Numbers identify evidence records, not retrieval hits. Reusing the same
 * number when one record supports several claims makes the compact UI stable
 * and prevents a duplicated candidate from looking like extra corroboration.
 */
export function buildCitationViewModel(
  citations: readonly ClaimCitation[],
): CitationViewModel {
  const referenceByEvidence = new Map<string, CitationReference>();
  const groups = new Map<
    string,
    {
      claimId?: string;
      claimText?: string;
      references: CitationReference[];
      seenEvidence: Set<string>;
    }
  >();
  const sources = new Map<string, CitationSource>();

  for (const citation of citations) {
    const referenceKey = evidenceKey(citation);
    let reference = referenceByEvidence.get(referenceKey);

    if (!reference) {
      reference = {
        citation,
        number: referenceByEvidence.size + 1,
        referenceKey,
      };
      referenceByEvidence.set(referenceKey, reference);
    }

    const groupKey = claimKey(citation);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        claimId: citation.claimId,
        claimText: citation.claimText,
        references: [],
        seenEvidence: new Set<string>(),
      };
      groups.set(groupKey, group);
    }

    if (!group.claimText && citation.claimText) group.claimText = citation.claimText;
    if (!group.seenEvidence.has(referenceKey)) {
      group.seenEvidence.add(referenceKey);
      group.references.push(reference);
    }

    const sourceKey = `${citation.source}\u0000${citation.url ?? ""}`;
    if (!sources.has(sourceKey)) {
      sources.set(sourceKey, {
        key: sourceKey,
        source: citation.source,
        title: citation.title,
        url: citation.url,
      });
    }
  }

  return {
    groups: Array.from(groups.values(), ({ seenEvidence: _seenEvidence, ...group }) => group),
    references: Array.from(referenceByEvidence.values()),
    sources: Array.from(sources.values()),
  };
}

export function citationHeading(citation: ClaimCitation): string | undefined {
  if (citation.headingPath && citation.headingPath.length > 0) {
    return citation.headingPath.join(" › ");
  }
  return citation.section;
}

export function citationLocator(citation: ClaimCitation): string | undefined {
  const parts: string[] = [];

  if (citation.startLine !== undefined) {
    parts.push(
      citation.endLine !== undefined && citation.endLine !== citation.startLine
        ? `Lines ${citation.startLine}–${citation.endLine}`
        : `Line ${citation.startLine}`,
    );
  }

  if (citation.jsonPointer) parts.push(`JSON ${citation.jsonPointer}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
