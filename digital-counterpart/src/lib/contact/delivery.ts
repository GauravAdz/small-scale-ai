/**
 * Getting a message from the conversation to a real inbox.
 *
 * Same shape as the vector stores and the rate limiter: one small interface,
 * adapters behind it, chosen from the environment. Two are implemented, both
 * over plain `fetch` so neither adds a dependency:
 *
 *   resend  — RESEND_API_KEY. The test sender reaches the account owner's
 *             address; production delivery uses a verified sender domain.
 *   webhook — CONTACT_WEBHOOK_URL. A Slack/Discord incoming webhook, or any
 *             endpoint that accepts JSON. Useful when email is overkill.
 *   none    — nothing configured.
 *
 * `none` is the important case. A contact form that swallows messages while
 * showing a green tick is worse than no form at all — a recruiter walks away
 * believing they made contact. So the adapter reports `configured: false`, the
 * UI is told before the visitor types a word, and the success state is never
 * shown for a message that went nowhere.
 */

import { readEnv, type EnvConfig } from "@/lib/config";
import { loadProfile } from "@/lib/knowledge/loader";
import type { ContactMessage } from "./schema";

const DELIVERY_TIMEOUT_MS = 10_000;

export type DeliveryResult =
  | { ok: true }
  /** Delivery is not set up. Not an error — a known, truthful state. */
  | { ok: false; kind: "unconfigured" }
  /** Delivery was attempted and failed. Worth retrying or falling back. */
  | { ok: false; kind: "failed"; detail: string };

export interface DeliveryAdapter {
  readonly kind: string;
  send(message: ContactMessage): Promise<DeliveryResult>;
}

/** Is there any configured route to Gaurav's inbox right now? */
export function hasDeliveryAdapter(config: EnvConfig = readEnv()): boolean {
  return config.contact.delivery !== "none";
}

function formatBody(message: ContactMessage): string {
  return [
    `From: ${message.name} <${message.email}>`,
    message.company ? `Company: ${message.company}` : null,
    message.reason ? `Reason: ${message.reason}` : null,
    `Received: ${message.receivedAt}`,
    "",
    message.message,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Email subjects are headers: keep visitor text on one short, single line. */
function subjectPart(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function resendAdapter(config: EnvConfig, to: string): DeliveryAdapter {
  const { apiKey, from } = config.contact.resend;

  return {
    kind: "resend",
    async send(message) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // Resend retains keys for 24 hours. A retry after an ambiguous
            // network failure therefore cannot create a duplicate email.
            "Idempotency-Key": message.submissionId,
          },
          body: JSON.stringify({
            from,
            to: [to],
            // Replying to the notification reaches the sender directly, which
            // is the only interaction Gaurav actually wants from this email.
            reply_to: message.email,
            subject: `GauravGPT · ${subjectPart(message.reason ?? "Message")} from ${subjectPart(message.name)}`,
            text: formatBody(message),
            html: `<pre style="font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(
              formatBody(message),
            )}</pre>`,
          }),
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          return {
            ok: false,
            kind: "failed",
            detail: `resend ${response.status}: ${detail.slice(0, 200)}`,
          };
        }

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          kind: "failed",
          detail: error instanceof Error ? error.message : "network error",
        };
      }
    },
  };
}

function webhookAdapter(url: string): DeliveryAdapter {
  return {
    kind: "webhook",
    async send(message) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `text` is what Slack and Discord both read; the structured fields
          // sit alongside it for anything else consuming the hook.
          body: JSON.stringify({ text: formatBody(message), ...message }),
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          return {
            ok: false,
            kind: "failed",
            detail: `webhook ${response.status}: ${detail.slice(0, 200)}`,
          };
        }

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          kind: "failed",
          detail: error instanceof Error ? error.message : "network error",
        };
      }
    },
  };
}

export function createDeliveryAdapter(config: EnvConfig = readEnv()): DeliveryAdapter | null {
  switch (config.contact.delivery) {
    case "resend": {
      // Falls back to the profile's own address, so setting one key is enough
      // to make the form work end to end.
      const to = config.contact.resend.to?.trim() || loadProfile().contact.email;
      return to ? resendAdapter(config, to) : null;
    }
    case "webhook":
      return config.contact.webhookUrl ? webhookAdapter(config.contact.webhookUrl) : null;
    default:
      return null;
  }
}

export async function sendContactMessage(
  message: ContactMessage,
  config: EnvConfig = readEnv(),
): Promise<DeliveryResult> {
  const adapter = createDeliveryAdapter(config);
  if (!adapter) return { ok: false, kind: "unconfigured" };

  const result = await adapter.send(message);
  if (!result.ok && result.kind === "failed") {
    console.error(`[contact] ${adapter.kind} delivery failed:`, result.detail);
  }
  return result;
}
