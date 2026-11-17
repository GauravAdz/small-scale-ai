/** Stable identifiers recorded in traces and evaluation output for regression attribution. */
export const RELIABILITY_VERSIONS = Object.freeze({
  pipeline: "evidence-v2.15",
  resolver: "typed-reference-v3.1",
  retrieval: "hybrid-rrf-mmr-v2.2",
  verifier: "support-v2.11",
  verifierPrompt: "verifier-system-v2.8",
  interpreter: "typed-query-understanding-v2.1",
  interpreterPrompt: "semantic-recovery-v2.0",
  renderer: "direct-safe-paraphrase-v3.2",
  rendererPrompt: "natural-voice-v3.6",
  chunker: "heading-lines-v2.1",
  indexableText: "2",
});

export const reliabilityVersionSummary = (): string =>
  `versions=${JSON.stringify(RELIABILITY_VERSIONS)}`;
