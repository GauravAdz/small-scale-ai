"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertTriangle, ArrowDown, RotateCcw } from "lucide-react";
import { Composer } from "./composer";
import { Landing } from "./landing";
import { Message } from "./message";
import { TurnStatusLine } from "./turn-status";
import { Button } from "@/components/ui/button";
import type { ChatUiConfig } from "@/lib/chat/ui-config";
import type { ContactFormVisualData, ProjectVisualData, Visual, VisualKind } from "@/lib/chat/visual-types";
import type { Profile } from "@/lib/knowledge/schema";
import { firstName } from "@/lib/person";
import type { CounterpartMessage } from "@/types/chat";
import { VERIFICATION_UNAVAILABLE_MESSAGE } from "@/lib/chat/error-response";

export type ChatPanelHandle = {
  openVisual: (kind: VisualKind, prompt: string) => void;
  goHome: (section?: string) => void;
  resume: () => void;
};
export type ChatViewState = { home: boolean; hasConversation: boolean; busy: boolean };
type ChatPanelProps = {
  profile: Profile;
  featured: ProjectVisualData[];
  projects: ProjectVisualData[];
  contactForm: ContactFormVisualData;
  chatUi: ChatUiConfig;
  onViewChange: (state: ChatViewState) => void;
};
const CHAT_TRANSPORT = new DefaultChatTransport({ api: "/api/chat" });

export const ChatPanel = React.forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({ profile, featured, projects, contactForm, chatUi, onViewChange }, ref) {
  const { messages, setMessages, sendMessage, status, stop, error, regenerate, clearError } = useChat<CounterpartMessage>({ transport: CHAT_TRANSPORT });
  const busy = status === "submitted" || status === "streaming";
  const hasConversation = messages.length > 0;
  const displayName = firstName(profile.name);
  const [home, setHome] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [stopped, setStopped] = React.useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  const [homeNavigation, setHomeNavigation] = React.useState<{ section: string } | null>(null);
  const homeRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const latestTurnRef = React.useRef<HTMLDivElement>(null);
  const anchoredTurn = React.useRef<string | null>(null);
  const followOpening = React.useRef(false);
  const localTurnSequence = React.useRef(0);

  React.useEffect(() => { onViewChange({ home, hasConversation, busy }); }, [home, hasConversation, busy, onViewChange]);

  const goHome = React.useCallback((section = "home") => {
    setHome(true);
    setHomeNavigation({ section });
  }, []);
  React.useEffect(() => {
    if (!home || !homeNavigation) return;
    const section = homeRef.current?.querySelector<HTMLElement>(`[id="${homeNavigation.section}"]`);
    const container = homeRef.current;
    if (container && section) {
      container.scrollTop += section.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }
    section?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
  }, [home, homeNavigation]);

  // Move only the conversation scroller. A short answer uses its natural
  // height; growth can bring a new question to the top without a blank spacer.
  const scrollToOpening = React.useCallback(() => {
    const container = scrollRef.current;
    const turn = latestTurnRef.current;
    if (!container || !turn) return;
    const top = Math.max(0, container.scrollTop + turn.getBoundingClientRect().top - container.getBoundingClientRect().top - 24);
    container.scrollTop = top;
    if (Math.abs(container.scrollTop - top) < 2) followOpening.current = false;
  }, []);
  const lastUserId = messages.findLast(message => message.role === "user")?.id;
  React.useEffect(() => {
    if (home || !lastUserId) return;
    if (anchoredTurn.current !== lastUserId) {
      anchoredTurn.current = lastUserId;
      followOpening.current = true;
      scrollToOpening();
    }
    const turn = latestTurnRef.current;
    if (!turn) return;
    const observer = new ResizeObserver(() => {
      if (followOpening.current) scrollToOpening();
    });
    observer.observe(turn);
    return () => observer.disconnect();
  }, [lastUserId, home, scrollToOpening]);
  const updateJumpToLatest = React.useCallback(() => {
    const container = scrollRef.current;
    const latestTurn = latestTurnRef.current;
    if (!container || !latestTurn) {
      setShowJumpToLatest(false);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const latestRect = latestTurn.getBoundingClientRect();
    setShowJumpToLatest(latestRect.top > containerRect.bottom - 8);
  }, []);

  React.useEffect(() => {
    if (home) {
      setShowJumpToLatest(false);
      return;
    }
    const frame = requestAnimationFrame(updateJumpToLatest);
    const container = scrollRef.current;
    const latestTurn = latestTurnRef.current;
    if (!container || !latestTurn) return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(updateJumpToLatest);
    observer.observe(container);
    observer.observe(latestTurn);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [home, lastUserId, updateJumpToLatest]);

  const takeScrollControl = () => { followOpening.current = false; };
  const handleConversationScroll = () => {
    takeScrollControl();
    updateJumpToLatest();
  };

  const send = React.useCallback((text: string) => {
    if (busy || !text.trim()) return;
    setHome(false);
    setStopped(false);
    clearError();
    void sendMessage({ text });
  }, [busy, clearError, sendMessage]);

  const openVisual = React.useCallback((kind: VisualKind, prompt: string) => {
    if (busy) return;
    const visual = localVisual(kind, contactForm);
    if (!visual) { send(prompt); return; }
    setHome(false);
    setStopped(false);
    clearError();
    const stamp = `${Date.now()}-${++localTurnSequence.current}`;
    setMessages(current => [...current,
      { id: `local-user-${stamp}`, role: "user", parts: [{ type: "text", text: prompt }] },
      { id: `local-assistant-${stamp}`, role: "assistant", parts: [
        { type: "text", text: contactForm.deliveryConfigured ? `Send ${displayName} a message below.` : `Write ${displayName} a message below. You'll review it in your email app before sending.` },
        { type: "data-visual", id: "visual", data: visual },
      ] },
    ]);
  }, [busy, contactForm, displayName, clearError, send, setMessages]);

  React.useImperativeHandle(ref, () => ({ openVisual, goHome, resume: () => setHome(false) }), [openVisual, goHome]);
  const turns: CounterpartMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user" || turns.length === 0) turns.push([]);
    turns[turns.length - 1].push(message);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={homeRef} hidden={!home} data-testid="home-scroll" className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-10">
        <Landing
          profile={profile}
          featured={featured}
          projects={projects}
          config={chatUi}
          draft={draft}
          onDraftChange={setDraft}
          onStop={() => { setStopped(true); void stop(); }}
          hasConversation={hasConversation}
          onResume={() => setHome(false)}
          active={home}
          onSelect={send}
          onLocalVisual={openVisual}
          disabled={busy}
        />
      </div>
      <div className={home ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <div ref={scrollRef} onScroll={handleConversationScroll} onWheel={takeScrollControl} onTouchStart={takeScrollControl} onPointerDown={takeScrollControl} onKeyDown={takeScrollControl} data-testid="conversation-scroll" tabIndex={0} aria-label="Conversation" className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 [overflow-anchor:none] sm:px-8">
          <div className="mx-auto w-full max-w-3xl">
            {turns.map((turn, index) => {
              const latest = index === turns.length - 1;
              return <div key={turn[0].id} ref={latest ? latestTurnRef : undefined} data-testid="conversation-turn" className="flex flex-col gap-5 pb-8 last:pb-0">
                {turn.map(message => <Message key={message.id} message={message} isStreaming={busy && latest && message.role === "assistant"} onSelect={send} onLocalVisual={openVisual} disabled={busy} />)}
                {latest && busy && turn.at(-1)?.role === "user" && <TurnStatusLine />}
                {latest && stopped && <p role="status" className="text-sm text-muted-foreground">Response stopped.</p>}
                {latest && error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /><div className="flex-1"><p className="font-medium">That request didn&apos;t go through.</p><p className="mt-1">{/^(You're sending messages faster|That's more than I can verify|That message exceeds)/.test(error.message) ? error.message : VERIFICATION_UNAVAILABLE_MESSAGE}</p></div>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setStopped(false); void regenerate(); }} className="min-h-11 shrink-0 text-destructive"><RotateCcw className="size-3.5" />Retry</Button>
                </div>}
              </div>;
            })}
          </div>
        </div>
        {!home && <div data-testid="conversation-composer" className="relative shrink-0 border-t border-border bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
          {turns.length > 1 && (
            <Button
              type="button"
              variant="subtle"
              aria-label="Jump to latest answer"
              aria-hidden={!showJumpToLatest}
              tabIndex={showJumpToLatest ? 0 : -1}
              onClick={() => {
                setShowJumpToLatest(false);
                followOpening.current = true;
                scrollToOpening();
              }}
              className={`absolute right-4 -top-14 z-10 size-11 rounded-full border border-border shadow-lg transition-[opacity,transform,visibility] duration-200 sm:right-8 sm:w-auto sm:px-4 ${showJumpToLatest ? "visible translate-y-0 opacity-100" : "invisible translate-y-2 opacity-0 pointer-events-none"}`}
            >
              <ArrowDown className="size-4" /><span className="hidden sm:inline">Latest</span>
            </Button>
          )}
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-1 min-h-5 text-xs text-muted-foreground">
              {busy && <span className="flex items-center gap-2"><span aria-hidden className="size-1.5 rounded-full bg-primary" />Preparing your answer…</span>}
            </div>
            <Composer
              value={draft}
              onValueChange={setDraft}
              onSubmit={send}
              onStop={() => { setStopped(true); void stop(); }}
              busy={busy}
              placeholder={`Ask about ${displayName}…`}
              placeholderWide={`Ask about ${displayName}'s work, skills or availability…`}
            />
          </div>
        </div>}
      </div>
    </div>
  );
});

function localVisual(kind: VisualKind, contactForm: ContactFormVisualData): Visual | null {
  switch (kind) {
    case "contact-form":
      return { kind: "contact-form", data: contactForm };
    case "projects":
    case "project-detail":
    case "evidence-atlas":
    case "skills":
    case "education":
    case "availability":
    case "profile":
    case "profile-link":
    case "experience":
      return null;
  }

  const exhaustiveVisual: never = kind;
  return exhaustiveVisual;
}
