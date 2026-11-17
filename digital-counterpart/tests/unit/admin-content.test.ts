import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedPath, GitHubContentError, serializeDocument, validateContent, writeContent } from "@/lib/admin/github-content";
import { loadProfile } from "@/lib/knowledge/loader";

describe("online content editor boundaries", () => {
  const tokenBefore = process.env.ADMIN_GITHUB_TOKEN;
  afterEach(() => {
    if (tokenBefore === undefined) delete process.env.ADMIN_GITHUB_TOKEN;
    else process.env.ADMIN_GITHUB_TOKEN = tokenBefore;
    vi.unstubAllGlobals();
  });
  it("accepts only authored knowledge paths", () => {
    expect(allowedPath("data/profile.json")).toBe(true);
    expect(allowedPath("data/projects/new-project.md")).toBe(true);
    expect(allowedPath("data/notes/new-note.md")).toBe(true);
    expect(allowedPath("data/.index/index.json")).toBe(false);
    expect(allowedPath("data/../src/auth.ts")).toBe(false);
    expect(allowedPath("README.md")).toBe(false);
    expect(allowedPath("data/projects/.hidden.md")).toBe(false);
  });

  it("serializes and validates a project form", () => {
    const text = serializeDocument("data/projects/new-project.md", {
      kind: "markdown",
      frontmatter: { title: "New project", type: "project", slug: "new-project", tags: ["React"] },
      body: "# New project\n\nI built this.",
    });
    expect(text).toContain("slug: new-project");
    expect(() => validateContent("data/projects/new-project.md", text)).not.toThrow();
    expect(() => validateContent("data/projects/new-project.md", text.replace("slug: new-project", "slug: TODO"))).toThrow(GitHubContentError);
  });

  it("rejects mismatched or empty records", () => {
    expect(() => validateContent("data/projects/thing.md", "---\ntitle: Thing\ntype: note\n---\n\nBody"))
      .toThrow("type: project");
    expect(() => validateContent("data/notes/thing.md", "---\ntitle: Thing\ntype: note\n---\n"))
      .toThrow("Add some body text");
    expect(() => validateContent("data/notes/thing.md", "---\ntitle: Thing\ntype: project\nslug: thing\n---\n\nBody"))
      .toThrow("data/projects/");
    expect(() => validateContent("data/projects/thing.md", "---\ntitle: Thing\ntype: project\nslug: thing\nurl: javascript:alert(1)\n---\n\nBody"))
      .toThrow("valid URL");
  });

  it("keeps the existing structured profile valid", () => {
    const profile = loadProfile();
    const text = serializeDocument("data/profile.json", { kind: "profile", data: profile });
    expect(() => validateContent("data/profile.json", text)).not.toThrow();
  });

  it("publishes only the selected data file to main with its version", async () => {
    process.env.ADMIN_GITHUB_TOKEN = "test-token";
    const fetchMock = vi.fn(async (url: string) => Response.json(
      url.includes("/git/trees/")
        ? { tree: [], truncated: false }
        : { commit: { html_url: "https://github.com/example/commit/1" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const text = serializeDocument("data/notes/update.md", {
      kind: "markdown", frontmatter: { title: "Update", type: "note" }, body: "An authored update.",
    });
    await expect(writeContent("data/notes/update.md", text, "old-sha"))
      .resolves.toBe("https://github.com/example/commit/1");
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/contents\/data\/notes\/update\.md$/);
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body).toMatchObject({ branch: "main", sha: "old-sha" });
    expect(Buffer.from(body.content, "base64").toString("utf8")).toBe(text);
  });
});
