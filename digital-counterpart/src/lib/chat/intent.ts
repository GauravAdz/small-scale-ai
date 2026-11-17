/**
 * Lightweight, deterministic reading of what a visitor asked.
 *
 * A portfolio has a small, knowable domain — five projects, three skill groups,
 * two schools, one person. That is small enough that the application can work
 * recognize direct actions and obvious subjects. Unfamiliar wording still
 * reaches semantic evidence assessment rather than requiring another regex.
 *
 * Nothing here is a hard classifier. Every rule feeds a decision that also
 * consults retrieval, and the tie-break always favours answering.
 */

import type { ProfileLinkChannel } from "./visual-types";
import { normalizeQuerySurface } from "./query-surface";

/** Topics the portfolio can speak to. */
export type Topic =
  | "projects"
  | "skills"
  | "education"
  | "experience"
  | "hiring"
  | "contact"
  | "about"
  | "philosophy";

/** A direct way to reach Gaurav, distinct from project/source-code intent. */
export type ContactActionIntent =
  | { kind: "info" }
  | { kind: "message" }
  | { kind: "profile-link"; channel: ProfileLinkChannel }
  | null;

const TOPIC_PATTERNS: Array<[Topic, RegExp]> = [
  [
    "projects",
    /\b(project|projects|built|build|building|portfolio|work|works|shipped|made|demo|repo|repository|github|code|codebase|showcase|case ?study)\b/i,
  ],
  [
    "skills",
    /\b(skill|skills|stack|tech|technolog|tool|tools|language|languages|framework|frameworks|librar|know|knows|proficien|experienced with|good at|strong at|capab|competen|technical|technically|contribute|python|pytorch|react|typescript|javascript|next\.?js|node|pandas|tailwind|sql)\b/i,
  ],
  [
    "education",
    /\b(stud(y|ies|ying|ied)|degree|university|uni|college|school|academic|course|courses|module|modules|major|bsc|msc|bachelor|master|jku|kepler|budhanilkantha|a.?levels?|graduat)\b/i,
  ],
  [
    "experience",
    /\b(experience|experienced|background|career|job|jobs|role|roles|worked|work(ed)? at|employ|intern(ship)?s?|professional|cv|resum|history|track record)\b/i,
  ],
  [
    "hiring",
    /\b(hire|hiring|hired|recruit|opportunit|available|availability|open to|looking for|seeking|position|vacanc|salary|relocat|visa|notice period|start date|freelance|contract|full.?time|part.?time|remote|why should|why might|interested in|kind of (role|work|job|opportunit))\b/i,
  ],
  [
    "contact",
    /\b(contact|reach|reach out|get in touch|email|e.?mail|message|dm|linkedin|connect|meet|meeting|talk to|speak to|write to|inbox|call)\b/i,
  ],
  [
    "about",
    /\b(who is|who are|about (him|gaurav|you|yourself)|introduce|tell me about (him|gaurav|you|yourself)|bio|biography|age|old|where.*(live|based|from)|located|location|nationality)\b/i,
  ],
  [
    "philosophy",
    /\b(philosoph\w*|how (do|does) (you|he) (like to )?work|approach|process|values|principle|mindset|opinion|think about|style|weakness|strength|learn)\b/i,
  ],
];

export function detectTopics(query: string): Set<Topic> {
  const found = new Set<Topic>();
  if (wantsTechnicalContribution(query)) found.add("skills");
  for (const [topic, pattern] of TOPIC_PATTERNS) {
    if (pattern.test(query)) found.add(topic);
  }
  return found;
}

/** Broad contribution only: named tasks/domains must receive their own assessment. */
export function wantsTechnicalContribution(query: string): boolean {
  const q = query.trim().replace(/[?.!]+$/, "");
  return /^(?:what|how) (?:can|could|would|might) (?:gaurav|he) (?:contribute(?: technically| to (?:our|a|an|the) (?:engineering|technical|software|development|product) team)?|help (?:our|a|an|the) (?:engineering|technical|software|development|product) team)$/i.test(q) ||
    /^what (?:can|could|would|might) (?:gaurav|he) bring to (?:our|a|an|the) (?:engineering|technical|software|development|product) team$/i.test(q);
}

export type SubjectReference = "gaurav" | "assistant-deictic" | "none";

/**
 * Identify who personal language points at without treating the assistant as
 * evidence about Gaurav. In particular, "Can you build me a site?" addresses
 * the product, while "Can Gaurav build React sites?" asks about the person.
 */
export function subjectReference(query: string): SubjectReference {
  if (/\b(gaurav|adhikari|he|him|his|himself)\b/i.test(query)) return "gaurav";
  if (/\b(you|your|yours|yourself)\b/i.test(query)) return "assistant-deictic";
  return "none";
}

export function hasGauravReference(query: string): boolean {
  return subjectReference(query) === "gaurav";
}

export function hasAssistantDeicticReference(query: string): boolean {
  return subjectReference(query) === "assistant-deictic";
}

/** @deprecated Prefer `hasGauravReference`; the old name was epistemically ambiguous. */
export function hasPersonalReference(query: string): boolean {
  return hasGauravReference(query);
}

/** "hi", "hey there", "good morning" — conversational navigation, not a question. */
export function isGreeting(query: string): boolean {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/[!.?,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length > 40) return false;
  return /^(?:(?:hi|hey|hello|yo|hiya|howdy|sup|greetings)(?: there)?|good (?:morning|afternoon|evening)|what'?s up|how'?s it going|how are you(?: doing)?)$/.test(
    normalized,
  );
}

/** "what are you?", "are you a bot?", "is this real?" — questions about the product. */
export function isIdentityQuestion(query: string): boolean {
  // Bare "this" identifies the chat here; trailing project/person details do
  // not. Keep this anchored so "Who is this project for?" still gets assessed.
  const normalized = query.trim().replace(/\s+/g, " ");
  if (/^who(?: is|['’]s) this[?!.]*$/i.test(normalized)) return true;
  if (/^who(?: is|['’]s) gauravgpt[?!.]*$/i.test(normalized)) return true;
  return /\b(are you (a|an) (bot|ai|robot|human|real|llm|chatbot|model)|is this (a )?(bot|ai|real|chatgpt)|what are you|who are you|am i (talking|speaking) to|how (do|does) (you|this) work|are you (actually )?(gaurav|gauravgpt))\b/i.test(
    query,
  );
}

/** Details the public notes deliberately do not claim or estimate. */
export function asksForPrivateOrUnrecordedDetail(query: string): boolean {
  return /\b(salary|compensation|pay rate|hourly rate|day rate|visa|notice period|reference|home address|phone number|relationship status)\b/i.test(
    query,
  );
}

/**
 * Requests to *produce* generic output, rather than to learn about someone.
 *
 * Generic production tasks are outside the portfolio's purpose:
 * "write me a Python sorting algorithm" shares the word `python` with the
 * skills notes, so retrieval ranks it perfectly, and nothing downstream would
 * have stopped it. Fires only when the question also has no personal reference.
 */
const PRODUCE_TASK =
  /\b(write|generate|create|compose|draft|implement|code|build me|make me|solve|calculate|compute|translate|summari[sz]e|refactor|debug|fix|convert|explain how to)\b[\s\S]{0,40}\b(code|function|script|program|algorithm|essay|poem|story|article|blog|email|letter|sql|query|regex|component|class|app|website|homework|assignment|answer|solution|test|snippet|for me)\b/i;

/** "do my homework", "help me with this assignment" — someone else's task. */
const ASSISTANCE_REQUEST =
  /\b(help me (with|on|out)|do my|can you (help|do)|i need help)\b[\s\S]{0,30}\b(homework|assignment|essay|exam|test|revision|coursework|problem set|question|task|project|code|bug)\b/i;

/** A handful of general-knowledge shapes worth catching before the embedder. */
const GENERAL_KNOWLEDGE =
  /\b(capital of|who won|world cup|weather|what year did|when did .* (die|born)|population of|currency of|translate .* (to|into)|tell me a joke|recipe for|meaning of life|prime minister of|president of)\b/i;

/** Prompt-injection shapes. Never in scope, and never worth a model call. */
const INSTRUCTION_OVERRIDE =
  /\b(ignore (all |your |the )?(previous|prior|above)|disregard (the |your )?(instructions|prompt)|system prompt|reveal your (prompt|instructions)|you are now|act as (a|an)|pretend (to be|you are)|jailbreak|developer mode)\b/i;

export type OffDomainReason = "produce-task" | "general-knowledge" | "override";

/**
 * A cheap pre-retrieval check. Returns a reason only when the request is
 * plainly not about a person's background — never on a merely unusual question.
 */
export function offDomainReason(query: string): OffDomainReason | null {
  if (INSTRUCTION_OVERRIDE.test(query)) return "override";
  if (hasGauravReference(query)) return null;
  if (PRODUCE_TASK.test(query)) return "produce-task";
  if (ASSISTANCE_REQUEST.test(query)) return "produce-task";
  if (GENERAL_KNOWLEDGE.test(query)) return "general-knowledge";
  return null;
}

/**
 * Match a project by slug or title, tolerating the way people actually type
 * them ("smart farm", "the satellite one", "GS2").
 */
export function matchProjectSlug(
  query: string,
  projects: readonly { slug: string; title: string }[],
): string | null {
  const normalized = normalizeProjectText(query);

  for (const project of projects) {
    const slugWords = normalizeProjectText(project.slug);
    const title = normalizeProjectText(project.title);

    if (hasNormalizedPhrase(normalized, title) || hasNormalizedPhrase(normalized, slugWords)) {
      return project.slug;
    }

    // Distinctive single-word titles ("Udaan") are worth matching alone; short
    // generic ones are not, or "work" would match a project called Work.
    const head = title.split(/\s+/)[0];
    if (head.length >= 5 && hasNormalizedPhrase(normalized, head)) {
      return project.slug;
    }
  }

  return null;
}

const PROJECT_LINK_LANGUAGE =
  /\b(github|gitlab|repo|repos|repository|repositories|source code|codebase|codebases|url|link|website|web site|homepage|demo)\b/i;

/** A named project's source, repository, demo, or other authored URL. */
export function asksForProjectLink(query: string): boolean {
  return PROJECT_LINK_LANGUAGE.test(query);
}

/** A collection request for projects with public source repositories. */
export function asksForProjectRepositoryDiscovery(query: string): boolean {
  const repositoryLanguage =
    /\b(github|gitlab|repo|repos|repository|repositories|source code|codebase|codebases)\b/i.test(
      query,
    );
  const projectCollection =
    /\b(project|projects|work|repo|repos|repository|repositories|codebase|codebases)\b/i.test(
      query,
    );
  return repositoryLanguage && projectCollection;
}

/**
 * Resolve direct contact and profile actions before broad topic routing.
 *
 * A channel name alone refers to Gaurav's profile in this portfolio. A named
 * project or a repository collection keeps its project meaning, so the same
 * word (especially “GitHub”) never has to belong permanently to one topic.
 */
export function contactActionIntent(
  query: string,
  projects: readonly { slug: string; title: string }[],
): ContactActionIntent {
  const normalizedQuery = normalizeQuerySurface(query);
  if (wantsMessageForm(normalizedQuery)) return { kind: "message" };

  const namedProject = matchProjectSlug(normalizedQuery, projects);
  if (
    (namedProject && asksForProjectLink(normalizedQuery)) ||
    asksForProjectRepositoryDiscovery(normalizedQuery) ||
    (asksForProjectLink(normalizedQuery) && /\bprojects?\b/i.test(normalizedQuery))
  ) {
    return null;
  }

  const channel = profileLinkChannelFromSurface(normalizedQuery);
  if (channel) {
    return isDirectProfileChannelRequest(normalizedQuery, channel)
      ? { kind: "profile-link", channel }
      : null;
  }

  return detectTopics(normalizedQuery).has("contact") ? { kind: "info" } : null;
}

function isDirectProfileChannelRequest(
  query: string,
  channel: ProfileLinkChannel,
): boolean {
  const compact = query
    .toLowerCase()
    .replace(/[?!.]+/g, " ")
    .replace(/\b(?:please|pls)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const channelLabel = channel === "email"
    ? "(?:email|mail)"
    : channel === "website"
      ? "(?:website|web site|homepage)"
      : channel === "resume"
        ? "(?:cv|resume|résumé|curriculum vitae)"
        : channel;
  if (new RegExp(`^(?:the )?${channelLabel}(?: (?:link|profile|account|url|address))?$`, "i").test(compact)) {
    return true;
  }
  // CV language also appears in experience questions. Only a direct file
  // action should become a download; "what's in his CV?" remains experience.
  if (channel === "resume") {
    if (/\b(?:listed|says?|experience|skills?|education|projects?|history|details?|contents?)\b/i.test(query) ||
        /\bwhat(?:'s| is) in\b/i.test(query)) {
      return false;
    }
    return /\b(?:download|get|give|show|send|share|open|view|see|find|have|access)\b/i.test(query) ||
      /\b(?:where|can i|may i)\b/i.test(query);
  }
  return /\b(?:gaurav|he|him|his|you|your|yours)\b/i.test(query) ||
    /\b(?:give|show|send|share|open|find)\b/i.test(query) ||
    /\b(?:profile|account|contact|reach|url|link|address)\b/i.test(query);
}

function profileLinkChannelFromSurface(query: string): ProfileLinkChannel | null {
  if (/\bgithub\b/i.test(query)) return "github";
  if (/\blinkedin\b/i.test(query)) return "linkedin";
  if (/\b(?:email|email address|mail address)\b/i.test(query)) return "email";
  if (/\b(?:website|web site|homepage|personal site)\b/i.test(query)) return "website";
  if (/(?:\bcv\b|\bresume\b|résumé|curriculum vitae)/i.test(query)) return "resume";
  return null;
}

/**
 * A direct request for the authored summary of a named project. Specific
 * questions such as status, stack, role and links are handled before this.
 */
export function asksForProjectOverview(
  query: string,
  project: { slug: string; title: string },
): boolean {
  let normalized = normalizeProjectText(
    query.replace(/what['’]s/gi, "what is").replace(/\bwhats\b/gi, "what is"),
  );
  const mentions = [...new Set([
    normalizeProjectText(project.title),
    normalizeProjectText(project.slug),
  ])].sort((a, b) => b.length - a.length);

  for (const mention of mentions) {
    normalized = normalized.replace(
      new RegExp(`(?:^| )${escapeRegex(mention)}(?= |$)`, "g"),
      (match) => `${match.startsWith(" ") ? " " : ""}project_name`,
    );
  }
  normalized = normalized.replace(/\s+/g, " ").trim();

  return /^(?:project_name|show me (?:the )?project_name(?: project| app| application)?|what is (?:the )?project_name(?: project| app| application)?|what is project_name about|what (?:does|did) project_name do|how (?:does|did) project_name work|(?:tell me(?: more)? about|describe|explain|what about|anything else about) (?:the )?project_name(?: project| app| application)?|(?:go deeper|more details) (?:about|into|on) (?:the )?project_name(?: project| app| application)?|(?:can|could|would) you (?:tell me(?: more)? about|describe|explain) (?:the )?project_name(?: project| app| application)?|give me (?:an?|a short|a quick) overview of (?:the )?project_name(?: project| app| application)?)$/.test(normalized);
}

function normalizeProjectText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNormalizedPhrase(text: string, phrase: string): boolean {
  return phrase.length > 0 && (` ${text} `).includes(` ${phrase} `);
}

/** Descriptions are retrieval hints, never proof of a project identity. */
export function describesRememberedWork(query: string): boolean {
  if (/^(?:what is|what['’]s) (?:his|gaurav['’]s|your) website[?.!]*$/i.test(query.trim())) return false;
  if (/^what has (?:gaurav|he) (?:actually )?built with\b/i.test(query.trim())) return false;
  if (/\b(school|university|degree|education|stud(?:y|ying|ied)|email|contact|location|age)\b/i.test(query) &&
      !/\b(project|chatbot|bot|app|application|built|created|developed)\b/i.test(query)) return false;
  return /\b(project|chatbot|bot|website|site|app|application|tool|system|thing|one|remember|recall|built|made|created|developed|done)\b/i.test(query) &&
    !/\b(projects|strongest|best|hire|contribute|able to)\b|\b(?:can|could|would) (?:gaurav|he)\b/i.test(query);
}

/** Only open stack requests; a specific technology premise needs verification. */
export function asksForTechnologyStack(query: string): boolean {
  return /\b(?:what|which)\b.{0,40}\b(?:technologies|technology|tools|frameworks|libraries|languages|stack)\b|\b(?:tech|technology) stack\b/i.test(query);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Explicitly asking to send a message, rather than asking about him.
 *
 * Deliberately narrow. "Why might I hire him?" is a question about his case,
 * and answering it with an empty form instead of the case is the worst possible
 * reading — so hiring language belongs to the `hiring` topic, which shows
 * availability, and only an actual intent to write lands here.
 */
export function wantsMessageForm(query: string): boolean {
  return /\b(message (him|gaurav|you)|send (him|gaurav|you|a) (a )?(message|note|email)|contact form|i['’]?d like to (send|message)|can i (message|email)|write to (him|gaurav|you))\b/i.test(
    query,
  );
}

/** A terse repository request can inherit the active project from chat state. */
export function isProjectRepositoryFollowUp(query: string): boolean {
  return /^(?:github|gitlab|(?:the )?(?:repo|repository)|source(?: code)?|codebase)(?: link| url)?[?!.]*$/i.test(
    query.trim(),
  );
}

/** A challenge asks to re-check or expose support for the previous proposition. */
export function isEvidenceChallenge(query: string): boolean {
  return /^(?:really|are you sure|source|sources|prove it|is that accurate|is this accurate|how do you know|what(?:'s| is) the evidence)[?!.]*$/i.test(
    query.trim(),
  );
}

/** "Why hire him?" asks for evidence, not an availability card. */
export function wantsHiringCase(query: string): boolean {
  return (
    /\b(why (should|might|would|could) .{0,18}hire|should (?:i|we) hire|hireable|worth (?:an )?interview(?:ing)?|case for hir|good fit|add value|what (?:can|could|would|might) .{0,18}contribute|prove (his|gaurav'?s)|evidence of (his|gaurav'?s))\b/i.test(
      query,
    ) ||
    /\bhir(?:e|ing)\b[\s\S]{0,140}\b(?:can|could|would).{0,30}(?:he|gaurav).{0,30}(?:able to )?(?:build|make|develop|deliver)\b/i.test(
      query,
    )
  );
}

/** Questions asking for judgement and differentiation, not merely a biography. */
export function wantsEvidenceCase(query: string): boolean {
  return (
    wantsHiringCase(query) ||
    /\b(most impressive|impressive things?|what stands out|standout|remarkable|distinctive|unique strengths?|strongest qualities|best things? about|why is (he|gaurav) (good|interesting|impressive)|what makes (him|gaurav) special)\b/i.test(
      query,
    )
  );
}

/**
 * A short turn only needs the prior question when it points backward.
 * Character count alone treated fresh questions like "Where does he study?"
 * as project follow-ups and polluted retrieval with the previous subject.
 */
export function isContextualFollowUp(query: string): boolean {
  const normalized = query.trim();
  if (normalized.length > 90) return false;

  return (
    isProjectRepositoryFollowUp(normalized) ||
    /\b(it|its|that|this|those|these|them|the (first|second|last|other) one|that one|this one|same one)\b/i.test(
      normalized,
    ) ||
    /^(and |but )?(why|how so|what about|which one|tell me more|go deeper|more details|anything else)\b/i.test(
      normalized,
    )
  );
}

const RETRIEVAL_HINTS: Record<Topic, string> = {
  projects: "projects portfolio built shipped work",
  skills: "skills stack technologies technical projects",
  education: "education university degree studying school",
  experience: "experience background projects roles work",
  hiring: "availability interests skills projects experience",
  contact: "contact email message reach",
  about: "profile background focus location",
  philosophy: "philosophy approach process principles work",
};

/** Deterministic vocabulary expansion for lexical retrieval. */
export function expandRetrievalQuery(query: string): string {
  const hints = [...detectTopics(query)].map((topic) => RETRIEVAL_HINTS[topic]);
  if (wantsHiringCase(query)) hints.push("skills projects evidence technical work");
  if (wantsEvidenceCase(query)) {
    hints.push("strongest skills projects evidence robotics artificial intelligence achievements");
  }
  return [...new Set([query, ...hints])].join(" ");
}
