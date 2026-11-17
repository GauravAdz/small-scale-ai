/** Authoring markers invalidate a whole field/proposition, never just a word. */
export function containsAuthoringPlaceholder(value: unknown): boolean {
  if (typeof value === "string") {
    return /\b(?:todo|placeholder|tbd|fixme|replace\s+me|fill\s+this\s+in)\b|<!--|\{\{[^}]+\}\}|\[(?:insert|add|your)\s+[^\]]+\]/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsAuthoringPlaceholder);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsAuthoringPlaceholder);
  }
  return false;
}

/** Drop complete authoring paragraphs, preserving line positions for citations. */
export function omitAuthoringParagraphs(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let paragraph: number[] = [];
  let comment = false;
  let invalidHeadingDepth: number | undefined;
  const flush = () => {
    if (containsAuthoringPlaceholder(paragraph.map((index) => lines[index]).join("\n"))) {
      for (const index of paragraph) lines[index] = "";
    }
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading) {
      flush();
      if (invalidHeadingDepth !== undefined && heading[1].length <= invalidHeadingDepth) {
        invalidHeadingDepth = undefined;
      }
      if (containsAuthoringPlaceholder(line)) invalidHeadingDepth = heading[1].length;
    }
    if (line.includes("<!--")) comment = true;
    // Keep the marker until flush so a comment embedded in a sentence rejects
    // that entire paragraph, including wrapped continuation lines.
    if (comment && !line.includes("<!--")) lines[index] = `<!-- ${line}`;
    if (line.includes("-->")) comment = false;
    if (invalidHeadingDepth !== undefined) lines[index] = "";
    if (!line.trim() && !comment) flush();
    else paragraph.push(index);
  }
  flush();
  return lines.join("\n");
}
