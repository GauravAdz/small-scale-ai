---
slug: digital-counterpart
title: Digital Counterpart
type: project
weight: 100
year: 2026
status: building
role: Solo build
summary: An evidence-backed conversational portfolio designed to cite factual claims and abstain when support is insufficient.
tags: [Next.js, React, TypeScript, Evidence verification, RAG, Tailwind CSS]
url: ""
repo: https://github.com/GauravAdz/small-scale-ai
featured: true
---

# Digital Counterpart

The engine behind **GauravGPT**, the thing you're talking to right now. A
conversational counterpart that represents me to recruiters and collaborators —
and, critically, one designed to keep unsupported claims from reaching the answer.

## The problem with the obvious version

The obvious version of this is a chatbot with your biography stuffed into a
system prompt. I built that (GauravGPT) and used it for a year. It has one fatal
flaw: asked about a job I never had, it will invent one, in my voice, confidently.
For a portfolio that's worse than useless — it's a liability.

## The fix: evidence records, support verification, and a refusal

My background lives in plain markdown and JSON in a `data/` directory. An ingest
step turns it into provenance-bearing evidence records and searchable chunks.
Every question runs through candidate retrieval, then a separate support check
against the original proposition. Retrieval scores select what to inspect; they
do not decide what is true.

The important part is what happens when support is missing. Each question clause
is marked supported, contradicted, insufficient, or not recorded. Only approved
claims reach the voice renderer; unsupported clauses become explicit uncertainty.

## Design decisions worth defending

- **Hybrid over pure vector.** On a corpus of a few hundred chunks, BM25 is not
  the weak sibling — it's frequently better, especially on proper nouns like
  school names and library names. Fusing the two beats either alone, and it means
  the app works with *zero* embedding keys configured.
- **Files over a CMS.** Updating my background is `git commit`, not a login.
  Human-editable markdown means I'll actually keep it current.
- **Claim citations in the UI.** Factual claims carry evidence IDs that resolve
  to a source, heading, excerpt, and locator.
- **Pluggable providers.** Vector, embedding, verifier, and renderer boundaries
  stay explicit. A lexical-only local index remains a supported fail-closed mode.

## Stack

Next.js 16 (App Router, Turbopack), React 19.2, TypeScript, Tailwind CSS v4,
shadcn/ui, Framer Motion. Streaming via the Vercel AI SDK v7.

The model provider is pluggable behind one interface. An earlier prototype used
Gemma for its free-tier allowance; current deployment facts are read from runtime
configuration rather than maintained in this project narrative.

Retrieval is hand-rolled — BM25 plus cosine similarity — because on this corpus
size a vector database is infrastructure you maintain for no gain.
