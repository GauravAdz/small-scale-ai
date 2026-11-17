import { readEnv } from "@/lib/config";

export const runtime = "nodejs";

export function GET(): Response {
  try {
    const env = readEnv();
    return Response.json({
      status: "ok",
      verifier: {
        provider: env.models.verifier.provider,
        deployment: env.models.verifier.model,
      },
      renderer: env.naturalAnswers.enabled
        ? { kind: "natural", provider: env.models.renderer.provider, model: env.models.renderer.model,
            cache: env.naturalAnswers.cacheEnabled ? (process.env.VERCEL === "1" ? "regional" : "memory") : "disabled" }
        : { kind: "deterministic" },
      embeddings: { provider: env.embeddings.provider },
    });
  } catch (error) {
    return Response.json(
      {
        status: "misconfigured",
        error: error instanceof Error ? error.name : "ConfigurationError",
      },
      { status: 503 },
    );
  }
}
