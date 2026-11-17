import type { CandidateRetrieval, ScoredChunk } from "./types";

export function candidateEvidenceIds(retrieval: CandidateRetrieval): string[] {
  return [
    ...new Set(retrieval.candidates.flatMap(({ chunk }) => chunk.evidenceIds)),
  ];
}

export function topCandidates(
  retrieval: CandidateRetrieval,
  count: number,
): readonly ScoredChunk[] {
  return retrieval.candidates.slice(0, Math.max(0, count));
}

