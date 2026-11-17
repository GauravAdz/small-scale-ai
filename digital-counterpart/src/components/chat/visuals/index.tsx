"use client";

import { EvidenceAtlasVisual } from "./evidence-atlas-visual";
import type { Visual } from "@/lib/chat/visual-types";
import { ContactFormVisual } from "./contact-form-visual";
import {
  AvailabilityVisual,
  EducationVisual,
  ExperienceVisual,
  ProfileVisual,
  SkillsVisual,
} from "./profile-visuals";
import { ProjectDetailVisual, ProjectsVisual } from "./project-visuals";
import { ProfileLinkVisual } from "./profile-link-visual";

/**
 * One switch, so a new visual kind is a type error until it is rendered.
 *
 * `onOpenContact` lets a card hand off to the message form without a round
 * trip — the availability card's primary action is "message him", and making
 * that cost a request would be silly.
 */
export function VisualBlock({
  visual,
  onOpenContact,
  onSelect,
}: {
  visual: Visual;
  onOpenContact?: () => void;
  onSelect?: (prompt: string) => void;
}) {
  const withInsights = (content: React.ReactNode) => (
    <div>
      {visual.insights && visual.insights.length > 0 && (
        <div className="border-border/70 mb-2.5 border-y py-2.5">
          <p className="text-primary text-[10px] font-semibold tracking-wide uppercase">
            What stands out
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {visual.insights.map((insight) => (
              <li key={insight} className="text-foreground/80 flex gap-2 text-xs leading-relaxed">
                <span aria-hidden className="bg-primary mt-[0.45rem] size-1 shrink-0 rounded-full" />
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {content}
    </div>
  );

  switch (visual.kind) {
    case "projects":
      return withInsights(<ProjectsVisual heading={visual.heading} projects={visual.projects} />);
    case "project-detail":
      return withInsights(<ProjectDetailVisual project={visual.project} />);
    case "evidence-atlas":
      return withInsights(<EvidenceAtlasVisual data={visual.data} onAsk={onSelect} />);
    case "skills":
      return withInsights(<SkillsVisual groups={visual.groups} />);
    case "education":
      return withInsights(<EducationVisual entries={visual.entries} />);
    case "availability":
      return withInsights(<AvailabilityVisual data={visual.data} onOpenContact={onOpenContact} />);
    case "profile":
      return withInsights(<ProfileVisual data={visual.data} onOpenContact={onOpenContact} />);
    case "profile-link":
      return withInsights(<ProfileLinkVisual data={visual.data} />);
    case "experience":
      return withInsights(<ExperienceVisual data={visual.data} onOpenContact={onOpenContact} />);
    case "contact-form":
      return withInsights(<ContactFormVisual data={visual.data} />);
  }

  const exhaustiveVisual: never = visual;
  return exhaustiveVisual;
}
