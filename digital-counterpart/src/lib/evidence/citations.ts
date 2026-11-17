import type { Citation } from "@/lib/rag/types";
import type { FactualAnswerPlan } from "@/lib/llm/answer-plan";
import type { EvidenceRecord } from "./types";

function titleFromSource(source: string): string {
  if (source === "runtime://configuration") return "Current runtime configuration";
  const file = source.split("/").at(-1) ?? source;
  return file.replace(/\.(md|json)$/i, "").replace(/[-_]/g, " ");
}

export function citationsForPlan(
  plan: FactualAnswerPlan,
  evidence: readonly EvidenceRecord[],
): Citation[] {
  const byId = new Map(evidence.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const clause of plan.clauses) {
    for (const claim of clause.claims) {
      for (const evidenceId of claim.evidenceIds) {
        const key = `${claim.id}\u0000${evidenceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const record = byId.get(evidenceId);
        if (!record) throw new Error(`Claim ${claim.id} references unknown evidence ${evidenceId}.`);
        citations.push({
          id: `${claim.id}:${evidenceId}`,
          claimId: claim.id,
          evidenceId,
          claimText: claim.text,
          title: titleFromSource(record.locator.source),
          source: record.locator.source,
          section: record.locator.headingPath?.join(" › "),
          headingPath: record.locator.headingPath,
          excerpt: record.text,
          startLine: record.locator.startLine,
          endLine: record.locator.endLine,
          jsonPointer: record.locator.jsonPointer,
          provenance: record.authority === "runtime"
            ? "runtime-record"
            : record.authority === "repository-derived"
              ? "repository-record"
              : "portfolio-record",
        });
      }
    }
  }
  return citations;
}
