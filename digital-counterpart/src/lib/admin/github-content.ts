import matter from "gray-matter";
import { z } from "zod";

import { frontmatterSchema, profileSchema } from "@/lib/knowledge/schema";

export const REPO = "GauravAdz/small-scale-ai";
export const BRANCH = "main";
// The editor exposes app-relative paths (data/*), but this app lives in a monorepo.
const REPO_PATH_PREFIX = "digital-counterpart/";
function repoPath(path: string): string {
  return `${REPO_PATH_PREFIX}${path}`;
}
const API = `https://api.github.com/repos/${REPO}`;

export type ContentFile = { path: string; sha: string; content: string; document: EditorDocument };
export type ContentEntry = { path: string; sha: string };
export type EditorDocument =
  | { kind: "profile"; data: Record<string, unknown> }
  | { kind: "markdown"; frontmatter: Record<string, unknown>; body: string };

export class GitHubContentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function token(): string {
  const value = process.env.ADMIN_GITHUB_TOKEN?.trim();
  if (!value) throw new GitHubContentError("Repository publishing is not configured.", 503);
  return value;
}

async function github<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    const message = response.status === 409 || response.status === 422
      ? "This file changed since you opened it. Reload it, then try again."
      : response.status === 404
        ? "The file was not found in the repository."
        : response.status === 401 || response.status === 403
          ? "Repository access failed. Check the admin token and its Contents permission."
          : "GitHub could not complete this request. Try again.";
    throw new GitHubContentError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export function allowedPath(path: string): boolean {
  return path === "data/profile.json" ||
    /^data\/(?!\.)[a-z0-9-]+(?:\/(?!\.)[a-z0-9-]+)*\.md$/.test(path);
}

function validLink(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateContent(path: string, content: string): void {
  if (!allowedPath(path)) throw new GitHubContentError("Choose a file inside data/.", 400);
  if (content.length === 0 || content.length > 100_000) {
    throw new GitHubContentError("Content must be between 1 and 100,000 characters.", 400);
  }
  if (path === "data/profile.json") {
    try {
      const profile = profileSchema.parse(JSON.parse(content));
      if (!/^\S+@\S+\.\S+$/.test(profile.contact.email)) {
        throw new GitHubContentError("Enter a valid contact email address.", 400);
      }
      const links = [
        ...Object.values(profile.contact).filter((value): value is string => Boolean(value) && value !== profile.contact.email),
        ...profile.links.map((link) => link.href),
      ];
      if (links.some((link) => !validLink(link))) {
        throw new GitHubContentError("A profile link is not a valid URL.", 400);
      }
    } catch (error) {
      if (error instanceof GitHubContentError) throw error;
      throw new GitHubContentError(
        error instanceof z.ZodError
          ? `Profile is invalid: ${error.issues[0]?.path.join(".")}: ${error.issues[0]?.message}`
          : "Profile must be valid JSON.",
        400,
      );
    }
    return;
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    throw new GitHubContentError("The Markdown frontmatter is invalid.", 400);
  }
  const frontmatter = frontmatterSchema.safeParse({ title: parsed.data.title, ...parsed.data });
  if (!frontmatter.success) {
    throw new GitHubContentError(`Frontmatter is invalid: ${frontmatter.error.issues[0]?.message}`, 400);
  }
  if (!parsed.content.trim()) throw new GitHubContentError("Add some body text before publishing.", 400);
  if (path.startsWith("data/projects/") && frontmatter.data.type !== "project") {
    throw new GitHubContentError("Files in projects/ need type: project.", 400);
  }
  if (!path.startsWith("data/projects/") && frontmatter.data.type === "project") {
    throw new GitHubContentError("Project records belong in data/projects/.", 400);
  }
  if (frontmatter.data.type === "project" && !frontmatter.data.slug) {
    throw new GitHubContentError("Projects need a slug in the frontmatter.", 400);
  }
  if ([frontmatter.data.url, frontmatter.data.repo].some((link) => link && !validLink(link))) {
    throw new GitHubContentError("A project link is not a valid URL.", 400);
  }
}

export function serializeDocument(path: string, document: EditorDocument): string {
  if (path === "data/profile.json" && document.kind === "profile") {
    return `${JSON.stringify(document.data, null, 2)}\n`;
  }
  if (path.endsWith(".md") && document.kind === "markdown") {
    return matter.stringify(document.body.trimEnd() + "\n", document.frontmatter);
  }
  throw new GitHubContentError("The editor data does not match this file.", 400);
}

export async function listContent(): Promise<ContentEntry[]> {
  const tree = await github<{ tree: Array<{ path: string; type: string; sha: string }>; truncated: boolean }>(
    `${API}/git/trees/${BRANCH}?recursive=1`,
  );
  if (tree.truncated) throw new GitHubContentError("Repository listing was truncated.", 503);
  return tree.tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(REPO_PATH_PREFIX))
    .map(({ path, sha }) => ({ path: path.slice(REPO_PATH_PREFIX.length), sha }))
    .filter(({ path }) => allowedPath(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function readContent(path: string): Promise<ContentFile> {
  if (!allowedPath(path)) throw new GitHubContentError("Choose a file inside data/.", 400);
  const file = await github<{ sha: string; content: string; encoding: string; type: string }>(
    `${API}/contents/${repoPath(path)}?ref=${BRANCH}`,
  );
  if (file.type !== "file" || file.encoding !== "base64") {
    throw new GitHubContentError("GitHub returned an unsupported file format.", 502);
  }
  const content = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
  const document: EditorDocument = path === "data/profile.json"
    ? { kind: "profile", data: JSON.parse(content) as Record<string, unknown> }
    : (() => {
      const parsed = matter(content);
      return { kind: "markdown" as const, frontmatter: parsed.data as Record<string, unknown>, body: parsed.content };
    })();
  return { path, sha: file.sha, content, document };
}

export async function writeContent(path: string, content: string, sha?: string): Promise<string> {
  validateContent(path, content);
  await validateRecordLinks(path, content, sha);
  const result = await github<{ commit: { html_url: string } }>(`${API}/contents/${repoPath(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `${sha ? "Update" : "Add"} portfolio content: ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
      branch: BRANCH,
    }),
  });
  return result.commit.html_url;
}

async function validateRecordLinks(path: string, content: string, sha?: string): Promise<void> {
  const entries = await listContent();
  const markdownEntries = entries.filter((entry) => entry.path.endsWith(".md"));
  const existingDocs = await Promise.all(markdownEntries.map((entry) => readContent(entry.path)));
  const docs = existingDocs.map((entry) => ({
    path: entry.path,
    slug: entry.document.kind === "markdown"
      ? entry.document.frontmatter.slug ?? entry.path.split("/").pop()?.replace(/\.md$/, "")
      : undefined,
    type: entry.document.kind === "markdown" ? entry.document.frontmatter.type : undefined,
  }));
  const projects = docs.filter((doc) => doc.type === "project");

  if (path === "data/profile.json") {
    const next = profileSchema.parse(JSON.parse(content));
    for (const pinned of next.pinnedProjects) {
      if (!projects.some((project) => project.slug === pinned)) {
        throw new GitHubContentError(`Pinned project “${pinned}” does not exist.`, 400);
      }
    }
    return;
  }

  const nextSlug = matter(content).data.slug ?? path.split("/").pop()?.replace(/\.md$/, "");
  if (docs.some((doc) => doc.path !== path && doc.slug === nextSlug)) {
    throw new GitHubContentError(`Another record already uses the slug “${nextSlug}”.`, 400);
  }
  if (!sha || !path.startsWith("data/projects/")) return;
  const current = existingDocs.find((doc) => doc.path === path);
  const oldSlug = current?.document.kind === "markdown" ? current.document.frontmatter.slug : undefined;
  if (oldSlug === nextSlug) return;
  const profile = await readContent("data/profile.json");
  const pins = profile.document.kind === "profile" ? profile.document.data.pinnedProjects : undefined;
  if (Array.isArray(pins) && pins.includes(oldSlug)) {
    throw new GitHubContentError("Unpin this project in Profile before changing its slug.", 400);
  }
}

export async function deleteContent(path: string, sha: string): Promise<string> {
  if (!allowedPath(path) || path === "data/profile.json") {
    throw new GitHubContentError("This file cannot be removed here.", 400);
  }
  if (path.startsWith("data/projects/")) {
    const [profile, project] = await Promise.all([readContent("data/profile.json"), readContent(path)]);
    const pins = profile.document.kind === "profile" ? profile.document.data.pinnedProjects : undefined;
    const slug = project.document.kind === "markdown" ? project.document.frontmatter.slug : undefined;
    if (Array.isArray(pins) && pins.includes(slug)) {
      throw new GitHubContentError("Unpin this project in Profile before removing it.", 400);
    }
  }
  const result = await github<{ commit: { html_url: string } }>(`${API}/contents/${repoPath(path)}`, {
    method: "DELETE",
    body: JSON.stringify({ message: `Remove portfolio content: ${path}`, sha, branch: BRANCH }),
  });
  return result.commit.html_url;
}
