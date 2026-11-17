# Digital Counterpart (GauravGPT) — System Architecture

This document provides a comprehensive, deep-dive architectural specification of the **Digital Counterpart** (GauravGPT) codebase. It explains the design principles, end-to-end request lifecycles, subsystem boundaries, data contracts, and reliability invariants that govern the system.

---

## 1. System Overview & Product Mission

The **Digital Counterpart** is a conversational AI portfolio designed for recruiters, engineering leads, and technical collaborators. Rather than acting as an ungrounded general-purpose chatbot, its primary mission is to provide accurate, honest, and evidence-backed answers about Gaurav's projects, technical capabilities, background, and availability.

### Core Product Principles

1. **Answer the Exact Question, Then Offer Evidence**: Provide a focused conclusion first; never dump the entire portfolio merely because a prompt contains words like "skills" or "projects".
2. **Progressive Disclosure**:
   - **Conclusion / Synthesis First**: A concise, direct narrative answer.
   - **Visual Card Second**: A targeted, interactive visual (single project card, skill matrix, timeline).
   - **Citations & Follow-ups Last**: Verification provenance pills and contextual follow-up chips.
3. **Evidence-Linked Claims (Zero Hallucination)**: Every factual statement is strictly verified against authored records. Unsupported claims are eliminated before reaching prose generation.
4. **Answer-First Reveal Contract**: Streaming answers stream prose first, followed by visual payloads, ensuring reading flow is never disrupted by premature UI rendering.
5. **Deterministic Over Heuristic**: Canonical structured attributes (contact information, education, GPA, dates, locations) bypass probabilistic retrieval and LLM synthesis entirely via deterministic fast-paths.

---

## 2. Architectural Invariants (The Reliability Contract)

The system is engineered around **10 non-negotiable architectural invariants** defined in `docs/reliability-invariants.md`. Any pull request or modification that violates these invariants fails automated gates (`scripts/lint-architecture.ts` and test suites):

| Invariant | Title | Description |
| :--- | :--- | :--- |
| **INV-001** | **No Unsupported Claims** | Every factual claim about Gaurav must reference at least one verified evidence record ID. |
| **INV-002** | **Retrieval Score != Proof** | BM25, cosine, RRF, MMR, and reranker scores only select candidates; scores never establish factual truth. |
| **INV-003** | **No Confidence Inflation via Expansion** | Vocabulary expansion is restricted to candidate discovery; verification evaluates the original atomic clause. |
| **INV-004** | **Follow-ups Never Bypass Grounding** | Conversation history resolves references, but the resulting proposition undergoes normal retrieval and support verification. |
| **INV-005** | **History is Untrusted Context** | Prior user messages and assistant prose are conversational context, never evidence records. |
| **INV-006** | **No Silent Embedding Drift** | Runtime embedding configuration, vector dimensions, and mean-centering transforms must match the persisted index fingerprint. |
| **INV-007** | **Absence of Evidence != Inability** | A candidate search miss produces an honest knowledge gap (`insufficient`), never an assertion that Gaurav lacks a capability. |
| **INV-008** | **Canonical Fact Ownership** | Mutable facts (location, availability, education, contact) have single canonical structured owners (`data/profile.json`). |
| **INV-009** | **Deterministic Failure Semantics** | `not-recorded` requires an exhaustive canonical lookup; candidate retrieval misses result in `insufficient`. |
| **INV-010** | **Verifier vs. Renderer Separation** | The planner/verifier decides what facts may be stated; the renderer formats approved claims and cannot introduce new propositions. |

---

## 3. High-Level Architecture Map

```mermaid
flowchart TD
    subgraph Client ["Client (Browser)"]
        UI[Chat UI / Composer]
        StreamHandler[SSE Reader / ai-sdk]
        MessageRenderer["Answer-First Message Renderer"]
        Visuals["Visual Blocks (Cards, Grids, Form)"]
    end

    subgraph API ["Next.js App Router (Node.js Runtime)"]
        ChatRoute["POST /api/chat"]
        RateLimiter["IP Rate Limiter (Token Bucket)"]
        ContactRoute["POST /api/contact"]
    end

    subgraph Orchestration ["Chat Pipeline (`src/lib/chat/pipeline.ts`)"]
        Surface["Conservative Surface Normalization"]
        Context["Resolve Conversation Context"]
        Intent["Deterministic Interaction Interpretation"]
        Recovery["Bounded Semantic Recovery"]
        ScopePre["Pre-Retrieval Scope Guard"]
        ClauseDecomp["Atomic Clause Decomposition"]
        ExactPath{"Exact Fact / Fast-Path?"}
        ScopePost["Post-Retrieval Scope Guard"]
        VisualPlanner["Evidence-Aware Visual Selector"]
        PlanBuilder["Factual Plan Builder"]
        VoiceRenderer["Deterministic Voice Renderer"]
        CitationBuilder["Plan Citation Generator"]
    end

    subgraph RAG ["Retrieval Engine (`src/lib/rag/`)"]
        QueryExp["Query Token Expander"]
        BM25["BM25 Lexical Scorer"]
        VectorStore["Vector Embeddings (Memory / Remote)"]
        RRF["Reciprocal Rank Fusion (RRF)"]
        MMR["MMR Diversity Filter"]
    end

    subgraph Verification ["Evidence & Verification (`src/lib/evidence/`)"]
        FactStore["In-Memory Fact Store"]
        Contradiction["Authority & Conflict Resolver"]
        ExtractiveVerifier["Extractive Verifier"]
        CapabilityInference["Capability Inference Engine"]
        ModelVerifier["AiSdk Model Verifier (Gemini / Azure / OpenAI)"]
        VerifierCache["In-Memory Verification Cache"]
    end

    subgraph Knowledge ["Knowledge Base (`data/`)"]
        ProfileJSON["data/profile.json"]
        MarkdownDocs["data/projects/*.md, experience.md, etc."]
        IndexJSON["data/.index/index.json"]
    end

    UI -->|JSON Request| RateLimiter
    RateLimiter --> ChatRoute
    ChatRoute --> Surface --> Context --> Intent
    Intent -->|uncertain only| Recovery
    Intent -->|confident| ScopePre
    Recovery -->|validated UnderstoodQuery| ScopePre
    ScopePre -->|Pass| ClauseDecomp
    ClauseDecomp --> ExactPath
    ExactPath -->|Match| FactStore
    ExactPath -->|No Match| QueryExp
    QueryExp --> BM25 & VectorStore
    BM25 & VectorStore --> RRF --> MMR
    MMR --> ScopePost
    ScopePost -->|Candidate Evidence| Verification
    Verification --> PlanBuilder
    PlanBuilder --> VisualPlanner
    PlanBuilder --> VoiceRenderer
    PlanBuilder --> CitationBuilder
    VoiceRenderer & VisualPlanner & CitationBuilder --> ChatRoute
    ChatRoute -->|SSE Stream (text -> visual -> citations -> status)| StreamHandler
    StreamHandler --> MessageRenderer --> Visuals
```

---

## 4. End-to-End Request Lifecycle & Turn Stages

Every visitor query executes through a synchronous turn pipeline with distinct stages streamed to the UI:

```
[resolving] ──▶ [searching] ──▶ [verifying] ──▶ [writing] ──▶ [done]
```

### Turn Progression:

1. **HTTP Ingestion & Validation** (`src/app/api/chat/route.ts`):
   - Validates client payload against Zod schema (`messages` array).
   - Enforces sliding-window IP rate limiting (`src/lib/rate-limit.ts`).
   - Verifies that index and environment configurations match.
   - Initialises a Server-Sent Events (SSE) stream via `ai` UI message stream protocol.

2. **Surface Normalization and Reference Resolution** (`src/lib/chat/query-surface.ts`, `src/lib/chat/resolve-question.ts`):
   - **Stage**: `resolving`
   - Normalizes whitespace, Unicode apostrophes, and a small set of stable channel spellings without making semantic guesses.
   - Classifies the semantic head of deictic phrases before consulting project context: the current `website`, `site`, or `page` means the portfolio surface; `chatbot` or `bot` means GauravGPT; `project` or `app` may inherit the active project; a bare `this` remains contextual.
   - Detects pronominal and anaphoric references (e.g., *"tell me more about it"*, *"what stack was used for that?"*).
   - Rewrites the question into a standalone proposition using previous turn metadata (focused projects, topics).
   - A deterministically unresolved reference is the only deictic case eligible for semantic recovery. If recovery remains ambiguous, the visitor receives a clarification instead of a guessed referent.

3. **Progressive Query Understanding** (`src/lib/chat/query-understanding.ts`):
   - Produces one `UnderstoodQuery` containing the original, resolved, and canonical query plus the interaction target, source, confidence, and ambiguity state.
   - Keeps recognized requests on the deterministic zero-LLM path.
   - Calls the semantic interpreter only when deterministic routing is unknown or structurally incomplete, such as a fuzzy unnamed project or an unresolved bare reference.
   - Sends only the resolved query and the allowed ontology: intent kinds, profile channels, authored project slugs/titles, and skill names. It never sends retrieved evidence or the knowledge corpus.
   - Validates the structured output and rejects unknown project slugs, unknown enums, and impossible intent/target/channel/aspect combinations.
   - Uses high-confidence interpretations, asks for clarification on material ambiguity, and retains the resolved proposition when recovery is disabled, invalid, or unavailable.

   Semantic recovery answers what the visitor meant. It cannot establish that the interpreted proposition is true. The accepted canonical query still passes through exact facts, retrieval, and support verification.

4. **Pre-Retrieval Scope Guard** (`src/lib/chat/scope-guard.ts`):
   - Evaluates whether the question falls completely outside the portfolio domain (e.g., general world trivia, math puzzles, coding assistance unrelated to Gaurav).
   - Returns an immediate, courteous local redirect without spending LLM tokens or retrieval latency.

5. **Clause Decomposition** (`src/lib/evidence/question.ts`):
   - Splits compound queries (e.g., *"Where does Gaurav live and has he built computer vision models?"*) into independent atomic clauses.
   - Clauses are evaluated concurrently under a configurable concurrency budget (`mapIndependentClauses`).

6. **Exact Fact Fast-Path & Canonical Background Check**:
   - `answerCanonicalBackgroundSummary`: Checks if the clause asks for Gaurav's general 30-second summary or background; answers deterministically from verified profile records.
   - `answerExactFact`: Matches structured attributes (email, location, graduation date, degree, GPA, GitHub, LinkedIn). Returns exact values with authority `authoritative`.

7. **Candidate Retrieval** (`src/lib/rag/retriever.ts`):
   - **Stage**: `searching`
   - Expands query terms with domain synonyms (`src/lib/chat/intent.ts`).
   - Executes hybrid retrieval:
     - **Lexical**: BM25 scoring over chunk title, headings, and body.
     - **Semantic**: Dot-product / cosine similarity over mean-centered embeddings.
   - Fuses ranked lists using **Reciprocal Rank Fusion (RRF)**:
     $$\text{RRF}(d) = \sum_{m \in \{\text{lexical}, \text{semantic}\}} \frac{w_m}{k + \text{rank}_m(d)}$$
   - Applies **Maximal Marginal Relevance (MMR)** diversity selection to eliminate duplicate content from identical documents.

8. **Evidence Context Selection**:
   - Selects complete authored parent records while the small corpus fits the configured record and character budgets.
   - Falls back to bounded ranked excerpts as the corpus grows. Weak lexical retrieval never establishes either support or absence.

9. **Evidence Verification** (`src/lib/evidence/verifier.ts`):
   - **Stage**: `verifying`
   - **Contradiction Resolution**: Groups records by `subject + predicate`, prioritizing authoritative sources over derived ones and newer timestamps over older ones.
   - **Extractive Fast-Path**: If the clause is purely descriptive and has high textual overlap with candidate evidence, extracts facts without an LLM.
   - **Capability Inference**: Evaluates whether documented skills support an adjacent technical capability without over-claiming.
   - **Model Verifier**: For complex narrative synthesis, invokes `AiSdkEvidenceVerifier` against an explicit JSON schema. The model produces candidate claims tied strictly to candidate `evidenceIds`.
   - **Validation Gate**: Strips any claim lacking valid evidence IDs or citing non-existent records.

10. **Factual Answer Planning** (`src/lib/llm/answer-plan.ts`):
   - Compiles verified claims across all clauses into a `FactualAnswerPlan`.
   - If a clause has status `insufficient`, `not-recorded`, or `contradicted`, automatically generates an honest uncertainty claim.

11. **Evidence-Aware Visual Selection** (`src/lib/chat/visual-intent.ts`):
    - Evaluates whether a visual element (Project Cards, Skills Grid, Experience Timeline, Contact Form) is justified.
    - Consumes the same `UnderstoodQuery` used by evidence strategy when all clauses are supported, preventing answer and visual intent from drifting.
    - **Crucial Rule**: Unsupported clauses cannot select a visual. If an assessment is unsupported, visual generation is suppressed.

12. **Deterministic Voice Rendering** (`src/lib/llm/renderer.ts`):
    - **Stage**: `writing`
    - Translates approved factual plan claims into final natural language prose.
    - Default `DeterministicVoiceRenderer` concatenates approved claim texts, ensuring zero hallucinated propositions can be introduced.

13. **Streaming Delivery & Answer-First Reveal**:
    - **Stage**: `done`
    - Emits SSE message parts in strict order:
      1. `text-start` / `text-delta` / `text-end`: The complete answer text.
      2. `data-visual`: Typed interactive visual component payload.
      3. `data-sources`: Citations linking claim propositions to evidence files and lines.
      4. `data-followups`: Relevant follow-up prompt suggestions.
      5. `data-status`: Final turn stage and support status (`supported`, `partially-supported`, `insufficient`, etc.).

---

## 5. Subsystem Deep-Dive

### 5.1. Knowledge Layer & Ingestion Pipeline

```
data/
├── profile.json            # Canonical source of truth (identity, skills, contact, education)
├── projects/               # Detailed project case studies with YAML frontmatter
│   ├── satellite-classifier.md
│   ├── gauravgpt.md
│   ├── smart-farm.md
│   ├── udaan.md
│   └── digital-counterpart.md
├── experience.md           # Professional and self-directed engineering history
├── education.md            # Academic coursework, degree details, achievements
├── faq.md                  # Common recruiter / engineering questions
├── philosophy.md           # Engineering principles and methodology
└── .index/
    └── index.json          # Persisted, versioned, provenance-bearing knowledge index
```

#### The Ingestion Pipeline (`scripts/ingest.ts`):
1. **Manifest Generation**: Hashes every source file using SHA-256 (`corpusDigest`).
2. **Document Loading**: Validates frontmatter schemas and parses markdown AST (`gray-matter`).
3. **Placeholder Stripping**: Omits paragraphs containing `TODO` or unfulfilled template placeholders so they never enter the knowledge index.
4. **Chunking** (`src/lib/knowledge/chunk.ts`): Breaks documents into overlapping character chunks (`counterpartConfig.retrieval.chunk`: 900 chars, 150 overlap), tracking document hierarchy and headings.
5. **Evidence Records Generation**: Creates typed evidence units (`evidence:docId:chunkIndex`) stamped with authority levels (`authoritative`, `corroborated`, `derived`).
6. **BM25 Lexical Statistics**: Pre-computes vocabulary frequencies and document lengths.
7. **Embeddings Computation**: Generates vector representations using the configured provider, normalizes them, and calculates the corpus mean vector for mean-centering.
8. **Integrity Verification**: Writes `data/.index/index.json` with embedded schema versions, chunker versions, and fingerprint digests.

---

### 5.2. RAG & Retrieval Engine (`src/lib/rag/`)

- **Dual-Index Search**:
  - `bm25.ts`: In-memory BM25 ranker tuned for technical keyword precision.
  - `embeddings.ts`: Vector embedder supporting OpenAI, Azure OpenAI, Groq, or `none` (lexical-only fallback).
- **Reciprocal Rank Fusion (RRF)**: Combines disparate lexical scores (unbounded) and vector cosine scores (bounded) without arbitrary normalisation factors.
- **Maximal Marginal Relevance (MMR)**: Penalizes candidate chunks that share significant token overlap or come from the same source document as already-selected chunks, maximizing informational diversity across the top $K$ results.
- **Fail-Fast Fingerprint Gate**: On application startup or retriever initialization, verifies that `index.embedding.fingerprint` strictly matches current runtime configuration. Throws `EmbeddingFingerprintMismatchError` if out of sync.

---

### 5.3. Evidence Verification & Grounding Engine (`src/lib/evidence/`)

The verifier is the core truth-enforcing boundary of the system:

```
Candidate Chunks ──▶ Fact Store Extraction
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
    Deterministic Path           Narrative Path
  - Background Summary         - Extractive Overlap
  - Exact Fact Store           - Capability Inference
  - Contradiction Check        - AiSdk Model Verifier
             │                           │
             └─────────────┬─────────────┘
                           ▼
                 Validated Claims List
                 (Each claim must have >= 1 valid evidenceId)
```

- **Fact Store** (`fact-store.ts`): An in-memory indexed database of canonical facts extracted from `profile.json` and active project frontmatter.
- **Contradiction Resolver** (`verifier.ts`): Resolves competing evidence by evaluating record `authority` (authoritative > corroborated > derived) and `validFrom` timestamps.
- **Model Verifier** (`model-verifier.ts`): Sends the candidate evidence records and atomic clause to a structured LLM call with a Zod output schema:
  - Requires the model to output individual claims.
  - Requires each claim to cite specific `evidenceIds` from the provided list.
  - Enforces `validateModelAssessment`: Any claim referencing an unrecognized evidence ID or making negative capability assertions is stripped.

---

### 5.4. Chat Pipeline & Orchestration (`src/lib/chat/`)

- `pipeline.ts`: The central state machine connecting resolution, retrieval, verification, planning, and rendering.
- `query-understanding.ts`: Owns the validated `UnderstoodQuery`, deterministic recovery trigger, ambiguity policy, and injected semantic-interpreter seam.
- `model-query-interpreter.ts`: Uses structured model output to map noisy language into the allowed ontology. Its output is untrusted routing data, never evidence.
- `scope-guard.ts`: Heuristic and semantic filter that prevents out-of-domain queries from triggering retrieval and verifier calls.
- `visual-intent.ts` & `visual-data.ts`: Maps visitor intent and verified evidence to rich UI component descriptors (`Visual` union type).
- `conversation-state.ts`: Tracks active project slugs, topics, and question histories across conversational turns.

---

### 5.5. Presentation & UI Layer (`src/components/`)

Built with Next.js 16 App Router, React 19, Tailwind CSS, and Framer Motion:

- `src/components/chat/message.tsx`: Implements the answer-first reveal contract.
- `src/components/chat/visuals/`: Interactive components rendered conditionally based on verified evidence:
  - `project-card.tsx` / `project-detail.tsx`: Live previews, GitHub links, technology tags, and key metrics.
  - `skills-grid.tsx`: Categorized skill proficiency matrices.
  - `experience-timeline.tsx`: Career and self-directed building history.
  - `contact-form.tsx`: In-chat contact submission.
- `src/components/chat/citations.tsx`: Interactive pills showing exact source files and line ranges backing each claim.
- `src/components/chat/follow-ups.tsx`: Contextual prompt chips guiding user exploration.
- `src/components/chat/turn-status.tsx`: Discrete progress indicator displaying the current pipeline stage (`searching`, `verifying`, `writing`).

---

## 6. Data Contracts & Schemas

### 6.1. Turn Status & Streaming Message Parts (`src/types/chat.ts`)

```typescript
export type TurnStage =
  | "resolving"
  | "searching"
  | "verifying"
  | "writing"
  | "done"
  | "local"
  | "error";

export type TurnStatus = {
  stage: TurnStage;
  support?: SupportStatus | "mixed";
};

export type CounterpartDataParts = {
  visual: Visual;
  sources: Citation[];
  followups: FollowUp[];
  status: TurnStatus;
};
```

### 6.2. Verified Claim & Support Assessment (`src/lib/evidence/types.ts`)

```typescript
export type SupportStatus =
  | "supported"
  | "partially-supported"
  | "unsupported"
  | "contradicted"
  | "insufficient"
  | "not-recorded";

export type VerifiedClaim = {
  id: string;
  text: string;
  kind: "fact" | "capability" | "inference" | "uncertainty";
  evidenceIds: string[];
};

export type SupportAssessment = {
  questionId: string;
  question: string;
  status: SupportStatus;
  claims: readonly VerifiedClaim[];
  evidenceIds: readonly string[];
  method: "deterministic" | "extractive" | "inference" | "model";
  reason: string;
};
```

### 6.3. Visual Payload Schema (`src/lib/chat/visual-types.ts`)

```typescript
export type Visual =
  | { kind: "projects"; projects: ProjectSummaryCard[]; title?: string }
  | { kind: "project-detail"; project: ProjectDetailCard }
  | { kind: "skills"; data: SkillCategory[] }
  | { kind: "experience"; data: ExperienceData }
  | { kind: "education"; data: EducationData }
  | { kind: "availability"; data: AvailabilityData }
  | { kind: "contact-form"; data: ContactFormData }
  | { kind: "evidence-atlas"; data: EvidenceAtlasData };
```

---

## 7. Observability, Evaluation & Testing Infrastructure

The codebase enforces reliability through multi-tiered testing and benchmarking suites:

```
digital-counterpart/
├── tests/
│   ├── unit/            # Unit tests (deterministic paths, config, schemas, BM25)
│   ├── property/        # Fast-check property tests (pipeline invariants, claims)
│   ├── integration/     # Index integrity, retrieval fusion, provider failover
│   └── e2e/             # Playwright browser end-to-end tests
├── evals/
│   ├── dataset/         # Curated golden evaluation datasets (JSONL)
│   └── promptfoo/       # Promptfoo automated model evaluations & assertions
└── scripts/
    ├── bench.ts         # Retrieval & verification regression benchmark
    ├── verify-index.ts  # Knowledge index digest and schema validation
    ├── lint-architecture.ts # Architectural boundary enforcement linter
    ├── lint-knowledge.ts    # Authoring quality and placeholder linter
    └── ingest.ts        # Index build pipeline
```

### Key Verification Commands:
- `npm run typecheck`: Strict TypeScript compilation across source and scripts.
- `npm test`: Runs unit, property, and integration tests via Vitest.
- `npm run lint:architecture`: Validates architectural decoupling (e.g., UI never imports LLM logic; chat route only orchestrates; retriever never produces raw booleans).
- `npm run verify:index`: Verifies that active data files match index hashes.
- `npm run bench`: Runs end-to-end question answering benchmark covering routing, exact-facts, and latency.

---

## 8. Technology Stack Summary

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | Next.js 16 (App Router) | Server-side rendering, streaming API routes, static assets |
| **Runtime** | Node.js (v20+) | Execution environment for streaming chat pipeline |
| **UI Library** | React 19, Tailwind CSS | Component architecture and responsive styling |
| **Animation** | Framer Motion | Smooth state transitions and micro-interactions |
| **Streaming Protocol** | Vercel AI SDK (`ai`) | Server-Sent Events UI stream protocol |
| **Validation** | Zod | Runtime type validation for API bodies, configs, and models |
| **Retrieval** | Custom In-Memory BM25 + Vector Store | Hybrid search with zero heavy third-party framework overhead |
| **Embeddings** | OpenAI / Azure OpenAI / Groq / None | Configurable embedding provider abstraction |
| **Testing** | Vitest, Fast-Check, Playwright, Promptfoo | Unit, property-based, E2E, and LLM evaluation |
