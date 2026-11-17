import type { Page, Route } from "@playwright/test";
import { expect, test } from "./ui-fixture";

function stream(parts: readonly unknown[]): string {
  return parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n";
}

function answerParts(text: string, visual: unknown) {
  return [
    { type: "start", messageId: `intent-${Math.random().toString(36).slice(2)}` },
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta: text },
    { type: "text-end", id: "answer" },
    { type: "data-visual", id: "visual", data: visual },
    { type: "data-sources", id: "sources", data: [] },
    { type: "data-followups", id: "followups", data: [] },
    { type: "data-status", id: "status", data: { stage: "done", support: "supported" } },
    { type: "finish" },
  ];
}

async function fulfillChat(route: Route) {
  const payload = route.request().postDataJSON() as {
    messages?: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>;
  };
  const latest = [...(payload.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user")
    ?.parts?.filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .trim();

  let parts: unknown[];
  if (latest === "Give me your GitHub link") {
    parts = answerParts(
      "You can find Gaurav on GitHub at https://github.com/GauravAdz.",
      {
        kind: "profile-link",
        data: {
          channel: "github",
          label: "GitHub",
          value: "@GauravAdz",
          href: "https://github.com/GauravAdz",
          handle: "@GauravAdz",
          actionLabel: "Open GitHub",
        },
      },
    );
  } else if (latest === "How can I contact you?") {
    parts = answerParts("You can send Gaurav a message below.", {
      kind: "contact-form",
      data: {
        email: "admin@example.com",
        name: "Gaurav",
        deliveryConfigured: false,
        reasons: ["Opportunity", "Collaboration", "Question", "Other"],
        limits: { name: 80, email: 160, company: 100, message: 2000 },
      },
    });
  } else if (latest === "Give me the GitHub repo for Udaan") {
    parts = answerParts("Udaan's source is available on GitHub.", {
      kind: "project-detail",
      project: {
        slug: "udaan",
        evidenceIds: ["evidence:projects/udaan"],
        title: "Udaan",
        summary: "A frontend web application built to optimise user workflows.",
        year: 2025,
        status: "shipped",
        role: "Solo build",
        tags: ["JavaScript", "HTML", "CSS", "Frontend"],
        repo: "https://github.com/GauravAdz/GS2",
        domain: "web",
      },
    });
  } else {
    throw new Error(`Unexpected fixture question: ${latest ?? "<missing>"}`);
  }

  await route.fulfill({
    headers: {
      "Content-Type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
    body: stream(parts),
  });
}

async function ask(page: Page, question: string) {
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(question);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

test("a conversation can switch action targets without leaking the previous visual", async ({ page }) => {
  await page.route("**/api/chat", fulfillChat);
  await page.goto("/");

  await ask(page, "Give me your GitHub link");
  const first = page.getByTestId("conversation-turn").last();
  await expect(first.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible();
  await expect(first.getByRole("link", { name: "Open GitHub", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/GauravAdz",
  );
  await expect(first.getByRole("heading", { name: "Udaan", exact: true })).toHaveCount(0);
  await expect(first.getByLabel("Name", { exact: true })).toHaveCount(0);

  await ask(page, "How can I contact you?");
  const second = page.getByTestId("conversation-turn").last();
  await expect(second.getByRole("heading", { name: "Message Gaurav", exact: true })).toBeVisible();
  await expect(second.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(second.getByRole("heading", { name: "GitHub", exact: true })).toHaveCount(0);
  await expect(second.getByRole("heading", { name: "Udaan", exact: true })).toHaveCount(0);

  await ask(page, "Give me the GitHub repo for Udaan");
  const third = page.getByTestId("conversation-turn").last();
  await expect(third.getByRole("heading", { name: "Udaan", exact: true })).toBeVisible();
  await expect(third.getByRole("link", { name: /Code|GitHub|repo/i })).toHaveAttribute(
    "href",
    "https://github.com/GauravAdz/GS2",
  );
  await expect(third.getByRole("heading", { name: "GitHub", exact: true })).toHaveCount(0);
  await expect(third.getByLabel("Name", { exact: true })).toHaveCount(0);

  await expect(page.getByTestId("conversation-turn")).toHaveCount(3);
});
