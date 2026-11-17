"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

import { EASE_OUT_EXPO } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

/**
 * The frame every visual answer sits in.
 *
 * Assistant messages deliberately have no bubble of their own, so this is the
 * only bordered plane in a reply — which keeps the card as the visually
 * dominant element (the answer *is* the card; the sentence above it is
 * framing) and avoids putting a card inside a card.
 *
 * The label is a mark, not a heading: it tells you what you're looking at in
 * one word and then gets out of the way.
 */
export function CardFrame({
  label,
  aside,
  children,
  className,
}: {
  label: string;
  /** Right-hand metadata — a count, a status. Optional. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.section
      // Arrival, not decoration: the card is retrieved rather than typed, and a
      // short rise says "this was found" in a way an instant swap doesn't.
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
      className={cn(
        "surface border-border mt-3 overflow-hidden rounded-xl border",
        className,
      )}
    >
      <header className="border-border/80 flex items-center justify-between gap-3 border-b px-3.5 py-2">
        <h3 className="label-mark">{label}</h3>
        {aside && <span className="datum text-muted-foreground">{aside}</span>}
      </header>
      <div className="p-3.5">{children}</div>
    </motion.section>
  );
}

/** A quiet inner plane — list rows, sub-cards. One level only, never nested. */
export function Panel({
  children,
  className,
  interactive,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-border/80 bg-background/50 rounded-lg border",
        interactive &&
          "hover:border-primary/40 transition-[border-color,background-color] duration-150",
        className,
      )}
    >
      {children}
    </div>
  );
}
