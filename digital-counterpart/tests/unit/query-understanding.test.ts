import { describe, expect, it, vi } from "vitest";

import {
  deterministicUnderstoodQuery,
  understandQuery,
  validateSemanticInterpretation,
  type SemanticInterpretation,
  type SemanticQueryInterpreter,
} from "@/lib/chat/query-understanding";
import { loadProjects } from "@/lib/knowledge/loader";
import { SemanticRecoveryUnavailableError } from "@/lib/errors";

const projects = loadProjects().map(({ slug, title }) => ({ slug, title }));
const policy = { acceptConfidence: 0.8, clarifyConfidence: 0.55 };

function candidate(overrides: Partial<SemanticInterpretation> = {}): SemanticInterpretation {
  return {
    canonicalQuery: "What is Gaurav's LinkedIn profile?",
    domain: "portfolio",
    intent: "profile-link",
    targetKind: "profile",
    projectSlug: null,
    channel: "linkedin",
    aspect: "contact",
    confidence: 0.98,
    ambiguous: false,
    ...overrides,
  };
}

function interpreter(output: unknown): SemanticQueryInterpreter {
  return { interpret: vi.fn().mockResolvedValue(output) };
}

describe("progressive query understanding", () => {
  it.each([
    "Give me your GitHub link",
    "What's your LinkedIn?",
    "Can I download Gaurav's CV?",
    "How do I contact him?",
    "Tell me about Udaan.",
    "Give me Udaan's repo.",
    "What is Gaurav studying?",
  ])("keeps the deterministic fast path free of recovery calls: %s", async (resolvedQuery) => {
    const semanticInterpreter = interpreter(candidate());
    const result = await understandQuery({
      originalQuery: resolvedQuery,
      resolvedQuery,
      projects,
      skillNames: ["JavaScript", "Python"],
      enabled: true,
      interpreter: semanticInterpreter,
      ...policy,
    });
    expect(result.kind).toBe("understood");
    expect(result.query.source).toBe("deterministic");
    expect(semanticInterpreter.interpret).not.toHaveBeenCalled();
  });

  it.each([
    ["link ed in pls", candidate()],
    ["git hb pls", candidate({
      canonicalQuery: "What is Gaurav's GitHub profile?",
      channel: "github",
    })],
    ["where he studyin", candidate({
      canonicalQuery: "Where does Gaurav study?",
      intent: "education",
      targetKind: "education",
      channel: null,
      aspect: "overview",
    })],
    ["tell me about the satlite thing", candidate({
      canonicalQuery: "Tell me about Satellite Classifier.",
      intent: "project-detail",
      targetKind: "project",
      projectSlug: "satellite-classifier",
      channel: null,
      aspect: "overview",
    })],
    ["wat he use to make the flying image project", candidate({
      canonicalQuery: "What technologies did Gaurav use for Satellite Classifier?",
      intent: "project-detail",
      targetKind: "project",
      projectSlug: "satellite-classifier",
      channel: null,
      aspect: "technology-stack",
    })],
    ["does he do ai stuffs", candidate({
      canonicalQuery: "What has Gaurav built with AI?",
      intent: "skills",
      targetKind: "skill",
      channel: null,
      aspect: "skills",
    })],
    ["can i msg him", candidate({
      canonicalQuery: "Can I send Gaurav a message?",
      intent: "contact-message",
      targetKind: "profile",
      channel: null,
      aspect: "contact",
    })],
  ] as const)("accepts a high-confidence constrained recovery: %s", async (resolvedQuery, output) => {
    const result = await understandQuery({
      originalQuery: resolvedQuery,
      resolvedQuery,
      projects,
      skillNames: ["JavaScript", "Python"],
      enabled: true,
      interpreter: interpreter(output),
      ...policy,
    });
    expect(result.kind).toBe("understood");
    expect(result.query).toMatchObject({
      canonicalQuery: output.canonicalQuery,
      source: "semantic-recovery",
      recoveryOutcome: "accepted",
      interaction: { kind: output.intent, target: { kind: output.targetKind } },
    });
  });

  it.each([
    candidate({
      intent: "project-detail",
      targetKind: "project",
      projectSlug: "banking-platform",
      channel: null,
      aspect: "overview",
    }),
    candidate({ targetKind: "project", projectSlug: "udaan" }),
    candidate({ intent: "education", channel: "linkedin", aspect: "overview" }),
    candidate({ intent: "education", channel: null, aspect: "contact" }),
  ])("rejects invented or impossible ontology combinations", (output) => {
    expect(() => validateSemanticInterpretation(output, projects))
      .toThrow(/Semantic recovery/);
  });

  it.each([
    ["invalid_confidence", candidate({ confidence: 2 })],
    ["invalid_channel", { ...candidate(), channel: "sms" }],
    ["invalid_aspect", { ...candidate(), aspect: "salary" }],
    ["schema_parse_failure", { ...candidate(), domain: undefined }],
  ] as const)("classifies malformed recovery fields as %s", (reason, output) => {
    try {
      validateSemanticInterpretation(output, projects);
      throw new Error("Expected semantic validation to fail");
    } catch (error) {
      expect(error).toMatchObject({ name: "SemanticRecoveryInvalidError", reason });
    }
  });

  it("asks for clarification instead of silently turning Java into JavaScript", async () => {
    const semanticInterpreter = interpreter(candidate({
      canonicalQuery: "Does Gaurav have Java experience?",
      intent: "skills",
      targetKind: "skill",
      channel: null,
      aspect: "proficiency",
      confidence: 0.72,
      ambiguous: true,
    }));
    const result = await understandQuery({
      originalQuery: "java experience",
      resolvedQuery: "java experience",
      projects,
      skillNames: ["JavaScript", "Python"],
      enabled: true,
      interpreter: semanticInterpreter,
      ...policy,
    });
    expect(result.kind).toBe("clarification");
    expect(result.query.canonicalQuery).toContain("Java experience");
    expect(result.query.canonicalQuery).not.toContain("JavaScript");
  });

  it("accepts a high-confidence external domain without inventing a portfolio intent", async () => {
    const result = await understandQuery({
      originalQuery: "Explain photosynthesis",
      resolvedQuery: "Explain photosynthesis",
      projects,
      skillNames: [],
      enabled: true,
      interpreter: interpreter(candidate({
        canonicalQuery: "Explain photosynthesis.",
        domain: "external",
        intent: "unknown",
        targetKind: "unknown",
        channel: null,
        aspect: null,
        confidence: 0.99,
        ambiguous: false,
      })),
      ...policy,
    });
    expect(result).toMatchObject({
      kind: "understood",
      query: {
        domain: "external",
        source: "semantic-recovery",
        recoveryOutcome: "accepted",
        interaction: { kind: "unknown", target: { kind: "unknown" } },
      },
    });
  });

  it.each([
    [candidate({ projectSlug: "invented" }), "invalid"],
    [new SemanticRecoveryUnavailableError("provider unavailable", "http_503"), "failed"],
  ] as const)("falls back to the resolved proposition after recovery failure", async (output, recoveryOutcome) => {
    const semanticInterpreter: SemanticQueryInterpreter = output instanceof Error
      ? { interpret: vi.fn().mockRejectedValue(output) }
      : interpreter(output);
    const result = await understandQuery({
      originalQuery: "show me his banking platform",
      resolvedQuery: "show me his banking platform",
      projects,
      skillNames: [],
      enabled: true,
      interpreter: semanticInterpreter,
      ...policy,
    });
    expect(result.kind).toBe("understood");
    expect(result.query).toMatchObject({
      canonicalQuery: "show me his banking platform",
      source: "deterministic",
      recoveryOutcome,
    });
  });

  it("classifies a recovery timeout and falls back without exposing provider details", async () => {
    const observe = vi.fn();
    const result = await understandQuery({
      originalQuery: "where he studyin",
      resolvedQuery: "where he studyin",
      projects,
      skillNames: [],
      enabled: true,
      interpreter: {
        interpret: vi.fn().mockRejectedValue(
          new SemanticRecoveryUnavailableError("secret upstream detail", "TimeoutError"),
        ),
      },
      observe,
      ...policy,
    });
    expect(result).toMatchObject({
      kind: "understood",
      query: { source: "deterministic", recoveryOutcome: "failed" },
    });
    expect(observe).toHaveBeenLastCalledWith({
      name: "semantic_recovery_failed",
      providerErrorType: "timeout",
    });
    expect(JSON.stringify(observe.mock.calls)).not.toContain("secret upstream detail");
  });

  it("does not hide programming errors behind the provider fallback", async () => {
    const defect = new TypeError("broken adapter contract");
    await expect(understandQuery({
      originalQuery: "where he studyin",
      resolvedQuery: "where he studyin",
      projects,
      skillNames: [],
      enabled: true,
      interpreter: { interpret: vi.fn().mockRejectedValue(defect) },
      ...policy,
    })).rejects.toBe(defect);
  });

  it("keeps disabled recovery optional", async () => {
    const query = deterministicUnderstoodQuery({
      originalQuery: "link ed in pls",
      resolvedQuery: "link ed in pls",
      projects,
    });
    expect(query).toMatchObject({ source: "deterministic", recoveryOutcome: "disabled" });
  });
});
