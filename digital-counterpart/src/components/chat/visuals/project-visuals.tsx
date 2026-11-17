"use client";

import { ArrowUpRight, Boxes, BrainCircuit, Cpu, FileText, Github, LineChart, Layout } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { CardFrame, Panel } from "./card-frame";
import type { ProjectDomain, ProjectVisualData } from "@/lib/chat/visual-types";
import { cn } from "@/lib/utils";

/**
 * Projects don't all do the same thing, so their cards don't all look the same.
 *
 * The variation is a glyph and a one-word domain mark, both derived from the
 * project's own tags. That is enough for someone scanning to tell a robotics
 * build from a React app before reading a word — and it stays inside the single
 * accent, rather than handing each project a colour and turning the grid into
 * a chart of nothing.
 */
const DOMAIN: Record<ProjectDomain, { icon: LucideIcon; label: string }> = {
  ai: { icon: BrainCircuit, label: "Applied AI" },
  web: { icon: Layout, label: "Web" },
  hardware: { icon: Cpu, label: "Hardware" },
  data: { icon: LineChart, label: "Data" },
  code: { icon: Boxes, label: "Software" },
};

function LinkRow({ project }: { project: ProjectVisualData }) {
  if (!project.url && !project.repo) return null;

  const isDocument = project.url?.endsWith(".pdf");

  return (
    <div className="border-border/70 mt-2.5 flex items-center gap-3 border-t pt-2.5">
      {project.url && (
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          {isDocument ? <FileText className="size-3" /> : null}
          {isDocument ? "Poster" : "Live"}
          {!isDocument && <ArrowUpRight className="size-3" />}
        </a>
      )}
      {project.repo && (
        <a
          href={project.repo}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          <Github className="size-3" />
          Code
        </a>
      )}
    </div>
  );
}

function Tags({ tags, limit = 4 }: { tags: string[]; limit?: number }) {
  if (tags.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1">
      {tags.slice(0, limit).map((tag) => (
        <li
          key={tag}
          className="border-border/80 text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-tight"
        >
          {tag}
        </li>
      ))}
      {tags.length > limit && (
        <li className="text-muted-foreground self-center font-mono text-[10px]">
          +{tags.length - limit}
        </li>
      )}
    </ul>
  );
}

/** `shipped` and `building` are different states and should not look alike. */
function StatusMark({ status }: { status?: string }) {
  if (!status) return null;
  const live = /ship|live|done|complete/i.test(status);

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 font-mono text-[10px]">
      <span
        aria-hidden
        className={cn("size-1 rounded-full", live ? "bg-success" : "bg-primary")}
      />
      {status}
    </span>
  );
}

export function ProjectsVisual({
  heading,
  projects,
}: {
  heading: string;
  projects: ProjectVisualData[];
}) {
  if (projects.length === 0) return null;

  return (
    <CardFrame label={heading} aside={`${projects.length}`}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {projects.map((project) => {
          const { icon: Icon, label } = DOMAIN[project.domain];

          return (
            <li key={project.slug}>
              <Panel interactive className="flex h-full flex-col p-3">
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="text-primary bg-primary/10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"
                  >
                    <Icon className="size-3.5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="truncate text-sm font-semibold tracking-tight">
                        {project.title}
                      </h4>
                      {(project.year || project.status) && (
                        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5">
                          {project.year ? <span className="datum">{project.year}</span> : null}
                          <StatusMark status={project.status} />
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 font-mono text-[10px] tracking-tight">
                      {label}
                      {project.role ? ` · ${project.role}` : ""}
                    </p>
                  </div>
                </div>

                {project.summary && (
                  <p className="text-foreground/75 mt-2 flex-1 text-xs leading-relaxed">
                    {project.summary}
                  </p>
                )}

                <Tags tags={project.tags} />
                <LinkRow project={project} />
              </Panel>
            </li>
          );
        })}
      </ul>
    </CardFrame>
  );
}

/**
 * One project, asked about by name.
 *
 * Showing all five when someone asked about one is the failure this exists to
 * prevent — it makes them do the filtering the question already did.
 */
export function ProjectDetailVisual({ project }: { project: ProjectVisualData }) {
  const { icon: Icon, label } = DOMAIN[project.domain];

  return (
    <CardFrame label="Project" aside={project.year ? String(project.year) : undefined}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="text-primary bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-lg"
        >
          <Icon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold tracking-tight">{project.title}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-muted-foreground font-mono text-[10px]">{label}</span>
            {project.role && (
              <span className="text-muted-foreground font-mono text-[10px]">
                {project.role}
              </span>
            )}
            <StatusMark status={project.status} />
          </div>
        </div>
      </div>

      {project.summary && (
        <p className="text-foreground/80 mt-3 text-sm leading-relaxed">{project.summary}</p>
      )}

      <Tags tags={project.tags} limit={8} />
      <LinkRow project={project} />
    </CardFrame>
  );
}
