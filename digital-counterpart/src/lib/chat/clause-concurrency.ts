import type { AtomicQuestion } from "@/lib/evidence/question";

/** Ambiguous references stay sequential. Results always retain question order. */
export async function mapIndependentClauses<T>(
  clauses: readonly AtomicQuestion[],
  concurrency: number,
  processClause: (clause: AtomicQuestion) => Promise<T>,
): Promise<T[]> {
  const dependent = clauses.slice(1).some(({ text }) =>
    /\b(he|his|him|it|its|they|them|their|that|those|this|these|former|latter|above|previous|then)\b/i.test(text),
  );
  const width = dependent ? 1 : Math.max(1, Math.floor(concurrency));
  const results: T[] = new Array(clauses.length);
  let cursor = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(width, clauses.length) }, async () => {
    while (!failure && cursor < clauses.length) {
      const index = cursor++;
      try { results[index] = await processClause(clauses[index]); }
      catch (error) { failure ??= { error }; }
    }
  }));
  if (failure) throw failure.error;
  return results;
}
