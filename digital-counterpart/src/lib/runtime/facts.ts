import type { EnvConfig } from "@/lib/config";
import type { EvidenceRecord } from "@/lib/evidence/types";
import { canonicalJson, sha256 } from "@/lib/knowledge/manifest";

export type RuntimeFact = Readonly<{
  key: "llm-provider" | "llm-model" | "embedding-provider" | "embedding-model";
  value: string;
  evidence: EvidenceRecord;
}>;

export function runtimeFacts(config: EnvConfig): RuntimeFact[] {
  const sourceHash = sha256(
    canonicalJson({
      llm: { provider: config.llm.provider, model: config.llm.model },
      embeddings: {
        provider: config.embeddings.provider,
        model: config.embeddings.model,
        dimensions: config.embeddings.dimensions,
      },
    }),
  );
  const record = (key: RuntimeFact["key"], value: string): RuntimeFact => ({
    key,
    value,
    evidence: {
      id: `runtime:${key}`,
      docId: "runtime:configuration",
      kind: "runtime-fact",
      authority: "runtime",
      text: value,
      subject: "Digital Counterpart",
      predicate: key,
      value,
      locator: { source: "runtime://configuration", jsonPointer: `/${key}` },
      sourceHash,
      verifiedAt: new Date().toISOString(),
    },
  });

  return [
    record("llm-provider", config.llm.provider),
    record("llm-model", config.llm.model),
    record("embedding-provider", config.embeddings.provider),
    record("embedding-model", config.embeddings.model ?? "none"),
  ];
}

