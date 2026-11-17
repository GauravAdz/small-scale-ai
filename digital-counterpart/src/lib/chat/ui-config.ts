import type { VisualKind } from "./visual-types";

export type ChatTopic = {
  label: string;
  prompt: string;
};

export type ChatIntro = {
  lede: string;
  sub: string;
  topics: ChatTopic[];
};

export type QuickPrompt = {
  /** Text shown on the action. */
  label: string;
  /** Compact label for the phone-sized discovery row. */
  mobileLabel?: string;
  /** One line under the label. Keep it to about five words. */
  hint?: string;
  /** What actually gets sent (defaults to `label`). */
  prompt?: string;
  /** Open a deterministic visual without calling the model. */
  localVisual?: VisualKind;
  icon?: "projects" | "skills" | "spark" | "hire" | "message" | "education";
};

/** The serializable, public subset of `counterpart.config.ts` used by the UI. */
export type ChatUiConfig = {
  intro: ChatIntro;
  quickPrompts: QuickPrompt[];
};
