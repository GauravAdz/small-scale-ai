import { describe, expect, it } from "vitest";

import { inferCapabilityFromRecords } from "@/lib/evidence/capability-inference";
import { createFactStore } from "@/lib/evidence/fact-store";
import { decomposeQuestion } from "@/lib/evidence/question";
import { readEnv } from "@/lib/config";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { Retriever } from "@/lib/rag/retriever";

function store() {
  const retriever = Retriever.fromIndexFile();
  return createFactStore({
    profile: loadProfile(),
    projects: loadProjects(),
    evidence: retriever.allEvidence(),
    env: readEnv(),
  });
}

describe("structured capability inference", () => {
  it("combines transferable app skills with agricultural project evidence", () => {
    const [question] = decomposeQuestion(
      "I wanna hire someone for my argo farm to build a mobile app, would he be able to make one?",
    );
    const assessment = inferCapabilityFromRecords(question, store());

    expect(assessment?.status).toBe("partially-supported");
    expect(assessment?.claims.map(({ kind }) => kind)).toEqual(["inference", "uncertainty"]);
    expect(assessment?.evidenceIds).toEqual([
      "evidence:profile:skills",
      "evidence:projects/udaan",
      "evidence:projects/smart-farm",
    ]);
    expect(assessment?.claims[1].text).toContain("not evidence of a shipped native mobile app");
  });

  it("does not turn farm-project adjacency into machinery capability", () => {
    const [question] = decomposeQuestion("Could Gaurav operate heavy farm machinery?");
    expect(inferCapabilityFromRecords(question, store())).toBeNull();
  });
});
