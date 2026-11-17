import type { EnvConfig } from "@/lib/config";
import type { EvidenceRecord, VerifiedClaim } from "./types";
import { skillParts, type Profile, type ProjectSummary } from "@/lib/knowledge/schema";
import { runtimeFacts } from "@/lib/runtime/facts";
import { rankProjectsForQuestion, type ProjectSelection } from "./project-ranking";
import {
  asksForProjectLink,
  asksForProjectOverview,
  asksForProjectRepositoryDiscovery,
  asksForTechnologyStack,
  contactActionIntent,
  describesRememberedWork,
  matchProjectSlug,
  wantsHiringCase,
  wantsTechnicalContribution,
} from "@/lib/chat/intent";
import { asksForSkillLevel, matchSkillGroups, matchSkills, type MatchedSkill } from "@/lib/chat/capability-match";
import type { UnderstoodQuery } from "@/lib/chat/query-understanding";

export type FactLookup =
  | { kind: "matched"; claim: VerifiedClaim; evidence: EvidenceRecord[]; refutes?: "skill" | "project-tag" }
  | { kind: "not-recorded"; field: string }
  | { kind: "not-exact" };

export type FactStore = Readonly<{
  profile: Profile;
  projects: readonly ProjectSummary[];
  evidenceById: ReadonlyMap<string, EvidenceRecord>;
  runtime: readonly ReturnType<typeof runtimeFacts>[number][];
  projectSelection?: ProjectSelection;
}>;

export function createFactStore(input: {
  profile: Profile;
  projects: readonly ProjectSummary[];
  evidence: readonly EvidenceRecord[];
  env: EnvConfig;
  projectSelection?: ProjectSelection;
}): FactStore {
  const runtime = runtimeFacts(input.env);
  return {
    profile: input.profile,
    projects: input.projects,
    evidenceById: new Map([
      ...input.evidence.map((record) => [record.id, record] as const),
      ...runtime.map((fact) => [fact.evidence.id, fact.evidence] as const),
    ]),
    runtime,
    ...(input.projectSelection ? { projectSelection: input.projectSelection } : {}),
  };
}

function evidence(store: FactStore, id: string): EvidenceRecord[] {
  const record = store.evidenceById.get(id);
  return record ? [record] : [];
}

function matched(
  id: string,
  text: string,
  evidenceId: string | readonly string[],
  store: FactStore,
  kind: VerifiedClaim["kind"] = "fact",
): FactLookup {
  const evidenceIds = typeof evidenceId === "string" ? [evidenceId] : [...evidenceId];
  const records = evidenceIds.flatMap((item) => evidence(store, item));
  if (records.length !== evidenceIds.length) return { kind: "not-exact" };
  return { kind: "matched", claim: { id, text, kind, evidenceIds }, evidence: records };
}

function namedProject(question: string, projects: readonly ProjectSummary[]): ProjectSummary | undefined {
  const slug = matchProjectSlug(question, projects);
  return slug ? projects.find((project) => project.slug === slug) : undefined;
}

function educationEntryForQuestion(
  question: string,
  profile: Profile,
  institution?: string,
): Profile["education"][number] | undefined {
  if (institution) {
    return profile.education.find(
      ({ school }) => school.toLowerCase() === institution.toLowerCase(),
    );
  }

  const q = question.toLowerCase();
  if (/\ba[ -]?levels?\b/.test(q)) {
    return profile.education.find(({ credential }) => /a[ -]?levels?/i.test(credential));
  }
  if (/\bbudhanilkantha\b/.test(q)) {
    return profile.education.find(({ school }) => /budhanilkantha/i.test(school));
  }
  if (/\bjku\b|\bjohannes kepler\b|\buniversity\b|\bbsc\b|\bbachelor/.test(q)) {
    return profile.education.find(({ end }) => end?.toLowerCase() === "present") ?? profile.education[0];
  }
  return profile.education.find(({ end }) => end?.toLowerCase() === "present") ?? profile.education[0];
}

function mentionedCourse(
  question: string,
  profile: Profile,
): { entry: Profile["education"][number]; course: string; status: "taken" | "recognized" | "planned" } | undefined {
  const normalized = question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const entry of profile.education) {
    for (const status of ["taken", "recognized", "planned"] as const) {
      for (const course of entry.coursework?.[status] ?? []) {
        const candidate = course.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (candidate && (` ${normalized} `).includes(` ${candidate} `)) {
          return { entry, course, status };
        }
      }
    }
  }
  return undefined;
}

function projectSection(
  store: FactStore,
  project: ProjectSummary,
  heading: string,
): EvidenceRecord | undefined {
  const source = `data/projects/${project.slug}.md`;
  return [...store.evidenceById.values()].find(
    (record) =>
      record.locator.source === source &&
      record.locator.headingPath?.at(-1)?.toLowerCase() === heading.toLowerCase(),
  );
}

function proficiencyText(skills: readonly MatchedSkill[], list: (items: string[]) => string): string {
  const byLevel = new Map<string, string[]>();
  const unlevelled: string[] = [];
  for (const { skill } of skills) {
    if (skill.level) byLevel.set(skill.level, [...(byLevel.get(skill.level) ?? []), skill.name]);
    else unlevelled.push(skill.name);
  }
  const parts = [...byLevel].map(([level, names]) => `${list(names)} as ${level}`);
  if (unlevelled.length > 0) parts.push(`${list(unlevelled)} without a stated level`);
  return parts.join("; ");
}

export function lookupExactFact(
  question: string,
  store: FactStore,
  claimId = "claim:exact",
  understood?: UnderstoodQuery,
): FactLookup {
  const q = question.toLowerCase();
  const profile = store.profile;
  const list = (items: string[]) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
  const project = namedProject(question, store.projects);
  const contactAction = contactActionIntent(question, store.projects);

  if (
    understood?.responseShape.mode === "keywords" &&
    /\bdescribe (?:yourself|gaurav)\b/i.test(question)
  ) {
    return matched(
      claimId,
      "AI, robotics, software.",
      ["evidence:profile:bio", "evidence:profile:focus"],
      store,
    );
  }

  if (contactAction?.kind === "message") {
    return matched(
      claimId,
      "You can send Gaurav a message below.",
      "evidence:profile:contact",
      store,
    );
  }

  if (contactAction?.kind === "info") {
    const channels = [
      profile.contact.email ? `email at ${profile.contact.email}` : null,
      profile.contact.linkedin ? `LinkedIn at ${profile.contact.linkedin}` : null,
    ].filter((value): value is string => Boolean(value));
    return channels.length
      ? matched(
          claimId,
          `You can contact Gaurav by ${list(channels)}.`,
          "evidence:profile:contact",
          store,
        )
      : { kind: "not-recorded", field: "contact information" };
  }

  // A visitor's description may identify a recorded project semantically. A
  // failed title lookup cannot establish absence or authorize profile facts.
  if (!project && !store.projectSelection && describesRememberedWork(question)) {
    return { kind: "not-exact" };
  }

  if (wantsTechnicalContribution(question)) {
    const areas = profile.focusAreas;
    if (!areas.length) return { kind: "not-exact" };
    const examples = [...new Map(areas.flatMap((area) => {
      const ranked = rankProjectsForQuestion(`${area.label} ${area.detail ?? ""}`, store.projects);
      const best = ranked.find(({ reasons, project }) => project.summary && reasons.some((reason) => reason.startsWith("matches ")));
      return best ? [[best.project.slug, best.project] as const] : [];
    })).values()].slice(0, 3);
    if (!examples.length) return { kind: "not-exact" };
    const labels = areas.map(({ label }) => label.replace(/\bML\b/g, "machine learning").replace(/&/g, "and").toLowerCase());
    return matched(claimId,
      `Gaurav could contribute in ${list(labels)}, based on his current skills and project work. His work includes ${examples.map((project) => `${project.title} — ${project.summary!.replace(/[.!?]$/, "").replace(/^./, (c) => c.toLowerCase())}`).join("; ")}.`,
      ["evidence:profile:focus", "evidence:profile:skills", ...examples.map(({ slug }) => `evidence:projects/${slug}`)], store, "inference");
  }

  if (project && asksForProjectLink(question)) {
    const evidenceId = `evidence:projects/${project.slug}`;
    const wantsRepository = /\b(github|gitlab|repo|repos|repository|repositories|source code|codebase|codebases)\b/.test(q);
    const url = wantsRepository ? project.repo : project.url || project.repo;
    return url
      ? matched(claimId, `${project.title}: ${url}`, evidenceId, store)
      : { kind: "not-recorded", field: wantsRepository ? "project repository" : "project URL" };
  }

  if (!project && asksForProjectRepositoryDiscovery(question)) {
    const linked = store.projects.filter(({ repo }) => repo);
    if (linked.length === 0) return { kind: "not-recorded", field: "project repositories" };
    return matched(
      claimId,
      `Gaurav has GitHub repositories for ${list(linked.map(({ title, repo }) => `${title} (${repo})`))}.`,
      linked.map(({ slug }) => `evidence:projects/${slug}`),
      store,
    );
  }

  if (contactAction?.kind === "profile-link") {
    const value = contactAction.channel === "resume"
      ? profile.resume
      : profile.contact[contactAction.channel];
    if (!value) return { kind: "not-recorded", field: `Gaurav's ${contactAction.channel}` };
    const text = (() => {
      switch (contactAction.channel) {
        case "github":
          return `You can find Gaurav on GitHub at ${value}.`;
        case "linkedin":
          return `You can find Gaurav on LinkedIn at ${value}.`;
        case "email":
          return `You can email Gaurav at ${value}.`;
        case "website":
          return `Gaurav's website is ${value}.`;
        case "resume":
          return "You can download Gaurav's CV below.";
      }
    })();
    return matched(
      claimId,
      text,
      contactAction.channel === "resume" ? "evidence:profile:resume" : "evidence:profile:contact",
      store,
    );
  }

  if (/\b(embedding model|embedding provider|semantic model)\b/.test(q)) {
    const key = /provider/.test(q) ? "embedding-provider" : "embedding-model";
    const fact = store.runtime.find((item) => item.key === key)!;
    const label = key === "embedding-provider" ? "embedding provider" : "embedding model";
    return matched(claimId, `The current ${label} is ${fact.value}.`, fact.evidence.id, store);
  }
  if (/\b(what model|which model|model are you|llm model|chat model|model powers)\b/.test(q)) {
    const fact = store.runtime.find((item) => item.key === "llm-model")!;
    return matched(claimId, `The current answer model is ${fact.value}.`, fact.evidence.id, store);
  }
  if (/\b(provider|who powers you)\b/.test(q) && /\b(model|running|using|powered)\b/.test(q)) {
    const fact = store.runtime.find((item) => item.key === "llm-provider")!;
    return matched(claimId, `The current answer provider is ${fact.value}.`, fact.evidence.id, store);
  }

  if (/\b(what(?:'s| is) (?:his|gaurav'?s) name|full name|who is gaurav)\b/.test(q)) {
    return matched(claimId, `His name is ${profile.name}.`, "evidence:profile:bio", store);
  }
  if (/\b(how old|what age|age is|state .{0,20} age|recorded age)\b/.test(q)) {
    return profile.age
      ? matched(
          claimId,
          `Gaurav is ${profile.age} years old.`,
          "evidence:profile:bio",
          store,
        )
      : { kind: "not-recorded", field: "age" };
  }
  // Unqualified biography questions are exact; named places, dates and
  // compound propositions must retain semantic support assessment.
  const person = "(?:gaurav(?: adhikari)?|he|his|you|your|gaurav's)";
  const simple = q.replace(/[?.!]+$/g, "").trim();
  if (new RegExp(`^(?:when (?:was|were) ${person} born|what is ${person} (?:date of birth|birth date|birthday))$`).test(simple)) {
    return profile.dateOfBirth
      ? matched(claimId, `Gaurav was born on ${new Date(profile.dateOfBirth + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`, "evidence:profile:bio", store)
      : { kind: "not-recorded", field: "date of birth" };
  }
  if (new RegExp(`^where (?:was|were) ${person} born$`).test(simple)) {
    return profile.birthCountry
      ? matched(claimId, `Gaurav was born in ${profile.birthCountry}.`, "evidence:profile:bio", store)
      : { kind: "not-recorded", field: "birthplace" };
  }
  if (new RegExp(`^what is ${person} (?:nationality|citizenship)$`).test(simple)) {
    return profile.citizenship
      ? matched(claimId, `Gaurav is a ${profile.citizenship} citizen.`, "evidence:profile:bio", store)
      : { kind: "not-recorded", field: "citizenship" };
  }
  if (/\b(?:born|birthplace|place of birth|date of birth|birth date|birthday|nationality|citizenship|citizen)\b/.test(q)) {
    return { kind: "not-exact" };
  }
  const locationRelation = understood?.qualifiers.locationRelation ?? (
    /\bnationality\b/.test(q) ? "nationality"
      : /\b(?:born|birthplace|place of birth)\b/.test(q) ? "birthplace"
        : /\borigin\b/.test(q) ? "origin"
          : /\bfrom\b/.test(q) ? "from"
            : /\b(?:live|lives|living)\b/.test(q) ? "lives"
            : /\b(?:currently located|current location|located in|location)\b/.test(q) ||
                /\bwhere\b.{0,40}\bbased\b|\bbased in\b/.test(q) ? "based"
                : undefined
  );
  if (locationRelation && locationRelation !== "based") {
    const field = locationRelation === "lives"
      ? "residence"
      : locationRelation === "nationality"
        ? "nationality"
        : locationRelation === "birthplace"
          ? "birthplace"
          : "place of origin";
    return { kind: "not-recorded", field };
  }
  if (locationRelation === "based") {
    return profile.location
      ? matched(
          claimId,
          `Gaurav is based in ${profile.location}.`,
          "evidence:profile:bio",
          store,
        )
      : { kind: "not-recorded", field: "location" };
  }
  if (/\b(grade|grades|gpa|mark|marks)\b/.test(q)) {
    return { kind: "not-recorded", field: "grades" };
  }
  const institution = understood?.qualifiers.institution;
  const namedCourse = mentionedCourse(question, profile);
  if (
    namedCourse ||
    (/\b(subject|subjects|module|modules|course|courses|coursework)\b/.test(q) &&
      (understood?.interaction.kind === "education" || /\b(?:study|studies|studying|degree|education|school|university|academic|a[ -]?levels?)\b/.test(q)))
  ) {
    if (namedCourse) {
      const text = namedCourse.status === "planned"
        ? `Gaurav has not yet taken ${namedCourse.course}; it is planned for a future semester.`
        : namedCourse.status === "recognized"
          ? `${namedCourse.entry.school} recognized Gaurav's prior coursework for ${namedCourse.course}.`
          : `Gaurav has taken ${namedCourse.course} as part of ${namedCourse.entry.credential}.`;
      return matched(claimId, text, "evidence:profile:education", store);
    }

    const entry = educationEntryForQuestion(question, profile, institution);
    if (!entry?.coursework) return { kind: "not-recorded", field: "coursework" };
    if (/\b(?:plan|planned|future|next|not yet)\b/.test(q)) {
      return entry.coursework.planned.length
        ? matched(
            claimId,
            `Gaurav has not yet taken ${list(entry.coursework.planned)}; they are planned for a future semester.`,
            "evidence:profile:education",
            store,
          )
        : { kind: "not-recorded", field: "planned coursework" };
    }
    if (/\b(?:recogniz|credit|prior)\w*\b/.test(q)) {
      return entry.coursework.recognized.length
        ? matched(
            claimId,
            `${entry.school} recognized Gaurav's prior coursework for ${list(entry.coursework.recognized)}.`,
            "evidence:profile:education",
            store,
          )
        : { kind: "not-recorded", field: "recognized coursework" };
    }
    const details = [
      entry.coursework.taken.length
        ? `Gaurav's coursework for ${entry.credential} includes ${list(entry.coursework.taken)}`
        : "",
      entry.coursework.recognized.length
        ? `${list(entry.coursework.recognized)} was recognized from prior coursework`
        : "",
    ].filter(Boolean);
    return details.length
      ? matched(claimId, `${details.join("; ")}.`, "evidence:profile:education", store)
      : { kind: "not-recorded", field: "coursework" };
  }
  if (/\b(?:graduate|graduation|finish|complete)\b/.test(q) && /\b(?:degree|bsc|bachelor|university|study|studies)\b/.test(q)) {
    const current = educationEntryForQuestion(question, profile, institution);
    return current?.expectedEnd
      ? matched(
          claimId,
          `Gaurav expects to complete ${current.credential} in ${current.expectedEnd}.`,
          "evidence:profile:education",
          store,
        )
      : { kind: "not-recorded", field: "expected graduation" };
  }
  if (institution) {
    // An institution qualifier does not make every relationship educational.
    // Employment and role claims must be assessed against experience evidence
    // as a complete role–organisation pair.
    if (/\b(work(?:ed|ing)?|employ\w*|job|role|career)\b/.test(q)) {
      return { kind: "not-exact" };
    }
    const requested = educationEntryForQuestion(question, profile, institution);
    if (!requested) return { kind: "not-exact" };
    const current = requested.end?.toLowerCase() === "present";
    const dates = [requested.start, requested.end].filter(Boolean).join("–");
    const location = requested.location ? ` in ${requested.location}` : "";
    return matched(
      claimId,
      current
        ? `Gaurav is studying ${requested.credential} at ${requested.school}${location}.`
        : `Gaurav attended ${requested.school}${location} for ${requested.credential}${dates ? ` (${dates})` : ""}.`,
      "evidence:profile:education",
      store,
    );
  }
  if (/\b(?:why|what made|choose|motivat|focused on|focus on)\b/.test(q) && /\b(?:study|studies|studying|degree|education)\b/.test(q)) {
    return { kind: "not-exact" };
  }
  if (
    /^(?:what (?:is|are) (?:gaurav|he|you) stud(?:y|ying)|what degree (?:is|are) (?:gaurav|he|you) studying|where (?:does|do|is|are) (?:gaurav|he|you) study(?:ing)?|where (?:does|do) (?:gaurav|he|you) go to (?:school|university)|which (?:school|university|college) (?:is|does) (?:gaurav|he) (?:attend|attending|study at)|what is (?:gaurav'?s|his|your) (?:current )?education|tell me (?:about )?(?:gaurav'?s|his|your) current education|(?:tell me about )?(?:gaurav'?s|his|your) education(?:al)? background)\b/i.test(question.trim())
  ) {
    const current = profile.education.find((entry) => entry.end?.toLowerCase() === "present") ?? profile.education[0];
    if (!current) return { kind: "not-recorded", field: "education" };
    return matched(
      claimId,
      `Gaurav is studying ${current.credential} at ${current.school}.`,
      "evidence:profile:education",
      store,
    );
  }
  if (understood?.interaction.kind === "hiring-evidence" || wantsHiringCase(question)) {
    // A named deliverable or requested capability is a material constraint.
    // Generic portfolio evidence may support an interview case, but it cannot
    // deterministically prove that Gaurav can perform that specific task.
    if (/\b(?:able to\s+)?(?:build|make|develop|deliver|implement|operate|design)\b/i.test(question)) {
      return { kind: "not-exact" };
    }
    const groups = profile.skills.map(({ group }) => group).filter(Boolean);
    const selectedProjects = rankProjectsForQuestion(question, store.projects)
      .slice(0, 2)
      .map(({ project }) => project);
    if (groups.length === 0 || selectedProjects.length === 0) {
      return { kind: "not-recorded", field: "hiring evidence" };
    }
    return matched(
      claimId,
      `Based on his skills and project work, Gaurav could be worth interviewing for work involving ${list(profile.focusAreas.map(({ label }) => label)) || list(groups)}. Relevant examples include ${list(selectedProjects.map(({ title }) => title))}.`,
      [
        "evidence:profile:skills",
        ...(profile.focusAreas.length ? ["evidence:profile:focus"] : []),
        ...selectedProjects.map(({ slug }) => `evidence:projects/${slug}`),
      ],
      store,
      "inference",
    );
  }
  const asksRoleInterests =
    /\b(?:what|which) (?:kind|types?) of (?:roles?|jobs?|work|opportunit(?:y|ies))\b|\b(?:roles?|jobs?|work|opportunit(?:y|ies)).{0,40}\binterested in\b|\binterested in.{0,40}\b(?:roles?|jobs?|work|opportunit(?:y|ies))\b/.test(q);
  if (
    asksRoleInterests ||
    /\b(available|availability|open to|collaborat\w*|internship|opportunit\w*)\b/.test(q)
  ) {
    // General availability is not proof of ability to perform a requested task.
    if (/\bavailable\s+to\s+(?!work\b|start\b|join\b|collaborate\b)/.test(q)) return { kind: "not-exact" };
    const asksSpecificDate = /\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|next (?:week|month|year)|start date)\b/.test(q);
    if (asksSpecificDate) return { kind: "not-recorded", field: "dated availability" };
    const asksRecordedConstraint =
      /\b(remote|austria|part[ -]?time|student jobs?|hours? (?:per|a) week)\b/.test(q);
    if (asksRecordedConstraint) {
      return profile.availability?.note
        ? matched(
            claimId,
            profile.availability.note,
            "evidence:profile:availability",
            store,
          )
        : { kind: "not-recorded", field: "availability constraints" };
    }
    if (asksRoleInterests) {
      const interests = profile.availability?.interests ?? [];
      return interests.length > 0
        ? matched(
            claimId,
            `Gaurav is interested in ${new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(interests)}.`,
            "evidence:profile:availability",
            store,
          )
        : { kind: "not-recorded", field: "role interests" };
    }
    return profile.availability
      ? matched(
          claimId,
          `Gaurav is ${profile.availability.label.charAt(0).toLowerCase()}${profile.availability.label.slice(1)}.`,
          "evidence:profile:availability",
          store,
        )
      : { kind: "not-recorded", field: "availability" };
  }
  if (/\b(?:applied[ -]?ai|artificial intelligence).{0,40}\b(?:role|job|position)\b|\b(?:role|job|position).{0,40}\b(?:applied[ -]?ai|artificial intelligence)\b/.test(q) && /\b(?:fit|aligned|suit|match)\w*\b/.test(q)) {
    const projectIds = rankProjectsForQuestion(question, store.projects)
      .filter(({ reasons }) => reasons.some((reason) => /matches .*\b(?:ai|artificial|intelligence|machine|learning)\b/i.test(reason)))
      .slice(0, 3)
      .map(({ project }) => `evidence:projects/${project.slug}`);
    const evidenceIds = ["evidence:profile:skills", ...projectIds];
    return matched(
      claimId,
      "Based on his AI skills and project work, an applied-AI product role appears aligned with Gaurav's portfolio.",
      evidenceIds,
      store,
      "inference",
    );
  }

  if (project && asksForTechnologyStack(question)) {
    const stack = projectSection(store, project, "Stack");
    return stack
      ? matched(claimId, stack.text.replace(/\s+/g, " ").trim(), stack.id, store)
      : { kind: "not-exact" };
  }

  if (store.projectSelection?.kind === "ranking") {
    const selected = store.projectSelection.projects;
    if (selected.length === 0) return { kind: "not-recorded", field: "projects" };
    const labels = selected.map(({ title }) => title);
    const basis = store.projectSelection.mode === "editorial"
      ? "how Gaurav has ordered and described his portfolio"
      : "the requested focus and the project descriptions";
    const text = selected.length === 1
      ? `Based on ${basis}, ${labels[0]} is the strongest project to look at first in Gaurav's portfolio.`
      : `Based on ${basis}, the projects to look at first are ${list(labels)}.`;
    return matched(
      claimId,
      text,
      selected.map(({ slug }) => `evidence:projects/${slug}`),
      store,
      "inference",
    );
  }

  if (store.projectSelection?.kind === "discovery") {
    const selected = store.projectSelection.projects;
    if (selected.length === 0) return { kind: "not-recorded", field: "projects" };
    const labels = selected.map(({ title }) => title);
    const basis = store.projectSelection.mode === "editorial"
      ? "how Gaurav has ordered and described his portfolio"
      : "the requested focus and the project descriptions";
    return matched(
      claimId,
      `Based on ${basis}, relevant work includes ${list(labels)}.`,
      selected.map(({ slug }) => `evidence:projects/${slug}`),
      store,
      "inference",
    );
  }

  if (project) {
    const evidenceId = `evidence:projects/${project.slug}`;
    const requestedTag = project.tags.find((tag) => q.includes(tag.toLowerCase()));
    if (requestedTag) {
      const result = matched(
        claimId,
        `${project.title} uses ${requestedTag}.`,
        evidenceId,
        store,
      );
      return result.kind === "matched" ? { ...result, refutes: "project-tag" } : result;
    }
    if (/\b(year|when)\b/.test(q)) {
      return project.year
        ? matched(claimId, `${project.title} is a ${project.year} project.`, evidenceId, store)
        : { kind: "not-recorded", field: "project year" };
    }
    if (/\b(role|solo|team|who built|ownership)\b/.test(q)) {
      return project.role
        ? matched(claimId, `Gaurav's role on ${project.title} is ${project.role}.`, evidenceId, store)
        : { kind: "not-recorded", field: "project role" };
    }
    if (/\b(status|finished|complete|shipped|building)\b/.test(q)) {
      return project.status
        ? matched(claimId, `${project.title}'s status is “${project.status}”.`, evidenceId, store)
        : { kind: "not-recorded", field: "project status" };
    }
    if (/\b(repo|repository|github|url|link)\b/.test(q)) {
      const url = project.repo || project.url;
      return url
        ? matched(claimId, `${project.title}: ${url}`, evidenceId, store)
        : { kind: "not-recorded", field: "project URL" };
    }
    if (asksForProjectOverview(question, project) && project.summary) {
      return matched(claimId, `${project.title} is ${project.summary}`, evidenceId, store);
    }
  }

  const requestedSkills = matchSkills(question, profile.skills);
  const requestedSkill = requestedSkills.length === 1 ? requestedSkills[0].skill : undefined;
  const skillLevelQuestion = asksForSkillLevel(question);

  if (skillLevelQuestion && requestedSkills.length > 0) {
    return matched(
      claimId,
      `Gaurav lists ${proficiencyText(requestedSkills, list)}.`,
      "evidence:profile:skills",
      store,
    );
  }

  if (skillLevelQuestion) {
    const requestedGroups = matchSkillGroups(question, profile.skills);
    if (requestedGroups.length > 0) {
      const summaries = requestedGroups.map((group) =>
        `For ${group.group}, Gaurav lists ${proficiencyText(group.items.map((item) => ({ group, skill: skillParts(item) })), list)}`,
      );
      return matched(claimId, `${summaries.join(". ")}.`, "evidence:profile:skills", store);
    }
  }

  if (!requestedSkill && /\b(skill|skills|stack|technolog|technical|contribute)\w*\b/.test(q)) {
    if (/\bcontribut\w*\b/.test(q)) return { kind: "not-exact" };
    if (!/^(?:what (?:are|is)|what['’]s|list|tell me about) (?:gaurav['’]s|his|your) (?:skills|tech stack|stack|technologies)[?.!]*$/i.test(question.trim())) return { kind: "not-exact" };
    const groups = profile.skills.map(({ group }) => group).filter(Boolean);
    if (groups.length === 0) return { kind: "not-recorded", field: "skills" };
    return matched(
      claimId,
      `Gaurav's skills include ${list(profile.skills.flatMap(({ items }) => items.slice(0, 3).map((item) => skillParts(item).name)))}.`,
      "evidence:profile:skills",
      store,
    );
  }

  if (requestedSkill) {
    if (!/^(?:(?:does|did|has) (?:gaurav|he) (?:know|use|used|learn|learned|never used)|(?:what is|what['’]s) (?:gaurav['’]s|his)|is .+ in (?:gaurav['’]s|his) (?:recorded )?skills|how proficient is (?:he|gaurav) with|does (?:his|gaurav['’]s) profile list)\b/i.test(question.trim())) return { kind: "not-exact" };
    const result = matched(
      claimId,
      requestedSkill.level ? `Gaurav's ${requestedSkill.name} proficiency is ${requestedSkill.level}.` : `Gaurav has skills in ${requestedSkill.name}.`,
      "evidence:profile:skills",
      store,
    );
    return result.kind === "matched" ? { ...result, refutes: "skill" } : result;
  }

  return { kind: "not-exact" };
}
