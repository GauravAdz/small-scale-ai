"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

import type { ChatActionProps } from "./contracts";
import type { FollowUp } from "@/lib/chat/visual-types";

/**
 * Where to go next, authored by the application.
 *
 * These used to be the model's job by omission — it would end an answer with
 * "let me know if you'd like to hear about X". Generating them costs tokens,
 * arrives last, and can offer something that doesn't exist. Composing them from
 * the visual that was just shown makes them instant, always valid, and free.
 */
export function FollowUps({
  followUps,
  onSelect,
  onLocalVisual,
  disabled,
}: ChatActionProps & {
  followUps: FollowUp[];
}) {
  const reduced = useReducedMotion();
  if (followUps.length === 0) return null;

  return (
    <motion.ul
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.06, ease: "easeOut" }}
      className="mt-2.5 flex flex-wrap gap-1.5"
    >
      {followUps.map((followUp) => {
        const className =
          "border-border/80 text-foreground/75 hover:border-primary/40 hover:text-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

        return (
          <li key={followUp.label}>
            {followUp.href ? (
              <a
                href={followUp.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
              >
                {followUp.label}
                <ArrowUpRight className="size-2.5" />
              </a>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  followUp.localVisual
                    ? onLocalVisual(followUp.localVisual, followUp.prompt ?? followUp.label)
                    : onSelect(followUp.prompt ?? followUp.label)
                }
                className={className}
              >
                {followUp.label}
              </button>
            )}
          </li>
        );
      })}
    </motion.ul>
  );
}
