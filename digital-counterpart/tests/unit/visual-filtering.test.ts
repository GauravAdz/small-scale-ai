import { describe, expect, it } from "vitest";

import { evidenceAtlasVisual, experienceVisual } from "@/lib/chat/visual-data";

describe("capability visual filtering", () => {
  it.each([
    ["AI", "AI & Data Science"],
    ["artificial intelligence", "AI & Data Science"],
    ["ML", "AI & Data Science"],
    ["data analysis", "AI & Data Science"],
    ["React", "Web Development"],
    ["frontend", "Web Development"],
    ["HTML", "Web Development"],
    ["robotics", "Beyond code"],
    ["quantitative finance", "Beyond code"],
    ["graphic design", "Beyond code"],
  ])("focuses %s on its authored capability", (subject, expected) => {
    const visual = evidenceAtlasVisual(`How proficient is Gaurav in ${subject}?`);
    expect(visual.capabilities.map(({ label }) => label)).toEqual([expected]);
    expect(visual.projects.every((project) =>
      visual.capabilities[0].projectSlugs.includes(project.slug),
    )).toBe(true);
  });

  it.each([
    ["AI", ["LinzSings", "Digital Counterpart", "Smart Farm and Its Ecosystem", "Satellite Classifier", "GauravGPT"]],
    ["web development", ["Appogeny", "LinzSings", "Digital Counterpart", "Udaan", "GauravGPT"]],
    ["robotics", ["Smart Farm and Its Ecosystem"]],
  ])("shows the projects linked to %s through authored metadata", (subject, expected) => {
    expect(evidenceAtlasVisual(`How proficient is Gaurav in ${subject}?`).projects.map(({ title }) => title))
      .toEqual(expected);
  });

  it("builds the Experience card from authored role metadata", () => {
    expect(experienceVisual().roles).toEqual([
      expect.objectContaining({
        title: "Science Teacher",
        organisation: "Budhanilkantha School",
        period: "December 2024 – May 2025",
      }),
      expect.objectContaining({ organisation: "Team Knowledge Park" }),
      expect.objectContaining({ title: "Independent AI / Product Developer" }),
      expect.objectContaining({
        title: "First-prize Hackathon Project Developer",
        organisation: "Ars Electronica Festival 2026 AI Hackathon",
        period: "September 2026",
        detail: "Developed LinzSings, an audio-based City of Linz storytelling experience that won first prize through the event's community vote.",
      }),
    ]);
  });

  it.each([
    "What are Gaurav's skills?",
    "What skill should Gaurav learn next?",
    "How does Gaurav approach design?",
    "Could Gaurav work with artificial snow machines?",
  ])("keeps a broad view when no capability is named: %s", (question) => {
    expect(evidenceAtlasVisual(question).capabilities.map(({ label }) => label)).toEqual([
      "AI & Data Science",
      "Web Development",
      "Beyond code",
    ]);
  });
});
