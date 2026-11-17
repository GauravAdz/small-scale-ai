"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Code2,
  Download,
  MapPin,
  MessageSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "@/components/identity/avatar";
import { Button } from "@/components/ui/button";
import { Composer } from "./composer";
import type { ChatActionProps } from "./contracts";
import type { ChatUiConfig } from "@/lib/chat/ui-config";
import type { ProjectVisualData } from "@/lib/chat/visual-types";
import type { Profile } from "@/lib/knowledge/schema";

type LandingProps = ChatActionProps & {
  profile: Profile;
  featured: ProjectVisualData[];
  projects: ProjectVisualData[];
  config: ChatUiConfig;
  draft: string;
  onDraftChange: (value: string) => void;
  onStop: () => void;
  hasConversation: boolean;
  onResume: () => void;
  active: boolean;
};

/** Authored profile and project records lead; the counterpart invites a deeper look. */
export function Landing({
  profile,
  featured,
  projects,
  config,
  draft,
  onDraftChange,
  onStop,
  hasConversation,
  onResume,
  active,
  onSelect,
  onLocalVisual,
  disabled = false,
}: LandingProps) {
  const [expanded, setExpanded] = React.useState(false);
  const extraProjects = projects.filter(project => !featured.some(item => item.slug === project.slug));
  const visibleProjects = expanded ? [...featured, ...extraProjects] : featured;
  const workRef = React.useRef<HTMLElement>(null);
  const highlights = profileHighlights(profile);

  return (
    <div className="portfolio-home mx-auto w-full max-w-6xl">
      <section
        id="home"
        aria-labelledby="portfolio-title"
        className="portfolio-hero grid min-h-[calc(100dvh-4rem)] content-center gap-5 py-6 sm:gap-6 sm:py-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)] lg:gap-x-16 lg:gap-y-7 lg:py-12"
      >
        <div className="lg:col-start-1 lg:row-start-1">
          <p className="label-mark mb-5 flex items-center gap-2"><span className="h-px w-8 bg-primary" aria-hidden /> A portfolio you can talk to</p>
          <h1 id="portfolio-title" tabIndex={-1} className="text-[clamp(2.25rem,10.5vw,5.5rem)] leading-[0.98] font-semibold tracking-[-0.04em]">{profile.name}</h1>
          <p className="mt-5 text-xl font-medium tracking-tight text-primary sm:text-2xl">{profile.title}</p>
          {profile.location && <p className="hero-location mt-3 flex items-center gap-2 text-sm text-muted-foreground"><MapPin aria-hidden className="size-3.5" /> {profile.location}</p>}
        </div>

        <div id="ask" className="min-w-0 scroll-mt-6 lg:col-start-1 lg:row-start-2">
          {active && (
            <Composer
              value={draft}
              onValueChange={onDraftChange}
              onSubmit={onSelect}
              onStop={onStop}
              busy={disabled}
              placeholder={`Ask about ${profile.name.split(/\s+/)[0]}…`}
              placeholderWide={`Ask about ${profile.name.split(/\s+/)[0]}'s work, skills or availability…`}
              className="border-primary/25"
            />
          )}
          <ul aria-label="Question starters" className="mt-2 grid grid-cols-3 gap-1 sm:mt-3 sm:flex sm:flex-wrap sm:gap-2">
            {config.quickPrompts.map(chip => (
              <li key={chip.label} className="min-w-0">
                <button
                  type="button"
                  aria-label={chip.label}
                  disabled={disabled}
                  onClick={() => chip.localVisual ? onLocalVisual(chip.localVisual, chip.prompt ?? chip.label) : onSelect(chip.prompt ?? chip.label)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-card px-1 py-1 text-center text-xs font-medium transition-[border-color,background-color,transform] duration-150 hover:border-primary/50 hover:bg-accent active:scale-[0.99] disabled:opacity-50 sm:w-auto sm:justify-start sm:gap-2 sm:rounded-full sm:px-3.5 sm:py-2 sm:text-left"
                >
                  <span className="sm:hidden">{chip.mobileLabel ?? chip.label}</span>
                  <span className="hidden sm:inline">{chip.label}</span>
                  <ArrowUpRight aria-hidden className="hidden size-3.5 shrink-0 text-primary sm:block" />
                </button>
              </li>
            ))}
          </ul>
          {hasConversation && (
            <Button variant="ghost" size="sm" className="mt-2 min-h-11" onClick={onResume}>
              <MessageSquare aria-hidden className="size-3.5" />Resume conversation
            </Button>
          )}
        </div>

        <div className="lg:col-start-1 lg:row-start-3">
          <div className="hero-action-links grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <a href="#work" className="portfolio-primary w-full gap-1.5 px-2 text-xs sm:w-auto sm:gap-2.5 sm:px-[1.1rem] sm:text-sm"><ArrowDown aria-hidden className="size-4 shrink-0" /> Explore my work</a>
            {profile.resume && <a href={profile.resume} download className="portfolio-secondary w-full gap-1.5 px-2 text-xs sm:w-auto sm:gap-2.5 sm:px-[1.1rem] sm:text-sm"><Download aria-hidden className="size-4 shrink-0" /> Download CV</a>}
          </div>
        </div>

        <div className="hero-portrait relative flex min-w-0 flex-col items-stretch gap-2.5 sm:grid sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:block lg:self-center lg:justify-self-end">
          <Avatar
            name={profile.name}
            src={profile.avatar}
            alt={`Portrait of ${profile.name}`}
            sizes="(min-width: 1024px) 340px, (min-width: 640px) 144px, calc(100vw - 40px)"
            loading="eager"
            className="hero-portrait-image aspect-video h-auto w-full rounded-[1.35rem] sm:aspect-square sm:w-36 lg:aspect-[4/5] lg:w-[min(28vw,340px)] lg:rounded-[2rem]"
            imageClassName="object-[center_18%] sm:object-center"
          />
          {profile.availability && (
            <div className="hero-availability min-w-0 rounded-xl border border-border bg-card px-3.5 py-3 shadow-lg lg:absolute lg:-bottom-4 lg:-left-6 lg:max-w-[calc(100%+1rem)]">
              <p className="flex items-start gap-2 text-sm font-medium leading-relaxed">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${profile.availability.status === "open" ? "bg-success" : "bg-muted-foreground"}`} />
                <span className="min-w-0">{profile.availability.label}</span>
              </p>
            </div>
          )}
        </div>
      </section>

      <section ref={workRef} id="work" aria-labelledby="work-title" className="scroll-mt-6 border-t border-border py-8 sm:py-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 id="work-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight sm:text-3xl">Selected work</h2></div></div>
        <div id="work-projects" className="grid gap-4 sm:grid-cols-2">
          {visibleProjects.map((project, index) => <article key={project.slug} className="project-preview group flex flex-col rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-6 flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground">0{index + 1} / {project.domain.toUpperCase()}</span><span className="font-mono text-xs text-muted-foreground">{project.year}</span></div>
            <h3 className="text-xl font-semibold tracking-tight">{project.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{project.summary}</p>
            <ul aria-label="Technologies" className="mt-4 flex flex-wrap gap-2">{project.tags.slice(0, 3).map(tag => <li key={tag} className="rounded-md bg-muted px-2 py-1 font-mono text-[10px]">{tag}</li>)}</ul>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5">
              <button disabled={disabled} onClick={() => onSelect(`Tell me about ${project.title}.`)} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary disabled:opacity-50">Explore project <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-1" /></button>
              {(project.url || project.repo) && <a href={project.url || project.repo} target="_blank" rel="noopener noreferrer" aria-label={`${project.url ? "Visit" : "View source for"} ${project.title} (opens in new tab)`} className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-primary">{project.url ? (/\.pdf(?:[?#]|$)/i.test(project.url) ? "View PDF" : "Live site") : "Source"}<ArrowUpRight aria-hidden className="size-3.5" /></a>}
            </div>
          </article>)}
        </div>
        {extraProjects.length > 0 && <button type="button" aria-expanded={expanded} aria-controls="work-projects"
          onClick={() => {
            if (expanded) {
              const container = workRef.current?.closest<HTMLElement>('[data-testid="home-scroll"]');
              if (container && workRef.current) container.scrollTop += workRef.current.getBoundingClientRect().top - container.getBoundingClientRect().top - 24;
            }
            setExpanded(value => !value);
          }}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
          {expanded ? "View less" : "View more"}<ArrowDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </button>}
      </section>

      <section id="about" aria-labelledby="about-title" className="scroll-mt-6 border-t border-border py-8 sm:py-10">
        <h2 id="about-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight sm:text-3xl">A few things about me</h2>
        <ul className="mt-6 grid gap-x-10 sm:grid-cols-2">
          {highlights.map(highlight => <ProfileHighlight key={highlight.title} {...highlight} />)}
        </ul>
      </section>
    </div>
  );
}

type Highlight = { icon: LucideIcon; title: string; detail: string };

function ProfileHighlight({ icon: Icon, title, detail }: Highlight) {
  return (
    <li className="flex gap-3 border-t border-border py-5">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><Icon className="size-4" /></span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

function profileHighlights(profile: Profile): Highlight[] {
  const ai = profile.focusAreas.find(area => /data|machine|ai/i.test(area.label));
  const robotics = profile.metrics.find(metric => /robot/i.test(metric.label));
  const web = profile.focusAreas.find(area => /web|full.?stack/i.test(area.label));
  const currentEducation = profile.education.find(entry => entry.end?.toLowerCase() === "present");

  return [
    {
      icon: BrainCircuit,
      title: "Applied AI",
      detail: ai?.detail ? `Machine learning and data science with ${ai.detail}.` : profile.title,
    },
    {
      icon: Bot,
      title: "Robotics",
      detail: robotics ? `${robotics.value.replace(/\byrs\b/i, "years")} building and experimenting with robotics.` : "Building and experimenting with robotics and automation.",
    },
    {
      icon: Code2,
      title: "Full-stack software",
      detail: web?.detail ? `Interactive applications with ${web.detail}.` : "Interactive web applications and software systems.",
    },
    {
      icon: MapPin,
      title: profile.location ? `Based in ${profile.location.split(",")[0]}` : "Location",
      detail: currentEducation && profile.location ? `${currentEducation.credential} student in ${profile.location}.` : profile.location ?? "See the profile for current location.",
    },
  ];
}
