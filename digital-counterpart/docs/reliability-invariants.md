# Reliability invariants

These invariants are architectural constraints, not prompt suggestions. A change that
breaks one must fail a deterministic test or an evaluation gate.

## INV-001 — No unsupported personal factual claim

Every factual claim about Gaurav references at least one evidence record that supports it.

## INV-002 — Retrieval score is not factual proof

BM25, vector, RRF, MMR, and reranker scores select candidates only. No retrieval score
classifies a proposition as true.

## INV-003 — Query expansion cannot increase evidence confidence

Expanded vocabulary is used only for candidate discovery. Verification receives the
original resolved atomic question.

## INV-004 — Follow-ups never bypass grounding

Conversation state may resolve a reference, but the resolved standalone proposition uses
the same retrieval and support checks as a new question.

## INV-005 — Conversation history is not evidence

User statements and previous assistant text are untrusted conversational context. They
cannot create evidence records or evidence IDs.

## INV-006 — No silent embedding incompatibility

Runtime embedding configuration must exactly match the persisted fingerprint. Dimensions
and mean-centering inputs must match before a vector comparison.

## INV-007 — Absence of evidence is not negative evidence

A failed evidence search produces uncertainty, never a claim that Gaurav lacks a skill or
capability unless an authoritative record explicitly says so.

## INV-008 — Exact mutable facts have canonical owners

Mutable identity, education, availability, project, and runtime facts are read from their
canonical structured owner and are not manually duplicated as current facts.

## INV-009 — “Not recorded” is stronger than a top-K miss

`not-recorded` is used only after an exhaustive canonical lookup. Candidate retrieval
misses use `insufficient`.

## INV-010 — Factual planning and voice rendering are separate

The planner decides which claims may be said. The renderer receives only approved claims
and cannot add factual propositions.

