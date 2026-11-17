import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const profile = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/profile.json"), "utf8")) as Record<string, unknown>;
const profileText = `${JSON.stringify(profile, null, 2)}\n`;
const projectText = "---\ntitle: Example project\ntype: project\nslug: example-project\ntags: [React]\n---\n\n# Example project\n\nA concrete example.\n";
const projectDocument = {
  kind: "markdown",
  frontmatter: { title: "Example project", type: "project", slug: "example-project", tags: ["React"] },
  body: "# Example project\n\nA concrete example.\n",
};

test("the online editor publishes a profile update and keeps the file list usable on mobile", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/admin/content**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      submitted = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { commitUrl: "https://github.com/GauravAdz/digital-counterpart/commit/example" } });
    } else if (url.searchParams.get("path") === "data/profile.json") {
      await route.fulfill({ json: { path: "data/profile.json", sha: "profile-sha", content: profileText, document: { kind: "profile", data: profile } } });
    } else if (url.searchParams.get("path") === "data/projects/example-project.md") {
      await route.fulfill({ json: { path: "data/projects/example-project.md", sha: "project-sha", content: projectText, document: projectDocument } });
    } else {
      await route.fulfill({ json: [
        { path: "data/profile.json", sha: "profile-sha" },
        { path: "data/projects/example-project.md", sha: "project-sha" },
      ] });
    }
  });

  await page.goto("/preview/admin");
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Gaurav Adhikari");
  if (process.env.ADMIN_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.ADMIN_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.ADMIN_SCREENSHOT_DIR, "desktop.png"), fullPage: true });
  }
  await name.fill("Updated Name");
  await page.getByRole("button", { name: "Publish change" }).click();
  await expect(page.getByRole("status")).toContainText("Published to GitHub");
  expect(submitted).toMatchObject({ action: "save", path: "data/profile.json", sha: "profile-sha" });
  const posted = submitted as unknown as { document: { data: { name: string } } };
  expect(posted.document.data.name).toBe("Updated Name");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "example project" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Example project");
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  await expect(page.getByLabel("Markdown source")).toHaveValue(/# Example project/);
  await page.getByRole("button", { name: "Use fields" }).click();
  if (process.env.ADMIN_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.ADMIN_SCREENSHOT_DIR, "mobile.png"), fullPage: true });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("File name").fill("career-update");
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByText("data/notes/career-update.md")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Career update");
  await page.getByLabel("Body", { exact: true }).fill("# Career update\n\nA new authored fact.");
  await expect(page.getByRole("button", { name: "Publish change" })).toBeEnabled();
});
