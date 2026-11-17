import { ImageResponse } from "next/og";

import { loadProfile } from "@/lib/knowledge/loader";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Favicon. A single `G` — the same mark the header and every assistant message
 * carry, so the tab, the chat and the wordmark are recognisably one thing. Two
 * initials at 32px are already at the edge of legible; one is not.
 */
export default function Icon() {
  let initial = "G";

  try {
    initial = loadProfile().name.trim()[0]?.toUpperCase() || "G";
  } catch {
    // An unconfigured profile shouldn't break the favicon route.
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#8a3d15",
          color: "#fdf2e9",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          borderRadius: 7,
        }}
      >
        {initial}
      </div>
    ),
    size,
  );
}
