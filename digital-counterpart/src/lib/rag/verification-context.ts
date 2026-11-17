import type { EvidenceRecord } from "@/lib/evidence/types";
import type { CandidateRetrieval } from "./types";
import { tokenize } from "./bm25";

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

function duplicates(left: EvidenceRecord, right: EvidenceRecord): boolean {
  if (left.id === right.id || normalize(left.text) === normalize(right.text)) return true;
  // Complementary sections from a single source must survive. Only near-identical
  // propositions within the same section are collapsed; no semantic model call.
  if (left.locator.source !== right.locator.source ||
      JSON.stringify(left.locator.headingPath) !== JSON.stringify(right.locator.headingPath)) return false;
  const a = new Set(tokenize(left.text));
  const b = new Set(tokenize(right.text));
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.max(1, a.size + b.size - shared) >= 0.9 &&
    // Numbers and negation may distinguish otherwise very similar propositions.
    JSON.stringify(left.text.match(/\b(?:\d+(?:\.\d+)?|not|never|no|without)\b/gi)) ===
    JSON.stringify(right.text.match(/\b(?:\d+(?:\.\d+)?|not|never|no|without)\b/gi));
}

/** Preserve reranked order and precise excerpts; parent documents aren't extra context. */
export function selectVerificationEvidence(
  retrieval: CandidateRetrieval,
  records: readonly EvidenceRecord[],
  limit: number,
): EvidenceRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const unique: EvidenceRecord[] = [];
  for (const { chunk } of retrieval.candidates) {
    const record = byId.get(`evidence:${chunk.id}`) ?? chunk.evidenceIds.map((id) => byId.get(id)).find(Boolean);
    if (record && !unique.some((other) => duplicates(other, record))) unique.push(record);
  }
  // Retrieval already uses MMR. Prefer a first representative of each source
  // before filling remaining slots with complementary sections, keeping #1 first.
  const sources = new Set<string>();
  const primary: EvidenceRecord[] = [];
  const secondary: EvidenceRecord[] = [];
  for (const record of unique) {
    (sources.has(record.locator.source) ? secondary : primary).push(record);
    sources.add(record.locator.source);
  }
  return [...primary, ...secondary].slice(0, Math.max(0, limit));
}

/**
 * A small corpus fits as complete authored records, including evidence that
 * lexical retrieval missed. For a larger corpus retain ranked excerpts within
 * both budgets. Only indexed records enter context; history is never evidence.
 */
export function selectUnderstandingEvidence(
  retrieval: CandidateRetrieval,
  records: readonly EvidenceRecord[],
  limit: number,
  maxCharacters: number,
): EvidenceRecord[] {
  const parents = records.filter((record) => record.id === `evidence:${record.docId}`);
  if (parents.length > 0 && parents.length <= limit &&
      parents.reduce((total, record) => total + record.text.length, 0) <= maxCharacters) {
    return parents;
  }
  let characters = 0;
  return selectVerificationEvidence(retrieval, records, limit).filter((record) => {
    if (characters + record.text.length > maxCharacters) return false;
    characters += record.text.length;
    return true;
  });
}
