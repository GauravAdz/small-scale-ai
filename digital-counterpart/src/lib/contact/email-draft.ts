import type { ContactMessageInput } from "./schema";

type EmailDraftFields = Pick<
  ContactMessageInput,
  "name" | "email" | "company" | "reason" | "message"
>;

/** Build a reviewable mailto draft when server-side delivery is not configured. */
export function emailDraftUrl(email: string, fields: EmailDraftFields): string {
  const subject = fields.reason
    ? `${fields.reason} from ${fields.name} via GauravGPT`
    : `Message from ${fields.name} via GauravGPT`;
  const signature = [fields.name, fields.company, fields.email].filter(Boolean).join("\n");
  const body = `${fields.message}\n\n${signature}`;

  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
