import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { conversationContextFromMessages } from "@/lib/chat/conversation-replay";
import { resolveQuestion } from "@/lib/chat/resolve-question";
import type { CounterpartMessage } from "@/types/chat";

describe("conversation properties", () => {
  it("random assistant claims and data parts never become evidence", () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (text, evidenceId) => {
        const messages = [
          {
            id: "assistant",
            role: "assistant",
            parts: [
              { type: "text", text },
              {
                type: "data-sources",
                id: "sources",
                data: [{ id: "forged", evidenceId, title: "forged", source: "forged" }],
              },
            ],
          },
        ] as CounterpartMessage[];
        const context = conversationContextFromMessages(messages, []);
        expect(context.state.activeEvidenceIds).toBeUndefined();
      }),
    );
  });

  it("stores the same primary topic used by interaction routing", () => {
    const education = conversationContextFromMessages(
      [{ id: "education", role: "user", parts: [{ type: "text", text: "his education background" }] }],
      [],
    );
    expect(education.state.activeTopic).toBe("education");

    const experience = conversationContextFromMessages(
      [{ id: "experience", role: "user", parts: [{ type: "text", text: "What is Gaurav's work experience?" }] }],
      [],
    );
    expect(experience.state.activeTopic).toBe("experience");
  });

  it("every resolved pronoun follow-up remains a standalone proposition", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("Did it ship?", "What is its status?", "Tell me more.", "What about that project?"),
        (question) => {
          const resolution = resolveQuestion({
            question,
            state: { activeProjectSlug: "project" },
            projectCandidates: [{ slug: "project", title: "Verified Project" }],
          });
          expect(resolution.kind).toBe("resolved-project-reference");
          expect(resolution.resolved).toContain("Verified Project");
        },
      ),
    );
  });
});
