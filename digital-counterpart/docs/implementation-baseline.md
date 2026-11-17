# Evidence pipeline baseline — 2026-09-07

Before behavior changes: 17 test files / 42 tests passed; knowledge lint passed
with 12 warnings (authoring placeholders and absent freshness timestamps);
index verification passed with 62 evidence records / 46 chunks, corpus
`ae17a86aae1b`. Production build passed. Typecheck passed when rerun after build
(the first concurrent run raced with Next.js regenerating `.next/types`).

Existing evaluations: Recall@10 1.000, MRR 0.767, NDCG@10 0.826 (5 retrieval
cases); support precision/recall 1.000, false support/abstention 0.000,
contradiction/status accuracy 1.000; answer 74/74, multi-clause completeness
1.000; citation precision/recall 1.000, invalid IDs 0; conversation resolution
1.000, false history grounding 0, bypasses 0. These are curated deterministic
gates, not a measurement of live provider reliability.

The tsx checks required permission to create their local IPC socket outside
the sandbox. Existing files are largely untracked; unrelated work is preserved.

## Resumed audit — 2026-09-07

The nested app repository was clean at `9826fe3`. Most phases were already
implemented. Before new changes: 103 tests passed; knowledge lint passed with
11 warnings; index verification passed with 59 evidence records / 43 chunks,
corpus `60e5820bcad2`. Offline answer evaluation passed 78/78 and benchmark
passed 19/19. Recall@10 remained 1.000; MRR was 0.667 and NDCG@10 was 0.752.
These ranking values were already below the earlier baseline on arrival.

Production build failed because `.env.local` lacked the now-required explicit
verifier provider/model. Browser testing subsequently found a reduced-motion
hydration mismatch (10/11 passed). Live evaluation revealed a seniority
absence/contradiction error and a deterministic work-philosophy routing error.
See `implementation-status.md` for the fixes and final verification results.

## Upgrade checkpoint 0 — 2026-09-08

The requested upgrade baseline was captured against the existing dirty working
tree, so these measurements describe the current workspace rather than a clean
commit. No pre-existing changes were discarded or rewritten.

- Typecheck: passed.
- Vitest: 28 files, 183 tests passed.
- Retrieval: Recall@10 1.000, MRR 0.667, NDCG@10 0.752 across 5 cases.
- Support: precision and recall 1.000, false-support and false-abstention 0.000.
- Answers: 86/86 passed; unsupported factual claim rate 0.000; exact-value
  accuracy and multi-clause completeness 1.000.
- Citations: precision and recall 1.000; invalid evidence ID rate 0.000.
- Conversation: resolution accuracy 1.000; no history-grounding bypasses.
- Benchmarks: 33/33 deterministic routing and 5/5 capability filtering cases
  passed.

## Upgrade checkpoint 1 — expanded retrieval baseline

The retrieval suite now has 55 evidence-backed cases: the original 5 plus 50
new project-stack, architecture, semantic-paraphrase, typo, metadata, distractor,
and cross-project cases. The lexical baseline is Recall@10 1.000, MRR 0.330,
NDCG@10 0.491, with local retrieval latency of 8.69 ms p50 and 12.66 ms p95.
The lower ranking scores expose the section-level retrieval blind spot that the
later controlled experiments are intended to measure.
