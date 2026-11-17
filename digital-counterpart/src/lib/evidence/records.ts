import type { EvidenceAuthority, EvidenceKind, EvidenceRecord } from "./types";
import type { Chunk, KnowledgeDoc } from "@/lib/rag/types";
import { containsAuthoringPlaceholder } from "@/lib/knowledge/placeholders";

function authorityFor(type: string): EvidenceAuthority {
  switch (type) {
    case "profile":
      return "profile";
    case "project":
      return "project-record";
    case "education":
      return "education-record";
    case "experience":
      return "experience-record";
    case "faq":
      return "faq";
    case "philosophy":
      return "philosophy";
    default:
      return "repository-derived";
  }
}

function kindFor(type: string): EvidenceKind {
  switch (type) {
    case "project":
      return "project-evidence";
    case "experience":
      return "experience";
    case "philosophy":
      return "authored-opinion";
    case "profile":
    case "education":
      return "fact";
    default:
      return "narrative";
  }
}

const profilePointers: Readonly<Record<string, string>> = {
  "profile:bio": "/bio",
  "profile:skills": "/skills",
  "profile:focus": "/focusAreas",
  "profile:education": "/education",
  "profile:availability": "/availability",
  "profile:contact": "/contact",
  "profile:resume": "/resume",
  "profile:metrics": "/metrics",
};

export function evidenceFromDocuments(docs: readonly KnowledgeDoc[]): EvidenceRecord[] {
  return docs.filter((doc) => doc.text.trim() && !containsAuthoringPlaceholder([doc.title, doc.text])).map((doc) => {
    if (!doc.sourceHash) throw new Error(`Document ${doc.id} has no source hash.`);
    const id = `evidence:${doc.id}`;
    return {
      id,
      docId: doc.id,
      kind: kindFor(doc.type),
      authority: authorityFor(doc.type),
      text: doc.text,
      locator: {
        source: doc.source,
        ...(profilePointers[doc.id] ? { jsonPointer: profilePointers[doc.id] } : {}),
      },
      sourceHash: doc.sourceHash,
    };
  });
}

/**
 * Retrieval excerpts are evidence in their own right. The parent document
 * record remains the canonical owner for exact JSON facts, while this record
 * gives narrative claims a precise heading and line-addressable citation.
 */
export function evidenceFromChunks(
  chunks: readonly Chunk[],
  documents: readonly EvidenceRecord[],
): EvidenceRecord[] {
  const byDocument = new Map(documents.map((record) => [record.docId, record]));
  return chunks.filter((chunk) => !containsAuthoringPlaceholder([chunk.text, chunk.headings]) && byDocument.has(chunk.docId)).map((chunk) => {
    const parent = byDocument.get(chunk.docId);
    if (!parent) throw new Error(`Chunk ${chunk.id} has no parent evidence record.`);
    return {
      id: `evidence:${chunk.id}`,
      docId: chunk.docId,
      kind: parent.kind,
      authority: parent.authority,
      text: chunk.text,
      locator: {
        source: chunk.source,
        ...(chunk.headings.length > 0 ? { headingPath: chunk.headings } : {}),
        ...(chunk.startLine ? { startLine: chunk.startLine } : {}),
        ...(chunk.endLine ? { endLine: chunk.endLine } : {}),
      },
      sourceHash: chunk.sourceHash,
    };
  });
}
