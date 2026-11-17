/**
 * Reads the `data/` directory into typed documents.
 *
 * This is the seam that makes the knowledge base zero-code editable: add a
 * markdown file, re-run `npm run ingest`, and the counterpart knows about it.
 */

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { containsAuthoringPlaceholder, omitAuthoringParagraphs } from "./placeholders";

import type { KnowledgeDoc } from "@/lib/rag/types";
import {
  frontmatterSchema,
  profileSchema,
  skillParts,
  type ExperienceRole,
  type Frontmatter,
  type Profile,
  type ProjectSummary,
} from "./schema";

export const DATA_DIR = path.join(process.cwd(), "data");
export const INDEX_PATH = path.join(DATA_DIR, ".index", "index.json");

/** Read and validate `data/profile.json`. */
export function loadProfile(dataDir: string = DATA_DIR): Profile {
  const file = path.join(dataDir, "profile.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Every counterpart needs a profile.json.`);
  }

  const parsed = profileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `data/profile.json is invalid:\n${parsed.error.issues
        .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return parsed.data;
}

/** Every `.md` file under `data/`, recursively, excluding dotted dirs. */
function markdownFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full, base);
    return entry.isFile() && entry.name.endsWith(".md") ? [path.relative(base, full)] : [];
  });
}

export type MarkdownDoc = {
  relativePath: string;
  slug: string;
  frontmatter: Frontmatter;
  body: string;
};

export function loadMarkdownDocs(dataDir: string = DATA_DIR): MarkdownDoc[] {
  return markdownFiles(dataDir).map((relativePath) => {
    const raw = fs.readFileSync(path.join(dataDir, relativePath), "utf8");
    const { data, content } = matter(raw);
    const fallbackSlug = path.basename(relativePath, ".md");

    const parsed = frontmatterSchema.safeParse({
      title: data.title ?? fallbackSlug,
      ...data,
    });

    if (!parsed.success) {
      throw new Error(
        `Invalid frontmatter in data/${relativePath}:\n${parsed.error.issues
          .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n")}`,
      );
    }

    return {
      relativePath,
      slug: parsed.data.slug ?? fallbackSlug,
      frontmatter: parsed.data,
      body: content.trim(),
    };
  });
}

/**
 * `profile.json` holds facts nobody writes prose about — contact details, skill
 * lists, availability. Synthesising them into documents means questions like
 * "what languages do you use?" are answerable from retrieval like anything else,
 * instead of needing a special case in the prompt.
 */
export function profileDocuments(profile: Profile): KnowledgeDoc[] {
  profile = profileSchema.parse(profile);
  const docs: KnowledgeDoc[] = [];

  const push = (id: string, title: string, text: string, weight: number) => {
    if (text.trim() && !containsAuthoringPlaceholder(text)) {
      docs.push({ id, title, type: "profile", source: "data/profile.json", weight, text });
    }
  };

  push(
    "profile:bio",
    "About me",
    [
      `# About ${profile.name}`,
      profile.tagline ? `_${profile.tagline}_` : "",
      profile.bio,
      profile.title ? `\nCurrent focus: ${profile.title}.` : "",
      // Age is composed here from the structured field rather than written into
      // `bio` prose. One number, one place to change it, and the sentence the
      // model retrieves is generated rather than maintained by hand.
      profile.age ? `Age: ${profile.age} years old.` : "",
      profile.dateOfBirth ? `Date of birth: ${profile.dateOfBirth}.` : "",
      profile.birthCountry ? `Birth country: ${profile.birthCountry}.` : "",
      profile.citizenship ? `Citizenship: ${profile.citizenship}.` : "",
      profile.location ? `Based in ${profile.location}.` : "",
      profile.availability ? `Availability: ${profile.availability.label}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    95,
  );

  push(
    "profile:skills",
    "Skills & tools",
    [
      "# Skills and tools",
      ...profile.skills.map((group) => {
        // Levels are stated explicitly so "how good are you with PyTorch?"
        // gets a real answer instead of a hedge.
        const items = group.items.map((skill) => {
          const { name, level } = skillParts(skill);
          return level ? `- ${name} — ${level}` : `- ${name}`;
        });
        return `## ${group.group}\n\n${items.join("\n")}`;
      }),
    ].join("\n\n"),
    85,
  );

  if (profile.focusAreas.length > 0) {
    push(
      "profile:focus",
      "What I focus on",
      [
        "# What I focus on",
        ...profile.focusAreas.map((area) =>
          area.detail ? `- ${area.label} (${area.detail})` : `- ${area.label}`,
        ),
      ].join("\n"),
      88,
    );
  }

  if (profile.education.length > 0) {
    push(
      "profile:education",
      "Education",
      [
        "# Education",
        // Kept as flowing lines rather than headings + short bodies: headings
        // live in chunk metadata, so an entry whose body is only a date range
        // falls under the minimum chunk size and drops out of the index
        // entirely — which is how this silently went missing the first time.
        ...profile.education.map((entry) => {
          const dates = [entry.start, entry.end].filter(Boolean).join(" – ");
          const studyDetails = [
            entry.location ? `Location: ${entry.location}.` : "",
            entry.expectedEnd ? `Expected completion: ${entry.expectedEnd}.` : "",
            entry.studyMode ? `Study mode: ${entry.studyMode}.` : "",
            entry.instructionLanguage ? `Instruction language: ${entry.instructionLanguage}.` : "",
            entry.coursework?.taken.length
              ? `Coursework taken: ${entry.coursework.taken.join(", ")}.`
              : "",
            entry.coursework?.recognized.length
              ? `Prior coursework recognized: ${entry.coursework.recognized.join(", ")}.`
              : "",
            entry.coursework?.planned.length
              ? `Planned coursework, not yet taken: ${entry.coursework.planned.join(", ")}.`
              : "",
          ];
          return [
            `${entry.credential} at ${entry.school}${dates ? ` (${dates})` : ""}.`,
            ...studyDetails,
            entry.detail,
          ]
            .filter(Boolean)
            // Optional authoring fields have already been omitted by the schema.
            .join("\n");
        }),
      ].join("\n\n"),
      88,
    );
  }

  if (profile.availability) {
    // "What kind of work are you looking for?" is one of the two questions a
    // recruiter always asks, and it used to be answerable only from a prose
    // paragraph in faq.md. Giving it its own document means retrieval can hit
    // it directly instead of via whatever paragraph happens to share vocabulary.
    push(
      "profile:availability",
      "Availability & what I'm looking for",
      [
        "# Availability and what I'm looking for",
        `Status: ${profile.availability.label}.`,
        profile.availability.interests.length > 0
          ? `Interested in: ${profile.availability.interests.join(", ")}.`
          : "",
        profile.availability.note ?? "",
        profile.location ? `Based in ${profile.location}.` : "",
        `Hiring, opportunities, roles, internships and collaboration enquiries reach me at ${profile.contact.email}, or through the message form on this site.`,
      ]
        .filter(Boolean)
        .join("\n"),
      92,
    );
  }

  push(
    "profile:contact",
    "Contact",
    [
      "# How to reach me",
      `Email: ${profile.contact.email}`,
      profile.contact.linkedin ? `LinkedIn: ${profile.contact.linkedin}` : "",
      profile.contact.github ? `GitHub: ${profile.contact.github}` : "",
      profile.contact.website ? `Website: ${profile.contact.website}` : "",
      profile.availability
        ? `\nCurrent availability: ${profile.availability.label}.`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    90,
  );

  if (profile.resume) {
    push(
      "profile:resume",
      "Curriculum vitae",
      `# Curriculum vitae\n\nGaurav's CV is available to download at ${profile.resume}.`,
      90,
    );
  }

  if (profile.metrics.length > 0) {
    push(
      "profile:metrics",
      "At a glance",
      [
        "# At a glance",
        ...profile.metrics.map(
          (metric) =>
            `- ${metric.label}: ${metric.value}${metric.hint ? ` (${metric.hint})` : ""}`,
        ),
      ].join("\n"),
      60,
    );
  }

  return docs;
}

/**
 * Fold `summary` and `tags` into the indexed text.
 *
 * They were retrieval-invisible while living only in frontmatter, which is why
 * "tell me about your AI projects" missed the projects entirely: the word "AI"
 * appears in `summary`, and "RAG"/"Claude API" only in `tags`. These are the
 * most information-dense lines in a project file — they belong in the index.
 */
function withFrontmatterContext(doc: MarkdownDoc): string {
  const { summary, tags, role, status, year } = doc.frontmatter;

  const facets = [
    role && `Role: ${role}`,
    status && `Status: ${status}`,
    year && `Year: ${year}`,
    tags.length > 0 && `Tags: ${tags.join(", ")}`,
  ].filter(Boolean);

  // Placed above the body so it lands in the document's opening chunk.
  return [summary, facets.join(" · "), doc.body].filter(Boolean).join("\n\n");
}

/** The full corpus: profile-derived documents plus every markdown file. */
export function loadKnowledgeDocs(dataDir: string = DATA_DIR): KnowledgeDoc[] {
  const profile = loadProfile(dataDir);
  const markdown = loadMarkdownDocs(dataDir).map<KnowledgeDoc>((doc) => ({
    id: doc.relativePath.replace(/\.md$/, "").replace(/\\/g, "/"),
    title: doc.frontmatter.title,
    type: doc.frontmatter.type,
    source: `data/${doc.relativePath.replace(/\\/g, "/")}`,
    slug: doc.slug,
    weight: doc.frontmatter.weight,
    url: doc.frontmatter.url || undefined,
    text: omitAuthoringParagraphs(withFrontmatterContext(doc)),
  }));

  return [...profileDocuments(profile), ...markdown].filter((doc) =>
    doc.text.trim() && !containsAuthoringPlaceholder([doc.title, doc.text, doc.url]),
  );
}

/** Projects for the showcase panel, pinned ones first. */
export function loadProjects(dataDir: string = DATA_DIR): ProjectSummary[] {
  const profile = loadProfile(dataDir);
  const pinned = profile.pinnedProjects;

  return loadMarkdownDocs(dataDir)
    .filter((doc) => doc.frontmatter.type === "project")
    .map<ProjectSummary>((doc) => ({ ...doc.frontmatter, slug: doc.slug }))
    .sort((a, b) => {
      const rank = (slug: string) => {
        const index = pinned.indexOf(slug);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
      };
      const byPin = rank(a.slug) - rank(b.slug);
      if (byPin !== 0) return byPin;
      const byWeight = b.weight - a.weight;
      if (byWeight !== 0) return byWeight;
      return (b.year ?? 0) - (a.year ?? 0);
    });
}

/** Role metadata for the compact Experience card, owned by experience.md. */
export function loadExperienceRoles(dataDir: string = DATA_DIR): ExperienceRole[] {
  return loadMarkdownDocs(dataDir)
    .filter((doc) => doc.frontmatter.type === "experience")
    .flatMap((doc) => doc.frontmatter.experienceRoles);
}
