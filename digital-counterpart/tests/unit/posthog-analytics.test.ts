import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureTurnAnalytics,
  structuredInterpretationAnalytics,
} from "@/lib/analytics/posthog";

const event = {
  requestId: "request-123",
  route: "answer" as const,
  interpretation: {
    interaction: {
      kind: "profile-link" as const,
      target: { kind: "profile" as const },
      channel: "github" as const,
    },
    source: "semantic-recovery" as const,
    recoveryOutcome: "accepted" as const,
  },
  visualKind: "profile-link" as const,
  support: "supported" as const,
  rendering: "deterministic" as const,
  citationCount: 1,
  followUpCount: 0,
};

afterEach(() => vi.restoreAllMocks());

describe("PostHog turn analytics", () => {
  it("strips every query-text field at the analytics boundary", () => {
    const privateText = "unique visitor wording that must stay private";
    const interpretation = structuredInterpretationAnalytics({
      originalQuery: privateText,
      resolvedQuery: privateText,
      canonicalQuery: privateText,
      domain: "portfolio",
      interaction: event.interpretation.interaction,
      target: { kind: "profile" },
      qualifiers: { contactChannel: "github" },
      responseShape: { mode: "normal" },
      source: "semantic-recovery",
      confidence: 0.98,
      ambiguous: false,
      recoveryOutcome: "accepted",
    });
    expect(JSON.stringify(interpretation)).not.toContain(privateText);
    expect(interpretation).toEqual(event.interpretation);
  });

  it("does nothing unless both PostHog settings are configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await captureTurnAnalytics(event, { NODE_ENV: "test" });
    await captureTurnAnalytics(event, { NODE_ENV: "test", POSTHOG_PROJECT_KEY: "phc_test" });
    await captureTurnAnalytics(event, { NODE_ENV: "test", POSTHOG_HOST: "https://eu.i.posthog.com" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("captures only structured routing metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await captureTurnAnalytics(event, {
      NODE_ENV: "test",
      POSTHOG_PROJECT_KEY: "phc_test",
      POSTHOG_HOST: "https://eu.i.posthog.com",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://eu.i.posthog.com/capture/");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toEqual({
      api_key: "phc_test",
      event: "counterpart_chat_turn",
      properties: {
        distinct_id: "request-123",
        $process_person_profile: false,
        $lib: "digital-counterpart",
        route: "answer",
        interpretation_source: "semantic-recovery",
        recovery_used: true,
        recovery_outcome: "accepted",
        interaction_kind: "profile-link",
        target_kind: "profile",
        channel: "github",
        visual_kind: "profile-link",
        support_status: "supported",
        rendering: "deterministic",
        citation_count: 1,
        follow_up_count: 0,
      },
    });

    const fieldNames = new Set<string>();
    const collectFieldNames = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) collectFieldNames(item);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        fieldNames.add(key.toLowerCase());
        collectFieldNames(nested);
      }
    };
    collectFieldNames(payload);

    for (const forbidden of [
      "question",
      "answer",
      "email",
      "citation_text",
      "evidence",
      "ip_address",
    ]) {
      expect(fieldNames.has(forbidden)).toBe(false);
    }
  });

  it("never lets capture failures escape into the chat path", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));
    await expect(
      captureTurnAnalytics(event, {
        NODE_ENV: "test",
        POSTHOG_PROJECT_KEY: "phc_test",
        POSTHOG_HOST: "https://eu.i.posthog.com",
      }),
    ).resolves.toBeUndefined();
  });
});
