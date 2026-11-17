# Evidence pipeline implementation status — 2026-09-07

## Follow-up: answer quality before API savings — 2026-09-08

The user explicitly prioritized precise, satisfying answers over minimizing
API cost and authorized paid evaluation. This preference is recorded in
AGENTS.md. Exact facts and simple conversational actions retain their direct
paths; narrative understanding now uses the configured verifier instead of
sentence overlap, vocabulary-absence checks or late retrieval-score vetoes.

The current 16 indexed parent records fit within 20 evidence records and 24,000
text characters, so the verifier can inspect authored context even when lexical
retrieval finds no matches. Larger corpora fall back to ranked excerpts within
both limits. Project visuals follow the evidence supplying approved claims.
The corpus, credentials and provider/model selection were not changed.

Live evaluation confirmed that "Could he automate irrigation?" and "Could
Gaurav handle crop watering?" can receive qualified assessments from Smart Farm
evidence. "What user problem does Smart Farm solve?" is no longer blocked by a
blanket metric-risk keyword rule. Specific watering implementations remain
unestablished; the answer distinguishes relevant experience from direct proof.

The writer gets one correction attempt after formatting or equivalence
rejection, using the original approved claims and rejected draft under the same
deadline. Both attempts require validation and independent equivalence review;
provider errors still fall back immediately. Inference labels are enforced from
structured claim metadata without changing the proposition or evidence IDs.
Verifier instructions also distinguish true project ambiguity from a question
whose remembered details identify one project.

Offline AI-work and philosophy cases now test routing through the abstaining
fixture; supported-answer goldens remain in the paid understanding suite. The
philosophy retrieval golden was retained separately, preserving all 55 retrieval
cases and their baseline. `eval:natural -- --allow-paid --understanding` checks
these live goldens through verification, writing, review and displayed citations.

Offline validation: 205 tests, seven workflow tests, 41 routing cases, five
capability cases, 89 answer cases, remaining offline evaluations, architecture
lint, typecheck, index verification and production build passed. All 11 browser
fixtures passed using the existing localhost:3000 server; the initial release
command could not start a second Next.js dev server. Knowledge lint retains 11
existing authoring/freshness warnings. Retrieval remains Recall@10 1.000,
MRR 0.330 and NDCG@10 0.491. No deployment was performed.

Final paid complete-flow validation passed all 16 comprehension cases using
OpenAI `gpt-5.6-luna`: 15 used accepted natural wording, one retained its approved
source wording after formatting rejection, and no request failed. The suite
checked support, required facts, visual expectations, displayed citations and
cross-question wording-cache reuse. It made 16 evidence-verifier calls, 16
writer calls and 14 review calls across the measured turns. Median verifier
latency was 3.28 seconds and median rendering latency was 3.00 seconds. These
are curated fixture measurements, not a guarantee for arbitrary questions.

Nine additional live negative cases retained honest evidence gaps for invented
employment, user counts, credentials, salary and unrelated capabilities. A
tenth injection case produced a correct denial that the old substring-based
golden rejected; its live golden now accepts an evidence-linked contradiction
or honest abstention and passed in the final comprehension run. Policy versions:
pipeline `evidence-v2.9`, verifier `support-v2.9`, verifier prompt
`verifier-system-v2.7`, writer prompt `natural-voice-v3.5`.

## Follow-up: assistant identity resolution — 2026-09-08

Resumed the unfinished identity-routing fix from the latest session, after its
retrieval Checkpoints 0 and 1 had completed. Bare "who is this" and straight or
curly-apostrophe contractions now select the existing local identity response.
The reference resolver recognizes assistant identity before interpreting
"this" as a project pronoun, including after an active project discussion.
The same precedence fixes existing identity phrases such as "Is this a bot?".
The new phrase match is anchored: "Who is this project for?" still resolves to
the active project and requires support assessment. Resolver version is now
`project-reference-v2.3`.

Regression tests reproduced nine failures before the fix. Validation after the
fix: all 197 tests, seven verification-workflow tests, 37 routing benchmarks,
five capability-filtering benchmarks, all offline evaluations (89 answer
cases), typecheck, architecture lint, index verification and production build
passed. Retrieval ranking remains at Recall@10 1.000, MRR 0.330 and NDCG@10
0.491 across 55 cases. No paid checks or deployment were performed. Existing
workspace changes were preserved; this fix remains uncommitted.

## Follow-up: verification workflow — 2026-09-08

Resumed the unfinished change-aware verification runner and fixture browser
suite. Added seven regression tests covering scope selection, complete release
gates, argument validation, paid-command opt-in and local browser request
restrictions. Application-logic checks now include index verification;
`--release` runs the complete offline gate set plus browser fixtures and build.
README and agent instructions describe scoped runs and separate live checks.

Every fixture browser test now checks console and page errors. Browser testing
found that the workspace's redundant `100dvh` height pushed the composer out of
view at 200% mobile CSS zoom; fixed insets now size the workspace by themselves.
All nine fixture browser tests passed on desktop/mobile with no console errors,
using the existing development server's advertised `http://localhost:3000`
origin. Its alternate `127.0.0.1` origin rejected JavaScript assets with 403.

Validation: seven workflow tests, nine browser tests, typecheck, architecture
lint, index verification and production build passed. No evidence or RAG
behavior changed. No paid evaluations or deployment were performed; the full
offline evaluation and application unit suites were not rerun for this scoped
tooling/layout change. Existing unrelated workspace edits remain uncommitted.

The requested implementation is complete locally. No deployment or remote
environment change was performed. The source of truth remains authored
portfolio evidence. The original support assessments remain intact; checked
LLM paraphrases can replace their displayed wording.

## Follow-up: natural answers and shared caching — 2026-09-07

### Follow-up: contribution-first wording

The user reported that the technical-contribution prompt still returned
"canonical profile records skills". This phrase came from the approved
fact-store claim, so the writer could only paraphrase category names. Broad
contribution questions now build a qualified contribution assessment from
profile focus areas, skills and relevant project summaries. The response leads
with "Gaurav could contribute in..." and then concrete examples. Closely worded
team questions share that path; unknown target domains do not.

Common exact-fact and missing-information fallbacks now use direct conversational
wording. Negation handling uses typed lookup metadata instead of matching prose.
The writer rejects administrative phrasing and permits qualified contribution
sentences that lead with Gaurav while retaining their evidence basis. Pipeline
version `evidence-v2.7` and renderer prompt `natural-voice-v3.4` invalidate earlier
answer-cache entries. The local browser displayed the corrected contribution
answer with citations and the matching three-project atlas, without console errors.
Validation: 143 tests, 81 offline answer cases, 24 routing benchmarks, index
verification, architecture lint, typecheck and production build passed. All 10
targeted paid cases used accepted natural wording, with two cross-question
contribution-cache hits and no fallbacks.

The interrupted implementation was resumed and the renderer enabled in the
ignored local environment using the existing verifier provider/model. The
writer receives approved claims, not raw questions or conversation history.
Its output needs ordered claim IDs, unchanged exact values and proficiency
labels, explicit inference qualifications, and a separate equivalence review.
Failures use the original verified wording; citations bind to displayed claims.
Model equivalence review is a risk reduction measure, not a proof.

Wording reuse keys include the entire approved plan, evidence IDs, corpus digest,
model identities and policy versions. Equivalent questions can share checked
wording across visitors. Vercel uses regional Runtime Cache; local execution
uses a bounded LRU. Both expire after 24 hours by default. Simultaneous requests
share work within a process, with independent visitor cancellation. Invalid
entries, model failures and timeouts cannot populate the cache.

The OpenAI writer uses no reasoning; review uses low effort for a single fact
and medium effort for multiple claims or inferences. Complex evidence checking
retains medium effort. Live testing caught project work rewritten as employment
and a lost proficiency label; the prompt and deterministic checks now guard
those cases. Renderer prompt version: `natural-voice-v3.3`.

The paid `eval:natural` uses configured models (renderer defaults to the
configured verifier for this evaluation), accepts case IDs and an optional
`--inspect-rewrites` for public fixture diagnostics, checks actual displayed
citations, and requires a cache hit without model calls for equivalent role
questions. Offline evals and routing benchmarks explicitly disable paid wording.

Final validation with `natural-voice-v3.3`: all 78 live cases passed, including
75 factual answers with accepted natural wording, zero renderer fallbacks,
41 wording-cache hits, and equivalent role questions served without model
calls. The run made 34 writer calls, 34 review calls and 6 evidence-verifier
calls, with 2205 provider-cached input tokens reported. These are curated
fixture results, not a guarantee for arbitrary future questions. No cost
estimate is reported without configured pricing.

All 129 tests, typecheck, architecture lint, knowledge lint, index verification,
offline `eval:all`, 21/21 routing benchmarks and the production build passed.
Knowledge lint retains 11 existing warnings about excluded authoring notes and
missing freshness timestamps. No knowledge source or index was changed.

The hosted cache adapter is implemented but has not been exercised in a deployed
Vercel environment. Hosting variables and deployment remain unchanged.

## Follow-up: OpenAI Luna activation — 2026-09-07

The local verifier now uses `openai/gpt-5.6-luna`, selected explicitly by the
user after the Google comparison recorded below. Hosting variables have not
been changed.

The first Luna request failed with HTTP 400 `invalid_json_schema`: OpenAI strict
structured outputs rejected the optional `reason` property. The wire schema now
requires `reason` with a string-or-null value, normalized to the existing
optional internal field. Evidence and citation checks are unchanged. The
verifier version is `support-v2.6` so older cached assessments are ineligible.

The project key passed the model-access check. The live evaluation explicitly
removed the inherited `OPENAI_API_KEY` so `.env.local` supplied the credential.
Luna then passed 87/87 cases and all 86 assessed clauses, with no failures,
15 model calls, 9 cache hits, median model latency 2185 ms, and p95 3588 ms.
Estimated cost was $0.00511 per 100 benchmark questions at $0.20/M input and
$1.20/M output; this small curated benchmark does not predict all production
traffic. Targeted verifier/integration tests (22), typecheck, index
verification, and the production build passed.

```bash
env -u OPENAI_API_KEY npm run eval:models -- openai:gpt-5.6-luna:0.20:1.20:0.02
```

## Where the previous session stopped

The app is a separate Git repository at
`Documents/projects/small-scale-ai/digital-counterpart`, initially clean at
`9826fe3`. Most implementation phases were already present, including all four
priority engineering changes. The remaining work was production configuration,
enforcing all evaluation gates, live model selection, and fixing issues exposed
by those evaluations and browser checks. The parent directory's Graphify map
describes older architecture; current source/tests are authoritative.

## Plan coverage

| Phases | Implemented behavior |
| --- | --- |
| 0, 19–21 | Saved baseline, existing unit/property/integration/browser suites, retrieval/support/answer/citation/conversation/operational evaluations, paid model comparison |
| 1 | Recursive placeholder checks, whole invalid propositions omitted, optional authoring fields become missing, index/lint invariant |
| 2 | Retrieve 10 candidates; rerank, deduplicate and diversify; select at most 5 narrative verifier records; Recall@10 remains unchanged |
| 3–5 | Exact facts and extractive support first; structured verifier only for unresolved judgments; schema, evidence IDs and inference labels validated; explicit production configuration required |
| 6, 8–10 | Process-local LRU/TTL cache of validated judgments; SHA-256 keys include resolved question, index, provider/model, versions and selected evidence; revalidate hits; no failed calls/history/final-text caching |
| 11–14 | Independent clauses use concurrency 2 and a shared 3-call budget; 5 evidence items/call; token, latency, cache and error metrics; development-only diagnostics |
| 15–18 | Lifecycle streaming; source summary with optional technical provenance; three discovery prompts and persistent contact; public infrastructure errors distinct from insufficient evidence |
| 7 (optional) | Retrieval cache intentionally deferred: local BM25 is inexpensive; verification caching delivers the paid-call savings |

Canonical exact facts and structured inferences can consult the full local fact
store; they never send that store to a model. No agent framework, vector
database, paid response generator, or required personal information was added.

## Changes made during the resumed session

- Citation gates now check the exact claim/evidence pair and require complete
  coverage. Arbitrary `runtime:` IDs are no longer accepted. A source-level
  expectation accepts an indexed child excerpt only through known provenance.
- Answer and live-model gates enforce clause completeness, inference labels,
  required evidence, routing, resolved questions and visual expectations.
  Unexecuted provider evaluations report `support: null`, not perfect scores.
- Corrected the salary dataset to require a verified insufficient-evidence
  assessment. No salary or other missing facts were added.
- Work-philosophy questions now bypass generic project metadata and extract
  from authored opinion records, using their headings as context. Regression
  coverage confirms citations and zero paid calls while project discovery
  continues working.
- Strengthened the verifier policy: student status or adjacent experience
  does not contradict senior competence; undocumented seniority is insufficient.
  Added a direct verifier regression case and bumped prompt/policy versions.
- Fixed reduced-motion hydration using the installed Next.js guidance: server
  and first browser render are static, then apply the client preference.
- Explicitly configured Google `gemini-3.5-flash-lite` in ignored `.env.local`,
  with claim verification and the evidence pipeline enabled. Existing secrets
  were preserved. `.env.example` is now exempted from the broad Git ignore rule
  so fresh checkouts can retain the documented setup template.

## Final verification

- Typecheck, architecture lint and production build: pass.
- Unit/property/integration tests: 110 passed across 24 files.
- Browser suite: 11/11 passed, including desktop/mobile, source disclosure,
  contact, failures, reduced motion, zoom and browser-console checks.
- Knowledge lint: passes with 11 warnings about excluded source authoring notes
  and absent freshness timestamps. Missing values remain missing.
- Index: 59 evidence records, 43 chunks, corpus `60e5820bcad2`; no authoring
  markers in indexed evidence. No source/index data was changed this session.
- Offline answers: 78/78; routing benchmarks: 21/21.
- Offline support precision/recall, contradiction/status accuracy, citation
  precision/coverage and conversation resolution: 1.000; false support,
  false abstention, invalid citation IDs and history bypasses: zero.
- Retrieval: Recall@10 1.000, MRR 0.667, NDCG@10 0.752 across five cases.
  Ranking values match the resumed baseline; their earlier decline from
  0.767/0.826 predates this session. Retrieval/index code was not changed.

## Live verifier selection

The final comparison used the same nine direct verifier cases and 78 portfolio
cases for each candidate. Direct successful judgments were replayed through
the cache. Prices were checked against the current model catalogue and entered
explicitly in the evaluation command; no search or other paid tools were used
by the verifiers.

| Candidate | Outcome |
| --- | --- |
| Google Gemini 2.5 Flash-Lite | Provider unavailable on first request; not eligible |
| OpenAI GPT-4.1 Mini | Provider unavailable on first request; not eligible |
| Google Gemini 3.1 Flash-Lite | Completed 87 cases; repeatedly returned partially-supported for a supported multi-source proposition; not eligible |
| Google Gemini 3.5 Flash-Lite | Passed 87/87, 86 assessed clauses, every status/citation/conversation gate; selected |

Final selected-model measurements:

- 15 paid calls across 87 cases; 9 verification-cache hits, 37.5% hit rate.
- 79.31% deterministic requests; 17.24% requests used the verifier; remaining
  requests were local responses. Direct verifier fixtures are included here.
- Median model latency 903 ms; p95 1157 ms.
- Mean input/output tokens per model call: 695.27 / 57.33.
- Estimated cost per 100 benchmark questions: **$0.00607**, using $0.30/M input
  and $2.50/M output. No provider cached-input tokens were reported.

These are measurements on a small curated corpus, not a guarantee about unseen
questions or production traffic. Provider failures have unknown usage and are
excluded from model eligibility. Repeat evaluation when evidence, model or
verification policy changes.

The final comparison command was:

```bash
npm run eval:models -- google:gemini-3.1-flash-lite:0.25:1.50:0.025 google:gemini-3.5-flash-lite:0.30:2.50:0.03
```

For deployment after the Luna follow-up above, set `LLM_VERIFIER_PROVIDER=openai`,
`LLM_VERIFIER_MODEL=gpt-5.6-luna`, the project's `OPENAI_API_KEY`,
`CLAIM_VERIFICATION=true` and `EVIDENCE_PIPELINE_V2=true` in the hosting
environment. Local `.env.local` changes do not configure Vercel. The Vercel CLI
is not installed; `npm i -g vercel` enables environment pulls, deployment and
log inspection when deployment work is requested.
