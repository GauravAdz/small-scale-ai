/**
 * GauravGPT — behaviour & UI knobs.
 *
 * This is the file you edit to change how the counterpart *behaves*.
 * Edit `data/profile.json` and `data/**\/*.md` to change what it *knows*.
 * Secrets and provider selection live in `.env.local` (see `.env.example`).
 */

// Relative, not `@/`: this file is imported by `scripts/*.ts` under tsx as well
// as by the Next build, and a relative path resolves identically in both.
import type { ChatIntro, QuickPrompt } from "./src/lib/chat/ui-config";

export const counterpartConfig = {
  /** Shown in browser and social metadata. */
  site: {
    name: "Gaurav Adhikari",
    /** `{name}` is replaced with `profile.name` at render time. */
    titleTemplate: "{name} — Applied AI & Software Builder",
    description:
      "Gaurav Adhikari is an Applied AI & Software Builder in Linz, Austria working across machine learning, robotics and full-stack software. Explore his projects or ask GauravGPT.",
  },

  chat: {
    /** The product's own framing of itself, shown on the landing screen. */
    intro: {
      /** `{name}` → profile.name. */
      lede: "Hey, I'm GauravGPT.",
      sub: "{name}'s digital counterpart — built to answer from verified records.",
      /** Cycled through in the interactive prompt line. Order is the tab order. */
      topics: [
        { label: "projects", prompt: "Show me the work that best represents Gaurav." },
        { label: "AI", prompt: "What has Gaurav actually built with AI?" },
        { label: "skills", prompt: "What could Gaurav contribute technically?" },
        { label: "experience", prompt: "Give me the 30-second version of Gaurav's background." },
        { label: "opportunities", prompt: "What kind of opportunities is Gaurav open to?" },
      ],
    } satisfies ChatIntro,

    /** Three discovery actions. Contact stays available beside the composer. */
    quickPrompts: [
      {
        label: "See Gaurav's strongest work",
        mobileLabel: "Work",
        hint: "The projects worth your time",
        prompt: "Show me the work that best represents Gaurav.",
        icon: "projects",
      },
      {
        label: "What can Gaurav contribute?",
        mobileLabel: "Skills",
        hint: "Where he'd contribute",
        prompt: "What could Gaurav contribute technically?",
        icon: "skills",
      },
      {
        label: "Is Gaurav available?",
        mobileLabel: "Available?",
        hint: "Roles and opportunities",
        prompt: "Is Gaurav available?",
        icon: "hire",
      },
    ] as (QuickPrompt & { prompt: string })[],

    /** Recent user turns replayed for neutral reference resolution; assistant prose is never evidence. */
    historyWindow: 5,
  },

  retrieval: {
    /** Broad discovery; Recall@10 is independent of verifier context size. */
    candidateK: 10,
    /** Fit the small authored corpus so lexical misses cannot hide an answer. */
    verificationK: 20,
    /** Bound context growth; larger corpora fall back to ranked excerpts. */
    verificationMaxCharacters: 36_000,

    /** Hybrid weights — must sum to 1. Lexical carries a small corpus well. */
    weights: {
      lexical: 0.45,
      semantic: 0.55,
    },

    /** Rank-fusion and diversity controls for the small portfolio corpus. */
    rankFusionK: 60,
    diversityLambda: 0.78,

    /** Ingest-time chunking. Characters, not tokens — deliberately simple. */
    chunk: {
      size: 900,
      overlap: 150,
    },
  },

  knowledge: {
    /** Warn only: freshness checks never rewrite or guess mutable facts. */
    freshnessDays: {
      age: 370,
      location: 180,
      availability: 90,
      education: 180,
    },
  },

  verificationCache: {
    enabled: true,
    ttlMs: 24 * 60 * 60 * 1000,
    maxEntries: 1000,
  },

  verificationBudget: {
    maxModelCallsPerTurn: 3,
    maxEvidenceItemsPerCall: 20,
    concurrency: 2,
    timeoutMs: 20_000,
  },

  semanticRecovery: {
    /** Recovery runs only after deterministic interpretation reports uncertainty. */
    enabled: true,
    timeoutMs: 5_000,
    maxOutputTokens: 400,
    acceptConfidence: 0.8,
    clarifyConfidence: 0.55,
  },

  /**
   * The pre-LLM scope guard.
   *
   * Direct conversational actions stay instant. Substantive questions use
   * evidence assessment and checked wording; answer quality takes priority
   * over minimizing model calls. Retrieval scores never veto interpretation.
   */
  scope: {
    /** What the app says instead of calling the model. `{name}` → profile.name. */
    redirect:
      "I'm GauravGPT, so I stick to questions about Gaurav — his projects, skills, studies, experience, availability, or how to reach him. Ask me any of those and I'll be useful.",

    /** Used when the visitor asks whether Gaurav can do something absent from his notes. */
    knowledgeGap:
      "I don't have enough verified information in Gaurav's portfolio to answer that confidently.",

    clarification:
      "I'm not sure which part of Gaurav's portfolio you mean. Name a project, skill, school, or contact channel and I'll check it.",

  },

  showcase: {
    /** Whether the identity rail starts open on desktop. */
    defaultOpen: true,
    /** How many projects the always-visible rail shows. Keep it small. */
    featuredProjects: 2,
  },

  /**
   * Where visitors get sent when a question falls outside the knowledge base.
   * The keys here are resolved from `data/profile.json` → `contact`.
   */
  escalation: {
    preferredChannels: ["email", "linkedin"] as const,
  },

  contact: {
    /** Field ceilings, enforced by Zod on the server. */
    limits: { name: 80, email: 160, company: 100, message: 2000 },
    /** Messages per window, per IP. Deliberately far tighter than chat. */
    rate: { requests: 3, windowSeconds: 600 },
    reasons: ["Opportunity", "Collaboration", "Question", "Other"] as const,
  },
  // Deliberately no top-level `as const`: it would narrow `defaultOpen` to the
  // literal `true`, so `useState(defaultOpen)` could never hold `false`.
};

export type CounterpartConfig = typeof counterpartConfig;
export type ContactReason = (typeof counterpartConfig.contact.reasons)[number];
export default counterpartConfig;
