import { isAdmin } from "@/auth";
import {
  deleteContent,
  GitHubContentError,
  listContent,
  readContent,
  serializeDocument,
  writeContent,
} from "@/lib/admin/github-content";
import type { EditorDocument } from "@/lib/admin/github-content";

export const runtime = "nodejs";

function failure(error: unknown): Response {
  if (error instanceof GitHubContentError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[admin] content request failed:", error);
  return Response.json({ error: "Could not complete the request." }, { status: 500 });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!(await isAdmin())) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const path = new URL(request.url).searchParams.get("path");
    return Response.json(path ? await readContent(path) : await listContent(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!(await isAdmin())) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const input = await request.json() as Record<string, unknown>;
    if (input.action === "delete") {
      if (typeof input.path !== "string" || typeof input.sha !== "string" || !input.sha) {
        return Response.json({ error: "File and version are required." }, { status: 400 });
      }
      const commitUrl = await deleteContent(input.path, input.sha);
      return Response.json({ commitUrl });
    }
    if (input.action !== "save" || typeof input.path !== "string" ||
        (input.sha !== undefined && typeof input.sha !== "string")) {
      return Response.json({ error: "File and content are required." }, { status: 400 });
    }
    const content = typeof input.content === "string"
      ? input.content
      : input.document && typeof input.document === "object"
        ? serializeDocument(input.path, input.document as EditorDocument)
        : null;
    if (content === null) return Response.json({ error: "Content is required." }, { status: 400 });
    const commitUrl = await writeContent(input.path, content, input.sha);
    return Response.json({ commitUrl });
  } catch (error) {
    return failure(error);
  }
}
