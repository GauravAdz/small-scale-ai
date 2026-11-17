import { tokenize } from "@/lib/rag/bm25";
import type { ProjectSummary } from "@/lib/knowledge/schema";

export type ProjectSelectionMode =
  | "editorial"
  | "relevance"
  | "relevance-with-editorial-tiebreak";

export type RankedProject = Readonly<{
  project: ProjectSummary;
  score: number;
  relevanceScore: number;
  editorialRank: number;
  mode: ProjectSelectionMode;
  evidenceIds: readonly string[];
  reasons: readonly string[];
}>;

export type ProjectSelection = Readonly<{
  kind: "ranking" | "discovery";
  mode: ProjectSelectionMode;
  projects: readonly ProjectSummary[];
  ranked: readonly RankedProject[];
}>;

/** Category and ranking words cannot distinguish one project from another. */
const NON_DISCRIMINATING_TERMS = new Set([
  "a", "about", "and", "are", "at", "best", "built", "demonstrate",
  "demonstrates", "example", "examples", "favorite", "favourite", "first",
  "flagship", "for", "gaurav", "has", "he", "his", "i", "in", "is",
  "look", "made", "main", "me", "most", "of", "portfolio", "prominent",
  "project", "projects", "proudest", "represent", "representative",
  "represents", "s", "should", "show", "strongest", "the", "to", "top", "what",
  "which", "work",
]);

const PROJECT_FACETS: ReadonlyArray<Readonly<{ asks: RegExp; evidence: RegExp; label: string }>> = [
  {
    asks: /\b(ai|artificial intelligence|machine.?learning|ml|llm|rag|prompt(?:ing| design)?)\b/i,
    evidence: /\b(ai|artificial intelligence|machine.?learning|ml|llm|rag|classifier|data science|prompt design)\b/i,
    label: "AI",
  },
  {
    asks: /\b(data science|data analysis|analytics|geospatial|satellite|pandas|shiny|python)\b/i,
    evidence: /\b(data science|data|analysis|analytics|geospatial|satellite|classifier|pandas|shiny|python)\b/i,
    label: "data",
  },
  {
    asks: /\b(web|frontend|front-end|react|next\.?js|typescript|javascript|html|css|tailwind|node\.?js)\b/i,
    evidence: /\b(web|frontend|front-end|react|next\.?js|typescript|javascript|html|css|tailwind|node\.?js)\b/i,
    label: "web",
  },
  {
    asks: /\b(robotics?|hardware|iot|automation|embedded|sensors?)\b/i,
    evidence: /\b(robotics?|hardware|iot|automation|embedded|sensors?|arduino|raspberry pi)\b/i,
    label: "hardware",
  },
];

function meaningfulTerms(question: string): Set<string> {
  return new Set(tokenize(question).filter((term) =>
    term.length > 1 && !NON_DISCRIMINATING_TERMS.has(term)));
}

function relevanceFor(question: string, project: ProjectSummary): {
  score: number;
  reasons: string[];
} {
  const terms = meaningfulTerms(question);
  const title = new Set(tokenize(project.title));
  const tags = new Set(tokenize(project.tags.join(" ")));
  const summary = new Set(tokenize(project.summary ?? ""));
  const metadata = new Set(tokenize([project.role, project.status].filter(Boolean).join(" ")));
  const matches: string[] = [];
  let score = 0;

  for (const term of terms) {
    let matched = false;
    if (title.has(term)) {
      score += 12;
      matched = true;
    }
    if (tags.has(term)) {
      score += 8;
      matched = true;
    }
    if (summary.has(term)) {
      score += 3;
      matched = true;
    }
    if (metadata.has(term)) {
      score += 1;
      matched = true;
    }
    if (matched) matches.push(term);
  }

  const evidenceText = [project.title, project.summary, project.tags.join(" ")]
    .filter(Boolean)
    .join(" ");
  const facets = PROJECT_FACETS.filter(({ asks, evidence }) =>
    asks.test(question) && evidence.test(evidenceText));
  score += facets.length * 20;

  return {
    score,
    reasons: [
      matches.length > 0 ? `matches ${[...new Set(matches)].join(", ")}` : null,
      ...facets.map(({ label }) => `matches ${label} facet`),
    ].filter((reason): reason is string => Boolean(reason)),
  };
}

/** User constraints decide relevance; authored order is the default and tie-breaker. */
export function rankProjectsForQuestion(
  question: string,
  projects: readonly ProjectSummary[],
): RankedProject[] {
  const scored = projects.map((project, editorialRank) => ({
    project,
    editorialRank,
    relevance: relevanceFor(question, project),
  }));
  const mode: ProjectSelectionMode = scored.some(({ relevance }) => relevance.score > 0)
    ? "relevance-with-editorial-tiebreak"
    : "editorial";

  return scored
    .map(({ project, editorialRank, relevance }) => ({
      project,
      score: relevance.score,
      relevanceScore: relevance.score,
      editorialRank,
      mode,
      evidenceIds: [`evidence:projects/${project.slug}`],
      reasons: relevance.reasons,
    }))
    .sort((left, right) =>
      right.relevanceScore - left.relevanceScore || left.editorialRank - right.editorialRank);
}

function selectionKind(question: string): ProjectSelection["kind"] | null {
  if (
    /\b(best|strongest|main|top|most prominent|prominent|flagship|most representative|best represents?|proudest|favourite|favorite)\b/i.test(question) ||
    /\blook\b.{0,20}\bat first\b/i.test(question)
  ) return "ranking";
  if (
    (
      /^(?:what|which|show|list)\b/i.test(question.trim()) &&
      /\b(projects?|works?|built|made|created)\b/i.test(question)
    ) ||
    /^(?:does|has)\s+gaurav\b.{0,50}\bworks?\b.{0,30}\b(?:related|using|involving)\b/i.test(question.trim())
  ) return "discovery";
  return null;
}

function requestedProjectCount(question: string, kind: ProjectSelection["kind"]): number {
  if (
    kind === "ranking" &&
    /\bproject\b(?!s)/i.test(question) &&
    !/\bprojects\b/i.test(question)
  ) return 1;
  return 3;
}

/** One ordered project set for both factual planning and visual presentation. */
export function selectProjectsForQuestion(
  question: string,
  projects: readonly ProjectSummary[],
): ProjectSelection | null {
  const kind = selectionKind(question);
  if (!kind) return null;
  const ranked = rankProjectsForQuestion(question, projects);
  const mode = ranked[0]?.mode ?? "editorial";
  if (mode === "editorial" && meaningfulTerms(question).size > 0) return null;
  const eligible = mode === "editorial"
    ? ranked
    : ranked.filter(({ relevanceScore }) => relevanceScore > 0);
  return {
    kind,
    mode,
    projects: eligible.slice(0, requestedProjectCount(question, kind)).map(({ project }) => project),
    ranked,
  };
}
