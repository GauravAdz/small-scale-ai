import { z } from "zod";
import { containsAuthoringPlaceholder } from "./placeholders";

const optionalKnowledgeText = z.preprocess(
  (value) => value === null || containsAuthoringPlaceholder(value) ? undefined : value,
  z.string().optional(),
);
const authoredText = z.string().refine((value) => !containsAuthoringPlaceholder(value), "Expected an authored fact, not an authoring placeholder");

/** ── profile.json ────────────────────────────────────────────────────────── */

export const availabilitySchema = z.object({
  status: z.enum(["open", "selective", "closed"]).default("open"),
  label: authoredText,
  /** What kind of work he's actually after. Drives the hiring card and RAG. */
  interests: z.array(authoredText).default([]),
  /** Free-text constraint — location, timing, visa. Optional on purpose. */
  note: optionalKnowledgeText,
});

export const contactSchema = z.object({
  email: authoredText,
  linkedin: optionalKnowledgeText,
  github: optionalKnowledgeText,
  x: optionalKnowledgeText,
  website: optionalKnowledgeText,
});

export const linkSchema = z.object({
  label: authoredText,
  href: authoredText,
  icon: z
    .enum(["github", "linkedin", "mail", "globe", "x", "file"])
    .default("globe"),
});

export const metricSchema = z.object({
  label: authoredText,
  value: authoredText,
  hint: optionalKnowledgeText,
});

/**
 * A skill is either a bare name or a name with a proficiency level. The level
 * exists mainly for retrieval — it lets the counterpart answer "how good are
 * you with PyTorch?" precisely instead of hedging — so it is folded into the
 * indexed text rather than crowding the badges.
 */
export const skillSchema = z.union([
  authoredText,
  z.object({ name: authoredText, level: optionalKnowledgeText }),
]);

export const skillGroupSchema = z.object({
  group: authoredText,
  /** Search vocabulary for the group. It guides filtering and is never shown as evidence. */
  aliases: z.array(authoredText).default([]),
  items: z.array(skillSchema),
});

/** Normalise either shape into `{ name, level }`. */
export function skillParts(skill: z.infer<typeof skillSchema>): {
  name: string;
  level?: string;
} {
  return typeof skill === "string" ? { name: skill } : skill;
}

/** Headline capabilities, shown as chips on the landing hero. */
export const focusAreaSchema = z.object({
  label: authoredText,
  detail: optionalKnowledgeText,
});

export const educationSchema = z.object({
  school: z.string().refine((value) => !containsAuthoringPlaceholder(value), "School must be an authored fact"),
  credential: z.string().refine((value) => !containsAuthoringPlaceholder(value), "Credential must be an authored fact"),
  location: optionalKnowledgeText,
  start: optionalKnowledgeText,
  end: optionalKnowledgeText,
  expectedEnd: optionalKnowledgeText,
  studyMode: optionalKnowledgeText,
  instructionLanguage: optionalKnowledgeText,
  coursework: z
    .object({
      taken: z.array(authoredText).default([]),
      recognized: z.array(authoredText).default([]),
      planned: z.array(authoredText).default([]),
    })
    .optional(),
  detail: optionalKnowledgeText,
});

export const profileSchema = z.object({
  $schema: z.string().optional(),
  name: authoredText,
  title: authoredText,
  tagline: optionalKnowledgeText,
  location: optionalKnowledgeText,
  /**
   * Single source of truth for age. Stated as a number rather than baked into
   * `bio`/`headline` prose so it is changed in exactly one place — the previous
   * version had "20-year-old" hardcoded in two strings and in the built index.
   */
  age: z.number().int().positive().optional(),
  dateOfBirth: z.string().date().optional(),
  birthCountry: optionalKnowledgeText,
  citizenship: optionalKnowledgeText,
  freshness: z
    .object({
      ageVerifiedAt: z.string().datetime({ offset: true }).optional(),
      locationVerifiedAt: z.string().datetime({ offset: true }).optional(),
      availabilityVerifiedAt: z.string().datetime({ offset: true }).optional(),
      educationVerifiedAt: z.string().datetime({ offset: true }).optional(),
    })
    .optional(),
  avatar: optionalKnowledgeText,
  availability: availabilitySchema.optional(),
  bio: authoredText,
  /** One-line intro for the hero; falls back to `bio` when unset. */
  headline: optionalKnowledgeText,
  /** Path to a CV in `public/`, e.g. /resume.pdf */
  resume: optionalKnowledgeText,
  focusAreas: z.array(focusAreaSchema).default([]),
  contact: contactSchema,
  links: z.array(linkSchema).default([]),
  metrics: z.array(metricSchema).default([]),
  skills: z.array(skillGroupSchema).default([]),
  education: z.array(educationSchema).default([]),
  pinnedProjects: z.array(z.string()).default([]),
});

export type Profile = z.infer<typeof profileSchema>;
export type ProfileLink = z.infer<typeof linkSchema>;
export type ProfileMetric = z.infer<typeof metricSchema>;
export type SkillGroup = z.infer<typeof skillGroupSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type FocusArea = z.infer<typeof focusAreaSchema>;
export type EducationEntry = z.infer<typeof educationSchema>;

/** ── markdown frontmatter ────────────────────────────────────────────────── */

export const experienceRoleSchema = z.object({
  title: authoredText,
  organisation: optionalKnowledgeText,
  period: optionalKnowledgeText,
  detail: optionalKnowledgeText,
});

export const frontmatterSchema = z.object({
  title: authoredText,
  /** Drives the citation label and lets the retriever boost by category. */
  type: z
    .enum(["project", "experience", "education", "philosophy", "faq", "note"])
    .default("note"),
  /** Ties into `profile.pinnedProjects`; defaults to the filename. */
  slug: optionalKnowledgeText,
  /** Higher sorts first in the showcase panel. Also a mild retrieval prior. */
  weight: z.coerce.number().default(50),
  summary: optionalKnowledgeText,
  year: z.coerce.number().optional(),
  status: optionalKnowledgeText,
  role: optionalKnowledgeText,
  tags: z.array(authoredText).default([]),
  url: optionalKnowledgeText,
  repo: optionalKnowledgeText,
  featured: z.boolean().default(false),
  /** Compact role metadata for the Experience visual; narrative evidence stays in the body. */
  experienceRoles: z.array(experienceRoleSchema).default([]),
});

export type Frontmatter = z.infer<typeof frontmatterSchema>;
export type ExperienceRole = z.infer<typeof experienceRoleSchema>;

/** A project as surfaced to the showcase panel. */
export type ProjectSummary = Frontmatter & { slug: string };
