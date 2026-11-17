"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";

import type { ClaimCitation } from "@/types/chat";
import { cn } from "@/lib/utils";

function locator(citation: ClaimCitation): string | null {
  if (citation.jsonPointer) return citation.jsonPointer;
  if (citation.startLine && citation.endLine) {
    return citation.startLine === citation.endLine
      ? `line ${citation.startLine}`
      : `lines ${citation.startLine}–${citation.endLine}`;
  }
  return citation.startLine ? `line ${citation.startLine}` : null;
}

/** Claim-linked evidence stays compact until a visitor chooses to inspect it. */
export function Citations({ citations }: { citations: ClaimCitation[] }) {
  const [open, setOpen] = React.useState(false);
  const evidenceRegionId = React.useId();
  const reduced = useReducedMotion();
  if (citations.length === 0) return null;

  const uniqueSources = new Set(citations.map(({ source }) => source)).size;
  const allPortfolioRecords = citations.every(
    ({ provenance }) => provenance === undefined || provenance === "portfolio-record",
  );
  const sourceLabel = allPortfolioRecords
    ? `Supported by ${uniqueSources} portfolio record${uniqueSources === 1 ? "" : "s"}`
    : `${uniqueSources} source${uniqueSources === 1 ? "" : "s"} cited`;

  return (
    <section className="mt-3" aria-label="Evidence for this answer">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={evidenceRegionId}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-md text-xs transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span aria-hidden className="bg-success/70 inline-block size-1.5 rounded-full" />
        {sourceLabel}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={evidenceRegionId}
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <ol className="mt-1 flex flex-col gap-2">
              {citations.map((citation, index) => {
                const where = locator(citation);
                const heading = citation.headingPath?.join(" › ") ?? citation.section;
                return (
                  <li key={`${citation.claimId ?? "claim"}:${citation.evidenceId ?? citation.id}`}>
                    <details className="group border-border/70 bg-card/40 rounded-lg border">
                      <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                        <span className="bg-muted text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold">
                          [{index + 1}]
                        </span>
                        <span className="min-w-0 break-words">
                          <span className="text-foreground font-medium">{citation.title}</span>
                          {heading ? (
                            <span className="text-muted-foreground"> · {heading}</span>
                          ) : null}
                        </span>
                        <ChevronDown className="text-muted-foreground ms-auto size-3.5 shrink-0 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="border-border/60 border-t px-3 py-3 text-xs leading-relaxed">
                        {citation.claimText ? (
                          <p className="text-foreground mb-2 break-words">{citation.claimText}</p>
                        ) : null}
                        {citation.excerpt ? (
                          <blockquote className="text-muted-foreground max-h-40 overflow-y-auto break-words">
                            {citation.excerpt}
                          </blockquote>
                        ) : null}
                        <details className="text-muted-foreground mt-2">
                          <summary className="focus-visible:ring-ring min-h-11 cursor-pointer rounded py-3 focus-visible:ring-2">Technical details</summary>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px]">
                          {citation.evidenceId ? <span className="break-all">{citation.evidenceId}</span> : null}
                          <span className="break-all">{citation.source}</span>
                          {where ? <span>{where}</span> : null}
                          {citation.url ? (
                            <a
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-foreground focus-visible:ring-ring inline-flex min-h-8 items-center gap-1 rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
                            >
                              Open source <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : null}
                          </div>
                        </details>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
