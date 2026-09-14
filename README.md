# Digital Counterpart

An evidence-backed conversational portfolio for Gaurav Adhikari. It is designed
to answer from Gaurav's verified records, attach evidence to factual claims, and
say when the available evidence is insufficient rather than guessing.

This is not a claim that language models cannot hallucinate. Reliability comes
from application boundaries: retrieval only finds candidates, a separate
support layer approves claims, and the voice renderer cannot decide what is
true.

## Reliability contract

- Every personal factual claim has one or more evidence IDs.
- Retrieval, similarity, query coverage, and reranking scores are never proof.
- Expanded queries find candidates; support is judged against the original
  resolved proposition.
- Follow-ups resolve to standalone questions and pass through normal support
  checks. Assistant history is not evidence.
- Exact profile, project, and runtime facts use deterministic paths.
- Missing support means `insufficient`; `not-recorded` is reserved for
  exhaustive canonical lookups.
- Source, chunker, embedding, and store identities are persisted and checked at
  runtime. Incompatible or stale indexes fail explicitly.

The full contract is in [`docs/reliability-invariants.md`](docs/reliability-invariants.md).

## Architecture

```text
Markdown / JSON records
        ↓ load + validate + SHA-256 manifest
Evidence records ───────────────┐
        ↓ retrieval projection  │
Search chunks + BM25/vectors    │
        ↓                       │
Resolved atomic questions       │
        ↓ candidate retrieval   │
Original proposition + evidence┘
        ↓ support verification
Evidence-linked factual plan
    ↓ checked LLM paraphrase (deterministic fallback)
Answer + claim citations + safe visual
```

`KnowledgeIndexV2` records the corpus digest, individual source hashes, chunker
version and configuration, embedding fingerprint and transform, vector-store
index identity, evidence records, retrieval chunks, and lexical statistics.
Narrative citations resolve to a source, heading, excerpt, and line span;
structured facts resolve to their canonical JSON pointer.

The main boundaries live under:

```text
src/lib/evidence/      truth, provenance, exact facts, support verification
src/lib/knowledge/     schemas, loading, chunking, source/index manifests
src/lib/rag/           candidate retrieval, embeddings, stores, reranking seam
src/lib/chat/          resolution, neutral state, scope, orchestration, visuals
src/lib/llm/           verifier/renderer model adapters and lean prompts
src/lib/observability/ OpenTelemetry spans with content recording disabled
```

## Quick start

```bash
npm install
cp .env.example .env.local
npm run lint:knowledge
npm run ingest
npm run verify:index
npm run dev
```

Open <http://localhost:3000>. BM25-only retrieval is the default and requires
no embedding service. Provider credentials are only needed when a configured
model path is actually used.

## Knowledge ownership

All personal knowledge lives in `data/`:

| Source | Canonical responsibility |
|---|---|
| `profile.json` | Current profile, structured education and coursework, availability, skills, contact |
| `projects/*.md` frontmatter | Project year, role, status, URLs, tags |
| `projects/*.md` body | Project narrative and technical evidence |
| `experience.md` | Role metadata and experience narrative |
| `philosophy.md` | Authored opinions and preferences |
| `faq.md` | Stable summaries, not mutable deployment facts |

Education dates, study status, expected completion, and taken, recognized, or
planned coursework belong to `profile.json`. `education.md` holds the surrounding
learning history and achievements. Current role preferences and weekly availability
also belong to `profile.json`; `experience.md` owns role history and the compact
metadata used by the Experience card. Project-specific facts belong to their
project records. Do not duplicate mutable facts across these sources. After any
knowledge change run:

```bash
npm run lint:knowledge
npm run ingest
npm run verify:index
npm run eval:all
```

Optional authoring fields become missing; whole authoring paragraphs are excluded
before evidence creation, preserving line positions. The linter warns about
excluded source notes and missing freshness metadata, and fails if authoring
placeholders reach any indexed evidence or chunk. Missing grades stay missing.

## Configuration

Configuration is validated in `src/lib/config.ts`; see `.env.example` for the
complete list.

- `EMBEDDING_PROVIDER=none|google|voyage|openai`
- `VECTOR_STORE=memory|pinecone|supabase`
- `LLM_VERIFIER_PROVIDER=google|anthropic|openai|azure`
- `LLM_VERIFIER_MODEL` (an Azure deployment name when the provider is `azure`)
- `LLM_INTERPRETER_ENABLED=true|false`; enabled recovery reuses the verifier
  role unless `LLM_INTERPRETER_PROVIDER` and `LLM_INTERPRETER_MODEL` override it
- `LLM_RENDERER_PROVIDER` / `LLM_RENDERER_MODEL` enable checked natural wording
  when both are configured with credentials; `LLM_RENDERER_ENABLED=false`
  keeps deterministic wording
- `EVIDENCE_PIPELINE_V2=true`
- `CLAIM_VERIFICATION=true` (`false` is fail-closed to exact facts)
- `RERANKER=none` by default; a non-none adapter must be explicitly injected
- `OBSERVABILITY_ENABLED=false` by default

Production requires explicit `LLM_VERIFIER_PROVIDER`, `LLM_VERIFIER_MODEL`, valid
credentials, and enabled verification. `src/instrumentation.ts` validates before
the server accepts requests; configuration validation also runs during build.
Development alone may use defaults. Select models using `npm run eval:models -- --allow-paid
provider:model:inputPricePerMillion:outputPricePerMillion[:cachedInputPricePerMillion]`.
This is an explicit paid evaluation, separate from the credential-free gates.
The completed implementation audit and measured model selection are recorded in
[`docs/implementation-status.md`](docs/implementation-status.md).

Answer quality takes priority over minimizing API calls. Exact facts and
simple conversational actions stay deterministic. Narrative questions reach
the configured LLM verifier, and approved claims receive checked natural
wording when the renderer is enabled.

Query understanding uses progressive compute. Reference resolution produces one
typed proposition with its domain, interaction, target, material qualifiers,
and response shape. Exact facts, retrieval, visuals, and diagnostics reuse that
contract instead of reinterpreting the raw sentence. Only uncertain requests
use the structured semantic interpreter, which receives the resolved question
and a compact ontology of allowed intents, channels, projects, institutions,
and skills. A high-confidence external result returns a local scope response;
accepted portfolio interpretations enter the normal factual paths. Interpretation
can recover meaning, but it never establishes that meaning as true.

Retrieval discovers `candidateK=10` candidates, but low scores or missing keyword
matches cannot decide whether a question is answerable. The current small corpus
fits as complete indexed parent records within `verificationK=20` and 36,000
text characters. This gives semantic assessment access to evidence that lexical
retrieval misses. If the corpus exceeds either budget, the context selector
uses ranked, deduplicated excerpts within both limits. Raw conversation history
never becomes evidence. Recall@10 remains a separate discovery metric.

Token overlap no longer approves narrative claims, and unfamiliar vocabulary
does not establish an evidence gap. The verifier interprets the question against
the supplied records, preserves qualifiers, and rejects unsupported claims.

The complex verifier is wrapped by a process-local LRU cache (24-hour TTL, 1000
entries). Configure `VERIFICATION_CACHE_ENABLED`, `VERIFICATION_CACHE_TTL_MS`, and
`VERIFICATION_CACHE_MAX_ENTRIES`. Keys hash the normalized resolved question,
corpus digest, provider/model, prompt/policy versions, actual selected evidence,
question kind, retrieval version, and Azure resource/API version when applicable.
Every hit passes local schema and evidence validation again. No provider errors,
invalid responses, or conversation histories enter this verification cache.
Cold starts lose this optimization; correctness does not depend on cache state.

The presentation stage classifies an approved plan as `direct-safe`, `naturalize`,
or `synthesize`. Natural exact facts use their canonical approved wording and
skip the renderer and reviewer. The optional natural-answer layer handles the
other two modes: it rewrites only the approved factual plan, then makes a
separate equivalence-review call before displaying the wording.
It preserves claim/evidence IDs, exact numbers and links, and qualified
inferences. Citations bind to the displayed claims. Rejected, failed or timed-out
rewrites fall back to the original verified wording. Model review reduces risk;
it is not a mathematical guarantee of semantic equivalence.

A formatting or equivalence rejection falls back immediately to the approved
wording. Interactive traffic does not make a second rewrite/review attempt.
Provider failures behave the same way, and rejected drafts never enter the cache.

The approved plan and fallback wording are conversational too: contribution
questions explain where Gaurav could help, using current focus areas and relevant
project examples. Skill, profile and project answers state the answer directly
without "canonical profile" or "recorded metadata" framing. Unknown domains
still require their own support assessment. Negation checks use fact metadata
so changing prose cannot disable a contradiction check.

Checked wording is cached by the entire approved plan, evidence, index digest,
model identities and policy versions. Different questions and visitors can
reuse it when those inputs match; similarity alone never authorizes a hit.
Raw visitor questions and conversation history are not direct cache inputs.
`ANSWER_CACHE_ENABLED`, `ANSWER_CACHE_TTL_MS` (24 hours), and
`ANSWER_CACHE_MAX_ENTRIES` (1000 local entries) control reuse. Vercel uses the
regional Runtime Cache across instances; other environments use process memory.
Simultaneous matching requests in one process share a generation. Cache failures
do not prevent answering. Vercel's platform controls regional storage limits.

For the configured OpenAI GPT-5.6 family, writing uses no reasoning, equivalence
review uses low effort for single facts and medium for inferences or multiple
claims, and complex evidence verification uses medium effort.
Stable prompt prefixes also enable provider-side prompt caching where supported;
those token savings depend on provider eligibility. A cold naturalized or
synthesized answer uses two extra calls; a direct-safe answer or wording-cache
hit skips both. Other providers keep their existing model-specific generation
settings.

Independent clauses run with concurrency 2, share a limit of 3 paid calls per
turn, and retain input order. Ambiguous pronouns keep clauses sequential. SDK
retries are disabled; verification calls have a 20-second timeout. The writer
and review share `LLM_RENDERER_TIMEOUT_MS` (20 seconds), bounded by
`LLM_RENDERER_MAX_OUTPUT_TOKENS` (1600) per call. The streamed route has an
85-second request deadline within its 90-second function limit. Verification
budget exhaustion is an operational error.

`npm run bench` remains deterministic and credential-free. The explicitly paid
`npm run bench:live -- --allow-paid` benchmark warms provider paths, disables
application caches, and reports per-class min/p50/p95/max latency, stage timing,
model calls, tokens, cache observations, routes, and support outcomes. Pass
`--samples=N` to change its default of three measured requests per class.

Changing embedding provider, model, dimensions, normalization, transform, or
indexable-text version changes the fingerprint and requires re-ingestion. The
runtime never compares mismatched vector dimensions and never silently queries
another corpus's remote vectors.

## Failure behavior

Semantic-provider failure may reduce recall by leaving lexical candidates only.
It never lowers support requirements. Stale sources, schema errors, embedding
fingerprint mismatches, and vector dimension mismatches stop verified answering
with typed errors. A disabled claim verifier leaves deterministic exact facts
available and abstains from narrative claims.

## Tests and evaluations

The verification runner selects checks from staged, unstaged and untracked
changes. Preview the selection before running it, or provide the current task's
files when the workspace contains unrelated work:

```bash
npm run verify:plan
npm run verify -- --files src/components/chat/message.tsx
npm run verify -- --base HEAD~1
npm run verify -- --release
```

Documentation alone needs no automated checks. UI changes run typechecking,
architecture lint and browser fixtures; application logic also runs tests,
index verification, benchmarks and offline evaluations. `--release` runs every
offline gate, browser fixtures and the production build regardless of changed
files. The runner stops at the first failed check.

`npm run test:ui` (also `test:e2e`) uses local response fixtures. Its browser
guard blocks unmocked API requests and external origins; service workers are
disabled. `npm run test:verification` checks the runner's selection, argument
validation and execution guards.

The browser runner starts a local server on port 3100. If this checkout already
has a dev server, reuse its advertised origin, for example
`PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:ui`. Using an alternate
hostname can trigger Next.js development-origin checks and prevent scripts
from loading.

Live checks use a separate command and require explicit paid opt-in:

```bash
npm run test:live -- --allow-paid
npm run eval:natural -- --allow-paid
```

`eval:models`, `ask` and `smoke:azure` also require `--allow-paid`.
Routine verification never selects these commands. Add the flag only when
the task calls for spending model API credits.

Use the authored comprehension cases to evaluate the real model and final
visitor-facing wording:

```bash
node scripts/verification/paid.mjs understanding --allow-paid
npm run eval:natural -- --allow-paid --understanding
```

Optional case IDs select a subset. The offline abstaining verifier checks that
semantic questions reach assessment; it does not measure comprehension. Live
goldens in `evals/understanding/` retain the supported-answer expectations for
questions such as AI work and work philosophy.

Individual gates remain available:

```bash
npm run typecheck
npm test
npm run test:property
npm run lint:knowledge
npm run verify:index
npm run bench
npm run eval:all
npm run build
```

The curated datasets under `evals/dataset/` cover exact facts, unknowns, false
premises, negation, multi-clause questions, follow-ups, history poisoning,
inference, contradictions, stale data, and embedding incompatibility. Retrieval
reports Recall@10, MRR, and NDCG; support, answer, citation, and conversation
suites enforce the critical zero-error gates.

Promptfoo is an optional external regression/red-team layer under
`evals/promptfoo/`. Run it in a separate Node 24 CI job; it is not a production
dependency.

`npm run eval:natural` is an explicit paid evaluation of the complete natural
answer flow, with actual displayed-citation checks and cross-question cache
reuse. Optional case IDs narrow the run. Offline `eval:all` and `bench` disable
the writer so enabling it locally does not turn routine gates into paid calls.

## Providers and stores

Model, embedding, and vector providers remain behind small interfaces. The
memory store is appropriate for this small corpus. Pinecone namespaces and
Supabase rows are scoped by the active `indexId`; ingestion never clears an
unrelated corpus globally.

Public OpenAI and Azure OpenAI are distinct provider choices. `openai` uses
`OPENAI_API_KEY` and the public OpenAI endpoint. `azure` uses
`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME`, and an explicit Azure
deployment name in `LLM_VERIFIER_MODEL`; it never falls through to the public
OpenAI client. The local evaluated verifier is OpenAI `gpt-5.6-luna`;
Azure remains supported with an explicitly configured, evaluated deployment. Keep
`EMBEDDING_PROVIDER=none` unless retrieval evaluation warrants changing it.

`LLM_MODEL` is no longer inherited by either role. Use role-specific model
variables so changing an inactive renderer cannot leave the verifier on an old
deployment by accident. `LLM_PROVIDER` remains a compatibility default for the
verifier; explicit `LLM_VERIFIER_PROVIDER` is preferred.

To evaluate Luna using the OpenAI key saved in `.env.local`, without an exported
terminal key overriding it, run:

```bash
env -u OPENAI_API_KEY npm run eval:models -- --allow-paid openai:gpt-5.6-luna:0.20:1.20:0.02
```

The verifier's structured-output schema requires every field, including a
nullable `reason`, as required by OpenAI strict mode. Internally, a null reason
is normalized to an absent optional reason; evidence validation is unchanged.

Rerankers refine candidate order only. They do not establish factual support,
and no external reranker should be enabled until held-out retrieval evaluation
shows a worthwhile gain.

## Operations and privacy

The request pipeline emits stable OpenTelemetry span names for resolution,
retrieval, reranking, verification, planning, rendering, and citations.
Telemetry is optional. Raw prompts and outputs are not recorded by default;
traces use request IDs, hashes, counts, versions, provider/model identifiers,
the embedding fingerprint, index digest, latency, and fallback reasons.

## Deployment

`data/.index/index.json` is generated and committed so production does not
re-embed at runtime. CI must lint knowledge and verify the index before build.
Set provider credentials only for the roles enabled in the deployment. The app
does not require LangChain, LlamaIndex, a production agent framework, or an MCP
service.

For Vercel, set the verifier provider, model, and corresponding credential in
Project Settings → Environment Variables (or
install the Vercel CLI with `npm i -g vercel`, then use `vercel env` commands)
and scope them to the intended production/preview environments. Pull local
values into the ignored `.env.local`; never commit a key.

If using Azure, after configuring the resource and its evaluated deployment, run:

```bash
npm run smoke:azure -- --allow-paid
```

The smoke check first exercises a minimal Azure structured-output request, then
runs the exact landing prompt and requires a supported answer with profile and
experience citations. It prints only the provider and deployment identifier,
never credentials or evidence payloads.
