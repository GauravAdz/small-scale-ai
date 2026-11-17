"use client";

import * as React from "react";
import { ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { CardFrame } from "./card-frame";
import type { EvidenceAtlasVisualData } from "@/lib/chat/visual-types";
import { cn } from "@/lib/utils";

/** Authored skill-to-project links, with native scrolling and expandable rows. */
export function EvidenceAtlasVisual({ data, onAsk }: {
  data: EvidenceAtlasVisualData;
  onAsk?: (prompt: string) => void;
}) {
  const groupId = React.useId();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const singleCapability = data.capabilities.length === 1 ? data.capabilities[0] : undefined;
  const capability = singleCapability ?? data.capabilities.find(item => item.id === selectedId);
  const projects = capability
    ? data.projects.filter(project => capability.projectSlugs.includes(project.slug))
    : data.projects;

  return (
    <CardFrame label="Skills in practice" aside={`${projects.length} ${projects.length === 1 ? "project" : "projects"}`}>
      <div role="region" aria-label="Skills and projects" data-testid="skills-explorer">
        {singleCapability ? (
          <p className="text-sm font-medium">{singleCapability.label}</p>
        ) : (
          <div role="group" aria-label="Filter projects by skill" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!capability} onClick={() => setSelectedId(null)}
              className={cn("min-h-11 rounded-lg border px-3 text-xs transition-colors", !capability ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>
              All projects
            </button>
            {data.capabilities.map(item => (
              <button key={item.id} type="button" aria-pressed={capability?.id === item.id}
                onClick={() => setSelectedId(current => current === item.id ? null : item.id)}
                className={cn("min-h-11 rounded-lg border px-3 text-xs transition-colors", capability?.id === item.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>
                {item.label}
              </button>
            ))}
          </div>
        )}
        {capability && <ul aria-label={`${capability.label} skills`} className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {capability.skills.map(skill => <li key={skill.name}>{skill.name}{skill.level ? ` · ${skill.level}` : ""}</li>)}
        </ul>}
        <div className="mt-4 divide-y divide-border border-y border-border">
          {projects.map(project => (
            <details key={project.slug} className="group" name={groupId}>
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 font-medium">{project.title}</span>
                <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                  <span className="font-mono text-[11px]">{project.year}</span>
                  <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180" aria-hidden />
                </span>
              </summary>
              <div className="pb-4">
                {project.summary && <p className="text-sm leading-relaxed text-muted-foreground">{project.summary}</p>}
                {project.tags.length > 0 && <ul aria-label="Technologies" className="mt-3 flex flex-wrap gap-1.5">
                  {project.tags.map(tag => <li key={tag} className="rounded bg-muted px-2 py-1 font-mono text-[10px]">{tag}</li>)}
                </ul>}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
                  {onAsk && <button type="button" onClick={() => onAsk(`Tell me about ${project.title}.`)} className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-primary">
                    Ask about {project.title}<ArrowRight className="size-3.5" aria-hidden />
                  </button>}
                  {(project.url || project.repo) && <a href={project.url || project.repo} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                    {project.url ? (/\.pdf(?:[?#]|$)/i.test(project.url) ? "View PDF" : "Live site") : "Source"}<ArrowUpRight className="size-3.5" aria-hidden />
                  </a>}
                </div>
              </div>
            </details>
          ))}
        </div>
        {projects.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No linked projects are listed for this skill.</p>}
      </div>
    </CardFrame>
  );
}
