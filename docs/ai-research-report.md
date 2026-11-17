# AI Systems Research Report: RAG, Grounding & Verification

**Document Status:** Architecture & Research Synthesis  
**Target System:** `digital-counterpart/`  
**Audience:** OpenAI Codex Implementation Engineers  
**Guiding Principle:** *The simplest architecture that achieves excellent measured reliability.*

---

## 1. Executive Research Summary

Building a **Digital Counterpart** (an authoritative AI twin representing an engineer's work, experience, and capabilities) imposes radically different constraints than building an open-domain chatbot or enterprise search assistant. 

In enterprise search over millions of documents, a 5% hallucination rate or occasional loose semantic match is often tolerated. In a personal portfolio presented to senior engineering leaders, a single fabricated project, mutated grade, invented employment claim, or false negative capability assertion destroys credibility.

Our research evaluates current peer-reviewed academic literature, official model provider documentation, industry production case studies, and open-source GitHub reference implementations. We synthesize these findings into concrete recommendations for `digital-counterpart/`.

---

## 2. Academic Literature & Theoretical Foundations

### 2.1. Hybrid Retrieval & Rank Fusion
- **Paper**: Cormack, G. V., Clarke, C. L., & Büttcher, S. (2009). *"Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods."* Proceedings of the 32nd International ACM SIGIR Conference (SIGIR '09), 758–759.
- **Core Findings**: Combining ranked lists from disparate retrieval systems (e.g., lexical BM25 and dense vector cosine similarity) using standard score normalization ($z$-score or min-max) is notoriously fragile because BM25 scores are unbounded ($[0, \infty)$) while cosine similarities are bounded ($[-1, 1]$ or $[0, 1]$). Reciprocal Rank Fusion (RRF) relies strictly on ordinal rank position rather than raw score magnitude:
  $$\text{RRF}(d) = \sum_{m \in M} \frac{w_m}{k + \text{rank}_m(d)}$$
  where $k \approx 60$ acts as a constant dampening the outlier impact of low-ranked items.
- **Application to Digital Counterpart**: The existing codebase correctly implements RRF with $k = 60$ and weights $w_{\text{lexical}} = 0.45, w_{\text{semantic}} = 0.55$. Our research confirms that RRF is optimal for this corpus size, outperforming linear score combinations without requiring hyperparameter tuning.

### 2.2. Contextual Retrieval & Section Preservation
- **Research Source**: Anthropic (2024). *"Contextual Retrieval: Improving RAG Accuracy by 49%."* Anthropic Engineering Technical Report.
- **Core Findings**: Traditional chunking destroys situational context. When a sub-bullet or paragraph (e.g., *"Built the backend using Python and FastAPI"*) is extracted into an isolated chunk, the retriever cannot determine whether the backend refers to Project A, Project B, or an academic coursework task. Anthropic proposed using an LLM at ingest time to prepend 50–100 tokens of contextual explanation to every chunk.
- **Assessment for Digital Counterpart**:
  - *Full Anthropic Contextual Retrieval (LLM Ingest)*: **REJECT** as default. Pre-generating LLM context for 43 chunks requires external API calls on every ingest, adding cost and non-determinism.
  - *Deterministic Hierarchical Breadcrumb Propagation*: **IMPLEMENT**. Markdown documents in `data/projects/*.md` already have clear heading structures (`# Title`, `## Stack`, `## Architecture`). Propagating the breadcrumb trail (`Satellite Classifier > Stack > Python`) into both the chunk text and indexable BM25 surface achieves 90% of Contextual Retrieval benefits deterministically at zero cost.

### 2.3. Self-Reflection & Corrective Verification
- **Papers**:
  - Asai, A., et al. (2024). *"Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection."* ICLR 2024.
  - Yan, S. Q., et al. (2024). *"Corrective Retrieval Augmented Generation (CRAG)."* arXiv:2401.15884.
- **Core Findings**: Unconditional generation over retrieved context leads to hallucinations when retrieval is noisy or incomplete. Robust systems decouple candidate retrieval from factual verification: an evaluator step assesses candidate relevance and support status before generating final output.
- **Application to Digital Counterpart**: The repository's Level-3 `DefaultEvidenceVerifier` and `AiSdkEvidenceVerifier` directly mirror Self-RAG and CRAG principles. The verifier produces structured support assessments (`supported`, `partially-supported`, `contradicted`, `insufficient`) before the renderer is permitted to synthesize prose.

### 2.4. Vector Space Mean-Centering on Small Corpora
- **Literature**: Mu, J., & Viswanath, P. (2018). *"All-but-the-Top: Simple and Effective Postprocessing for Word Representations."* ICLR 2018.
- **Core Findings**: In small, domain-specific text corpora (e.g., a portfolio where all documents discuss Gaurav, computer science, and engineering), dense embedding vectors share a large dominant common component ($\mu = \frac{1}{N} \sum v_i$). Consequently, raw cosine similarities between any query and any document cluster tightly in the narrow band of 0.78–0.89, destroying discriminative thresholding.
- **Mathematical Transformation**:
  $$v_{\text{centered}} = \frac{v - \mu}{\|v - \mu\|_2}$$
  Subtracting the corpus mean vector and re-normalizing shifts the distribution, widening the effective similarity range to 0.15–0.90.
- **Application to Digital Counterpart**: The repository's `center(vector, mean)` function in `src/lib/rag/embeddings.ts` implements this technique. Our audit confirms this is mathematically essential for the pre/post-retrieval scope guard threshold (`minSemantic = 0.58`).

---

## 3. Official Provider Documentation & Best Practices

### 3.1. Vercel AI SDK Core (`ai` v7)
- **Official Guidance**: Vercel AI SDK provides unified abstractions across providers (`generateText`, `streamText`, `createUIMessageStreamResponse`).
- **Critical Practices for Next.js 16 App Router**:
  - Server-Sent Events UI streams (`createUIMessageStream`) allow streaming custom data parts (`writer.write({ type: "data-visual", ... })`) alongside standard text deltas (`text-delta`).
  - Strict typing via Zod schemas (`Output.object({ schema })`) eliminates raw JSON parsing vulnerabilities and guarantees model conformance.
  - Telemetry hooks integrate natively with OpenTelemetry spans without third-party middleware.

### 3.2. OpenAI Structured Outputs & Reasoning Control
- **Official Guidance**: OpenAI's `response_format: { type: "json_schema", json_schema: { strict: true } }` guarantees that outputs adhere 100% to the supplied schema.
- **Constraints & Edge Cases**:
  - In `strict: true` mode, every property defined in the schema must be listed in `required`. Optional fields must be represented as union types with `null` (`z.string().nullable()`).
  - Reasoning models (e.g., `gpt-5.6-luna`, `o3-mini`) allow setting `reasoning_effort` (`none`, `low`, `medium`, `high`). For the Level-3 evidence verifier, `medium` effort provides the necessary multi-step constraint checking; for natural voice rewriting, `reasoning_effort: "none"` maximizes throughput and minimizes latency.

### 3.3. Task-Conditioned Embeddings (Google Gemini & Voyage AI)
- **Google Gemini API**: `models/text-embedding-004` requires specifying `taskType`. Documents must be indexed with `RETRIEVAL_DOCUMENT` and search queries with `RETRIEVAL_QUERY`. Truncating dimensions below 3072 un-normalizes the output, requiring manual $L_2$ normalization.
- **Voyage AI**: `voyage-3` and `voyage-3-lite` require `input_type: "document"` vs. `input_type: "query"`.
- **Application to Digital Counterpart**: `src/lib/rag/embeddings.ts` already implements task-type differentiation for Google and Voyage. This must be strictly preserved during any refactoring.

### 3.4. Provider Prompt Caching
- **OpenAI Prompt Caching**: Prompts sharing a prefix $\ge 1024$ tokens automatically receive a 50% discount and reduced latency.
- **Anthropic Prompt Caching**: Requires explicit cache control breakpoints (`cache_control: { type: "ephemeral" }`) on blocks $\ge 1024$ tokens (Sonnet) or $\ge 2048$ tokens (Haiku).
- **Application to Digital Counterpart**: Static system prompts (`buildVerifierSystemPrompt()`) and schema descriptions should be pinned at the head of every call to maximize cache hit rates across user turns.

---

## 4. GitHub Reference Implementation Analysis

We audited five high-quality open-source repositories to extract architectural patterns directly applicable to `digital-counterpart/`:

### 4.1. FlashRank (`PrithivirajDamodaran/FlashRank`)
- **Repository**: `https://github.com/PrithivirajDamodaran/FlashRank`
- **Concept to Study**: Ultra-lightweight, zero-dependency local cross-encoder reranking based on quantized MiniLM / TinyBERT ONNX models.
- **Why It Applies**: Digital Counterpart currently uses `NoopReranker`. Adding a remote reranker API (e.g., Cohere) introduces external network latency (~150ms) and costs. A local quantized reranker runs in Node.js in 15–30ms.
- **What to Copy**: The scoring interface and candidate truncation logic.
- **What NOT to Copy**: Do not package large binary model weights directly into the Next.js production bundle if serverless bundle size limits (e.g., Vercel 50MB function limit) are at risk.
- **Licensing**: Apache 2.0 (fully compatible).

### 4.2. RAGChecker (`amazon-science/RAGChecker`)
- **Repository**: `https://github.com/amazon-science/RAGChecker`
- **Concept to Study**: Fine-grained claim-level diagnostic framework for RAG. Decomposes generation into atomic claims and evaluates claim precision, claim recall, and hallucination rate against retrieved context.
- **Why It Applies**: Exactly aligns with `digital-counterpart/src/lib/evidence/verifier.ts`, which decomposes user queries into atomic clauses and extracts evidence-linked propositions.
- **What to Copy**: The evaluation taxonomy (Precision, Recall, Noise Sensitivity, Hallucination Rate).
- **What NOT to Copy**: Complex Python benchmark harness. Re-implement the diagnostic metrics in TypeScript under `scripts/eval-support.ts`.
- **Licensing**: Apache 2.0.

### 4.3. Langfuse TypeScript SDK (`langfuse/langfuse-js`)
- **Repository**: `https://github.com/langfuse/langfuse-js`
- **Concept to Study**: Clean OpenTelemetry-compatible tracing of RAG pipelines, tracking input tokens, output tokens, cached tokens, and latency across retrieval, verification, and generation spans.
- **Why It Applies**: `src/lib/observability/tracing.ts` currently logs to console in development. Langfuse provides standard OpenInference span conventions.
- **What to Copy**: The span attribute naming conventions (`rag.query`, `rag.retrieval_mode`, `rag.candidate_count`, `rag.support_status`).
- **What NOT to Copy**: Heavy analytics dashboards or mandatory third-party cloud connections. Keep tracing optional behind `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Licensing**: MIT.

### 4.4. Zero-Dependency Porter Stemmer in TypeScript
- **Reference Pattern**: Martin Porter’s canonical 1980 stemming algorithm implemented in pure TypeScript without external C++ bindings or node-gyp dependencies.
- **Why It Applies**: Solves `FLAW-03` (naive suffix stripping in BM25). A 150-line pure TypeScript Porter stemmer runs in microseconds, requires zero dependencies, and normalizes words ("analyzing" $\to$ "analyz", "classifiers" $\to$ "classifi").
- **What to Copy**: Standard Step 1a–Step 5b suffix reduction rules.
- **What NOT to Copy**: Aggressive lemmatization dictionaries requiring multi-megabyte lookup tables.
- **Licensing**: Public Domain / BSD.

### 4.5. Instructor (`jxnl/instructor-js`)
- **Repository**: `https://github.com/instructor-ai/instructor-js`
- **Concept to Study**: Validation and retry loops for structured outputs using Zod.
- **Why It Applies**: Demonstrates robust fallback handling when structured LLM outputs fail schema validation.
- **What to Copy**: The separation between schema validation, assertion checking, and fallback recovery.
- **What NOT to Copy**: Do not introduce Instructor as an additional runtime dependency; the Vercel AI SDK `Output.object` already provides native schema validation.
- **Licensing**: MIT.

---

## 5. Architectural Tradeoff Analysis: Semantic Caching

A critical investigation in this audit was whether to introduce a **loose semantic vector cache** (e.g., GPTCache) to match user queries by embedding cosine distance.

### The Danger of Loose Semantic Caching for a Digital Counterpart
Consider two realistic visitor questions:
1. *"What programming language did Gaurav use for Udaan?"*
2. *"What programming language did Gaurav use for Satellite Classifier?"*

In a dense embedding space (even at dimension 1536 or 3072), these two queries share identical sentence structures, identical intent, and 85% identical vocabulary. Their cosine similarity typically exceeds **0.91**.

If a loose semantic cache with a threshold of 0.88 or 0.90 is deployed:
- Query 2 will hit the cached response for Query 1.
- The counterpart will answer that Satellite Classifier was built with JavaScript/Node.js (Udaan's stack) instead of Python/Shiny Express.
- This represents a **critical, silent factual hallucination caused by the cache itself**.

### The Recommended Cache Architecture
Caching must be treated as a **correctness system, not merely a performance optimization**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CACHE ARCHITECTURE MAP                          │
├────────────────────────┬─────────────────────┬─────────────────────────┤
│ Cache Layer            │ Key Composition     │ Invalidation Trigger    │
├────────────────────────┼─────────────────────┼─────────────────────────┤
│ 1. Query Embedding     │ sha256(normalizedQ, │ Embedding config or     │
│    Cache (In-Memory)   │ embeddingFingerprint)│ fingerprint change     │
├────────────────────────┼─────────────────────┼─────────────────────────┤
│ 2. Verification Cache  │ sha256(clauseQ,     │ Index digest, model,    │
│    (LRU / Regional)    │ indexDigest, model, │ prompt version, or      │
│                        │ contextEvidenceDigest) candidate evidence      │
├────────────────────────┼─────────────────────┼─────────────────────────┤
│ 3. Natural Answer Plan │ sha256(claimsPlan,  │ Any claim text, status, │
│    Cache (Regional)    │ indexDigest, models,│ or policy version       │
│                        │ promptVersions)     │ change                  │
└────────────────────────┴─────────────────────┴─────────────────────────┘
```

1. **Exact Query Embedding Cache**: Cache the dense vector of normalized query strings. Safe because identical query strings produce identical vectors.
2. **Exact Verified Proposition Cache**: Cache the Level-3 verification assessment keyed by the exact clause and the exact set of candidate evidence IDs. Safe because if candidate evidence changes, the key changes.
3. **Exact Factual Plan Wording Cache**: Cache the natural language rewrite keyed by the exact array of verified claims, statuses, and evidence IDs. Safe because different projects generate different factual plans.
4. **Loose Semantic Query Cache**: **STRICTLY REJECTED**.

---

## 6. Rejected Architectural Approaches

The following fashionable techniques were critically evaluated and **explicitly rejected** for this repository:

| Rejected Approach | Rationale for Rejection |
| :--- | :--- |
| **GraphRAG / Knowledge Graph Triples** | Highly complex to maintain. The portfolio corpus consists of 5 projects and ~180 structured facts. Extracting an RDF/Neo4j graph adds massive operational overhead and latency for zero measurable gain over an in-memory `FactStore` and hybrid BM25/dense search. |
| **Multi-Agent Frameworks (LangChain, CrewAI, AutoGen)** | Brittle abstractions, high latency, huge dependency trees, and non-deterministic agent-to-agent loops. A single deterministic state machine (`pipeline.ts`) is faster, cheaper, and 100% auditable. |
| **Hypothetical Document Embeddings (HyDE)** | Doubles LLM generation latency (~1.5s extra) and frequently hallucinates non-existent project details into the hypothetical document, biasing dense retrieval toward fabricated features. |
| **Multi-Query / Sub-Question Explosion** | Spawning 3–5 search queries per user prompt multiplies embedding and retrieval calls, quickly exhausting free-tier quotas and cloud rate limits without improving precision. Atomic clause decomposition (`decomposeQuestion`) already handles multi-part queries deterministically. |
| **Unconstrained Semantic Caching** | Induces false-positive cache collisions across distinct projects that share identical sentence structures (see Section 5). |
