import { z } from "zod";

export const atomicQuestionKinds = [
  "exact-fact",
  "descriptive",
  "comparison",
  "capability",
  "opinion",
  "inference",
  "unknown",
] as const;

export const atomicQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(atomicQuestionKinds),
});

export type AtomicQuestion = z.infer<typeof atomicQuestionSchema>;

function classify(text: string): AtomicQuestion["kind"] {
  if (/\b(where|when|what year|how old|email|url|repo|degree|school|university|status)\b/i.test(text)) {
    return "exact-fact";
  }
  if (/\b(can|could|capab|know|skill|experienced|proficien|able to)\b/i.test(text)) return "capability";
  if (/\b(compare|versus|vs\.?|difference|stronger)\b/i.test(text)) return "comparison";
  if (/\b(opinion|prefer|think|believe|philosoph\w*)\b/i.test(text)) return "opinion";
  if (/\b(infer|suggest|fit|aligned|likely|based on)\b/i.test(text)) return "inference";
  if (/\b(describe|tell me|explain|give me|summari[sz]e|summary|background|overview|30[ -]?second|what has|what did|how (?:did|does|do))\b/i.test(text)) return "descriptive";
  return "unknown";
}

/** Conservative clause splitting; ambiguous fragments remain one question. */
export function decomposeQuestion(question: string): AtomicQuestion[] {
  const normalized = question.trim();
  if (!normalized) return [];
  const clauses = normalized
    .split(/\s*(?:\?|;|,\s+(?:and|but)\s+|\s+and\s+(?=(?:is|are|was|were|does|did|has|have|can|could|what|where|when|how|why)\b))\s*/i)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.map((text, index) => ({
    id: `q${index + 1}`,
    text: /[?!.]$/.test(text) ? text : `${text}?`,
    kind: classify(text),
  }));
}
