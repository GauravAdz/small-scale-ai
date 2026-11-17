import type { UnderstoodQuery } from "@/lib/chat/query-understanding";
import type { SupportStatus } from "@/lib/evidence/support";
import type { VisualKind } from "@/lib/chat/visual-types";

export type TurnAnalytics = Readonly<{
  requestId: string;
  route: "answer" | "local";
  interpretation?: StructuredInterpretationAnalytics;
  visualKind: VisualKind | null;
  support?: SupportStatus | "mixed";
  rendering?: "natural" | "deterministic";
  citationCount?: number;
  followUpCount?: number;
}>;

export type StructuredInterpretationAnalytics = Readonly<{
  source: UnderstoodQuery["source"];
  recoveryOutcome: UnderstoodQuery["recoveryOutcome"];
  interaction: UnderstoodQuery["interaction"];
}>;

/** Strip all query text before the analytics boundary. */
export function structuredInterpretationAnalytics(
  query: UnderstoodQuery | undefined,
): StructuredInterpretationAnalytics | undefined {
  return query
    ? {
        source: query.source,
        recoveryOutcome: query.recoveryOutcome,
        interaction: query.interaction,
      }
    : undefined;
}

type PostHogConfig = Readonly<{
  projectKey: string;
  host: string;
}>;

/**
 * Optional product analytics for routing/UI quality.
 *
 * Deliberately does not accept raw questions, answers, visitor identifiers,
 * email addresses, IP addresses, citations, or evidence excerpts. The event is
 * useful for aggregate questions such as "how often did a profile-link intent
 * render project cards?" without exporting conversation content.
 */
export async function captureTurnAnalytics(
  event: TurnAnalytics,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = postHogConfig(env);
  if (!config) return;

  const interaction = event.interpretation?.interaction;
  const target = interaction?.target;
  const payload = {
    api_key: config.projectKey,
    event: "counterpart_chat_turn",
    properties: {
      // Request-scoped and intentionally not stable across visits.
      distinct_id: event.requestId,
      $process_person_profile: false,
      $lib: "digital-counterpart",
      route: event.route,
      interpretation_source: event.interpretation?.source ?? "unavailable",
      recovery_used: event.interpretation?.source === "semantic-recovery",
      recovery_outcome: event.interpretation?.recoveryOutcome ?? "unavailable",
      interaction_kind: interaction?.kind ?? "unknown",
      target_kind: target?.kind ?? "unknown",
      target_project_slug: target?.kind === "project" ? target.slug : undefined,
      channel: interaction?.channel,
      visual_kind: event.visualKind ?? "none",
      support_status: event.support,
      rendering: event.rendering,
      citation_count: event.citationCount,
      follow_up_count: event.followUpCount,
    },
  };

  try {
    const response = await fetch(new URL("/capture/", config.host), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok && process.env.NODE_ENV === "development") {
      console.warn("[analytics] PostHog capture failed", { status: response.status });
    }
  } catch (error) {
    // Analytics is never allowed to affect answering.
    if (process.env.NODE_ENV === "development") {
      console.warn("[analytics] PostHog capture unavailable", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

function postHogConfig(env: NodeJS.ProcessEnv): PostHogConfig | null {
  const projectKey = env.POSTHOG_PROJECT_KEY?.trim();
  const host = env.POSTHOG_HOST?.trim();
  if (!projectKey && !host) return null;
  if (!projectKey || !host) {
    if (env.NODE_ENV === "development") {
      console.warn("[analytics] POSTHOG_PROJECT_KEY and POSTHOG_HOST must be configured together.");
    }
    return null;
  }
  try {
    const parsed = new URL(host);
    if (parsed.protocol !== "https:") return null;
    return { projectKey, host: parsed.origin };
  } catch {
    return null;
  }
}
