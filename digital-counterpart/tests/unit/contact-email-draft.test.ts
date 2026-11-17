import { describe, expect, it } from "vitest";

import { emailDraftUrl } from "@/lib/contact/email-draft";

describe("contact email drafts", () => {
  it("keeps every visitor field in the pre-addressed draft", () => {
    const url = new URL(emailDraftUrl("gaurav@example.com", {
      name: "Ada Lovelace",
      email: "ada@example.com",
      company: "Analytical Engines Ltd",
      reason: "Collaboration",
      message: "Could we discuss the interface for the new engine?",
    }));

    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("gaurav@example.com");
    expect(url.searchParams.get("subject")).toBe("Collaboration from Ada Lovelace via GauravGPT");
    expect(url.searchParams.get("body")).toBe(
      "Could we discuss the interface for the new engine?\n\nAda Lovelace\nAnalytical Engines Ltd\nada@example.com",
    );
  });

  it("omits blank optional fields without leaving empty signature lines", () => {
    const url = new URL(emailDraftUrl("gaurav@example.com", {
      name: "Grace Hopper",
      email: "grace@example.com",
      company: "",
      message: "I would like to ask about your recent project.",
    }));

    expect(url.searchParams.get("subject")).toBe("Message from Grace Hopper via GauravGPT");
    expect(url.searchParams.get("body")).toBe(
      "I would like to ask about your recent project.\n\nGrace Hopper\ngrace@example.com",
    );
  });
});
