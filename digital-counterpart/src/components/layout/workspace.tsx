"use client";

import * as React from "react";
import { ChatPanel, type ChatPanelHandle, type ChatViewState } from "@/components/chat/chat-panel";
import { SiteHeader } from "./site-header";
import type { ChatUiConfig } from "@/lib/chat/ui-config";
import type { ContactFormVisualData, ProjectVisualData } from "@/lib/chat/visual-types";
import type { Profile } from "@/lib/knowledge/schema";

/**
 * One viewport and one active scroll region; chat stays mounted while browsing home.
 * Fixed insets size the shell; an additional 100dvh height breaks CSS zoom.
 */
export function Workspace({ profile, featured, projects, contactForm, chatUi }: {
  profile: Profile;
  featured: ProjectVisualData[];
  projects: ProjectVisualData[];
  contactForm: ContactFormVisualData;
  chatUi: ChatUiConfig;
}) {
  const [view, setView] = React.useState<ChatViewState>({ home: true, hasConversation: false, busy: false });
  const chat = React.useRef<ChatPanelHandle>(null);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <SiteHeader
        profile={profile}
        home={view.home}
        busy={view.busy}
        onHome={(section) => chat.current?.goHome(section)}
        onMessage={() => chat.current?.openVisual("contact-form", "I'd like to send Gaurav a message.")}
      />
      <main className="min-h-0 min-w-0 flex-1">
        <ChatPanel
          ref={chat}
          profile={profile}
          featured={featured}
          projects={projects}
          contactForm={contactForm}
          chatUi={chatUi}
          onViewChange={setView}
        />
      </main>
    </div>
  );
}
