import { loadProfile, loadProjects } from "@/lib/knowledge/loader";

export const runtime = "nodejs";

/**
 * Feeds the showcase panel. Separate from the page render so the panel can
 * refresh without a full navigation, and so anything else you build (a browser
 * extension, a résumé generator) has a stable JSON surface.
 */
export async function GET() {
  try {
    return Response.json(
      { profile: loadProfile(), projects: loadProjects() },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    console.error("[profile] failed to load:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load profile." },
      { status: 500 },
    );
  }
}
