# Incident report: background prompt returns a false knowledge gap

**Date investigated:** 2026-09-04  
**Product:** Digital Counterpart / GauravGPT  
**Incident prompt:** `Give me the 30-second version of Gaurav's background.`  
**Observed answer:** `I couldn't find support for that in Gaurav's current records.`  
**Severity:** High for product credibility; medium for system availability  
**Status:** Code fix implemented locally; Azure deployment smoke test pending

## Executive summary

The chatbot is not failing because Gaurav's background is absent, because retrieval cannot find it, or because the knowledge index is stale. The records are present, the index passes validation, and the exact prompt retrieves the canonical profile biography as its first result.

The triggering provider request used the configured Google verifier and was rejected before a support assessment completed. The live diagnostic returned:

> This model `models/gemini-2.5-flash-lite` is no longer available to new users. Please update your code to use `models/gemini-3.5-flash-lite`.

The application then mishandles that provider failure. `DefaultEvidenceVerifier` catches every model-verifier exception and converts it into the factual status `insufficient` (`src/lib/evidence/verifier.ts:193-205`). The answer planner maps `insufficient` to “I couldn't find support...” (`src/lib/llm/answer-plan.ts:33-40`). Consequently, an infrastructure/configuration error is presented to the visitor as if the records lacked evidence.

There is also a deterministic-routing weakness: the bundled prompt begins with “Give me,” but the question classifier does not recognize this as a descriptive request (`src/lib/evidence/question.ts:21-30`). It labels the question `unknown`, preventing the normal extractive path and making this first-party landing-page prompt depend entirely on the external verifier.

A different Google model was tested during diagnosis and produced a supported answer, which confirmed that the records and retrieval path were sound. That test was diagnostic evidence, not the remediation: substituting another provider-specific default would leave the failure-semantics and first-party-prompt defects intact.

## What should have happened

The prompt is authored by the product itself in `counterpart.config.ts:30-36`, under the `experience` topic. The intended flow is:

1. Recognize the question as an experience/background request.
2. Retrieve profile and experience evidence.
3. Verify a concise set of claims against that evidence.
4. Return the short summary with citations and an experience visual.

The required source material exists:

- `data/profile.json:3-30` contains Gaurav's name, title, tagline, age, headline, location, biography, focus areas, and robotics background.
- `data/experience.md:16-31` describes his self-directed experience and approach to building and shipping products.
- The generated index contains 62 evidence records and 46 retrieval chunks.

## Reproduction and diagnostic results

### 1. Index integrity

Command:

```text
npm run verify:index
```

Result:

```text
Index V2 verified: 62 evidence records, 46 chunks, corpus ae17a86aae1b.
```

Conclusion: this is not a stale, corrupt, or missing index.

### 2. Retrieval using the exact incident prompt

The diagnostic retriever ran in the application's configured lexical mode: 46 chunks, BM25 retrieval, embedding provider `none`, memory store.

Top results:

| Rank | Score | Source | Relevant content |
|---:|---:|---|---|
| 1 | 1.000 | `data/profile.json` | Biography, applied-AI focus, robotics, age, Linz location, availability |
| 2 | 1.000 | `data/experience.md` | Self-directed experience and projects |
| 3 | 1.000 | `data/projects/gauravgpt.md` | Earlier chatbot project |
| 4 | 0.991 | `data/philosophy.md` | Shipping and product-development approach |

Lexical query coverage was 0.25. That number is not proof of support, but the candidates clearly contain enough evidence for a background summary. Conclusion: candidate discovery works.

### 3. Exact end-to-end reproduction with the current default

The pipeline returned:

```json
{
  "text": "I couldn't find support for that in Gaurav's current records.",
  "support": "insufficient",
  "detail": "0/1 clause supported",
  "reason": "Complex verification unavailable: AI_RetryError"
}
```

A direct inspection of the retry failure showed three failed attempts. In the sandbox they failed on DNS, demonstrating the same error-collapsing behavior for a network outage. A controlled live request reached Google and revealed the decisive production/configuration error: the configured model is unavailable to this API user.

### 4. Diagnostic validation with another model

The same pipeline was run with a one-process environment override:

```text
LLM_VERIFIER_MODEL=gemini-3.5-flash-lite
```

Result:

- support status: `supported`
- supported clauses: `1/1`
- five evidence-linked claims
- citations from `profile.json`, `experience.md`, `faq.md`, and project records
- experience visual and two follow-up prompts

The answer began:

> Gaurav Adhikari is 21 years old and based in Linz, Austria. He is an AI enthusiast focused on applied AI, machine learning, data science, and building interactive web applications.

Conclusion: a successful verifier call restored the intended behavior without changing the knowledge base or retrieval index. This isolated the incident but did not constitute a durable fix.

## Root-cause chain

```text
Product-authored background prompt
    -> classified as `unknown`
    -> profile and experience evidence retrieved successfully
    -> deterministic extractive verifier is skipped
    -> external verifier uses default `gemini-2.5-flash-lite`
    -> Google rejects the model for this API user
    -> verifier catches the provider exception
    -> exception is converted to factual status `insufficient`
    -> planner emits generic “couldn't find support” copy
    -> route returns a normal completed answer with no citations or visual
```

## Findings

### F1 — Configured verifier deployment unavailable

**Severity:** Critical for narrative answers  
**Confidence:** Confirmed

The live request established only that the configured Google model was unavailable to that API user. Treating the provider's suggested replacement as the fix would be too narrow: authentication, DNS, quota, deployment, and future lifecycle failures would still be translated into false evidence gaps. The durable configuration change is an explicit Azure provider with an explicit GPT-5.4 deployment name, while the durable semantic fix is to preserve provider failures as failures.

**Impact:** Any question that cannot be answered by exact-fact or deterministic extractive logic can falsely abstain. This is broader than the single background prompt.

### F2 — Provider failures are falsely reported as missing evidence

**Severity:** High  
**Confidence:** Confirmed

`src/lib/evidence/verifier.ts:193-205` catches all errors from the complex verifier and returns `status: "insufficient"`. This collapses several fundamentally different conditions into one factual verdict:

- model unavailable or retired;
- DNS/network outage;
- quota/rate-limit failure;
- invalid credentials;
- provider schema incompatibility;
- verifier response validation failure;
- genuine lack of supporting evidence.

After this conversion, `src/lib/llm/answer-plan.ts:33-40` has no failure information left and produces the observed sentence. Because the exception no longer reaches `src/app/api/chat/route.ts:153-161`, the route's error handling cannot return an appropriate retryable/503 response. The UI marks the turn as `done` with `support: insufficient` (`src/app/api/chat/route.ts:145-152`).

**Why this is harmful:** The response is safe from hallucination, but epistemically incorrect. “The verifier was unavailable” does not mean “the records do not support the answer.” It also sends maintainers debugging the knowledge base even though the provider is broken.

### F3 — The product's own prompt is classified as `unknown`

**Severity:** High as a resilience defect  
**Confidence:** Confirmed

The prompt is a first-party landing-page prompt in `counterpart.config.ts:34`. `decomposeQuestion()` recognizes phrases such as “describe,” “tell me,” and “explain” as descriptive, but not “give me” or explicit summary language (`src/lib/evidence/question.ts:21-30`). The exact prompt is therefore classified as:

```json
{
  "text": "Give me the 30-second version of Gaurav's background.",
  "kind": "unknown"
}
```

`DefaultEvidenceVerifier` only attempts direct sentence extraction for descriptive or opinion questions (`src/lib/evidence/verifier.ts:164-168` plus `directlyExtractive()`), so this classification forces the external model path.

Merely adding “give me” to the regex may not be sufficient: the extractive verifier also requires at least two original-question token overlaps with a candidate sentence. A robust fix should give canonical profile/background summaries a dedicated deterministic synthesis path rather than rely on a single sentence and surface-form token overlap.

### F4 — The configured prompt is absent from release gates

**Severity:** High  
**Confidence:** Confirmed

The exact landing-page prompt does not appear in `scripts/bench.ts` or any `evals/dataset/*.jsonl` case. The benchmark includes exact facts, projects, capability questions, unknowns, and scope routing, but not the background prompt that the UI actively encourages visitors to click (`scripts/bench.ts:7-20`).

This allowed two regressions to coexist undetected:

1. the bundled prompt's `unknown` classification;
2. the configured verifier model becoming unavailable.

Provider-independent unit tests alone cannot detect a retired remote model. A release gate needs both a deterministic contract test for the prompt and a small live-provider smoke check when deploying with an external verifier.

### F5 — Legacy model override behavior contradicts the documentation

**Severity:** Medium  
**Confidence:** Confirmed

`.env.example:20-25` says the verifier and renderer roles inherit the legacy `LLM_PROVIDER/LLM_MODEL` values unless explicitly overridden. The implementation does inherit `LLM_PROVIDER`, but `modelRole()` applies `LLM_MODEL` only when `role === "RENDERER"` (`src/lib/config.ts:143-160`). The verifier ignores `LLM_MODEL` and falls back to `DEFAULT_MODELS[provider]` unless `LLM_VERIFIER_MODEL` is explicitly set.

This means a maintainer could set:

```text
LLM_MODEL=gemini-3.5-flash-lite
```

and reasonably believe the migration is complete, while the actual verifier continues calling `gemini-2.5-flash-lite`. The current voice renderer is deterministic, so the override would affect the less relevant role and leave the failing role unchanged.

## What is not causing this incident

- **Missing profile data:** disproved; the profile contains a detailed biography and structured summary fields.
- **Stale or corrupt index:** disproved; `npm run verify:index` passes.
- **Retrieval miss:** disproved; the profile biography ranks first for the exact prompt.
- **Embedding configuration:** not causal; the app is intentionally in lexical-only mode and retrieval succeeds.
- **Reference resolution/history:** not causal; the standalone prompt resolves unchanged.
- **Renderer hallucination:** not causal; the deterministic renderer copies the planner's approved/uncertainty claims.

## Scope of impact

The visible incident is a high-value landing-page question, so it directly damages the first impression of the portfolio. The affected class is larger:

- narrative summaries phrased in ways the deterministic classifier does not recognize;
- comparisons, nuanced descriptions, and other questions designed for model verification;
- valid questions whose evidence cannot be reduced to one high-overlap sentence;
- all such questions during provider outages, quota exhaustion, credential failures, or future model lifecycle changes.

Exact facts such as age, location, contact, education, and explicitly handled skills can continue working because they use deterministic canonical paths. This creates a confusing partial-outage state: some questions work normally while broad, recruiter-friendly questions falsely claim that no records exist.

## Recommended remediation

### P0 — Establish Azure connectivity

1. Deploy underlying model `gpt-5.4` in the intended Azure OpenAI resource.
2. Set `LLM_VERIFIER_PROVIDER=azure`, the Azure deployment name in `LLM_VERIFIER_MODEL`, and the dedicated `AZURE_OPENAI_*` variables in the deployment environment.
3. Keep `EMBEDDING_PROVIDER=none` for the initial migration; lexical retrieval already succeeds for this incident prompt.
4. Run `npm run smoke:azure`, then send the exact landing prompt to the deployed chat endpoint and confirm a cited `supported` response.

Public OpenAI and Azure OpenAI use separate clients and credential variables. `LLM_MODEL` is no longer inherited; role-specific model variables are required for operational clarity.

### P1 — Stop lying about failure type

1. Preserve provider failures as a distinct typed outcome, such as `verification-unavailable`; do not map them to `insufficient`.
2. Return a retryable service response/message, for example: “The evidence verifier is temporarily unavailable. Gaurav's records were found, but I can't safely compose the answer right now.”
3. Emit the provider, model, error class, retryability, and request ID to observability without logging prompts, evidence contents, or credentials.
4. Keep genuine `insufficient` exclusively for completed support assessments where the evidence does not establish the proposition.

### P1 — Make the flagship background answer deterministic

1. Add a canonical background-summary handler based on structured fields and explicitly selected authored records.
2. Build the summary as several separately cited claims rather than treating a retrieval score as proof.
3. Allow the external verifier to enhance nonessential narrative selection, but do not make the product's own landing prompt unavailable when a provider fails.
4. Preserve the honest distinction between “no professional roles recorded” and “no background recorded.” The existing profile and self-directed experience are valid background evidence.

### P1 — Close the test gap

Add the exact configured prompt to:

- `scripts/bench.ts` with expected status `supported`;
- an evaluation dataset with expected profile/experience evidence IDs, citations, and `experience` visual;
- a unit test asserting it is classified as descriptive or routed to the canonical summary handler;
- a provider-failure test asserting the result is `verification-unavailable`, not `insufficient`;
- a configuration test asserting the documented model override precedence.

Also add a test that iterates over every nonlocal prompt in `counterpartConfig.chat.topics` and `quickPrompts`, preventing authored UI prompts from shipping without answer-contract coverage.

### P2 — Add lifecycle and deployment checks

1. Add a cheap live verifier smoke test to deployment/monitoring using the configured provider and model.
2. Alert separately on provider errors, false abstentions, and genuine unsupported questions.
3. Record the active verifier model in health diagnostics.
4. Review model-lifecycle notices periodically instead of relying on an unversioned default indefinitely.

## Acceptance criteria for the fix

The incident should be considered resolved only when all of the following are true:

- the exact prompt returns `supported` with at least one valid profile/experience citation;
- no external provider is required for the canonical background-summary path, or provider unavailability produces an explicit retryable error rather than an evidence verdict;
- `LLM_MODEL` and role-specific override precedence match the documentation, or the documentation is corrected;
- every product-authored nonlocal prompt has a benchmark/evaluation case;
- `npm run typecheck`, targeted unit tests, `npm run verify:index`, `npm run eval:all`, `npm run bench`, and `npm run build` pass;
- a live deployment smoke test confirms the configured Azure GPT-5.4 deployment accepts structured-output requests.

## Final diagnosis

The observed answer is misleading. Gaurav's background records were found successfully. The chatbot said otherwise because its external verifier was configured to use a model unavailable to the current API user, and the error-handling layer incorrectly translated that provider failure into “insufficient evidence.” The question classifier and missing regression coverage made a product-authored flagship prompt unnecessarily dependent on that fragile path.
