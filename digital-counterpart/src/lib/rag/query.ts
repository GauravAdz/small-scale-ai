import { z } from "zod";

export const retrievalQuerySchema = z.object({
  original: z.string(),
  expanded: z.string(),
});

export type RetrievalQuery = z.infer<typeof retrievalQuerySchema>;

export function retrievalQuery(original: string, expanded = original): RetrievalQuery {
  return retrievalQuerySchema.parse({ original: original.trim(), expanded: expanded.trim() });
}

