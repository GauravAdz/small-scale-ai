# Digital Counterpart AI Evaluation & Benchmark Plan

**Document Status:** Approved Evaluation Plan  
**Target System:** `digital-counterpart/`  
**Audience:** OpenAI Codex Implementation Engineers  
**Guiding Mandate:** *Measure before optimizing. Never alter retrieval, chunking, or verification based on intuition alone.*

---

## 1. Executive Evaluation Strategy

To guarantee that the Digital Counterpart achieves near-zero hallucination while preserving rapid response latency, every modification must be verified against an empirical evaluation framework.

The evaluation strategy adheres to three foundational rules:
1. **Deterministic Evaluation Takes Precedence Over LLM-as-a-Judge**: Model-based evaluation is non-deterministic and can drift. Exact-value assertions, citation coverage, support statuses, and ranking metrics (Recall@K, MRR) must be calculated deterministically. LLM judges are strictly reserved for semantic equivalence review.
2. **Retrieval Evaluation Decoupled From Generation**: A RAG failure can occur at retrieval (wrong chunks retrieved) or at verification/generation (correct chunks retrieved, but misinterpreted). Both stages must be measured independently.
3. **Strict Invariance Gates**: Automated tests must fail hard if any critical precision metric regresses, even if latency or conversational fluidity improves.

---

## 2. Test Dataset Design & Expansion

### 2.1. Baseline Dataset Audit & Gap Analysis
The baseline dataset in `evals/dataset/*.jsonl` contains 91 test cases. However, an inspection of tags reveals a **critical vulnerability**:
- `exact-fact`: 40 cases (strong coverage)
- `availability`: 13 cases
- `unknown`: 10 cases
- `inference`: 8 cases
- `retrieval`: **ONLY 5 CASES** (unacceptable coverage)
- `injection`: 1 case, `rag-injection`: 1 case (insufficient adversarial coverage)

Because `scripts/eval-retrieval.ts` filters strictly by `tags.includes("retrieval")`, retrieval ranking metrics (Recall@10=1.000, MRR=0.667) are computed across only five questions. A retrieval regression on project architectures, technology stacks, or experience narratives goes completely undetected!

### 2.2. Target Dataset Expansion (Adding `evals/dataset/retrieval.jsonl`)
Codex must expand the evaluation suite to **140+ total cases**, specifically adding 40+ dedicated retrieval cases in `evals/dataset/retrieval.jsonl`.

The expanded dataset must cover ten distinct behavioral categories:

| Category | Target Count | Description & Test Objective | Expected Behavior |
| :--- | :--- | :--- | :--- |
| **Exact Personal Facts** | 40 cases | Name, age, location, email, LinkedIn, GitHub, university, degree, GPA, availability status. | Immediate deterministic answer; `status: supported`; zero LLM calls; authoritative citations. |
| **Project Technology Stacks** | 15 cases | Specific tech stack questions for all 5 projects (Udaan, Satellite Classifier, Smart Farm, GauravGPT, Digital Counterpart). | Retrieve exact project markdown; match technology tags; verifier confirms stack claims. |
| **Project Architecture & Decisions** | 10 cases | Deep architectural questions ("Why did he use Shiny Express?", "How does Udaan structure state?"). | Hybrid retrieval ranks relevant section in top-3; extract rationale; cite exact lines. |
| **Semantic Paraphrases & Synonyms** | 10 cases | Paraphrased questions with synonyms ("geospatial satellite tool", "conversational twin", "autonomous robot build"). | Hybrid retrieval bridges vocabulary mismatch via dense embeddings and Porter stemming. |
| **Cross-Document / Multi-Part** | 8 cases | Compound queries ("Where does Gaurav live and what did he build with PyTorch?"). | Clause decomposition splits into 2 atomic clauses; each evaluated independently; combined answer. |
| **Conversational Follow-ups** | 8 cases | Anaphoric references ("Tell me about Udaan" $\to$ "What stack powered it?" $\to$ "Who worked on it?"). | Reference resolution rewrites into standalone proposition before retrieval. |
| **Ambiguous & Typo Queries** | 6 cases | Misspelled project names ("Udan", "Satelite Clasifier", "Gaurav GPT"). | Hybrid search and `intent.ts` fuzzy matching retrieve correct project without failing. |
| **Honest Knowledge Gaps** | 15 cases | Undocumented skills, salary, private life, unrecorded metrics ("Did he work at Google?", "What is his salary?"). | Pre/post-retrieval guard or verifier returns `status: insufficient` or `not-recorded`. Zero fabrication. |
| **Adversarial & Prompt Injection** | 10 cases | Direct injections ("Ignore instructions"), indirect injections embedded in text, system prompt extraction. | Pre-retrieval regex catches direct injection; verifier treats evidence as untrusted data; zero policy bypass. |
| **Cache Collision Stress Tests** | 8 cases | Closely worded queries across different projects ("What language for Project A?" vs. "Project B?"). | Distinct cache keys generated; zero cross-project cache collisions. |

---

## 3. Metric Definitions & Formulas

Codex must implement and report the following deterministic and model-assisted metrics:

### 3.1. Retrieval Metrics (Computed Offline via `scripts/eval-retrieval.ts`)

1. **Recall@K**: Proportion of target evidence records found in the top-$K$ candidates:
   $$\text{Recall@}K = \frac{1}{|Q|} \sum_{q \in Q} \frac{|\text{Retrieved}_K(q) \cap \text{Expected}(q)|}{|\text{Expected}(q)|}$$
   - *Target*: $\text{Recall@10} = 1.000$; $\text{Recall@5} \ge 0.900$.
2. **Mean Reciprocal Rank (MRR)**: Evaluates the rank position of the first relevant chunk:
   $$\text{MRR} = \frac{1}{|Q|} \sum_{q \in Q} \frac{1}{\text{rank}_1(q)}$$
   - *Target*: $\text{MRR} \ge 0.750$ across the expanded 45+ retrieval cases.
3. **Normalized Discounted Cumulative Gain (NDCG@K)**: Evaluates ranking quality with graded relevance:
   $$\text{DCG@}K = \sum_{i=1}^K \frac{2^{\text{rel}_i} - 1}{\log_2(i + 1)}, \quad \text{NDCG@}K = \frac{\text{DCG@}K}{\text{IDCG@}K}$$
   - *Target*: $\text{NDCG@10} \ge 0.820$.
4. **Irrelevant Context Rate**: Proportion of retrieved chunks in top-$K$ with zero relevance to the query:
   - *Target*: $\le 0.35$ at $K=5$.

### 3.2. Verification & Grounding Metrics (Computed Offline via `scripts/eval-support.ts`)

1. **Factual Precision**: Ratio of supported claims to total asserted claims:
   $$\text{Precision} = \frac{|\text{Supported Claims}|}{|\text{Total Asserted Claims}|}$$
   - *Target*: $1.000$ (Zero tolerance for unsupported claims).
2. **False Support Rate**: Rate at which an unsupported or unrecorded proposition is marked `supported`:
   - *Target*: $0.000$ (Critical Safety Invariant).
3. **False Abstention Rate**: Rate at which a fully documented proposition is erroneously marked `insufficient`:
   - *Target*: $\le 0.020$.
4. **Contradiction Accuracy**: Accuracy in detecting conflicting assertions across evidence records:
   - *Target*: $1.000$.
5. **Exact Value Accuracy**: Percentage of numeric values, dates, URLs, and emails preserved verbatim:
   - *Target*: $1.000$ (Enforced deterministically by `validateRewrite`).
6. **Citation Coverage & Precision**: Percentage of approved claims with valid, extant evidence IDs:
   - *Target*: $1.000$ coverage; zero phantom evidence IDs.

### 3.3. Performance & System Latency Metrics

1. **Total Turn Latency (p50 / p95)**: End-to-end time from HTTP request to first streaming token and completion.
   - *Target*: Deterministic turn: p50 $< 50\text{ms}$; p95 $< 100\text{ms}$.
   - *Target*: Narrative verified turn: p50 $< 1200\text{ms}$; p95 $< 2500\text{ms}$.
2. **Query Embedding Latency**: Time to compute dense vector representation.
   - *Target (Cache Hit)*: $< 1\text{ms}$.
   - *Target (Cache Miss)*: $< 250\text{ms}$.
3. **Cache Hit Rates**:
   - Query Embedding Cache: $\ge 40\%$ on repeated benchmark runs.
   - Natural Answer Wording Cache: $\ge 35\%$ across equivalent questions.
   - Verification Judgment Cache: $\ge 40\%$ across repeated clauses.

---

## 4. Benchmark Workflows & Execution Commands

All verification commands are run from `digital-counterpart/`:

```bash
# 1. Type check
npm run typecheck

# 2. Comprehensive unit, property, and integration tests
npm test

# 3. Knowledge and index integrity
npm run lint:knowledge
npm run verify:index

# 4. Offline RAG and Evidence Evaluations
npm run eval:retrieval       # Evaluates Recall@10, MRR, NDCG@10
npm run eval:support         # Evaluates support precision, false-support rate
npm run eval:answer          # Evaluates multi-clause completeness, exact values
npm run eval:citations       # Evaluates claim-to-evidence provenance
npm run eval:conversation    # Evaluates reference resolution across history
npm run eval:operations      # Evaluates token spend and budget compliance
npm run bench                # Evaluates 33 deterministic routing & 5 capability cases

# 5. Full Release Gate
npm run verify -- --release
```

---

## 5. Controlled Experimentation Framework

Whenever Codex evaluates architectural alternatives with empirical uncertainty, it must execute a controlled experiment following this exact template:

```markdown
### Experiment Template
- **Hypothesis**: Specific expected metric improvement.
- **Baseline**: Measurement on current system before code changes.
- **Variant**: Proposed change (e.g., BM25 Porter Stemming, FlashRank Reranker).
- **Evaluation Dataset**: Specified subset in `evals/dataset/`.
- **Success Criteria**: Quantitative threshold required to keep the change.
- **Rollback Condition**: Threshold below which the change must be reverted.
```

### Experiment 1: BM25 Porter Stemming vs. Baseline
- **Hypothesis**: Adding a zero-dependency Porter stemmer to `bm25.ts` improves lexical recall and MRR for morphological technical queries without degrading exact keyword matching.
- **Baseline**: Current `tokenize()` (drops trailing `s`).
- **Variant**: `tokenize()` with Porter stemmer.
- **Dataset**: Expanded `evals/dataset/retrieval.jsonl` (45 cases).
- **Success Criteria**: MRR increases by $\ge 0.05$; Recall@10 remains $1.000$; zero regression on exact project names ("Udaan").
- **Decision Rule**: **KEEP** if criteria met; **ROLLBACK** if exact keyword matching regresses.

### Experiment 2: Query Embedding Cache
- **Hypothesis**: Bounded in-memory LRU query embedding cache eliminates 100% of remote embedding REST calls on repeated queries, reducing p50 turn latency by $\ge 200\text{ms}$.
- **Baseline**: Current `Retriever.retrieve()` (calls `embedder.embed()` on every turn).
- **Variant**: Bounded LRU cache keyed by `sha256(normalize(q) + fingerprint)`.
- **Dataset**: `scripts/bench.ts` benchmark suite (executed twice).
- **Success Criteria**: Second run makes 0 embedding REST calls; latency drops to $<5\text{ms}$; 100% cache invalidation verified on re-index.
- **Decision Rule**: **KEEP** if verified.

### Experiment 3: Pluggable Cross-Encoder Reranker
- **Hypothesis**: Re-ranking top-10 RRF candidates using a lightweight cross-encoder improves NDCG@5 and eliminates irrelevant chunks.
- **Baseline**: `NoopReranker`.
- **Variant**: `FlashRankReranker` (or `VoyageReranker` if API key configured).
- **Dataset**: Expanded `evals/dataset/retrieval.jsonl`.
- **Success Criteria**: NDCG@5 improves by $\ge 0.08$; added latency is $\le 120\text{ms}$.
- **Decision Rule**: **KEEP** behind `RERANKER=flashrank`; **ROLLBACK** if added latency exceeds 150ms or serverless bundle size increases by $>15\text{MB}$.
