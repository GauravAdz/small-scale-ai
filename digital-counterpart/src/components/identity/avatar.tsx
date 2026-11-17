"use client";

import * as React from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Photo when there is one, initials when there isn't.
 *
 * `profile.avatar` previously pointed at a file that didn't exist and nothing
 * rendered it — data promising something the UI ignored. This closes that: set
 * `avatar` to an image in `public/` and it appears; leave it unset and the
 * monogram stands on its own. A file that 404s falls back rather than showing
 * a broken image.
 */
export function Avatar({
  name,
  src,
  alt,
  className,
  imageClassName,
  sizes = "56px",
  loading = "lazy",
}: {
  name: string;
  src?: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  sizes?: string;
  loading?: "eager" | "lazy";
}) {
  const [failed, setFailed] = React.useState(false);

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const shell = cn(
    "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl",
    className,
  );

  if (src && !failed) {
    return (
      <span className={cn(shell, "bg-muted relative")}>
        <Image
          src={src}
          alt={alt ?? name}
          fill
          sizes={sizes}
          loading={loading}
          onError={() => setFailed(true)}
          className={cn("object-cover", imageClassName)}
        />
      </span>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(shell, "bg-primary/10 text-primary text-base font-semibold")}
    >
      {initials}
    </div>
  );
}
