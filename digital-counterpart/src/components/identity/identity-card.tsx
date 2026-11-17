"use client";

import { ArrowUpRight, Download, Github, Linkedin, MapPin, Send } from "lucide-react";

import { Avatar } from "./avatar";
import { Button } from "@/components/ui/button";
import type { ProjectVisualData } from "@/lib/chat/visual-types";
import type { Profile } from "@/lib/knowledge/schema";
import { firstName } from "@/lib/person";
import { cn } from "@/lib/utils";

/** Compact profile for the conversation rail and mobile dialog. */
export function IdentityCard({
  profile,
  featured,
  onMessage,
  disabled,
  className,
  /** Mobile renders the same content in a sheet, where height gating is wrong. */
  allowScroll = false,
}: {
  profile: Profile;
  featured: ProjectVisualData[];
  onMessage: () => void;
  disabled?: boolean;
  className?: string;
  allowScroll?: boolean;
}) {
  const open = profile.availability?.status === "open";

  return (
    <div className={cn("flex min-h-full flex-col gap-4 p-4", className)}>
      {/* Identity ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <Avatar name={profile.name} src={profile.avatar} className="size-14 rounded-xl" />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.95rem] leading-tight font-semibold tracking-tight">
            {profile.name}
          </h2>
          <p className="text-foreground/65 mt-0.5 text-xs leading-snug">{profile.title}</p>

          {profile.location && (
            <p className="text-muted-foreground mt-1.5 flex items-center gap-1 text-[11px]">
              <MapPin className="size-3 shrink-0" />
              {profile.location}
            </p>
          )}
        </div>
      </div>

      {profile.availability && (
        <div className="border-border/80 bg-background/40 flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
          <span className="relative flex size-1.5 shrink-0" aria-hidden>
            <span
              className={cn(
                "relative inline-flex size-1.5 rounded-full",
                open ? "bg-success" : "bg-muted-foreground",
              )}
            />
          </span>
          <p className="text-foreground/80 truncate text-[11px]">{profile.availability.label}</p>
        </div>
      )}

      {/* Positioning ──────────────────────────────────────────────────────── */}
      {profile.tagline && (
        <p className="text-foreground/75 text-xs leading-relaxed text-pretty">{profile.tagline}</p>
      )}

      {/* Focus areas ──────────────────────────────────────────────────────── */}
      {profile.focusAreas.length > 0 && (
        <section>
          <h3 className="label-mark">Core areas</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {profile.focusAreas.slice(0, 4).map((area) => (
              <li
                key={area.label}
                className="border-border/60 flex items-baseline justify-between gap-2 border-b pb-1 last:border-b-0"
              >
                <span className="text-xs font-medium">{area.label}</span>
                {area.detail && (
                  <span className="text-muted-foreground truncate font-mono text-[10px]">
                    {area.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Featured work — first to go on a short viewport ─────────────────────
          A *height* query, not a width one: the rail overflows on a short
          laptop window, not a narrow one. Below 760px tall this block drops and
          the card fits without a scrollbar. */}
      {featured.length > 0 && (
        <section
          className={cn(!allowScroll && "hidden [@media(min-height:760px)]:block")}
        >
          <h3 className="label-mark">Featured</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {featured.map((project) => {
              const href = project.url || project.repo;
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{project.title}</span>
                    {project.summary && (
                      <span className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">
                        {project.summary}
                      </span>
                    )}
                  </span>
                  {project.year && (
                    <span className="datum text-muted-foreground shrink-0">{project.year}</span>
                  )}
                </>
              );

              return (
                <li key={project.slug}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-border/70 bg-background/40 hover:border-primary/40 flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5 transition-colors duration-150"
                    >
                      {body}
                    </a>
                  ) : (
                    <div className="border-border/70 bg-background/40 flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Actions — pinned to the bottom, always visible ────────────────────── */}
      <div className="mt-auto flex flex-col gap-2 pt-1">
        <Button
          type="button"
          onClick={onMessage}
          disabled={disabled}
          className="min-h-11 w-full text-xs"
        >
          <Send className="size-3.5" />
          Message {firstName(profile.name)}
        </Button>

        <div className="grid grid-cols-3 gap-1.5">
          {profile.resume && (
            <RailAction href={profile.resume} label="CV" download>
              <Download className="size-3.5" />
            </RailAction>
          )}
          {profile.contact.linkedin && (
            <RailAction href={profile.contact.linkedin} label="LinkedIn">
              <Linkedin className="size-3.5" />
            </RailAction>
          )}
          {profile.contact.github && (
            <RailAction href={profile.contact.github} label="GitHub">
              <Github className="size-3.5" />
            </RailAction>
          )}
        </div>
      </div>
    </div>
  );
}

function RailAction({
  href,
  label,
  download,
  children,
}: {
  href: string;
  label: string;
  download?: boolean;
  children: React.ReactNode;
}) {
  const external = /^https?:/.test(href);

  return (
    <a
      href={href}
      {...(download ? { download: "" } : {})}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="border-border text-foreground/75 hover:border-primary/40 hover:text-foreground group flex min-h-11 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-medium transition-colors duration-150"
    >
      {children}
      {label}
      {external && (
        <ArrowUpRight className="text-muted-foreground group-hover:text-primary size-2.5 transition-colors" />
      )}
    </a>
  );
}
