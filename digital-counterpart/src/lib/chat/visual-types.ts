/**
 * The visual vocabulary of an answer.
 *
 * These types are the contract between the deterministic intent layer on the
 * server (`visual-intent.ts`) and the renderer on the client (`chat/visuals/`).
 * Deliberately free of any node-only import so both sides can share them.
 *
 * Factual payloads are assembled from `profile.json` and project frontmatter.
 * Application code selects verified project IDs and never lets a renderer
 * author links, dates, status, tags, roles, or other record fields.
 */

export type VisualKind =
  | "projects"
  | "project-detail"
  | "evidence-atlas"
  | "skills"
  | "education"
  | "availability"
  | "profile"
  | "profile-link"
  | "experience"
  | "contact-form";

export type ProfileLinkChannel = "github" | "linkedin" | "website" | "email" | "resume";

export type ProfileLinkVisualData = {
  channel: ProfileLinkChannel;
  label: string;
  value: string;
  href: string;
  handle?: string;
  actionLabel: string;
  /** Download actions keep the same compact visual without pretending a local
   *  file is an external profile. */
  download?: boolean;
};

export type ProjectVisualData = {
  slug: string;
  /** Canonical project records supporting the factual card payload. */
  evidenceIds: string[];
  /** Approved claim that made this project relevant to the current answer. */
  relevanceClaimId?: string;
  title: string;
  summary?: string;
  year?: number;
  status?: string;
  role?: string;
  tags: string[];
  url?: string;
  repo?: string;
  /** Drives the accent and the glyph, so a robotics project doesn't look like a
   *  web project. Derived from tags at build time — never guessed by the model. */
  domain: ProjectDomain;
};

/** The shapes of work in this portfolio. `code` is the catch-all. */
export type ProjectDomain = "ai" | "web" | "hardware" | "data" | "code";

export type SkillVisualGroup = {
  group: string;
  items: Array<{ name: string; level?: string }>;
};

export type EvidenceCapability = {
  id: string;
  label: string;
  skills: Array<{ name: string; level?: string }>;
  /** Project slugs connected by source tags, never by model inference. */
  projectSlugs: string[];
};

export type EvidenceAtlasVisualData = {
  capabilities: EvidenceCapability[];
  projects: ProjectVisualData[];
};

export type EducationVisualEntry = {
  credential: string;
  school: string;
  location?: string;
  start?: string;
  end?: string;
  detail?: string;
};

export type ContactChannel = {
  label: string;
  href: string;
  icon: string;
};

export type AvailabilityVisualData = {
  status: "open" | "selective" | "closed";
  label: string;
  interests: string[];
  note?: string;
  location?: string;
  email: string;
  resume?: string;
};

export type ProfileVisualData = {
  name: string;
  title: string;
  avatar?: string;
  location?: string;
  age?: number;
  tagline?: string;
  focusAreas: Array<{ label: string; detail?: string }>;
  /** Small, factual counters. Never a fabricated metric. */
  facts: Array<{ label: string; value: string }>;
};

export type ExperienceVisualData = {
  /** Authored role metadata from experience.md; empty remains an honest state. */
  roles: Array<{
    title: string;
    organisation?: string;
    period?: string;
    detail?: string;
  }>;
  /** Representative self-directed work complements the role history. */
  selfDirected: ProjectVisualData[];
  email: string;
};

export type ContactFormVisualData = {
  email: string;
  name: string;
  /** False when no delivery adapter is configured. In that state the form
   *  creates a pre-addressed draft in the visitor's email app. */
  deliveryConfigured: boolean;
  reasons: readonly string[];
  limits: {
    name: number;
    email: number;
    company: number;
    message: number;
  };
};

export type Visual = ({ insights?: string[] } & (
  | { kind: "projects"; heading: string; projects: ProjectVisualData[] }
  | { kind: "project-detail"; project: ProjectVisualData; body?: string }
  | { kind: "evidence-atlas"; data: EvidenceAtlasVisualData }
  | { kind: "skills"; groups: SkillVisualGroup[] }
  | { kind: "education"; entries: EducationVisualEntry[] }
  | { kind: "availability"; data: AvailabilityVisualData }
  | { kind: "profile"; data: ProfileVisualData }
  | { kind: "profile-link"; data: ProfileLinkVisualData }
  | { kind: "experience"; data: ExperienceVisualData }
  | { kind: "contact-form"; data: ContactFormVisualData }
));

/** A contextual next step, authored by the app rather than invented by the model. */
export type FollowUp = {
  label: string;
  /** Sent as a question when present. */
  prompt?: string;
  /** Opens a visual locally with no request at all. */
  localVisual?: VisualKind;
  /** Opens a URL instead of asking anything. */
  href?: string;
};

/** Progress the server reports while a turn is in flight. */
export type TurnStage = "resolving" | "searching" | "found" | "verifying" | "writing" | "done" | "local" | "error";

export type TurnStatus = {
  stage: TurnStage;
  support?: import("@/lib/evidence/support").SupportStatus | "mixed";
  /** Short, human, and true. "Found 2 notes on Udaan" — never a fake thought. */
  detail?: string;
};
