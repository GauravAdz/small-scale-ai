<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Digital Counterpart agent handbook

This is a conversational portfolio, not a general-purpose assistant. Its job is to help a recruiter, engineering lead, or collaborator understand Gaurav quickly and honestly from authored evidence.

## Read before changing code

1. Read `README.md` for the product model and setup.
2. Read `counterpart.config.ts` for behavioral knobs.
3. Read the relevant files in `data/` before changing retrieval, prompts, or visuals.
4. Next.js 16 may differ from remembered APIs. Read the relevant local guide in `node_modules/next/dist/docs/` before changing framework behavior.

## Product principles

- Prioritize precise, useful, conversational answers over minimizing API cost. Use the paid LLM for semantic understanding and synthesis when it improves the answer; do not add local keyword patches merely to avoid model calls. Exact facts and simple conversational actions can remain deterministic. Paid quality evaluations are authorized when requested by the task, as in this session.
- Answer the exact question, then offer evidence. Do not dump the whole portfolio because a question mentions "work" or "skills".
- Treat each reported defect as an instance of a behavior class. Before editing, inspect the shared path and adjacent states, then implement the rule at the narrowest common boundary. Test the reported example, other inputs that should behave the same way, and a nearby input that should remain different. Use a prompt-specific patch only when the behavior itself is prompt-specific, and document the reason.
- Progressive disclosure is the default: conclusion first, the smallest relevant visual second, sources and follow-ups last.
- The verifier decides which evidence-linked claims may be said. The renderer controls wording only and must not add propositions.
- Natural wording requires a separate equivalence review. Cache only checked wording keyed by the complete approved plan, evidence, corpus digest, model identities and policy versions; query similarity alone is insufficient. Bind citations to displayed claims and retain the original assessments. Keep offline evals and routing benchmarks free of writer calls.
- Approved claims and deterministic fallbacks must also use conversational wording. Broad contribution questions lead with a qualified contribution assessment and concrete project examples, not internal skill-group names. Negation handling must use fact metadata, never match presentation strings such as "profile lists".
- Retrieval finds evidence candidates; its scores are never factual proof. Preserve clause-level support states and the honest knowledge-gap path.
- Weak or empty lexical retrieval must not veto semantic assessment. The current small corpus fits as complete indexed parent records within 20 records and 36,000 text characters; larger corpora use bounded ranked excerpts. Narrative support comes from the verifier, never token overlap or vocabulary absence.
- Every visual must earn its space. Filter project and capability views to the named theme, skill, or intent; use the broad view only for genuinely broad questions.
- Never let a fast visual steal the reading order from a streaming answer. Preserve the answer-first reveal contract in `components/chat/message.tsx`.
- Home and conversation are separate views of the same mounted chat session. Returning home must preserve messages, contact drafts, and the conversation scroll position. Keep new turns visible as they grow until the opening reaches the top; stop positioning once reached or when the visitor scrolls. Never reserve blank viewport space after a turn or scroll ancestor containers. Supporting visuals reveal after the answer finishes.
- Motion communicates state and hierarchy. Keep it subtle, interruptible, transform/opacity based where possible, and honor reduced-motion preferences.

## Architecture map

```text
data/profile.json + data/**/*.md
        │
        ├─ scripts/ingest.ts → data/.index/index.json
        │
question
  → conservative surface normalization (`src/lib/chat/query-surface.ts`)
  → neutral reference resolution (`src/lib/chat/resolve-question.ts`)
  → one typed proposition (domain, interaction, target, qualifiers, response shape),
    with bounded semantic recovery only if deterministic interpretation is uncertain
    (`src/lib/chat/query-understanding.ts`)
  → atomic clauses (`src/lib/evidence/question.ts`)
  → exact fact path or candidate retrieval (`src/lib/rag/`)
  → support verification (`src/lib/evidence/verifier.ts`)
  → evidence-linked factual plan (`src/lib/llm/answer-plan.ts`)
  → safe visual + voice renderer (`src/lib/chat/`, `src/lib/llm/renderer.ts`)
  → claim citations + streamed protocol (`src/app/api/chat/route.ts`)
  → answer-first rendering (`src/components/chat/message.tsx`)
```

The server/client contract is `src/types/chat.ts` plus `src/lib/chat/visual-types.ts`. Update both producer and renderer when changing a data part.

## Knowledge and content

- `data/profile.json` is the source of truth for identity, skills, education, links, metrics, and current availability. `data/experience.md` owns role history and its compact visual metadata; project-specific facts stay in their project records.
- `data/projects/*.md` contains project facts and frontmatter that drives cards, matching, citations, and retrieval priority.
- Skill-group aliases map visitor language and project tags to an authored capability. Keep them specific; they guide filtering and never establish proficiency.
- Lines containing `TODO` and template placeholders are excluded from the index. Do not turn them into polished-sounding claims.
- Project tags are functional metadata. Use specific, consistent technology/domain tags because filtering and evidence links depend on them.
- After content changes, run `npm run ingest`, review its placeholder report, and commit the regenerated index when appropriate.

## Chat decision rules

- Add or tune user-language recognition in `intent.ts`; keep rules narrow and pair them with benchmark cases.
- Prefer authored metadata and retrieval evidence over a second LLM classification call for small, factual taxonomies.
- Semantic recovery may infer the proposition a visitor intended to ask, but it is never evidence that the proposition is true. Pass the accepted `UnderstoodQuery` through evidence strategy, visuals and analytics instead of reclassifying raw text.
- Scope/domain is independent from detailed intent. A high-confidence external interpretation terminates locally before retrieval or model verification; `not-recorded`, `insufficient`, ambiguity, and provider failure remain distinct outcomes.
- Exact facts must consume every material typed qualifier before returning support. Named institutions and location relations may not fall through to nearby canonical facts.
- Presentation is chosen only after factual approval. `direct-safe` exact wording bypasses renderer/reviewer calls; a rejected natural rewrite falls back immediately without an interactive correction retry.
- Resolve deictic phrases by their explicit semantic head before project context: portfolio surfaces and the assistant have stable owners, project/app heads may inherit project state, and only genuinely unresolved references may escalate to semantic recovery.
- A constrained verifier may handle complex synthesis, but it returns support states and evidence IDs rather than unrestricted prose.
- A specific project name wins over a topic. An explicit topic wins over retrieval inference. A weak retrieval result must not fabricate a confident card.
- Approximate names and remembered details must reach semantic evidence assessment; a failed title lookup is not exhaustive absence. For descriptive project questions, provide the authored project records within the verification budget, preserve the original question, and qualify inferred identities. Distinguish plausible alternatives. Visuals follow the projects supplying approved answer facts; a rejected alternative cited for disambiguation must not acquire a card. Live comprehension cases live in `evals/understanding/`; the offline abstaining verifier only checks routing, never semantic quality.
- Follow-ups must be possible and contextual. Never generate links or actions the application cannot fulfill.
- Local responses are appropriate for greetings, identity, scope redirects, and fully deterministic UI actions—not for substantive capability questions that benefit from synthesis.

## Interaction and visual quality

- Design for scanning: one clear answer, one relevant visual, then supporting details.
- Cover submitted, searching, writing, done, empty, error, stopped, and rate-limited states.
- Maintain keyboard focus, semantic labels, 44px touch targets where practical, sufficient contrast, responsive layouts, and 200% zoom usability.
- Do not add animation solely as decoration. Use 100–150ms for direct feedback and 200–300ms for small state transitions.
- Test long answers, a one-item result, missing links, no evidence, slow streaming, and reduced motion.
- Avoid nested card clutter, generic metric tiles, gradient text, decorative glass, and duplicated prose/card content.
- Use the installed `humanizer` skill (`~/.codex/skills/humanizer/SKILL.md`) for visitor-facing copy. Keep factual qualifiers and source claims intact; remove repetitive headings, filler, and implementation explanations.
- Chat has Home navigation in the main header and one conversation scroller. Skills/project links use filters and native expandable rows, never a pan/zoom canvas.

## Validation

Use `npm run verify:plan` to inspect checks selected from changed files, then
`npm run verify -- --files <task paths>` for the current task or
`npm run verify -- --release` for all offline gates and the production build.
`test:ui` and `test:e2e` use local browser fixtures; mock API responses in tests.
Live browser/model checks are separate (`test:live`, `eval:models`,
`eval:natural`, `ask`, `smoke:azure`) and require `--allow-paid`. Run those only
when paid execution is authorized by the task; existing session authorization
does not require another confirmation. Routine UI work uses fixture tests.

Run the smallest relevant set, then the release set for cross-cutting changes:

```bash
npm run typecheck
npm test
npm run lint:knowledge
npm run verify:index
npm run eval:all
npm run bench
npm run build
```

When changing routing or filtering, add representative questions to `scripts/bench.ts`, including both a positive case and a nearby false positive. When changing UI, inspect desktop and mobile together in one bounded pass and check the browser console.

## Definition of done

- The exact user question produces the smallest useful evidence set.
- Prose and visuals complement rather than duplicate each other.
- No unsupported claim reaches the model prompt or UI.
- Loading and error behavior remains legible without relying on motion.
- Types, benchmark cases, and production build pass.
- New architectural knowledge or a subtle invariant is recorded here or beside the code it governs.

## Reliability contract

1. Retrieval relevance is never proof.
2. Every personal factual claim requires valid evidence IDs.
3. Follow-ups resolve references but never bypass support assessment.
4. Raw user or assistant history is untrusted context, never evidence.
5. Embedding fingerprints, transforms, and vector dimensions must match exactly.
6. Stale source/index pairs stop factual answering.
7. Missing evidence never implies inability.
8. Exact mutable facts stay in canonical structured owners and use deterministic paths.
9. Every RAG behavior change requires an eval change or an explicit explanation that behavior is unchanged.
10. Run targeted tests and `npm run verify:index` before completing relevant changes.
