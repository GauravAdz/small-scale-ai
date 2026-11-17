/**
 * Builders that turn `profile.json` + project frontmatter into visual payloads.
 *
 * This is the replacement for the old `llm/tools.ts`. The data is identical; the
 * difference is who decides. Previously the model chose a tool, which cost a
 * whole extra round-trip to decide something the application already knew from
 * five projects and three skill groups. Now `visual-intent.ts` decides and these
 * functions supply, and the model is left with the one job it is actually needed
 * for — the sentence.
 *
 * Server-only: reads the filesystem via the loader.
 */

import counterpartConfig from "../../../counterpart.config";
import { hasDeliveryAdapter } from "@/lib/contact/delivery";
import { matchSkillGroups } from "@/lib/chat/capability-match";
import { loadExperienceRoles, loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { skillParts, type ProjectSummary } from "@/lib/knowledge/schema";
import { firstName } from "@/lib/person";
import type {
  AvailabilityVisualData,
  ContactFormVisualData,
  EducationVisualEntry,
  EvidenceAtlasVisualData,
  ExperienceVisualData,
  ProfileVisualData,
  ProfileLinkChannel,
  ProfileLinkVisualData,
  ProjectDomain,
  ProjectVisualData,
  SkillVisualGroup,
} from "./visual-types";

/** An unfilled template line must never reach a card as if it were content. */
function real(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /\bTODO\b/.test(value) ? undefined : value;
}

/**
 * Classify a project by its tags so cards can differ meaningfully.
 *
 * Identical cards waste the strongest signal a grid has: a robotics build and a
 * React app are not the same kind of work, and saying so visually is faster
 * than making someone read four tag chips to find out.
 */
const DOMAIN_TAGS: Array<[ProjectDomain, RegExp]> = [
  ["hardware", /\b(iot|hardware|robotic|sensor|automation|embedded|arduino)\b/i],
  ["ai", /\b(ai|ml|rag|pytorch|gemini|gemma|llm|prompt|machine.?learning|nlp)\b/i],
  ["data", /\b(data|geospatial|pandas|analysis|shiny|classif|statistic)\b/i],
  ["web", /\b(react|next\.?js|frontend|css|html|tailwind|typescript|javascript|web)\b/i],
];

export function projectDomain(project: Pick<ProjectSummary, "tags" | "summary">): ProjectDomain {
  const haystack = [...project.tags, project.summary ?? ""].join(" ");
  for (const [domain, pattern] of DOMAIN_TAGS) {
    if (pattern.test(haystack)) return domain;
  }
  return "code";
}

function toProjectVisual(project: ProjectSummary): ProjectVisualData {
  return {
    slug: project.slug,
    evidenceIds: [`evidence:projects/${project.slug}`],
    title: project.title,
    summary: real(project.summary),
    year: project.year,
    status: project.status,
    role: project.role,
    tags: project.tags,
    url: project.url || undefined,
    repo: project.repo || undefined,
    domain: projectDomain(project),
  };
}

export function projectsVisual(slugs?: string[]): ProjectVisualData[] {
  const all = loadProjects();
  const bySlug = new Map(all.map((project) => [project.slug, project]));
  const wanted = slugs?.length
    ? slugs.flatMap((slug) => {
        const project = bySlug.get(slug);
        return project ? [project] : [];
      })
    : all;
  return (wanted.length > 0 ? wanted : all).map(toProjectVisual);
}

/**
 * Return only projects that genuinely answer a capability-shaped question.
 *
 * This is intentionally source-driven: aliases describe how visitors speak,
 * while matches are still made against authored tags/summaries. It avoids the
 * old failure mode where "built with AI" expanded into the entire portfolio.
 */
const PROJECT_FACETS: Array<{ asks: RegExp; evidence: RegExp }> = [
  {
    asks: /\b(ai|artificial intelligence|machine.?learning|ml|llm|rag|gemma|gemini|prompt(?:ing| design)?)\b/i,
    evidence: /\b(ai|artificial intelligence|machine.?learning|ml|llm|rag|gemma|gemini|classifier|data science|prompt design)\b/i,
  },
  {
    asks: /\b(data science|data analysis|analytics|geospatial|satellite|pandas|shiny|python)\b/i,
    evidence: /\b(data science|data|analysis|analytics|geospatial|satellite|classifier|pandas|shiny|python)\b/i,
  },
  {
    asks: /\b(web|frontend|front-end|react|next\.?js|typescript|javascript|html|css|tailwind|node\.?js)\b/i,
    evidence: /\b(web|frontend|front-end|react|next\.?js|typescript|javascript|html|css|tailwind|node\.?js)\b/i,
  },
  {
    asks: /\b(robotics?|hardware|iot|automation|embedded|sensors?)\b/i,
    evidence: /\b(robotics?|hardware|iot|automation|embedded|sensors?)\b/i,
  },
];

export function relevantProjectsVisual(query: string, limit = 3): ProjectVisualData[] {
  const projects = projectsVisual();
  const facets = PROJECT_FACETS.filter(({ asks }) => asks.test(query));
  if (facets.length === 0) return projects.slice(0, limit);

  return projects
    .map((project, order) => {
      const evidence = [project.title, project.summary ?? "", ...project.tags].join(" ");
      const score = facets.reduce(
        (total, facet) => total + (facet.evidence.test(evidence) ? 1 : 0),
        0,
      );
      return { project, order, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit)
    .map(({ project }) => project);
}

export function projectVisual(slug: string): ProjectVisualData | null {
  const match = loadProjects().find((project) => project.slug === slug);
  return match ? toProjectVisual(match) : null;
}

/** The two the rail shows. Pin order in `profile.json` is the ranking. */
export function featuredProjectsVisual(): ProjectVisualData[] {
  return projectsVisual().slice(0, counterpartConfig.showcase.featuredProjects);
}

export function skillsVisual(group?: string): SkillVisualGroup[] {
  const profile = loadProfile();
  const groups = group
    ? profile.skills.filter((entry) => entry.group.toLowerCase() === group.toLowerCase())
    : profile.skills;

  return (groups.length > 0 ? groups : profile.skills).map((entry) => ({
    group: entry.group,
    items: entry.items.map(skillParts),
  }));
}

function evidenceTokens(values: string[]): Set<string> {
  // Group-label glue and broad creative terms are too weak to prove a link.
  // In particular, "Graphics Design" must not connect to "Prompt Design" —
  // they share a word, not evidence of the same capability.
  const ignored = new Set([
    "and",
    "the",
    "with",
    "development",
    "beyond",
    "code",
    "design",
    "science",
  ]);
  return new Set(
    values
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
      .filter((token) => token.length > 1 && !ignored.has(token) && token !== "js"),
  );
}

/**
 * Capability-to-project proof, derived only from authored skill names, group
 * labels and project tags. A missing edge is preferable to an invented claim.
 */
export function evidenceAtlasVisual(query?: string): EvidenceAtlasVisualData {
  const profile = loadProfile();
  const projects = projectsVisual();

  const capabilities = profile.skills.map((group) => {
    const capabilityTerms = evidenceTokens([
      group.group,
      ...group.aliases,
      ...group.items.map((item) => skillParts(item).name),
    ]);

    const projectSlugs = projects
      .filter((project) => {
        const projectTerms = evidenceTokens(project.tags);
        for (const term of capabilityTerms) if (projectTerms.has(term)) return true;
        return false;
      })
      .map((project) => project.slug);

    return {
      id: group.group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      label: group.group,
      skills: group.items.map(skillParts),
      projectSlugs,
    };
  });

  if (!query) return { capabilities, projects };

  const focused = matchSkillGroups(query, profile.skills)
    .map((group) => capabilities.find((capability) => capability.label === group.group)!)
    .filter(Boolean);

  // A broad capability question benefits from the whole map. A named skill or
  // domain benefits from focus: remove unrelated branches and their projects.
  if (focused.length === 0) return { capabilities, projects };
  const slugs = new Set(focused.flatMap((capability) => capability.projectSlugs));
  return {
    capabilities: focused,
    projects: projects.filter((project) => slugs.has(project.slug)),
  };
}

export function educationVisual(): EducationVisualEntry[] {
  return loadProfile().education.map((entry) => ({
    credential: entry.credential,
    school: entry.school,
    location: entry.location,
    start: entry.start,
    end: entry.end,
    detail: real([
      entry.detail,
      entry.expectedEnd ? `Expected completion: ${entry.expectedEnd}` : undefined,
      entry.studyMode,
      entry.instructionLanguage ? `${entry.instructionLanguage}-taught` : undefined,
    ].filter(Boolean).join(" · ")),
  }));
}

export function availabilityVisual(): AvailabilityVisualData {
  const profile = loadProfile();
  const availability = profile.availability;

  return {
    status: availability?.status ?? "open",
    label: availability?.label ?? "Ask about availability",
    interests: availability?.interests ?? [],
    note: real(availability?.note),
    location: profile.location,
    email: profile.contact.email,
    resume: profile.resume,
  };
}

export function profileVisual(): ProfileVisualData {
  const profile = loadProfile();

  return {
    name: profile.name,
    title: profile.title,
    avatar: profile.avatar,
    location: profile.location,
    age: profile.age,
    tagline: profile.tagline,
    focusAreas: profile.focusAreas,
    // Straight from `metrics` — author-supplied counters, not computed claims.
    facts: profile.metrics.map((metric) => ({
      label: metric.label,
      value: metric.value,
    })),
  };
}

function displayUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function urlHandle(value: string): string | undefined {
  try {
    const segment = new URL(value).pathname.split("/").filter(Boolean).at(-1);
    return segment ? `@${decodeURIComponent(segment)}` : undefined;
  } catch {
    return undefined;
  }
}

/** A compact, canonical action for one profile contact channel. */
export function profileLinkVisual(
  channel: ProfileLinkChannel,
): ProfileLinkVisualData | null {
  const profile = loadProfile();

  switch (channel) {
    case "github": {
      const href = real(profile.contact.github);
      if (!href) return null;
      const handle = urlHandle(href);
      return {
        channel,
        label: "GitHub",
        value: handle ?? displayUrl(href),
        href,
        handle,
        actionLabel: "Open GitHub",
      };
    }
    case "linkedin": {
      const href = real(profile.contact.linkedin);
      if (!href) return null;
      return {
        channel,
        label: "LinkedIn",
        value: profile.name,
        href,
        handle: urlHandle(href),
        actionLabel: "Open LinkedIn",
      };
    }
    case "website": {
      const href = real(profile.contact.website);
      if (!href) return null;
      return {
        channel,
        label: "Website",
        value: displayUrl(href),
        href,
        actionLabel: "Open website",
      };
    }
    case "email": {
      const value = profile.contact.email;
      return {
        channel,
        label: "Email",
        value,
        href: `mailto:${value}`,
        actionLabel: "Email Gaurav",
      };
    }
    case "resume": {
      const href = real(profile.resume);
      if (!href) return null;
      return {
        channel,
        label: "Curriculum vitae",
        value: `${profile.name}'s CV`,
        href,
        handle: "PDF",
        actionLabel: "Download CV",
        download: true,
      };
    }
  }
}

/** Experience roles come from typed metadata in the same record RAG cites. */
export function experienceVisual(): ExperienceVisualData {
  const profile = loadProfile();

  return {
    roles: loadExperienceRoles(),
    selfDirected: projectsVisual().slice(0, 3),
    email: profile.contact.email,
  };
}

export function contactFormVisual(): ContactFormVisualData {
  const profile = loadProfile();

  return {
    email: profile.contact.email,
    name: firstName(profile.name),
    deliveryConfigured: hasDeliveryAdapter(),
    reasons: counterpartConfig.contact.reasons,
    limits: counterpartConfig.contact.limits,
  };
}
