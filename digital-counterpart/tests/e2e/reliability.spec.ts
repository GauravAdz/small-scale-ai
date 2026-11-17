import { expect, test, type Page } from "@playwright/test";

async function ask(page: Page, question: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Message" });
  await input.fill(question);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("supported exact answer exposes its canonical citation", async ({ page }) => {
  await ask(page, "Where does Gaurav study?");
  await expect(page.locator(".md-body").getByText(/Johannes Kepler University Linz/)).toBeVisible();
  await page.getByRole("button", { name: /Supported by|source cited/ }).click();
  await page.locator("summary").filter({ hasText: "profile" }).click();
  await expect(page.getByText("/education", { exact: true })).not.toBeVisible();
  await page.locator("summary").filter({ hasText: "Technical details" }).click();
  await expect(page.getByText("/education", { exact: true })).toBeVisible();
});

test("role-interest question uses canonical availability interests", async ({ page }) => {
  await ask(page, "What kind of roles is Gaurav interested in?");
  const answer = page.locator(".md-body");
  await expect(answer.getByText(/Applied AI/)).toBeVisible();
  await expect(answer.getByText(/Developer tools/)).toBeVisible();
  await expect(answer.getByText(/Interface-heavy products/)).toBeVisible();
  await expect(answer.getByText(/Data science \/ ML/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Supported by|source cited/ })).toBeVisible();
});

test("adjacent mobile capability gets a labelled evidence-backed assessment", async ({ page }) => {
  await ask(
    page,
    "I wanna hire someone for my argo farm to build a mobile app, would he be able to make one?",
  );
  const answer = page.locator(".md-body");
  await expect(answer.getByText(/credible fit to build an agricultural mobile-app MVP/i)).toBeVisible();
  await expect(answer.getByText(/transferable-skills assessment/i)).toBeVisible();
  await expect(page.getByText("Udaan", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Smart Farm and Its Ecosystem", { exact: true }).first()).toBeVisible();
  const citations = page.getByRole("button", { name: "Supported by 3 portfolio records" });
  await expect(citations).toBeVisible();
  await citations.click();
  await expect(page.getByRole("region", { name: "Evidence for this answer" }).locator("ol > li"))
    .toHaveCount(3);
});

test("unsupported capability abstains and suppresses evidence visuals", async ({ page }) => {
  await ask(page, "Can Gaurav fly a plane?");
  await expect(page.getByText(/don't have|couldn't find support/i)).toBeVisible();
  await expect(page.getByRole("region", { name: "Evidence for this answer" })).toHaveCount(0);
});

test("mixed multi-clause answer preserves the supported and unknown clauses", async ({ page }) => {
  await ask(page, "Where does Gaurav study, and what grades is he getting?");
  await expect(page.locator(".md-body").getByText(/Johannes Kepler University Linz/)).toBeVisible();
  await expect(page.locator(".md-body").getByText(/not recorded/i)).toBeVisible();
});

test("project follow-up is resolved but still checked", async ({ page }) => {
  await ask(page, "Tell me about Digital Counterpart.");
  await expect(page.getByText(/evidence-backed conversational portfolio/i).first()).toBeVisible();
  await ask(page, "Did it get 10,000 users?");
  await expect(page.getByText(/don't have enough verified information/i)).toBeVisible();
});

test("contact action stays local", async ({ page }) => {
  let chatRequests = 0;
  page.on("request", request => { if (request.url().endsWith("/api/chat")) chatRequests++; });
  await page.getByRole("button", { name: "Message Gaurav Adhikari", exact: true }).click();
  await expect(page.locator(".md-body")).toContainText(/reach Gaurav by email|Send Gaurav a message/i);
  expect(chatRequests).toBe(0);
});

test("stale-index failure hides internal details", async ({ page }) => {
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "Verified index is stale." }),
  );
  await ask(page, "Where does Gaurav study?");
  const alert = page.getByRole("alert").filter({ hasText: "didn't go through" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("couldn't verify that answer right now");
  await expect(alert).not.toContainText("index");
});

test("provider failure is visible without fabricating an answer", async ({ page }) => {
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status: 500, contentType: "text/plain", body: "Verifier provider unavailable." }),
  );
  await ask(page, "Explain the project architecture.");
  const alert = page.getByRole("alert").filter({ hasText: "didn't go through" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("couldn't verify that answer right now");
  await expect(page.locator(".md-body")).toHaveCount(0);
});

test("mobile keeps the composer and about navigation available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "About", exact: true })).toBeVisible();
});

test("landing, citations and contact remain usable across desktop, mobile and zoom", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    for (const label of ["See Gaurav's strongest work", "What can Gaurav contribute?", "Is Gaurav available?"]) {
      await expect(page.getByRole("button", { name: label, exact: false })).toBeVisible();
    }
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Message Gaurav Adhikari", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${name}-landing.png`), fullPage: true });
    await ask(page, "Where does Gaurav study?");
    await page.getByRole("button", { name: /Supported by|source cited/ }).click();
    await page.locator("summary").filter({ hasText: "profile" }).click();
    await page.screenshot({ path: testInfo.outputPath(`${name}-citations.png`), fullPage: true });
    await expect(page.getByRole("button", { name: "Message Gaurav Adhikari", exact: true })).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  }
  expect(errors).toEqual([]);
});
