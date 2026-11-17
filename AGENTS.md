# Agent guide

This repository contains two different products. Resolve the target before editing:

- The repository root is the original static GauravGPT (`index.html`, `README.md`) deployed through GitHub Pages.
- `digital-counterpart/` is the active Next.js conversational portfolio. For any request about RAG, retrieval, chat, visuals, recruiters, the portfolio UI, or Gaurav's current counterpart, work there and read `digital-counterpart/AGENTS.md` first.
- `profile/` is a legacy portfolio and should be treated as reference material unless explicitly requested.

## Working rules

- Preserve user changes. This repository may be intentionally untracked or dirty; inspect the diff and never reset unrelated work.
- Use `rg` / `rg --files` for discovery.
- Make factual profile changes in `digital-counterpart/data/`, never by hard-coding claims in components or prompts.
- Never infer achievements, employment, grades, dates, metrics, or project outcomes. Missing evidence should remain an honest knowledge gap.
- Run checks from the product directory whose code changed.
- Do not edit generated output (`.next/`, graph caches, or `data/.index/`) by hand. Regenerate it through the documented command.

## Repository checks

- Static root: manually verify `index.html`; there is no build step.
- Digital counterpart: `npm run typecheck`, `npm run bench`, and `npm run build` for release-level changes.

## Reliability contract

For `digital-counterpart/` changes:

1. Retrieval relevance is candidate selection, never factual proof.
2. Every personal factual claim requires valid evidence IDs.
3. Follow-ups resolve references but never bypass normal support assessment.
4. Embedding fingerprint or vector-dimension mismatches must fail explicitly.
5. A stale knowledge index must never be served.
6. Missing evidence must not become a negative capability claim.
7. Preserve deterministic exact-fact paths and exact structured values.
8. Every RAG behavior change requires corresponding eval coverage.
9. Run `npm run verify:index` after knowledge or index changes.
10. Run all targeted deterministic tests before completing a change.

Keep this root file short. Product architecture, interaction contracts, data rules, and quality standards live in the child guide.
