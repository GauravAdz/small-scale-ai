/**
 * Heading-aware markdown chunking.
 *
 * Splitting on headings first (rather than a blind sliding window) keeps each
 * chunk about one thing, and lets every chunk carry its heading trail — which
 * doubles as a precise citation label ("GauravGPT › How it works").
 */

import type { Chunk, KnowledgeDoc } from "@/lib/rag/types";
import { omitAuthoringParagraphs } from "./placeholders";

export type ChunkOptions = {
  size: number;
  overlap: number;
};

type Section = { headings: string[]; body: string; startLine: number; endLine: number };

/** Below this a chunk is a fragment, not a fact. */
const MIN_CHUNK_CHARS = 40;

/**
 * Strip authoring scaffolding before indexing.
 *
 * HTML comments are notes to whoever edits the file, and a `TODO` line marks
 * something not filled in yet. Indexing either means the counterpart retrieves
 * a template and answers from it — strictly worse than finding nothing and
 * admitting the gap, which lets the support layer report an honest evidence gap.
 */
export function sanitize(markdown: string): string {
  return omitAuthoringParagraphs(markdown);
}

/** Split markdown into sections keyed by their `#`/`##`/`###` trail. */
function splitByHeadings(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  const trail: string[] = [];
  let buffer: string[] = [];
  let bufferStartLine = 1;

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      sections.push({
        headings: [...trail],
        body,
        startLine: bufferStartLine,
        endLine: bufferStartLine + buffer.length - 1,
      });
    }
    buffer = [];
  };

  let inFence = false;
  for (const [lineIndex, line] of lines.entries()) {
    if (/^\s*```/.test(line)) inFence = !inFence;

    const heading = !inFence ? /^(#{1,4})\s+(.*)$/.exec(line) : null;
    if (heading) {
      flush();
      const depth = heading[1].length;
      trail.length = Math.max(0, depth - 1);
      trail[depth - 1] = heading[2].trim();
      bufferStartLine = lineIndex + 2;
      continue;
    }

    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * Pack paragraphs into chunks of roughly `size` characters, carrying `overlap`
 * characters of tail context into the next chunk so a sentence that straddles a
 * boundary is still retrievable from either side.
 */
function packParagraphs(body: string, { size, overlap }: ChunkOptions): string[] {
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const paragraph of paragraphs) {
    // A single oversized paragraph (a long list, a code block) gets hard-split.
    if (paragraph.length > size) {
      push();
      current = "";
      for (let i = 0; i < paragraph.length; i += size - overlap) {
        chunks.push(paragraph.slice(i, i + size).trim());
      }
      continue;
    }

    if (current.length + paragraph.length + 2 > size && current.length > 0) {
      push();
      current = overlap > 0 ? current.slice(-overlap).trim() : "";
    }

    current += (current ? "\n\n" : "") + paragraph;
  }

  push();
  return chunks.filter((chunk) => chunk.length > 0);
}

/** Turn one document into its retrievable chunks. */
export function chunkDocument(doc: KnowledgeDoc, options: ChunkOptions): Chunk[] {
  if (!doc.sourceHash) {
    throw new Error(`Document ${doc.id} has no source hash; chunk only through the ingest pipeline.`);
  }
  const sections = splitByHeadings(sanitize(doc.text));
  const chunks: Chunk[] = [];

  for (const section of sections) {
    let previousOffset = -1;
    for (const text of packParagraphs(section.body, options)) {
      if (text.length < MIN_CHUNK_CHARS) continue;

      // Chunk text is always drawn verbatim from the section. Looking it up
      // here keeps citation line spans coupled to the exact persisted excerpt,
      // including hard-split paragraphs and overlap windows.
      const offset = section.body.indexOf(text, Math.max(0, previousOffset + 1));
      const locatedOffset = offset >= 0 ? offset : section.body.indexOf(text);
      const before = locatedOffset >= 0 ? section.body.slice(0, locatedOffset) : "";
      const through = locatedOffset >= 0
        ? section.body.slice(0, locatedOffset + text.length)
        : section.body;
      const startLine = section.startLine + (before.match(/\n/g) ?? []).length;
      const endLine = section.startLine + (through.match(/\n/g) ?? []).length;
      previousOffset = Math.max(previousOffset, locatedOffset);

      chunks.push({
        id: `${doc.id}#${chunks.length}`,
        docId: doc.id,
        title: doc.title,
        type: doc.type,
        source: doc.source,
        url: doc.url,
        weight: doc.weight,
        // Drop a leading heading that just repeats the document title.
        headings: section.headings.filter(
          (heading) => heading && heading.toLowerCase() !== doc.title.toLowerCase(),
        ),
        text,
        sourceHash: doc.sourceHash,
        evidenceIds: doc.evidenceIds ?? [`evidence:${doc.id}`],
        startLine,
        endLine: Math.min(section.endLine, Math.max(startLine, endLine)),
      });
    }
  }

  return chunks;
}

export function chunkAll(docs: KnowledgeDoc[], options: ChunkOptions): Chunk[] {
  return docs.flatMap((doc) => chunkDocument(doc, options));
}
