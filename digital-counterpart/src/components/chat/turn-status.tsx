"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { TurnStatus } from "@/lib/chat/visual-types";

/**
 * What the server is actually doing, while it's doing it.
 *
 * Every line here is a real, completed step — "Searching Gaurav's notes",
 * "Found 3 relevant notes" — never a fabricated thought. Showing an invented
 * chain of reasoning to look busy is a lie about the system's internals, and
 * one the visitor can't check.
 *
 * The first line is optimistic and client-side: it appears the instant the
 * request is sent, so the interface responds before the network does. The
 * server then replaces it with the truth as soon as retrieval returns.
 */
export function TurnStatusLine({ status }: { status?: TurnStatus }) {
  const reduced = useReducedMotion();

  const label = status
    ? status.stage === "writing"
      ? (status.detail ?? "Preparing answer")
      : status.stage === "resolving"
        ? "Understanding your question…"
        : status.stage === "verifying"
          ? "Verifying sources…"
          : status.stage === "searching"
            ? "Searching portfolio…"
            : null
    : "Searching Gaurav's notes";

  return (
    <AnimatePresence initial={false} mode="wait">
      {label && (
        <motion.p
          key={label}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="status"
          className="text-muted-foreground flex items-center gap-2 text-xs"
        >
          <Pulse />
          {label}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** A single travelling dot. One mark, not three bouncing balls. */
function Pulse() {
  const reduced = useReducedMotion();

  return (
    <span aria-hidden className="bg-border relative h-px w-6 overflow-hidden rounded-full">
      <motion.span
        className="bg-primary absolute inset-y-0 w-2 rounded-full"
        animate={reduced ? { opacity: 0.7 } : { x: ["-100%", "300%"] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  );
}
