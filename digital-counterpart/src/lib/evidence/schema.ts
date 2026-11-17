import { z } from "zod";

import { claimKinds, evidenceAuthorities, evidenceKinds } from "./types";

const isoDate = z.string().datetime({ offset: true });

export const evidenceLocatorSchema = z
  .object({
    source: z.string().min(1),
    headingPath: z.array(z.string().min(1)).optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    jsonPointer: z.string().startsWith("/").optional(),
  })
  .superRefine((locator, context) => {
    if (
      locator.startLine !== undefined &&
      locator.endLine !== undefined &&
      locator.endLine < locator.startLine
    ) {
      context.addIssue({ code: "custom", message: "endLine must be greater than or equal to startLine" });
    }
  });

export const evidenceRecordSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  kind: z.enum(evidenceKinds),
  authority: z.enum(evidenceAuthorities),
  text: z.string().min(1),
  subject: z.string().min(1).optional(),
  predicate: z.string().min(1).optional(),
  value: z.unknown().optional(),
  locator: evidenceLocatorSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedAt: isoDate.optional(),
  validFrom: isoDate.optional(),
  validUntil: isoDate.optional(),
});

export const verifiedClaimSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    kind: z.enum(claimKinds),
    evidenceIds: z.array(z.string().min(1)),
  })
  .superRefine((claim, context) => {
    if (claim.kind !== "uncertainty" && claim.evidenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: `${claim.kind} claims require at least one evidence ID`,
      });
    }
    if (claim.kind === "uncertainty" && claim.evidenceIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "uncertainty claims must not pretend evidence supports a proposition",
      });
    }
  });

