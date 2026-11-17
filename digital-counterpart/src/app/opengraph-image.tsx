import { ImageResponse } from "next/og";

import { loadProfile } from "@/lib/knowledge/loader";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Gaurav Adhikari — Applied AI & Software Builder";

/**
 * The link preview card — the thing a recruiter sees before deciding to click,
 * and the only part of this project that gets read without being visited.
 *
 * Generated from `profile.json` so it can't go stale, and it leads with the
 * claim that actually differentiates the site: the answers are cited and it
 * refuses rather than guesses.
 *
 * `next/og` runs a subset of CSS — flexbox only, no grid, and every element
 * with more than one child needs an explicit `display`.
 */
export default function OpengraphImage() {
  let name = "GauravGPT";
  let title = "Applied AI & Software Builder";

  try {
    const profile = loadProfile();
    name = profile.name;
    title = profile.title;
  } catch {
    // Fall through to defaults — a broken profile shouldn't 500 the OG route.
  }

  const initial = name.trim()[0]?.toUpperCase() || "G";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#131211",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        {/* Accent rule — the only decoration, echoing the app's primary. */}
        <div style={{ display: "flex", width: 96, height: 6, background: "#d97a3d", borderRadius: 99 }} />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 76,
                height: 76,
                borderRadius: 20,
                background: "#241f1c",
                color: "#e8a06a",
                fontSize: 30,
                fontWeight: 700,
                marginRight: 24,
              }}
            >
              {initial}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 52, fontWeight: 700, color: "#f7f4f1", letterSpacing: "-0.02em" }}>
                {name}
              </div>
              {title ? (
                <div style={{ fontSize: 25, color: "#a89d95", marginTop: 6 }}>{title}</div>
              ) : null}
            </div>
          </div>

          <div style={{ fontSize: 31, color: "#d5cdc7", lineHeight: 1.35, maxWidth: 900 }}>
            Interactive portfolio powered by GauravGPT
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 22, color: "#8f857e" }}>
            Factual claims are linked to Gaurav's current records.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 19,
              color: "#e8a06a",
              background: "#211d1a",
              border: "1px solid #3a322c",
              borderRadius: 99,
              padding: "10px 22px",
            }}
          >
            GauravGPT
          </div>
        </div>
      </div>
    ),
    size,
  );
}
