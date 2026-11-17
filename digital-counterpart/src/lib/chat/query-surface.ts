/**
 * Conservative cleanup shared by resolution, deterministic routing, and facts.
 * Semantic repair belongs to the recovery interpreter, not this function.
 */
export function normalizeQuerySurface(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bgit[\s._-]+hub\b/gi, "github")
    .replace(/\blinked[\s._-]+in\b/gi, "linkedin")
    .replace(/\be[\s._-]+mail\b/gi, "email");
}
