import { afterEach, describe, expect, it, vi } from "vitest";

import { chatErrorResponse } from "@/lib/chat/error-response";
import { ProviderUnavailableError } from "@/lib/errors";
import { POST } from "@/app/api/chat/route";

afterEach(() => vi.unstubAllEnvs());

describe("chat provider failure response", () => {
  it("returns 503 without exposing provider details or credentials", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = chatErrorResponse(
      new ProviderUnavailableError(
        "upstream rejected secret azure-secret",
        {
          provider: "azure",
          model: "gauravgpt-gpt54",
          code: "http_429",
          requestId: "provider-request",
          retryable: true,
        },
      ),
      "app-request",
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    const body = await response.text();
    expect(body).toContain("couldn't verify that answer right now");
    expect(body).not.toContain("azure-secret");
    expect(body).not.toContain("gauravgpt-gpt54");
  });

  it("maps verifier configuration failure at the chat route to HTTP 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("LLM_PROVIDER", "azure");
    vi.stubEnv("LLM_VERIFIER_PROVIDER", "azure");
    vi.stubEnv("LLM_VERIFIER_MODEL", "");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "Tell me about Gaurav." }] }],
      }),
    }));

    expect(response.status).toBe(503);
  });
});
