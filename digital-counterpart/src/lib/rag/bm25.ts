/**
 * Okapi BM25 over the local corpus.
 *
 * On a personal knowledge base — a few hundred chunks full of proper nouns like
 * "Budhanilkantha", "Puter.js", "App Router" — lexical scoring is not a fallback
 * for real search, it frequently *is* the better half. Keeping it means the app
 * works with no embedding provider configured at all.
 */

import type { Chunk, LexicalStats } from "./types";

const K1 = 1.5;
const B = 0.75;

/**
 * Standard English stopwords, plus the interrogative and auxiliary verbs that
 * dominate how people actually query a portfolio ("how do you…", "can you tell
 * me about…"). Leaving `how` and `do` in the vocabulary made "how do you like to
 * work?" rank "How do I get in touch?" above the work-philosophy notes — the
 * question words matched and the content words didn't.
 */
const STOPWORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between",
  "both", "but", "by", "can", "could", "did", "do", "does", "doing", "done",
  "down", "during", "each", "few", "for", "from", "further", "get", "had", "has",
  "have", "having", "he", "her", "here", "hers", "him", "his", "how", "i", "if",
  "in", "into", "is", "it", "its", "just", "like", "me", "more", "most", "much", "my",
  "no", "nor", "not", "now", "of", "off", "on", "once", "only", "or", "other",
  "our", "ours", "out", "over", "own", "same", "she", "should", "so", "some",
  "such", "tell", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "us", "very", "was", "we", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "would", "you", "your", "yours",
]);

/**
 * Lowercase, split on non-alphanumerics (keeping `.` inside tokens so "puter.js"
 * and "node.js" survive), drop stopwords, and strip a trailing plural `s`.
 */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9.+#]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token));
}

/** Build the corpus statistics BM25 needs. Run once, at ingest time. */
export function buildLexicalStats(chunks: Chunk[]): LexicalStats {
  const documentFrequency: Record<string, number> = {};
  const lengths: Record<string, number> = {};
  let totalLength = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(indexableText(chunk));
    lengths[chunk.id] = tokens.length;
    totalLength += tokens.length;

    for (const term of new Set(tokens)) {
      documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
    }
  }

  return {
    documentFrequency,
    lengths,
    averageLength: chunks.length > 0 ? totalLength / chunks.length : 0,
    totalChunks: chunks.length,
  };
}

/** Field weights, applied by repetition — the simplest way to weight fields
 *  inside a single BM25 index without a second scoring pass. */
const TITLE_BOOST = 2;
const HEADING_BOOST = 3;

/**
 * Headings and title carry real signal and are weighted above body prose.
 *
 * Without this, "how do you like to work?" ranked an Education paragraph first,
 * purely because it happened to contain both "like" and "work" in passing —
 * above the notes actually filed under a "How I work" heading. A term in a
 * heading is a statement about what the chunk is *about*; the same term in prose
 * often isn't.
 */
export function indexableText(chunk: Chunk): string {
  return [
    // `type` is a facet people query by name ("your projects", "your
    // education"), so it belongs in the searchable surface. It appears on every
    // chunk of that type, so IDF naturally keeps it from dominating.
    chunk.type,
    ...Array<string>(TITLE_BOOST).fill(chunk.title),
    ...chunk.headings.flatMap((heading) =>
      Array<string>(HEADING_BOOST).fill(heading),
    ),
    chunk.text,
  ].join("\n");
}

/** Score every chunk against a query. Returns raw BM25 scores keyed by chunk id. */
export function scoreLexical(
  query: string,
  chunks: Chunk[],
  stats: LexicalStats,
): Map<string, number> {
  const queryTerms = tokenize(query);
  const scores = new Map<string, number>();
  if (queryTerms.length === 0) return scores;

  // Precompute IDF per unique query term.
  const idf = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    const df = stats.documentFrequency[term] ?? 0;
    // Standard BM25 IDF with +1 smoothing so it never goes negative.
    idf.set(term, Math.log(1 + (stats.totalChunks - df + 0.5) / (df + 0.5)));
  }

  for (const chunk of chunks) {
    const tokens = tokenize(indexableText(chunk));
    if (tokens.length === 0) continue;

    const termFrequency = new Map<string, number>();
    for (const token of tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }

    const docLength = stats.lengths[chunk.id] ?? tokens.length;
    const normalization = stats.averageLength > 0 ? docLength / stats.averageLength : 1;

    let score = 0;
    for (const term of new Set(queryTerms)) {
      const tf = termFrequency.get(term);
      if (!tf) continue;
      const weight = idf.get(term) ?? 0;
      score += (weight * (tf * (K1 + 1))) / (tf + K1 * (1 - B + B * normalization));
    }

    if (score > 0) scores.set(chunk.id, score);
  }

  return scores;
}

/**
 * How much of the query a chunk actually accounts for, weighted by IDF.
 *
 * BM25 scores are normalised by the corpus maximum before fusion, which makes
 * the top hit 1.0 whenever *any* single term matches — so "what was your salary
 * at Google?" scored a perfect 1.0 off the word "Google" alone once Gemini was
 * mentioned in the skills. Relative rank says which chunk is best; it says
 * nothing about whether the corpus answers the question at all.
 *
 * Coverage restores that absolute signal: rare unmatched terms (`salary`) carry
 * far more IDF weight than common matched ones (`google`), so a query whose
 * distinctive words are absent scores low no matter how it ranks.
 *
 * Returns 0–1, or 1 for a query with no scoreable terms (nothing to be missing).
 */
export function queryCoverage(
  query: string,
  chunk: Chunk,
  stats: LexicalStats,
): number {
  return queryCoverageAcross(query, [chunk], stats);
}

/**
 * IDF coverage across a set of chunks.
 *
 * Answers commonly need two complementary notes (for example skills plus a
 * project). Taking the best single-chunk coverage incorrectly called those
 * answers unsupported even when the selected evidence covered the query as a
 * whole. The union preserves the absolute grounding signal without rewarding
 * duplicate chunks.
 */
export function queryCoverageAcross(
  query: string,
  chunks: Chunk[],
  stats: LexicalStats,
): number {
  const terms = new Set(tokenize(query));
  // A subject identifier is useful for ranking but cannot be evidence on its
  // own. Without this, "Can Gaurav fly a plane?" looked partly covered because
  // every profile note naturally contains his name.
  for (const subject of ["gaurav", "adhikari", "gauravgpt"]) terms.delete(subject);
  if (terms.size === 0) return 1;

  const present = new Set(chunks.flatMap((chunk) => tokenize(indexableText(chunk))));

  let matched = 0;
  let total = 0;
  for (const term of terms) {
    const df = stats.documentFrequency[term] ?? 0;
    const idf = Math.log(1 + (stats.totalChunks - df + 0.5) / (df + 0.5));
    total += idf;
    if (present.has(term)) matched += idf;
  }

  return total > 0 ? matched / total : 1;
}
