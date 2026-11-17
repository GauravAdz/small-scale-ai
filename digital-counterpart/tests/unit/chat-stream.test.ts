import { afterEach, describe, expect, it, vi } from "vitest";
import { answerPortfolioQuestion } from "@/lib/chat/pipeline";
import { POST } from "@/app/api/chat/route";
import { ProviderUnavailableError } from "@/lib/errors";

vi.mock("@/lib/chat/pipeline", () => ({ answerPortfolioQuestion: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const request = () => new Request("http://localhost/api/chat", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Compare Gaurav's architecture." }] }] }),
});

describe("real progress streaming", () => {
  it("delivers progress before verification completes", async () => {
    vi.stubEnv("RATE_LIMIT_ENABLED", "false");
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(answerPortfolioQuestion).mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.("searching");
      onProgress?.("verifying");
      await blocked;
      return { kind: "local", text: "Completed." };
    });
    const response = await POST(request());
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("searching");
    expect(first).not.toContain("Completed");
    finish();
    let remaining = "";
    while (true) { const chunk = await reader.read(); if (chunk.done) break; remaining += new TextDecoder().decode(chunk.value); }
    expect(remaining).toContain("Completed.");
  });

  it("streams a sanitized provider error with no factual answer, citations, or insufficient status", async () => {
    vi.stubEnv("RATE_LIMIT_ENABLED", "false");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(answerPortfolioQuestion).mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.("verifying");
      throw new ProviderUnavailableError("secret provider response", { code: "http_503" });
    });
    const response = await POST(request());
    const stream = await response.text();
    expect(stream).toContain("couldn't verify that answer right now");
    expect(stream).toContain('"stage":"error"');
    expect(stream).not.toMatch(/secret|insufficient|text-delta|data-sources|data-visual/);
  });
});
