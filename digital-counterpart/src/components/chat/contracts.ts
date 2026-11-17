import type { VisualKind } from "@/lib/chat/visual-types";

/** Shared interaction contract for every surface that can start a chat action. */
export type ChatActionHandlers = {
  onSelect: (prompt: string) => void;
  onLocalVisual: (kind: VisualKind, prompt: string) => void;
};

export type ChatActionProps = ChatActionHandlers & {
  disabled?: boolean;
};
