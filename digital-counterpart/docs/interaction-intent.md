# Interaction intent and product-feedback contract

The evidence pipeline decides what may be claimed. Interaction intent is a separate application concern: it names what the visitor is trying to do so UI selection, tests, and product analytics use the same vocabulary.

## Decision boundary

`src/lib/chat/interaction-intent.ts` is intentionally deterministic. It does **not** decide whether a factual proposition is supported and it does not replace the verifier.

The current precedence is:

1. combined identity + contact → profile overview
2. explicit message/contact action → contact form
3. named project + link/repository request → that project
4. direct profile channel → GitHub / LinkedIn / email / website link
5. repository discovery → project collection
6. hiring evidence or availability
7. evidence-oriented judgement
8. named project detail
9. philosophy / skills / education / experience / about / projects
10. unknown → no forced visual

This keeps ambiguous words contextual. `GitHub` can mean a profile channel, a named project's repository, or a project collection depending on the rest of the request.

## UI invariant

`chooseVisual()` consumes the shared interaction intent. Retrieval never selects a visual on its own. A visual is allowed to be absent.

Representative contracts:

- `Give me your GitHub link` → `profile-link/github`
- `How can I contact you?` → `contact-form`
- `Give me the GitHub repo for Udaan` → `project-detail/udaan`
- `Which projects have GitHub repositories?` → `projects`

Unit coverage lives in `tests/unit/interaction-intent.test.ts`. A stateful browser contract in `tests/e2e/conversation-intent.spec.ts` checks that switching between these intents does not leak the previous turn's visual.

## Product analytics

`src/lib/analytics/posthog.ts` optionally emits one `counterpart_chat_turn` event per completed turn when both `POSTHOG_PROJECT_KEY` and `POSTHOG_HOST` are configured.

The event contains only structured application decisions:

- route (`answer` / `local`)
- interaction kind
- target kind and authored project slug when applicable
- requested profile channel when applicable
- selected visual kind
- support status
- rendering mode
- citation count
- follow-up count

It deliberately excludes raw questions, answers, emails, IP addresses, citation text, evidence excerpts, and stable visitor identifiers. The PostHog `distinct_id` is the request ID, so it is not reused across visits. Person profile processing is disabled on the event.

On Vercel the chat route schedules capture with `waitUntil()` so analytics cannot delay the streamed response. Capture errors are swallowed after optional development diagnostics; analytics must never affect answering.

## Useful aggregate checks

The first production dashboards should focus on behavior rather than vanity traffic:

- `interaction_kind = profile-link` grouped by `visual_kind`
- `interaction_kind = contact-message` grouped by `visual_kind`
- `target_kind = project` grouped by `visual_kind`
- support-status distribution by interaction kind
- natural vs deterministic rendering by interaction kind

A mismatch query such as `profile-link` turns rendering `projects` is a direct regression signal and should become a new test case.
