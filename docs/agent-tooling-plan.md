# Agent Tooling, Skills & Codex Integration Plan

**Document Status:** Approved Tooling & Integration Plan  
**Target System:** `digital-counterpart/`  
**Audience:** OpenAI Codex Implementation Engineers  
**Guiding Principle:** *Minimal privilege, zero unnecessary dependencies, progressive disclosure.*

---

## 1. Executive Tooling Strategy

Agentic coding tools like OpenAI Codex perform with highest precision when:
1. **Instruction files avoid context bloat**: Massive, monolithic prompts lead to attention loss and instruction fatigue. Information must be surfaced through **progressive disclosure**.
2. **Deterministic gates run automatically**: Post-tool-use hooks intercept syntax errors, broken invariants, and regressions before changes are committed.
3. **External dependencies and MCP servers are heavily vetted**: Every external tool or package introduces supply chain risk, bundle bloat, and operational failure modes.

---

## 2. Agent Skills Inventory & Specifications

The repository already defines four project-specific Agent Skills in `.agents/skills/` and one design skill. Codex should utilize these skills during execution:

```
.agents/skills/
├── counterpart-rag-review/          # Measure retrieval changes against baseline
├── counterpart-reliability-check/   # Run deterministic reliability gate
├── counterpart-knowledge-update/    # Update data/ and regenerate index.json
├── counterpart-model-eval/          # Run answer & Promptfoo regressions
└── impeccable/                      # UI design, ergonomics, and micro-interactions
```

### 2.1. Existing Project Skills

#### 1. `counterpart-rag-review`
- **Location**: `.agents/skills/counterpart-rag-review/SKILL.md`
- **When Codex Uses It**: Whenever modifying chunking (`chunk.ts`), BM25 (`bm25.ts`), embeddings (`embeddings.ts`), rank fusion (`retriever.ts`), or reranking (`reranker.ts`).
- **Workflow**:
  1. Capture baseline: `npm run eval:retrieval && npm run eval:support`.
  2. Perform localized change.
  3. Re-run evaluations and compare Recall@10, MRR, NDCG@10, false-support rate, and false-abstention rate.
  4. **Gate**: Reject change if critical precision gates regress, even if ranking metrics improve.

#### 2. `counterpart-reliability-check`
- **Location**: `.agents/skills/counterpart-reliability-check/SKILL.md`
- **When Codex Uses It**: Before completing any cross-cutting task.
- **Workflow**: Runs the 6-stage sequential gate and halts at the first structural failure:
  ```bash
  npm run typecheck
  npm test
  npm run lint:knowledge
  npm run verify:index
  npm run eval:retrieval
  npm run eval:support
  ```

#### 3. `counterpart-knowledge-update`
- **Location**: `.agents/skills/counterpart-knowledge-update/SKILL.md`
- **When Codex Uses It**: Whenever authoring or modifying personal records or project case studies in `data/`.
- **Workflow**:
  ```bash
  npm run lint:knowledge
  npm run ingest
  npm run verify:index
  npm run eval:retrieval
  npm run eval:support
  ```

#### 4. `counterpart-model-eval`
- **Location**: `.agents/skills/counterpart-model-eval/SKILL.md`
- **When Codex Uses It**: Before releasing verifier, renderer, or prompt changes.
- **Workflow**:
  ```bash
  npm run eval:answer
  npm run eval:citations
  npm run eval:conversation
  ```

---

### 2.2. Proposed New Project Skill: `portfolio-cache-auditor`

To support Stage 3 of the implementation plan (Query Embedding Cache & Correctness Caching), Codex should add the following specification as a project skill:

- **Location**: `.agents/skills/portfolio-cache-auditor/SKILL.md`
- **Scope**:
  ```markdown
  ---
  name: portfolio-cache-auditor
  description: Verify cache key composition, TTL enforcement, invalidation triggers, and collision resistance across query embedding, verification, and answer caches.
  ---

  # Portfolio Cache Auditor

  Work from `digital-counterpart/`. Run targeted cache unit tests:
  ```bash
  npm test tests/unit/verification-cache.test.ts
  npm test tests/unit/natural-answer.test.ts
  ```

  Verify the four critical cache invariants:
  1. No semantic vector distance caching for queries.
  2. Corpus digest modification invalidates 100% of cached verification judgments and answer wording.
  3. Distinct project queries with identical sentence structures must never share cache hits.
  4. Failed model calls, timeouts, and validation rejections must never enter the cache.
  ```

---

## 3. Model Context Protocol (MCP) Server Evaluation

We conducted a security and utility assessment of potential MCP servers for Codex during this project:

| MCP Candidate | Utility for Codex | Necessity | Security & Permission Risk | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **GitHub MCP Server** | Inspecting issues, pull requests, and commit history. | Low | Requires personal access token (`repo` scope). Potential risk of accidental write actions. | **OPTIONAL**: Use read-only mode only if investigating remote GitHub issues. Not required for local implementation. |
| **OpenTelemetry / APM MCP** | Real-time trace stream inspection. | Low | Exposes internal application trace data to external sockets. | **REJECT**: Standard Node.js console logs and local benchmark outputs provide all required telemetry without external servers. |
| **Filesystem / Database MCP** | Direct filesystem or database querying. | None | Redundant with native IDE and shell execution tools. | **REJECT**: Native agent file editing tools (`view_file`, `replace_file_content`) are faster, safer, and tracked. |

**MCP Verdict**: **Zero MCP servers are required** for Codex to execute the complete implementation plan. Native CLI commands (`tsx`, `vitest`, `playwright`, `next`) and file editing tools are completely sufficient and inherently more secure.

---

## 4. Codex Compatibility & Progressive Disclosure Architecture

Codex performs best when documentation is organized hierarchically so that it reads only the context relevant to its immediate stage.

### Progressive Disclosure Hierarchy

```text
Level 1: Root AGENTS.md
   │  (Identifies product boundaries: static GitHub Pages root vs. digital-counterpart/)
   │
   ├─▶ Level 2: digital-counterpart/AGENTS.md
   │      (Product principles, 10 Reliability Invariants, definition of done, core commands)
   │
   ├─▶ Level 3: docs/CODEX_IMPLEMENTATION_PLAN.md
   │      (The master execution plan: Checkpoints 1–10, DAG, file-by-file modifications)
   │
   └─▶ Level 4: Specialized Skills (.agents/skills/*) & Audit Docs (docs/ai-*.md)
          (Consulted on-demand when executing specific checkpoints)
```

### Codex Configuration via `.codex/hooks.json`
The repository already contains `.codex/hooks.json` registering `PostToolUse` and `Stop` hooks. Codex execution should leverage these hooks to run fast linting passes automatically after editing files.

---

## 5. Library & Dependency Recommendations

The repository's strict policy is to **avoid introducing heavy external frameworks**. Below is the audit and recommendation for every evaluated package:

| Proposed Library | Problem Solved | Existing Approach | Recommendation | Rationale & Tradeoffs |
| :--- | :--- | :--- | :--- | :--- |
| **Zero-Dependency Porter Stemmer (TypeScript)** | Morphological word matching in BM25 (`FLAW-03`). | Crude suffix stripping (`slice(0, -1)`). | **IMPLEMENT (Inline)** | Write a clean 150-line TypeScript module in `src/lib/rag/stemmer.ts`. Zero external npm dependencies, zero supply-chain risk, $<1\text{ms}$ execution. |
| **LRU Cache (`lru-cache` or Bounded Map)** | Query embedding cache (`FLAW-02`). | Remote REST call on every search. | **IMPLEMENT (Native Map)** | The existing `MemoryAnswerCache` in `src/lib/llm/answer-cache.ts` already implements a bounded Map with TTL and capacity trimming. Reuse this pattern in `src/lib/rag/embeddings.ts` with zero new dependencies. |
| **FlashRank (`flashrank` npm)** | Local cross-encoder reranking (`FLAW-04`). | `NoopReranker`. | **EXPERIMENT** | Benchmark under Experiment 3. If ONNX runtime increases Next.js build bundle by $>15\text{MB}$, keep behind optional flag or reject. |
| **LangChain / LlamaIndex** | RAG orchestration. | Bespoke typed pipeline (`pipeline.ts`). | **STRICTLY REJECT** | Heavy bundle size, slow initialization, breaking API churn, opaque abstractions. The existing native pipeline is vastly superior in speed and reliability. |
| **Cohere Rerank SDK** | Remote reranking API. | `NoopReranker`. | **REJECT as dependency** | If remote reranking is tested, use a plain native `fetch()` call in `src/lib/rag/reranker.ts` identical to `embeddings.ts`. No SDK dependency needed. |
