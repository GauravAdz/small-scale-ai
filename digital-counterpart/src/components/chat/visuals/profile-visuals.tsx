"use client";

import { Briefcase, GraduationCap, MapPin, MessageSquare } from "lucide-react";

import { CardFrame, Panel } from "./card-frame";
import { Avatar } from "@/components/identity/avatar";
import type {
  AvailabilityVisualData,
  EducationVisualEntry,
  ExperienceVisualData,
  ProfileVisualData,
  SkillVisualGroup,
} from "@/lib/chat/visual-types";
import { cn } from "@/lib/utils";

/**
 * Skills as grouped competence, not a badge dump.
 *
 * Levels are three ordinal words in the source data, so they render as three
 * pips. A percentage bar would invent a precision nobody has — "Python: 73%" is
 * a number no one measured — and is the single most common way a portfolio
 * makes a recruiter trust it less.
 */
const LEVEL_PIPS: Record<string, number> = {
  experienced: 3,
  advanced: 3,
  intermediate: 2,
  active: 2,
  familiar: 1,
  beginner: 1,
};

export function SkillsVisual({ groups }: { groups: SkillVisualGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <CardFrame label="Stack">
      <div className="flex flex-col gap-3.5">
        {groups.map((group) => (
          <div key={group.group}>
            <p className="text-foreground/70 mb-1.5 text-xs font-medium">{group.group}</p>
            <ul className="flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const pips = item.level ? (LEVEL_PIPS[item.level.toLowerCase()] ?? 0) : 0;

                return (
                  <li
                    key={item.name}
                    className="border-border/80 bg-background/50 flex items-center gap-2 rounded-md border px-2 py-1"
                  >
                    <span className="text-xs">{item.name}</span>
                    {item.level && (
                      <span className="flex shrink-0 items-center" title={item.level}>
                        <span className="sr-only">{item.level}</span>
                        <span aria-hidden className="flex gap-[3px]">
                          {[1, 2, 3].map((pip) => (
                            <span
                              key={pip}
                              className={cn(
                                "h-2.5 w-[3px] rounded-full",
                                pip <= pips ? "bg-primary" : "bg-border",
                              )}
                            />
                          ))}
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </CardFrame>
  );
}

/**
 * Education on a spine.
 *
 * Education is inherently ordered, and a vertical rail plus a node per entry
 * says "sequence" faster than repeating the dates in prose does.
 */
export function EducationVisual({ entries }: { entries: EducationVisualEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <CardFrame label="Education">
      <ol className="relative flex flex-col gap-3">
        {entries.length > 1 && (
          <span aria-hidden className="bg-border absolute top-4 bottom-4 left-[13px] w-px" />
        )}

        {entries.map((entry) => (
          <li key={`${entry.school}-${entry.credential}`} className="relative flex gap-3">
            <span className="bg-primary/10 text-primary ring-card relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4">
              <GraduationCap className="size-3.5" />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h4 className="text-sm leading-snug font-semibold">{entry.credential}</h4>
                {(entry.start || entry.end) && (
                  <span className="datum text-muted-foreground shrink-0">
                    {[entry.start, entry.end].filter(Boolean).join("–")}
                  </span>
                )}
              </div>

              <p className="text-foreground/75 mt-0.5 text-xs">{entry.school}</p>

              {entry.location && (
                <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
                  <MapPin className="size-3" />
                  {entry.location}
                </p>
              )}

              {entry.detail && (
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                  {entry.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </CardFrame>
  );
}

const STATUS_COPY: Record<AvailabilityVisualData["status"], string> = {
  open: "Open",
  selective: "Selective",
  closed: "Not looking",
};

/** The hiring card — the answer to "should I get in touch?" */
export function AvailabilityVisual({
  data,
  onOpenContact,
}: {
  data: AvailabilityVisualData;
  onOpenContact?: () => void;
}) {
  return (
    <CardFrame
      label="Availability"
      aside={
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              data.status === "open" ? "bg-success" : "bg-muted-foreground",
            )}
          />
          {STATUS_COPY[data.status]}
        </span>
      }
    >
      <p className="text-sm font-medium">{data.label}</p>

      {data.interests.length > 0 && (
        <>
          <p className="label-mark mt-3">Interested in</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {data.interests.map((interest) => (
              <li
                key={interest}
                className="border-primary/25 bg-primary/[0.06] text-foreground/85 rounded-full border px-2.5 py-1 text-xs"
              >
                {interest}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {data.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" />
            {data.location}
          </span>
        )}
        {data.note && <span>{data.note}</span>}
      </div>

      <div className="border-border/70 mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        {onOpenContact && (
          <button
            type="button"
            onClick={onOpenContact}
            className="bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.98] inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-[filter,transform] duration-150"
          >
            Message Gaurav
          </button>
        )}
        {data.resume && (
          <a
            href={data.resume}
            download=""
            className="border-border text-foreground/85 hover:border-primary/40 inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition-colors duration-150"
          >
            Download CV
          </a>
        )}
        <a
          href={`mailto:${data.email}`}
          className="text-muted-foreground hover:text-foreground font-mono text-[11px] transition-colors"
        >
          {data.email}
        </a>
      </div>
    </CardFrame>
  );
}

/** A compact "who is this" card, for the about-shaped questions. */
export function ProfileVisual({
  data,
  onOpenContact,
}: {
  data: ProfileVisualData;
  onOpenContact?: () => void;
}) {
  return (
    <CardFrame label="Profile">
      <div className="flex items-start gap-3">
        <Avatar name={data.name} src={data.avatar} className="size-14 rounded-lg" />

        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold tracking-tight">{data.name}</h4>
          <p className="text-foreground/70 text-xs">{data.title}</p>

          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {data.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {data.location}
              </span>
            )}
            {data.age && <span className="datum">{data.age} years old</span>}
          </div>
        </div>
      </div>

      {data.tagline && (
        <p className="text-foreground/80 mt-3 text-sm leading-relaxed">{data.tagline}</p>
      )}

      {data.focusAreas.length > 0 && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-3">
          {data.focusAreas.map((area) => (
            <li key={area.label}>
              <Panel className="h-full px-2.5 py-2">
                <p className="text-xs font-medium">{area.label}</p>
                {area.detail && (
                  <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                    {area.detail}
                  </p>
                )}
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {onOpenContact && (
        <div className="border-border/70 mt-3 border-t pt-3">
          <button
            type="button"
            onClick={onOpenContact}
            className="bg-primary text-primary-foreground hover:brightness-110 focus-visible:ring-ring inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-xs font-medium transition-[filter,transform] duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <MessageSquare aria-hidden className="size-3.5" />
            Message Gaurav
          </button>
        </div>
      )}
    </CardFrame>
  );
}

/** Experience roles with a truthful fallback when no role metadata is authored. */
export function ExperienceVisual({
  data,
  onOpenContact,
}: {
  data: ExperienceVisualData;
  onOpenContact?: () => void;
}) {
  const hasRoles = data.roles.length > 0;

  return (
    <CardFrame label="Experience">
      {hasRoles ? (
        <ol className="flex flex-col gap-2.5">
          {data.roles.map((role) => (
            <li key={`${role.title}-${role.organisation ?? ""}`}>
              <Panel className="p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h4 className="text-sm font-semibold">{role.title}</h4>
                  {role.period && (
                    <span className="datum text-muted-foreground">{role.period}</span>
                  )}
                </div>
                {role.organisation && (
                  <p className="text-foreground/70 mt-0.5 text-xs">{role.organisation}</p>
                )}
                {role.detail && (
                  <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                    {role.detail}
                  </p>
                )}
              </Panel>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-start gap-2.5">
          <Briefcase className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-foreground/80 text-sm leading-relaxed">
            No employed roles recorded yet — the work below is self-directed: picked, built and
            deployed end to end.
          </p>
        </div>
      )}

      {data.selfDirected.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.selfDirected.map((project) => (
            <li key={project.slug}>
              <Panel className="flex items-center justify-between gap-3 px-2.5 py-2">
                <span className="min-w-0 truncate text-xs font-medium">{project.title}</span>
                <span className="text-muted-foreground flex shrink-0 items-center gap-2">
                  {project.year ? <span className="datum">{project.year}</span> : null}
                  {project.status ? <span className="font-mono text-[10px] capitalize">{project.status}</span> : null}
                </span>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {onOpenContact && (
        <div className="border-border/70 mt-3 border-t pt-3">
          <button
            type="button"
            onClick={onOpenContact}
            className="text-primary text-xs font-medium hover:underline"
          >
            Ask him about it directly
          </button>
        </div>
      )}
    </CardFrame>
  );
}
