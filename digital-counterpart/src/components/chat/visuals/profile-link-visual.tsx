"use client";

import {
  ArrowUpRight,
  Download,
  FileText,
  Github,
  Globe2,
  Linkedin,
  Mail,
  type LucideIcon,
} from "lucide-react";

import type {
  ProfileLinkChannel,
  ProfileLinkVisualData,
} from "@/lib/chat/visual-types";
import { CardFrame } from "./card-frame";

const CHANNEL_ICON: Record<ProfileLinkChannel, LucideIcon> = {
  github: Github,
  linkedin: Linkedin,
  website: Globe2,
  email: Mail,
  resume: FileText,
};

/** One compact action for an exact profile contact fact. */
export function ProfileLinkVisual({ data }: { data: ProfileLinkVisualData }) {
  const Icon = CHANNEL_ICON[data.channel];
  const external = /^https?:/i.test(data.href);

  return (
    <CardFrame label={data.label} className="max-w-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{data.value}</p>
            {data.handle && data.handle !== data.value && (
              <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
                {data.handle}
              </p>
            )}
          </div>
        </div>

        <a
          href={data.href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          {...(data.download ? { download: "Gaurav-Adhikari-CV.pdf" } : {})}
          className="border-border text-foreground hover:border-primary/40 hover:bg-accent active:scale-[0.98] group inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-[border-color,background-color,color,transform] duration-150"
        >
          {data.actionLabel}
          {data.download ? (
            <Download className="text-primary size-3.5" aria-hidden />
          ) : external && (
            <ArrowUpRight
              className="text-muted-foreground group-hover:text-primary size-3 transition-colors"
              aria-hidden
            />
          )}
        </a>
      </div>
    </CardFrame>
  );
}
