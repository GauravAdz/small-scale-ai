"use client";

import * as React from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ComposerProps = {
  onSubmit: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  value: string;
  onValueChange: (value: string) => void;
  /** Shown on narrow screens, where the long form gets clipped mid-word. */
  placeholder?: string;
  /** Shown from `sm` up. Falls back to `placeholder`. */
  placeholderWide?: string;
  className?: string;
};

const MAX_HEIGHT = 160;

export function Composer({
  onSubmit,
  onStop,
  busy,
  value,
  onValueChange,
  placeholder,
  placeholderWide,
  className,
}: ComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [wide, setWide] = React.useState(false);

  // A CSS-only swap isn't available for `placeholder`, so this reads the same
  // `sm` breakpoint the rest of the layout uses.
  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Grow with content up to a cap, then scroll — same ergonomics as GauravGPT.
  //
  // Measure from 0, not from `auto`: `scrollHeight` is floored at the element's
  // own client height, so if the textarea is momentarily stretched by its flex
  // parent (which happens before `items-end` applies on a cold load) `auto`
  // reads back the stretched height and the box latches open at max height.
  // Collapsing to 0 first makes the measurement pure content height.
  const resize = React.useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;

    // Empty means exactly one row — hand it back to `rows={1}` instead of
    // measuring. Mount-time measurement is the unreliable case (the element
    // hasn't been laid out yet, and a bogus reading latches the box open at
    // max height), and it's also the case where there is nothing to measure.
    if (node.value.length === 0) {
      node.style.height = "";
      node.style.overflowY = "hidden";
      return;
    }

    node.style.height = "0px";
    const contentHeight = node.scrollHeight;
    node.style.height = `${Math.min(contentHeight, MAX_HEIGHT)}px`;
    node.style.overflowY = contentHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  React.useEffect(resize, [value, resize]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    onValueChange("");
    // Collapse immediately; the `value` effect re-measures on the next render.
    requestAnimationFrame(resize);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "composer-shell flex min-h-14 items-end gap-1.5 rounded-2xl border border-border bg-card p-1.5 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-[var(--ease-out-expo)] hover:border-primary/35 focus-within:-translate-y-px focus-within:border-primary/55 focus-within:ring-2 focus-within:ring-ring/15",
        className,
      )}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        name="message"
        autoComplete="off"
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter newlines. IME composition must not submit.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={(wide ? (placeholderWide ?? placeholder) : placeholder) ?? "Ask me anything…"}
        aria-label="Message"
        className={cn(
          // 16px, not 14px: iOS Safari zooms the whole page in on focus for any
          // smaller input font, which is why the old layout had to lock zoom.
          // Holding the threshold here is what let `maximumScale` go away.
          "min-w-0 text-foreground placeholder:text-muted-foreground scrollbar-subtle max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-base leading-7 outline-none sm:text-[0.9375rem]",
        )}
      />

      {busy ? (
        <Button
          type="button"
          size="icon"
          variant="subtle"
          onClick={onStop}
          aria-label="Stop generating"
          title="Stop generating"
          className="size-10 rounded-xl shadow-none"
        >
          <Square aria-hidden className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={value.trim().length === 0}
          aria-label="Send message"
          title="Send message"
          className="size-10 rounded-xl shadow-none disabled:bg-muted disabled:text-muted-foreground"
        >
          <ArrowUp aria-hidden className="size-4" />
        </Button>
      )}
    </form>
  );
}
