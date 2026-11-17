import { randomUUID } from "node:crypto";

import counterpartConfig from "../../../../counterpart.config";
import { readEnv } from "@/lib/config";
import { sendContactMessage } from "@/lib/contact/delivery";
import { contactMessageSchema } from "@/lib/contact/schema";
import { loadProfile } from "@/lib/knowledge/loader";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_CONTACT_BODY_BYTES = 10_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Its own limiter, far tighter than chat's.
 *
 * Chat is a browsing activity — a dozen questions a minute is a curious
 * visitor. Messages are not: three in ten minutes is already generous for a
 * real person, and anything above it is a form-spam script.
 */
const limiter = createRateLimiter(
  readEnv(),
  counterpartConfig.contact.rate.requests,
  counterpartConfig.contact.rate.windowSeconds,
  "contact",
);

type Reply = {
  ok: boolean;
  /** Shown to the visitor verbatim, so it has to be true. */
  message: string;
  /** Field-level errors, keyed by field name. */
  errors?: Record<string, string>;
  /** True only when a message genuinely reached a delivery adapter. */
  delivered?: boolean;
  /** Given whenever delivery didn't happen, so the visitor still has a route. */
  fallbackEmail?: string;
};

function json(body: Reply, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) },
  });
}

export async function POST(request: Request) {
  const env = readEnv();

  const rate = await limiter.check(clientKey(request));
  if (!rate.ok) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    const retryMinutes = Math.max(1, Math.ceil(retryAfter / 60));
    return json(
      {
        ok: false,
        message: `That's a few messages in a short window. Try again in about ${retryMinutes} ${retryMinutes === 1 ? "minute" : "minutes"}, or email him directly.`,
        fallbackEmail: safeEmail(),
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, message: "Send this form as JSON." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTACT_BODY_BYTES) {
    return json({ ok: false, message: "That message is too large to send." }, 413);
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_CONTACT_BODY_BYTES) {
      return json({ ok: false, message: "That message is too large to send." }, 413);
    }
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, message: "Malformed request body." }, 400);
  }

  const parsed = contactMessageSchema.safeParse(payload);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      errors[field] ??= issue.message;
    }
    return json({ ok: false, message: "Have a look at the highlighted fields.", errors }, 400);
  }

  const { website, company, ...fields } = parsed.data;

  // Honeypot filled means a bot. Return the same success a person would see:
  // a distinguishable rejection is a signal to tune against.
  if (website) {
    return json({ ok: true, message: "Message sent.", delivered: true });
  }

  const requestedId = request.headers.get("idempotency-key")?.trim();
  const submissionId = requestedId && IDEMPOTENCY_KEY.test(requestedId) ? requestedId : randomUUID();

  const result = await sendContactMessage(
    {
      ...fields,
      company: company || undefined,
      submissionId,
      receivedAt: new Date().toISOString(),
    },
    env,
  );

  if (result.ok) {
    return json({
      ok: true,
      delivered: true,
      message: "Sent — that's landed in his inbox. He'll reply from there.",
    });
  }

  // Neither branch below claims success. An unconfigured deploy and a provider
  // outage are different problems, but they have the same consequence for the
  // visitor — the message did not arrive — and saying otherwise loses them.
  if (result.kind === "unconfigured") {
    return json(
      {
        ok: false,
        delivered: false,
        message: "Message delivery isn't wired up on this deploy yet, so nothing was sent.",
        fallbackEmail: safeEmail(),
      },
      503,
    );
  }

  return json(
    {
      ok: false,
      delivered: false,
      message: "That didn't send — something went wrong on the way out.",
      fallbackEmail: safeEmail(),
    },
    502,
  );
}

/** The profile's address, or nothing if the profile can't be read at all. */
function safeEmail(): string | undefined {
  try {
    return loadProfile().contact.email;
  } catch {
    return undefined;
  }
}
