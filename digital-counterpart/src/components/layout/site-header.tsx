"use client";

import { House, MessageSquare } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/knowledge/schema";

type SiteHeaderProps = {
  profile: Profile;
  home: boolean;
  busy: boolean;
  onHome: (section?: string) => void;
  onMessage: () => void;
};

export function SiteHeader({ profile, home, busy, onHome, onMessage }: SiteHeaderProps) {
  return (
    <header className="z-20 shrink-0 border-b border-border bg-background px-4 sm:px-8">
      <div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-3 py-1.5">
        <a href="#home" onClick={(event) => { event.preventDefault(); onHome(); }} aria-label={`${profile.name} — home`} className="flex min-h-11 min-w-0 items-center gap-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-mono text-sm font-medium text-primary-foreground">GA.</span>
          <span className={home ? "hidden text-sm font-semibold sm:block" : "truncate text-sm font-semibold"}>
            {home ? profile.name : "GauravGPT"}
          </span>
        </a>
        <div className="flex items-center gap-1 sm:gap-3">
          <nav aria-label="Main navigation" className="flex items-center gap-0.5 sm:gap-2">
            <a href="#home" onClick={(event) => { event.preventDefault(); onHome(); }} aria-current={home ? "page" : undefined} className="nav-link">
              <House className="size-3.5" />Home
            </a>
            {home && <>
              <a href="#work" onClick={(event) => { event.preventDefault(); onHome("work"); }} className="nav-link hidden sm:inline-flex">Work</a>
              <a href="#about" onClick={(event) => { event.preventDefault(); onHome("about"); }} className="nav-link hidden sm:inline-flex">About</a>
            </>}
          </nav>
          <Button size="sm" onClick={onMessage} disabled={busy} aria-label={`Message ${profile.name}`} className="min-h-11 shadow-none">
            <MessageSquare className="size-4" /><span className="sm:hidden">Message</span><span className="hidden sm:inline">Contact</span>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
