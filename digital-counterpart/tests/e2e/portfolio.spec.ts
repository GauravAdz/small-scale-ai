import type { Page } from "@playwright/test";
import { expect, test } from "./ui-fixture";

/** A deliberately slow transport fixture tests reading order without paid model calls. */
async function installSlowAnswer(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/api/chat")) return originalFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          const emit = (part: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
          emit({ type: "start", messageId: `fixture-${Date.now()}` });
          emit({ type: "data-visual", id: "visual", data: { kind: "projects", heading: "Supporting work", projects: [{ slug: "fixture", title: "Supporting project", summary: "Supporting material follows the complete answer.", tags: [], domain: "web", evidenceIds: [] }] } });
          emit({ type: "text-start", id: "answer" });
          emit({ type: "text-delta", id: "answer", delta: "Read this opening first.\n\n" });
          const grow = setTimeout(() => {
            emit({ type: "text-delta", id: "answer", delta: Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1}: This longer response gives the visitor room to scroll at their own pace, with the opening still available above.`).join("\n\n") });
          }, 500);
          const finish = setTimeout(() => {
            emit({ type: "text-end", id: "answer" });
            emit({ type: "finish" });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }, 1600);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(grow);
            clearTimeout(finish);
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
    };
  });
}

async function installCvAnswer(page: Page) {
  await page.route("**/api/chat", route => route.fulfill({
    contentType: "text/event-stream",
    headers: { "x-vercel-ai-ui-message-stream": "v1" },
    body: [
      `data: ${JSON.stringify({ type: "start", messageId: "cv-fixture" })}`,
      `data: ${JSON.stringify({ type: "text-start", id: "answer" })}`,
      `data: ${JSON.stringify({ type: "text-delta", id: "answer", delta: "You can download Gaurav's CV below." })}`,
      `data: ${JSON.stringify({ type: "text-end", id: "answer" })}`,
      `data: ${JSON.stringify({ type: "data-visual", id: "visual", data: { kind: "profile-link", data: { channel: "resume", label: "Curriculum vitae", value: "Gaurav Adhikari's CV", href: "/resume.pdf", handle: "PDF", actionLabel: "Download CV", download: true } } })}`,
      `data: ${JSON.stringify({ type: "finish" })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  }));
}

async function ask(page: Page, question: string) {
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(question);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px portfolio`, () => {
    test.use({ viewport });

    test("home navigation, CV and expanded work are usable with reduced motion", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      const hero = page.locator("#home");
      const headerBox = await page.locator("header").boundingBox();
      const heroBox = await hero.boundingBox();
      expect(heroBox?.height).toBeGreaterThanOrEqual(viewport.height - (headerBox?.height ?? 64) - 1);
      await expect(page.getByRole("heading", { name: "Gaurav Adhikari", exact: true })).toBeInViewport();
      await expect(page.getByText("Applied AI & Software Builder", { exact: true })).toBeVisible();
      const titleBox = await page.getByText("Applied AI & Software Builder", { exact: true }).boundingBox();
      const locationBox = await page.locator(".hero-location").boundingBox();
      expect(locationBox?.y).toBeGreaterThan((titleBox?.y ?? 0) + (titleBox?.height ?? 0));
      await expect(page.getByText("I build intelligent systems and interactive web applications that solve real-world problems.", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("img", { name: "Portrait of Gaurav Adhikari", exact: true })).toBeVisible();
      await expect(page.getByText("Open to internships, part-time technical roles & collaborations", { exact: true })).toBeVisible();
      await expect(page.getByText("Ask GauravGPT", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Ask about my projects, skills, experience or availability.", { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("home-scroll").getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
      await expect(page.getByTestId("conversation-composer")).toHaveCount(0);
      if (viewport.width < 640) {
        const portraitBox = await page.locator(".hero-portrait-image").boundingBox();
        const captionBox = await page.locator(".hero-availability").boundingBox();
        expect(portraitBox?.width).toBeGreaterThan(300);
        expect(captionBox?.width).toBeGreaterThan(300);
        expect(captionBox?.y).toBeGreaterThan((portraitBox?.y ?? 0) + (portraitBox?.height ?? 0));
      }
      await expect(page.getByRole("link", { name: "Download CV" })).toBeInViewport();
      if (viewport.width < 640) {
        await page.getByRole("link", { name: "Explore my work", exact: true }).click();
      } else {
        await page.getByRole("navigation").getByRole("link", { name: "Work", exact: true }).click();
      }
      await expect(page.getByRole("heading", { name: "Selected work" })).toBeInViewport();
      const work = page.getByRole("region", { name: "Selected work", exact: true });
      const initialCount = await work.locator("article").count();
      await work.getByRole("button", { name: "View more", exact: true }).click();
      await expect(work.getByRole("button", { name: "View less" })).toHaveAttribute("aria-expanded", "true");
      expect(await work.locator("article").count()).toBeGreaterThan(initialCount);
      await expect(work.getByRole("heading", { name: "Digital Counterpart", exact: true })).toBeVisible();
      await work.getByRole("button", { name: "View less" }).click();
      await expect(work.locator("article")).toHaveCount(initialCount);
      if (viewport.width < 640) {
        await page.locator("#about").scrollIntoViewIfNeeded();
      } else {
        await page.getByRole("navigation").getByRole("link", { name: "About", exact: true }).click();
      }
      await expect(page.getByRole("heading", { name: "A few things about me" })).toBeInViewport();
      await expect(page.getByText("Hi, I'm Gaurav", { exact: false })).toHaveCount(0);
      for (const heading of ["Applied AI", "Robotics", "Full-stack software", "Based in Linz"]) {
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }
      await page.getByRole("link", { name: "Gaurav Adhikari — home" }).click();
      await expect(page.getByRole("heading", { name: "Gaurav Adhikari", exact: true })).toBeFocused();
      const contactButton = page.getByRole("button", { name: "Message Gaurav Adhikari", exact: true });
      await expect(contactButton).toContainText(viewport.width < 640 ? "Message" : "Contact");
      await contactButton.click();
      await expect(page.getByTestId("conversation-composer")).toBeVisible();
      await expect(page.locator(".md-body")).toContainText(/Write Gaurav a message|Send Gaurav a message/);
      const contact = page.locator("section").filter({ has: page.getByRole("heading", { name: "Message Gaurav", exact: true }) });
      await expect(contact.getByLabel("Name")).toBeVisible();
      await expect(contact.getByLabel("Email")).toBeVisible();
      await expect(contact.getByLabel("Message")).toBeVisible();
      await expect(page.getByRole("navigation").getByRole("link")).toHaveCount(1);
      await expect(page.getByRole("navigation").getByRole("link", { name: "Home", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to home" })).toHaveCount(0);
      await expect(page.getByText("Conversation with GauravGPT", { exact: true })).toHaveCount(0);
      await page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }).click();
      await expect(page.getByTestId("conversation-composer")).toHaveCount(0);
      await page.getByRole("main").getByRole("button", { name: "Resume conversation", exact: true }).click();
      await expect(page.getByTestId("conversation-composer")).toBeVisible();
      await expect(page.locator(".md-body")).toContainText(/Write Gaurav a message|Send Gaurav a message/);
      await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("long streamed answers preserve the opening and delay supporting visuals", async ({ page }) => {
      await installSlowAnswer(page);
      await page.goto("/");
      await ask(page, "Show the first long answer.");
      const opening = page.locator(".md-body p").first();
      await expect(opening).toHaveText("Read this opening first.");
      await expect(page.getByRole("heading", { name: "Supporting project", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
      await expect(opening).toBeInViewport();
      expect(await page.getByTestId("conversation-scroll").evaluate(node => node.scrollTop)).toBeLessThan(50);
      await expect(page.getByRole("heading", { name: "Supporting project", exact: true })).toHaveCount(1);
      await ask(page, "Show a follow-up answer.");
      const secondOpening = page.getByTestId("conversation-turn").last().locator(".md-body p").first();
      await expect(secondOpening).toBeInViewport();
      await expect(page.getByRole("button", { name: "Jump to latest answer", exact: true })).toHaveCount(0);
      await page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Gaurav Adhikari", exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
      await page.getByRole("main").getByRole("button", { name: "Resume conversation", exact: true }).click();
      await expect(secondOpening).toBeInViewport();
      await expect(page.getByTestId("conversation-turn")).toHaveCount(2);
      await page.getByTestId("conversation-scroll").evaluate(node => { node.scrollTop = 0; });
      await expect(opening).toBeInViewport();
      const jump = page.getByRole("button", { name: "Jump to latest answer", exact: true });
      await expect(jump).toBeVisible();
      await jump.click();
      await expect(secondOpening).toBeInViewport();
      await expect(jump).toHaveCount(0);
      await page.getByTestId("conversation-scroll").evaluate(node => { node.scrollTop += 240; });
      await expect(jump).toHaveCount(0);
    });

    test("a CV request reveals a named PDF download", async ({ page }) => {
      await installCvAnswer(page);
      await page.goto("/");
      await ask(page, "Can I download Gaurav's CV?");
      await expect(page.locator(".md-body")).toContainText("You can download Gaurav's CV below.");
      const download = page.getByRole("link", { name: "Download CV", exact: true });
      await expect(download).toHaveAttribute("href", "/resume.pdf");
      await expect(download).toHaveAttribute("download", "Gaurav-Adhikari-CV.pdf");
    });
  });
}

test("the hero has no horizontal overflow across phone sizes", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 700 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const metrics = await page.getByTestId("home-scroll").evaluate((scroller) => {
      const portrait = scroller.querySelector<HTMLElement>(".hero-portrait-image")?.getBoundingClientRect();
      const caption = scroller.querySelector<HTMLElement>(".hero-availability")?.getBoundingClientRect();
      const starters = scroller.querySelector<HTMLElement>('[aria-label="Question starters"]');
      return {
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
        portrait,
        caption,
        starters: starters ? { clientWidth: starters.clientWidth, scrollWidth: starters.scrollWidth } : null,
      };
    });

    expect(metrics.scrollWidth).toBe(metrics.clientWidth);
    expect(metrics.portrait?.width).toBeLessThanOrEqual(viewport.width - 40);
    expect(metrics.caption?.width).toBeLessThanOrEqual(viewport.width - 40);
    expect(metrics.caption?.y).toBeGreaterThan((metrics.portrait?.y ?? 0) + (metrics.portrait?.height ?? 0));
    expect(metrics.starters?.scrollWidth).toBe(metrics.starters?.clientWidth);
    const exploreBox = await page.getByRole("link", { name: "Explore my work", exact: true }).boundingBox();
    const cvBox = await page.getByRole("link", { name: "Download CV", exact: true }).boundingBox();
    expect(exploreBox).not.toBeNull();
    expect(cvBox).not.toBeNull();
    if (!exploreBox || !cvBox) throw new Error("Landing actions are missing");
    expect(exploreBox.y).toBe(cvBox.y);
    expect(exploreBox.height).toBeGreaterThanOrEqual(44);
    expect(cvBox.height).toBeGreaterThanOrEqual(44);
    expect(exploreBox.y).toBeGreaterThan(0);
    expect(cvBox.y).toBeGreaterThan(0);
    expect(exploreBox.y + exploreBox.height).toBeLessThanOrEqual(viewport.height);
    expect(cvBox.y + cvBox.height).toBeLessThanOrEqual(viewport.height);
    const starters = page.getByRole("list", { name: "Question starters" });
    const starterBox = await starters.boundingBox();
    expect(starterBox?.height).toBeLessThanOrEqual(44);
    for (const label of ["See Gaurav's strongest work", "What can Gaurav contribute?", "Is Gaurav available?"]) {
      const starter = starters.getByRole("button", { name: label, exact: true });
      await expect(starter).toBeVisible();
      expect((await starter.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  }

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    const zoomMetrics = await page.getByTestId("home-scroll").evaluate((scroller) => {
      const actions = [...scroller.querySelectorAll<HTMLElement>(".hero-action-links a")];
      return {
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
        actionWidths: actions.map(action => ({ clientWidth: action.clientWidth, scrollWidth: action.scrollWidth })),
        actionYs: actions.map(action => action.getBoundingClientRect().y),
      };
    });
    expect(zoomMetrics.scrollWidth).toBe(zoomMetrics.clientWidth);
    expect(zoomMetrics.actionWidths).toHaveLength(2);
    for (const action of zoomMetrics.actionWidths) expect(action.scrollWidth).toBe(action.clientWidth);
    expect(zoomMetrics.actionYs[1]).toBeGreaterThan(zoomMetrics.actionYs[0]);
  }
});

test("homepage metadata and crawler routes identify Gaurav Adhikari", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Gaurav Adhikari — Applied AI & Software Builder");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://gauravadhikari.info.np");

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const structured = JSON.parse(jsonLd ?? "{}") as { "@graph"?: Array<{ "@type"?: string }> };
  expect(structured["@graph"]?.map(node => node["@type"])).toEqual(expect.arrayContaining(["ProfilePage", "Person", "WebSite"]));

  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("User-Agent: OAI-SearchBot");
  expect(await robots.text()).toContain("Sitemap: https://gauravadhikari.info.np/sitemap.xml");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("<loc>https://gauravadhikari.info.np/</loc>");

  await page.goto("/preview");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("a focused skill answer shows its ratings and linked projects without filter controls", async ({ page }) => {
  const projects = [
    { slug: "udaan", title: "Udaan", year: 2025, tags: ["React"], domain: "web", evidenceIds: [] },
    { slug: "counterpart", title: "Digital Counterpart", year: 2026, tags: ["Next.js"], domain: "web", evidenceIds: [] },
    { slug: "robot", title: "Robot", year: 2024, tags: ["Arduino"], domain: "hardware", evidenceIds: [] },
  ];
  const events = [
    { type: "start", messageId: "focused-skill-fixture" },
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta: "Gaurav's web-development proficiency appears Intermediate." },
    { type: "text-end", id: "answer" },
    { type: "data-visual", id: "visual", data: { kind: "evidence-atlas", data: {
      capabilities: [{
        id: "web-development",
        label: "Web Development",
        skills: [{ name: "JavaScript", level: "Intermediate" }, { name: "HTML/CSS", level: "Experienced" }],
        projectSlugs: ["udaan", "counterpart"],
      }],
      projects,
    } } },
    { type: "finish" },
  ];
  await page.route("**/api/chat", route => route.fulfill({
    headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
    body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
  }));
  await page.goto("/");
  await ask(page, "How proficient is Gaurav in web development?");

  const explorer = page.getByRole("region", { name: "Skills and projects", exact: true });
  await expect(explorer.getByText("Web Development", { exact: true })).toBeVisible();
  await expect(explorer.getByLabel("Web Development skills")).toContainText("JavaScript · Intermediate");
  await expect(explorer.getByLabel("Web Development skills")).toContainText("HTML/CSS · Experienced");
  await expect(explorer.locator("details")).toHaveCount(2);
  await expect(explorer.getByRole("button", { name: "All projects", exact: true })).toHaveCount(0);
  await expect(explorer.getByRole("button", { name: "Web Development", exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`formatted claims keep their citations and project metadata distinct at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const claims = [
      "Appogeny is the first project in the authored portfolio order.",
      "Digital Counterpart is the second project in that order.",
      "Smart Farm and Its Ecosystem is the third project in that order.",
    ];
    const events = [
      { type: "start", messageId: `formatted-claims-${viewport.width}` },
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: claims.map((claim) => `- ${claim}`).join("\n") },
      { type: "text-end", id: "answer" },
      { type: "data-visual", id: "visual", data: { kind: "projects", heading: "Selected work", projects: [
        { slug: "appogeny", title: "Appogeny", year: 2025, status: "shipped", tags: ["AI"], domain: "ai", evidenceIds: ["project:appogeny"] },
        { slug: "satellite-classifier", title: "Satellite Classifier With a Deliberately Long Project Name", status: "completed", tags: ["Computer Vision"], domain: "ai", evidenceIds: ["project:satellite-classifier"] },
      ] } },
      { type: "data-sources", id: "sources", data: claims.map((claim, index) => ({
        id: `citation-${index}`,
        claimId: `claim-${index}`,
        evidenceId: `project:portfolio-order:${index}`,
        claimText: claim,
        title: "Portfolio order",
        source: "data/profile.json",
        jsonPointer: "/pinnedProjects",
        provenance: "portfolio-record",
      })) },
      { type: "data-followups", id: "followups", data: [] },
      { type: "data-status", id: "status", data: { stage: "done", support: "supported" } },
      { type: "finish" },
    ];
    await page.route("**/api/chat", route => route.fulfill({
      headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    }));

    await page.goto("/");
    await ask(page, "What are Gaurav's most prominent projects?");

    const turn = page.getByTestId("conversation-turn").last();
    const answer = turn.locator(".md-body");
    await expect(answer.locator("ul > li")).toHaveCount(3);
    await expect(answer.locator("li ul")).toHaveCount(0);
    for (const claim of claims) await expect(answer.getByText(claim, { exact: true })).toBeVisible();

    await expect(turn.getByRole("heading", { name: "Selected work", exact: true })).toBeVisible();
    const appogenyText = await turn.getByRole("heading", { name: "Appogeny", exact: true })
      .evaluate((heading) => heading.closest("li")?.textContent ?? "");
    expect(appogenyText).toContain("2025");
    expect(appogenyText).toContain("shipped");
    const satelliteText = await turn.getByRole("heading", { name: "Satellite Classifier With a Deliberately Long Project Name", exact: true })
      .evaluate((heading) => heading.closest("li")?.textContent ?? "");
    expect(satelliteText).not.toMatch(/\b\d{4}\b/);
    expect(satelliteText).toContain("completed");

    await turn.getByRole("button", { name: "Supported by 1 portfolio record", exact: true }).click();
    const evidence = turn.getByRole("region", { name: "Evidence for this answer", exact: true });
    await expect(evidence.locator("ol > li")).toHaveCount(3);
    for (const [index, claim] of claims.entries()) {
      await evidence.locator("summary").filter({ hasText: "Portfolio order" }).nth(index).click();
      await expect(evidence.getByText(claim, { exact: true })).toBeVisible();
    }

    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport();
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`a GitHub profile answer renders one compact link at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const events = [
      { type: "start", messageId: "profile-link-fixture" },
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: "You can find Gaurav on GitHub at https://github.com/GauravAdz." },
      { type: "text-end", id: "answer" },
      { type: "data-visual", id: "visual", data: { kind: "profile-link", data: {
        channel: "github",
        label: "GitHub",
        value: "@GauravAdz",
        href: "https://github.com/GauravAdz",
        handle: "@GauravAdz",
        actionLabel: "Open GitHub",
      } } },
      { type: "finish" },
    ];
    await page.route("**/api/chat", route => route.fulfill({
      headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    }));

    await page.goto("/");
    await ask(page, "Give me your GitHub link");

    const card = page.locator("section").filter({
      has: page.getByRole("heading", { name: "GitHub", exact: true }),
    });
    await expect(card).toContainText("@GauravAdz");
    const link = card.getByRole("link", { name: "Open GitHub", exact: true });
    await expect(link).toHaveAttribute("href", "https://github.com/GauravAdz");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect((await card.boundingBox())?.width).toBeLessThanOrEqual(460);
    await expect(page.getByRole("heading", { name: "Udaan", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  });
}

test("contact drafts survive a trip home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Message Gaurav Adhikari", exact: true }).click();
  const contact = page.locator("section").filter({ has: page.getByRole("heading", { name: "Message Gaurav", exact: true }) });
  await contact.getByLabel("Name").fill("Ada Lovelace");
  await contact.getByLabel("Email").fill("ada@example.com");
  await contact.getByLabel("Message").fill("I would like to discuss a collaboration.");

  await page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("main").getByRole("button", { name: "Resume conversation", exact: true }).click();

  await expect(contact.getByLabel("Name")).toHaveValue("Ada Lovelace");
  await expect(contact.getByLabel("Email")).toHaveValue("ada@example.com");
  await expect(contact.getByLabel("Message")).toHaveValue("I would like to discuss a collaboration.");
});

test("stopped turns recover through home without losing the conversation", async ({ page }) => {
  await installSlowAnswer(page);
  await page.goto("/");
  await ask(page, "A response to stop.");
  await page.getByRole("button", { name: "Stop generating" }).click();
  await expect(page.getByRole("status")).toContainText("Response stopped");
  await page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("main").getByRole("button", { name: "Resume conversation", exact: true }).click();
  await expect(page.getByTestId("conversation-turn")).toHaveCount(1);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`short replies cannot scroll into a blank page at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    for (let index = 0; index < 3; index++) {
      await page.getByRole("button", { name: "Message Gaurav Adhikari", exact: true }).click();
    }
    const scroller = page.getByTestId("conversation-scroll");
    const turn = page.getByTestId("conversation-turn").last();
    expect(await turn.evaluate(node => {
      const content = node.lastElementChild!;
      return node.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom;
    })).toBeLessThan(2);
    await scroller.hover();
    await page.mouse.wheel(0, 10000);
    await expect(turn.locator("section")).toBeInViewport();
    await page.mouse.wheel(0, 10000);
    await expect(page.getByRole("banner")).toBeInViewport();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await scroller.evaluate(node => node.scrollTop <= node.scrollHeight - node.clientHeight + 1)).toBe(true);
  });

  test(`skills explorer filters and expands without a movable canvas at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const projects = Array.from({ length: 8 }, (_, index) => ({
      slug: `sample-${index}`, title: `Sample project ${index + 1}`, summary: `Details for sample project ${index + 1}.`,
      year: 2026, tags: [index % 2 ? "Python" : "React"], domain: index % 2 ? "data" : "web", evidenceIds: [],
    }));
    const events = [
      { type: "start", messageId: "explorer-fixture" },
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: "Explore these sample projects by skill." },
      { type: "text-end", id: "answer" },
      { type: "data-visual", id: "visual", data: { kind: "evidence-atlas", data: {
        capabilities: [
          { id: "web", label: "Web", skills: [{ name: "React" }], projectSlugs: projects.filter((_, index) => index % 2 === 0).map(project => project.slug) },
          { id: "data", label: "Data", skills: [{ name: "Python" }], projectSlugs: projects.filter((_, index) => index % 2 === 1).map(project => project.slug) },
          { id: "empty", label: "Other", skills: [], projectSlugs: [] },
        ], projects,
      } } },
      { type: "finish" },
    ];
    await page.route("**/api/chat", route => route.fulfill({
      headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    }));
    await page.goto("/");
    await ask(page, "Show skills and projects.");
    const explorer = page.getByRole("region", { name: "Skills and projects", exact: true });
    await expect(explorer.locator("details")).toHaveCount(8);
    await explorer.getByRole("button", { name: "Web", exact: true }).click();
    await expect(explorer.locator("details")).toHaveCount(4);
    await expect(explorer.getByRole("button", { name: "Web", exact: true })).toHaveAttribute("aria-pressed", "true");
    await explorer.locator("summary").filter({ hasText: "Sample project 1" }).click();
    await expect(explorer.getByText("Details for sample project 1.", { exact: true })).toBeVisible();
    await expect(explorer.getByRole("button", { name: "Ask about Sample project 1", exact: true })).toBeVisible();
    await explorer.getByRole("button", { name: "Other", exact: true }).click();
    await expect(explorer.getByText("No linked projects are listed for this skill.")).toBeVisible();
    await explorer.getByRole("button", { name: "All projects", exact: true }).click();
    await expect(explorer.locator("details")).toHaveCount(8);
    await explorer.locator("summary").first().hover();
    await page.mouse.wheel(0, 10000);
    await expect(explorer.locator("summary").last()).toBeInViewport();
    await page.mouse.wheel(0, 10000);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole("banner")).toBeInViewport();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport();
    await expect(page.locator(".react-flow")).toHaveCount(0);
  });
}
