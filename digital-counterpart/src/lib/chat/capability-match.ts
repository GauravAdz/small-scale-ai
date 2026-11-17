import { skillParts, type Skill, type SkillGroup } from "@/lib/knowledge/schema";

const AMBIGUOUS_SINGLE_WORDS = new Set([
  "and",
  "beyond",
  "code",
  "design",
  "development",
  "js",
  "next",
  "the",
  "with",
]);

function normalizedPhrase(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("+", " plus ")
    .replaceAll("#", " sharp ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsPhrase(query: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${query} `.includes(` ${phrase} `);
}

function authoredPhrases(values: string[]): string[] {
  return values.flatMap((value) => [
    normalizedPhrase(value),
    ...value.split(/\s*(?:&|\/)\s*/).map(normalizedPhrase),
  ]);
}

/** Match authored names loosely enough for natural phrasing, but never by substring. */
function matchesVocabulary(query: string, names: string[], aliases: string[] = []): boolean {
  const normalizedQuery = normalizedPhrase(query);
  const namesAndParts = authoredPhrases(names);
  const exactPhrases = [...namesAndParts, ...aliases.map(normalizedPhrase)];

  if (exactPhrases.some((phrase) => {
    const words = phrase.split(" ");
    return containsPhrase(normalizedQuery, phrase) &&
      (words.length > 1 || (words[0].length > 1 && !AMBIGUOUS_SINGLE_WORDS.has(words[0])));
  })) return true;

  const queryWords = new Set(normalizedQuery.split(" "));
  return namesAndParts
    .flatMap((phrase) => phrase.split(" "))
    .some((word) => word.length > 1 && !AMBIGUOUS_SINGLE_WORDS.has(word) && queryWords.has(word));
}

export function matchSkillGroups(query: string, groups: readonly SkillGroup[]): SkillGroup[] {
  return groups.filter((group) => matchesVocabulary(
    query,
    [group.group, ...group.items.map((item) => skillParts(item).name)],
    group.aliases,
  ));
}

export type MatchedSkill = { group: SkillGroup; skill: ReturnType<typeof skillParts> };

export function matchSkills(query: string, groups: readonly SkillGroup[]): MatchedSkill[] {
  return groups.flatMap((group) => group.items.flatMap((item: Skill) => {
    const skill = skillParts(item);
    return matchesVocabulary(query, [skill.name]) ? [{ group, skill }] : [];
  }));
}

export function asksForSkillLevel(query: string): boolean {
  return /\bproficien(?:t|cy)\b|\b(?:skill|proficiency|experience|competency) level\b|\bhow (?:good|skilled|strong|experienced|comfortable|capable|advanced)\b|\bhow much experience\b/i.test(query);
}
