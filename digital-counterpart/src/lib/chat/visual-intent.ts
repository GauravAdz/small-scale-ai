/**
 * Which visual belongs with this answer — decided by the application, not the model.
 *
 * The old design gave the model four tools and let it pick. Elegant, and wrong
 * for this shape of product: choosing between "projects" and "skills" on a
 * corpus of five projects is not a judgement call that needs a language model,
 * and paying a full round-trip for it made every visual answer twice as slow as
 * it needed to be.
 *
 * The question and its verified subject determine whether a visual is useful.
 * Retrieval chooses context for verification and never chooses UI on its own.
 *
 * Returning `null` is a real outcome. Not every answer wants a card, and a card
 * attached to a one-line follow-up is clutter.
 */

import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { asksForSkillLevel, matchSkillGroups } from "./capability-match";
import { selectProjectsForQuestion } from "@/lib/evidence/project-ranking";
import { interpretInteraction } from "./interaction-intent";
import type { UnderstoodQuery } from "./query-understanding";
import {
  availabilityVisual,
  contactFormVisual,
  educationVisual,
  evidenceAtlasVisual,
  experienceVisual,
  profileLinkVisual,
  profileVisual,
  projectVisual,
  projectsVisual,
  relevantProjectsVisual,
} from "./visual-data";
import type { FollowUp, Visual } from "./visual-types";

export function chooseVisual(input: string | UnderstoodQuery): Visual | null {
  const query = typeof input === "string" ? input : input.canonicalQuery;
  const profile = loadProfile();
  const projects = loadProjects();
  const interaction = typeof input === "string"
    ? interpretInteraction(query, projects)
    : input.interaction;

  // Skill-proficiency language is more specific than broad topic vocabulary.
  // "How experienced is Gaurav with robotics?" is about the recorded robotics
  // capability, not his employment history. Let an authored capability match
  // win before the general interaction-topic switch, while plain questions like
  // "What is Gaurav's work experience?" still resolve to the Experience card.
  if (asksForSkillLevel(query) && matchSkillGroups(query, profile.skills).length > 0) {
    return { kind: "evidence-atlas", data: evidenceAtlasVisual(query) };
  }

  // ── direct, stated intent ─────────────────────────────────────────────────
  switch (interaction.kind) {
    case "profile-overview":
      return { kind: "profile", data: profileVisual() };

    case "contact-message":
    case "contact-info":
      return { kind: "contact-form", data: contactFormVisual() };

    case "project-link":
    case "project-detail": {
      if (interaction.target.kind !== "project") return null;
      const project = projectVisual(interaction.target.slug);
      return project ? { kind: "project-detail", project } : null;
    }

    case "profile-link": {
      if (!interaction.channel) return null;
      const data = profileLinkVisual(interaction.channel);
      return data ? { kind: "profile-link", data } : null;
    }

    case "project-repository-discovery": {
      const withRepositories = projects.filter((project) => project.repo);
      return withRepositories.length > 0
        ? {
            kind: "projects",
            heading: "Projects on GitHub",
            projects: projectsVisual(withRepositories.map((project) => project.slug)),
          }
        : null;
    }

    case "hiring-evidence":
    case "evidence-case":
      return { kind: "evidence-atlas", data: evidenceAtlasVisual() };

    case "evidence-challenge":
      return null;

    case "hiring-availability":
      return { kind: "availability", data: availabilityVisual() };

    case "philosophy":
      return null;

    case "education":
      return { kind: "education", entries: educationVisual() };

    case "experience":
      return { kind: "experience", data: experienceVisual() };

    case "about":
      return { kind: "profile", data: profileVisual() };

    case "skills":
      return { kind: "evidence-atlas", data: evidenceAtlasVisual(query) };

    case "projects":
    case "unknown":
      break;
  }

  // ── project discovery and authored metadata ───────────────────────────────
  // A question naming something that only exists as project work — "robotics",
  // "IoT", "geospatial" — is asking about the work, whatever words it used.
  // Read off the actual frontmatter rather than a hand-kept keyword list, so
  // adding a project extends this for free.
  const selection = interaction.kind === "projects"
    ? selectProjectsForQuestion(query, projects)
    : null;
  if (selection) {
    return {
      kind: "projects",
      heading: headingFor(query),
      projects: projectsVisual(selection.projects.map(({ slug }) => slug)),
    };
  }

  if (interaction.kind === "projects") {
    return { kind: "projects", heading: headingFor(query), projects: relevantProjectsVisual(query, 3) };
  }

  return null;
}

function headingFor(query: string): string {
  return /\b(ai|ml|machine.?learning|rag|llm)\b/i.test(query)
    ? "AI work"
    : /\b(best|strongest|main|top|prominent|flagship|favourite|favorite|proud|represent)\b/i.test(query)
      ? "Strongest work"
      : "Projects";
}

/**
 * The two or three next steps that make sense from here.
 *
 * Authored by the application so they are always real — a follow-up that offers
 * "view the repo" only appears when a repo URL exists — and so producing them
 * costs no tokens. Asking the model to invent them would put made-up links one
 * hallucination away from a recruiter's click.
 */
export function followUpsFor(visual: Visual | null): FollowUp[] {
  // No card means there is no concrete subject from which to derive a relevant
  // next step. Generic portfolio navigation belongs on the landing screen, not
  // beneath an unrelated, unsupported, or purely textual answer.
  if (!visual) return [];

  switch (visual.kind) {
    case "projects":
      return [
        { label: "Which is strongest?", prompt: "Which project best represents Gaurav's ability?" },
        { label: "What's the stack?", prompt: "What could Gaurav contribute technically?" },
      ];

    case "project-detail": {
      const followUps: FollowUp[] = [
        {
          label: "How does it work?",
          prompt: `How does ${visual.project.title} actually work?`,
        },
        { label: "See other projects", prompt: "Show me Gaurav's other projects." },
      ];
      if (visual.project.repo) {
        followUps.push({ label: "View repo", href: visual.project.repo });
      }
      return followUps;
    }

    case "evidence-atlas":
      return [
        {
          label: "Which project is strongest?",
          prompt: "Which project best represents Gaurav's ability, and why?",
        },
        { label: "Is he available?", prompt: "What kind of roles is Gaurav interested in?" },
      ];

    case "skills":
      return [
        { label: "Show me the proof", prompt: "Which projects demonstrate those skills?" },
        { label: "What's he learning?", prompt: "What is Gaurav studying?" },
      ];

    case "education":
      return [];

    case "availability":
      return [{ label: "Message Gaurav", localVisual: "contact-form" }];

    case "experience":
      return [
        { label: "See the projects", prompt: "Show me the work that best represents Gaurav." },
        { label: "How does he work?", prompt: "What's Gaurav's work philosophy?" },
      ];

    case "profile":
      return [
        { label: "What has he built?", prompt: "Show me the work that best represents Gaurav." },
        { label: "What's he good at?", prompt: "What could Gaurav contribute technically?" },
      ];

    case "profile-link":
      return [];

    case "contact-form":
      return [];
  }
}
