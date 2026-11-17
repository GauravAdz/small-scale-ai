import { z } from "zod";

import counterpartConfig from "../../../counterpart.config";

const { limits, reasons } = counterpartConfig.contact;

/**
 * The wire shape of a message from the conversation.
 *
 * Every field is capped. Uncapped free text on a public endpoint is a storage
 * and delivery problem waiting to happen, and nobody writing a genuine
 * introduction needs more than a couple of thousand characters.
 */
export const contactMessageSchema = z.object({
  name: z.string().trim().min(1, "Add your name.").max(limits.name),
  email: z
    .string()
    .trim()
    .min(1, "Add an email so he can reply.")
    .max(limits.email)
    .email("That email address doesn't look right."),
  company: z.string().trim().max(limits.company).optional().or(z.literal("")),
  reason: z.enum(reasons).optional(),
  message: z
    .string()
    .trim()
    .min(10, "A little more detail helps — a sentence or two is plenty.")
    .max(limits.message),
  /**
   * Honeypot. Hidden from people and from assistive technology; a bot that
   * fills every input it finds fills this one too.
   *
   * Deliberately *not* constrained to empty. Rejecting it here returns a
   * validation error naming the field, which tells a bot precisely which input
   * to leave alone next time. The route checks it instead and answers with the
   * same success a person would get, so a filled honeypot teaches nothing.
   */
  website: z.string().max(200).optional(),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

/** What the delivery layer receives — honeypot stripped, fields normalised. */
export type ContactMessage = {
  name: string;
  email: string;
  company?: string;
  reason?: string;
  message: string;
  /** Stable across a visitor retry so delivery providers can deduplicate it. */
  submissionId: string;
  /** Best-effort, for triage. Never shown to the visitor. */
  receivedAt: string;
};
