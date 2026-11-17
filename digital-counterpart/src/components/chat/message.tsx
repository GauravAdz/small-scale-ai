"use client";

import { motion, useReducedMotion } from "framer-motion";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Citations } from "./citations";
import type { ChatActionProps } from "./contracts";
import { FollowUps } from "./follow-ups";
import { TurnStatusLine } from "./turn-status";
import { VisualBlock } from "./visuals";
import { latestDataPart } from "@/lib/chat/message-parts";
import type { CounterpartMessage } from "@/types/chat";

type MessageProps = ChatActionProps & {
  message: CounterpartMessage;
  isStreaming?: boolean;
};

/** A question heading followed by readable prose, then supporting material.
 * Never reveal a visual during streaming: it must not outrun the answer.
 */
export function Message({
  message,
  isStreaming,
  onSelect,
  onLocalVisual,
  disabled,
}: MessageProps) {
  const reduced = useReducedMotion();
  const isUser = message.role === "user";

  const text = message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");

  if (isUser) {
    return (
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="border-border border-b pb-5"
      >
        <p className="text-xl font-medium leading-snug tracking-tight break-words whitespace-pre-wrap sm:text-2xl">
          {text}
        </p>
      </motion.div>
    );
  }

  const visual = latestDataPart(message, "visual");
  const citations = latestDataPart(message, "sources") ?? [];
  const followUps = latestDataPart(message, "followups") ?? [];
  const status = latestDataPart(message, "status");

  // Nothing has arrived yet — the request is in flight.
  const pending = isStreaming && text.length === 0;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex gap-2.5"
    >
      <span
        aria-hidden
        className="border-border bg-card text-primary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-[9px] font-semibold"
      >
        G
      </span>

      <div className="min-w-0 flex-1">
        <p className="mb-3 text-xs font-medium text-muted-foreground">GauravGPT</p>
        {text.length > 0 && (
          <div className="md-body break-words">
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
            {isStreaming && (
              <span className="bg-primary ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse rounded-full" />
            )}
          </div>
        )}

        {pending && <TurnStatusLine status={status} />}

        {/* Preserve a deliberate reading order: answer first, evidence second.
            The server may send the factual payload early, but a fast visual
            should never steal attention from the model's synthesis. */}
        {visual && !isStreaming && (
          <VisualBlock
            visual={visual}
            onOpenContact={() => onLocalVisual("contact-form", "I'd like to send Gaurav a message.")}
            onSelect={onSelect}
          />
        )}

        {!isStreaming && (
          <div>
            <Citations citations={citations} />
            <FollowUps
              followUps={followUps}
              onSelect={onSelect}
              onLocalVisual={onLocalVisual}
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
