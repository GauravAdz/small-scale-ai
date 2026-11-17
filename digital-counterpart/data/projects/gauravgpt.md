---
# ── Project schema ───────────────────────────────────────────────────────────
# `slug` must match the filename and is what `profile.json → pinnedProjects`
# references. Everything except `title` and `summary` is optional.
slug: gauravgpt
title: GauravGPT
type: project
weight: 100
year: 2024
status: shipped
role: Solo build
summary: A zero-build, single-file conversational AI persona that runs entirely in the browser.
tags: [JavaScript, Puter.js, CSS, Prompt Design]
url: https://gauravadz.github.io/small-scale-ai/
repo: https://github.com/GauravAdz/small-scale-ai
featured: true
---

# GauravGPT

The original, 2024 version: a lightweight browser-based chatbot with a custom
persona, built as one HTML file with no build step, no bundler, and no backend.
The name now belongs to this site; that project is where it started.

## The idea

I wanted a conversational version of myself online, and I wanted it to be
genuinely simple to run. The constraint I set was: **one file, opens in a
browser, no install**. That ruled out every framework and forced the interesting
decisions to be about interaction rather than architecture.

## How it works

The whole app is `index.html` — markup, styles, and logic in one document. It
talks to [Puter.js](https://puter.com) for inference via `puter.ai.chat`, which
means no API key handling and no server of my own. Conversation history is kept
in a plain array in memory and replayed on each turn so the model has context.

## What I actually solved

- **Mobile keyboards.** Using `100dvh` instead of `100vh` so the virtual keyboard
  doesn't push the composer off-screen — a small fix that took an embarrassing
  amount of debugging and is the difference between usable and not on a phone.
- **Perceived speed.** Animated typing indicators and optimistic message
  rendering, so the interface responds the instant you hit send rather than
  after the model does.
- **Composer ergonomics.** Auto-resizing textarea capped at 120px with scroll
  fallback; `Enter` sends, `Shift+Enter` newlines.
- **Theming without a toggle.** Light and dark handled purely through
  `prefers-color-scheme` CSS variables — no JS, no flash of wrong theme.

## What I'd change

The persona lives in a hardcoded `SYSTEM_PROMPT` string, which means the model
will happily improvise biography it was never given. That single limitation is
the direct reason I built the Digital Counterpart: same idea, but grounded in
retrieval so it can only say things I've actually written down.

## Stack

Vanilla JavaScript (ES6+), HTML5, CSS3 custom properties, Puter.js. Deployed on
GitHub Pages.
