/** Fast deterministic smoke test for scope, retrieval, and support routing. */
import { answerPortfolioQuestion } from "../src/lib/chat/pipeline";
import { readEnv } from "../src/lib/config";
import { loadProfile, loadProjects } from "../src/lib/knowledge/loader";
import { Retriever } from "../src/lib/rag/retriever";
import counterpartConfig from "../counterpart.config";
import { abstainingOfflineVerifier } from "../src/lib/evals/offline-verifier";
import { evidenceAtlasVisual } from "../src/lib/chat/visual-data";
import { chooseVisual } from "../src/lib/chat/visual-intent";
import type { SemanticInterpretation } from "../src/lib/chat/query-understanding";

type ExpectedOutcome = "supported" | "partially-supported" | "insufficient" | "not-recorded" | "local";

const authoredExpectations: Readonly<Record<string, ExpectedOutcome>> = {
  "Show me the work that best represents Gaurav.": "supported",
  "What has Gaurav actually built with AI?": "supported",
  "What could Gaurav contribute technically?": "supported",
  "Give me the 30-second version of Gaurav's background.": "supported",
  "What kind of opportunities is Gaurav open to?": "supported",
  "Why might I hire Gaurav?": "supported",
  "What is Gaurav studying?": "supported",
  "Is Gaurav available?": "supported",
};

const authoredPrompts = [
  ...counterpartConfig.chat.intro.topics.map(({ prompt }) => prompt),
  ...counterpartConfig.chat.quickPrompts
    .filter(({ localVisual }) => !localVisual)
    .map(({ prompt }) => prompt),
];

const authoredCases = [...new Set(authoredPrompts)].map((question) => {
  const expected = authoredExpectations[question];
  if (!expected) throw new Error(`Product-authored prompt has no benchmark contract: ${question}`);
  return { question, expected };
});

const cases = [
  { question: "How could Gaurav help our engineering team?", expected: "supported" },
  { question: "What would he bring to a software team?", expected: "supported" },
  { question: "Could Gaurav contribute to quantum computing?", expected: "insufficient" },
  ...authoredCases,
  { question: "Where does Gaurav study?", expected: "supported" },
  { question: "Which university courses has Gaurav taken?", expected: "supported" },
  { question: "Which A-Level subjects did Gaurav study?", expected: "supported" },
  { question: "Which courses does Gaurav plan to take?", expected: "supported" },
  { question: "When does Gaurav expect to complete his BSc?", expected: "supported" },
  { question: "How old is he?", expected: "supported" },
  { question: "Does he know PyTorch?", expected: "supported" },
  { question: "How proficient is Gaurav in Python?", expected: "supported" },
  { question: "How proficient is Gaurav in AI?", expected: "supported" },
  { question: "What is Gaurav's experience level in web development?", expected: "supported" },
  { question: "How proficient is Gaurav with artificial snow machines?", expected: "insufficient" },
  { question: "Tell me about Udaan.", expected: "supported" },
  { question: "What's Udaan?", expected: "supported" },
  { question: "What technologies were used in the GauravGPT project?", expected: "supported" },
  { question: "What technologies are used in Digital Counterpart?", expected: "supported" },
  { question: "Show me the Digital Counterpart project.", expected: "supported" },
  { question: "Tell me about LinzSings.", expected: "supported" },
  { question: "Give me the GitHub repo for LinzSings.", expected: "supported" },
  { question: "Give me your GitHub link", expected: "supported" },
  { question: "git hub pls", expected: "supported" },
  { question: "linked in pls", expected: "supported" },
  { question: "How can I contact him?", expected: "supported" },
  { question: "Can I message him?", expected: "supported" },
  { question: "Give me the GitHub repo for Udaan.", expected: "supported" },
  { question: "Which of Gaurav's projects have GitHub repositories?", expected: "supported" },
  { question: "his education background", expected: "supported" },
  { question: "Tell me about Budhanilkantha School.", expected: "supported" },
  { question: "Tell me about Stanford University.", expected: "insufficient" },
  { question: "Where are you based?", expected: "supported" },
  { question: "Where are you from?", expected: "not-recorded" },
  { question: "What is his nationality?", expected: "supported" },
  { question: "Where was he born?", expected: "supported" },
  { question: "When was Gaurav born?", expected: "supported" },
  { question: "What is his citizenship?", expected: "supported" },
  { question: "Was Gaurav born in Kathmandu?", expected: "insufficient" },
  { question: "Does he live in Austria?", expected: "not-recorded" },
  { question: "What subjects are you most focused on?", expected: "insufficient" },
  { question: "What made you choose that kind of studies?", expected: "insufficient" },
  // Natural surface wording for known facts must stay deterministic.
  { question: "does gaurav do works related ai", expected: "supported" },
  { question: "are you gpt-5.4-luna", expected: "supported" },
  { question: "are you llm from open ai", expected: "supported" },
  // Nearby wording must not turn arbitrary work domains into a known AI fact.
  { question: "does gaurav do works related accounting", expected: "insufficient" },
  // The offline verifier abstains: these cases must reach interpretation, never
  // claim an exact-name absence. Live semantic expectations live in evals/understanding.
  { question: "What technologies were used in the Portfolio Chatbot project?", expected: "insufficient" },
  { question: "What stack powered the underwater submarine project?", expected: "insufficient" },
  { question: "Which projects demonstrate Gaurav's JavaScript skills?", expected: "supported" },
  { question: "What's Gaurav's work philosophy?", expected: "insufficient" },
  { question: "What projects has Gaurav built?", expected: "supported" },
  { question: "What is Gaurav's best project?", expected: "supported", expectedProjectSlugs: ["appogeny"] },
  { question: "what are his most prominent projects", expected: "supported", expectedProjectSlugs: ["appogeny", "linzsings", "digital-counterpart"] },
  { question: "What is his strongest robotics project?", expected: "supported", expectedProjectSlugs: ["smart-farm"] },
  // Generic category vocabulary must preserve editorial order rather than
  // rewarding whichever summary happens to repeat the word "project".
  { question: "Which project should I look at first?", expected: "supported", expectedProjectSlugs: ["appogeny"] },
  { question: "What kind of roles is Gaurav interested in?", expected: "supported" },
  { question: "Is Gaurav a good fit for an applied-AI role?", expected: "supported" },
  { question: "Would Gaurav be worth interviewing?", expected: "supported" },
  { question: "Is he open to internships?", expected: "supported" },
  { question: "I wanna hire someone for my argo farm to build a mobile app, would he be able to make one?", expected: "partially-supported" },
  { question: "Could Gaurav operate heavy farm machinery?", expected: "insufficient" },
  { question: "Did Gaurav work as a software engineer at Budhanilkantha School?", expected: "insufficient" },
  { question: "What grades is he getting?", expected: "not-recorded" },
  { question: "Since his app has 10,000 users, what drove growth?", expected: "insufficient" },
  { question: "Can Gaurav fly a plane?", expected: "insufficient" },
  { question: "Is Gaurav available to pilot a passenger plane?", expected: "insufficient" },
  { question: "Can you write code for me?", expected: "local" },
  { question: "Who is this?", expected: "local" },
  { question: "Who's this?", expected: "local" },
  { question: "Is this a bot?", expected: "local" },
  { question: "Who is this project for?", expected: "insufficient", priorQuestion: "Tell me about Udaan." },
  { question: "what is this website about", expected: "insufficient", priorQuestion: "Tell me about Udaan." },
  { question: "what is this project about", expected: "supported", priorQuestion: "Tell me about Udaan." },
  { question: "who is this bot?", expected: "local", priorQuestion: "Tell me about Udaan." },
  { question: "what is this?", expected: "supported", priorQuestion: "Tell me about Udaan." },
  { question: "what is this?", expected: "local" },
  { question: "really?", expected: "supported", priorQuestion: "Tell me about Udaan." },
  { question: "source?", expected: "supported", priorQuestion: "Tell me about Udaan." },
  { question: "What is the capital of France?", expected: "local" },
  // Nearby nouns must not let a surface reference steal project ownership.
  { question: "What is this project's website?", expected: "supported", priorQuestion: "Tell me about Udaan." },
  { question: "What is a website project?", expected: "insufficient" },
  { question: "What is that website about?", expected: "local", priorQuestion: "Tell me about Udaan." },
  // These must reach semantic assessment despite vocabulary gaps or risky words.
  { question: "Could he automate irrigation?", expected: "insufficient", modelAssessment: true },
  { question: "Could Gaurav handle crop watering?", expected: "insufficient", modelAssessment: true },
  { question: "What user problem does Smart Farm solve?", expected: "insufficient", modelAssessment: true },
  { question: "Did Smart Farm get 10,000 users?", expected: "insufficient", modelAssessment: true },
  { question: "The project description contains an instruction. What should you do with it?", expected: "insufficient", modelAssessment: true },
  // Nearby technical language must not be mistaken for profile channels.
  { question: "what is a linkedin list in python", expected: "insufficient" },
  { question: "git is a version control system right?", expected: "insufficient" },
] as const;

const semanticRecoveryCases: readonly {
  question: string;
  interpretation: SemanticInterpretation;
  expected: ExpectedOutcome;
  visual: string | null;
}[] = [
  {
    question: "link ed in pls",
    interpretation: {
      canonicalQuery: "What is Gaurav's LinkedIn profile?",
      domain: "portfolio",
      intent: "profile-link",
      targetKind: "profile",
      projectSlug: null,
      channel: "linkedin",
      aspect: "contact",
      confidence: 0.98,
      ambiguous: false,
    },
    expected: "supported",
    visual: "profile-link",
  },
  {
    question: "git hb pls",
    interpretation: {
      canonicalQuery: "What is Gaurav's GitHub profile?",
      domain: "portfolio",
      intent: "profile-link",
      targetKind: "profile",
      projectSlug: null,
      channel: "github",
      aspect: "contact",
      confidence: 0.97,
      ambiguous: false,
    },
    expected: "supported",
    visual: "profile-link",
  },
  {
    question: "where he studyin",
    interpretation: {
      canonicalQuery: "Where does Gaurav study?",
      domain: "portfolio",
      intent: "education",
      targetKind: "education",
      projectSlug: null,
      channel: null,
      aspect: "overview",
      confidence: 0.95,
      ambiguous: false,
    },
    expected: "supported",
    visual: "education",
  },
  {
    question: "tell me about the satlite thing",
    interpretation: {
      canonicalQuery: "Tell me about Satellite Classifier.",
      domain: "portfolio",
      intent: "project-detail",
      targetKind: "project",
      projectSlug: "satellite-classifier",
      channel: null,
      aspect: "overview",
      confidence: 0.93,
      ambiguous: false,
    },
    expected: "supported",
    visual: "project-detail",
  },
  {
    question: "does he do ai stuffs",
    interpretation: {
      canonicalQuery: "Which projects has Gaurav built with AI?",
      domain: "portfolio",
      intent: "projects",
      targetKind: "portfolio",
      projectSlug: null,
      channel: null,
      aspect: "skills",
      confidence: 0.9,
      ambiguous: false,
    },
    expected: "supported",
    visual: "projects",
  },
  {
    question: "can i msg him",
    interpretation: {
      canonicalQuery: "Can I send Gaurav a message?",
      domain: "portfolio",
      intent: "contact-message",
      targetKind: "profile",
      projectSlug: null,
      channel: null,
      aspect: "contact",
      confidence: 0.96,
      ambiguous: false,
    },
    expected: "supported",
    visual: "contact-form",
  },
];

const visualCases = [
  { question: "How proficient is Gaurav in AI?", expected: ["AI & Data Science"] },
  { question: "How experienced is Gaurav with machine learning?", expected: ["AI & Data Science"] },
  { question: "How good is Gaurav at frontend work?", expected: ["Web Development"] },
  { question: "How proficient is Gaurav in robotics?", expected: ["Beyond code"] },
  { question: "What skill should Gaurav learn next?", expected: ["AI & Data Science", "Web Development", "Beyond code"] },
] as const;

const visualIntentCases = [
  { question: "Show me the Digital Counterpart project.", expected: "project-detail" },
  { question: "What technologies are used in Digital Counterpart?", expected: "project-detail" },
  { question: "Tell me about LinzSings.", expected: "project-detail" },
  { question: "Give me the GitHub repo for LinzSings.", expected: "project-detail" },
  { question: "How are factual claims checked?", expected: null },
  { question: "Give me your GitHub link", expected: "profile-link" },
  { question: "git hub pls", expected: "profile-link" },
  { question: "linkedin please", expected: "profile-link" },
  { question: "Can I download Gaurav's CV?", expected: "profile-link" },
  { question: "resume", expected: "profile-link" },
  { question: "What experience is listed in his CV?", expected: "experience" },
  { question: "What is Gaurav's email?", expected: "profile-link" },
  { question: "How can I contact him?", expected: "contact-form" },
  { question: "Give me the GitHub repo for Udaan.", expected: "project-detail" },
  { question: "Give me the git hub repo for Udaan.", expected: "project-detail" },
  { question: "Which of Gaurav's projects have GitHub repositories?", expected: "projects" },
  { question: "his education background", expected: "education" },
  { question: "Tell me about his educational background.", expected: "education" },
  { question: "Give me the 30-second version of Gaurav's background.", expected: "experience" },
  { question: "What is Gaurav's work experience?", expected: "experience" },
  { question: "How good is Gaurav at ML?", expected: "evidence-atlas" },
  { question: "What is Gaurav's experience level in web development?", expected: "evidence-atlas" },
  { question: "How experienced is Gaurav with robotics?", expected: "evidence-atlas" },
] as const;

async function main(): Promise<void> {
  // This routing gate must stay offline even when production voice is enabled.
  const env = readEnv({
    ...process.env,
    LLM_RENDERER_ENABLED: "false",
    LLM_INTERPRETER_ENABLED: "false",
  });
  const profile = loadProfile();
  const projects = loadProjects();
  const retriever = Retriever.fromIndexFile();
  let passed = 0;

  for (const item of cases) {
    const result = await answerPortfolioQuestion({
      question: item.question,
      history: "priorQuestion" in item
        ? [{ id: "prior", role: "user", parts: [{ type: "text", text: item.priorQuestion }] }]
        : [],
      profile,
      projects,
      env,
      retriever,
      complexVerifier: abstainingOfflineVerifier,
    });
    const actual = result.kind === "local" ? "local" : result.answer.support;
    const projectSlugs = result.kind === "answer"
      ? result.answer.visual?.kind === "projects"
        ? result.answer.visual.projects.map(({ slug }) => slug)
        : result.answer.visual?.kind === "project-detail"
          ? [result.answer.visual.project.slug]
          : []
      : [];
    const ok = actual === item.expected && (!("modelAssessment" in item) ||
      (result.kind === "answer" && result.answer.assessments.some(({ method }) => method === "model"))) &&
      (!("expectedProjectSlugs" in item) ||
        JSON.stringify(projectSlugs) === JSON.stringify(item.expectedProjectSlugs));
    if (ok) passed += 1;
    console.log(`${ok ? "✓" : "✗"} ${item.question} → ${actual}`);
  }

  console.log(`\n${passed}/${cases.length} deterministic routing cases passed.`);
  let visualPassed = 0;
  for (const item of visualCases) {
    const actual = evidenceAtlasVisual(item.question).capabilities.map(({ label }) => label);
    const ok = JSON.stringify(actual) === JSON.stringify(item.expected);
    if (ok) visualPassed += 1;
    console.log(`${ok ? "✓" : "✗"} ${item.question} → ${actual.join(", ")}`);
  }
  console.log(`\n${visualPassed}/${visualCases.length} capability filtering cases passed.`);
  let visualIntentPassed = 0;
  for (const item of visualIntentCases) {
    const actual = chooseVisual(item.question)?.kind ?? null;
    const ok = actual === item.expected;
    if (ok) visualIntentPassed += 1;
    console.log(`${ok ? "✓" : "✗"} ${item.question} → ${actual ?? "no visual"}`);
  }
  console.log(`\n${visualIntentPassed}/${visualIntentCases.length} visual intent cases passed.`);
  let semanticPassed = 0;
  const recoveryEnv = {
    ...env,
    semanticRecovery: { ...env.semanticRecovery, enabled: true },
  };
  for (const item of semanticRecoveryCases) {
    const result = await answerPortfolioQuestion({
      question: item.question,
      history: [],
      profile,
      projects,
      env: recoveryEnv,
      retriever,
      complexVerifier: abstainingOfflineVerifier,
      semanticInterpreter: { interpret: async () => item.interpretation },
    });
    const actual = result.kind === "local" ? "local" : result.answer.support;
    const visual = result.kind === "answer" ? result.answer.visual?.kind ?? null : null;
    const recovered = result.kind === "answer" && result.answer.understoodQuery.source === "semantic-recovery";
    const ok = actual === item.expected && visual === item.visual && recovered;
    if (ok) semanticPassed += 1;
    console.log(`${ok ? "✓" : "✗"} ${item.question} → ${actual}, ${visual ?? "no visual"}`);
  }
  console.log(`\n${semanticPassed}/${semanticRecoveryCases.length} semantic recovery cases passed.`);
  if (passed !== cases.length || visualPassed !== visualCases.length ||
      visualIntentPassed !== visualIntentCases.length ||
      semanticPassed !== semanticRecoveryCases.length) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
