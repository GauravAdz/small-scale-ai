import { notFound } from "next/navigation";

import { VisualBlock } from "@/components/chat/visuals";
import {
  availabilityVisual,
  contactFormVisual,
  educationVisual,
  experienceVisual,
  profileLinkVisual,
  profileVisual,
  projectVisual,
  projectsVisual,
  skillsVisual,
} from "@/lib/chat/visual-data";
import type { Visual } from "@/lib/chat/visual-types";

/**
 * Development-only gallery of every visual answer, rendered from real data.
 *
 * Card work otherwise costs a round-trip per iteration, and you can only see a
 * card by asking a question that happens to route to it. This renders them all
 * at once through the same builders the chat route uses.
 *
 * Returns 404 in production so it never ships as a visitor-facing page.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const detail = projectVisual("udaan");
  const contact = contactFormVisual();
  const profileLinks = (["github", "linkedin", "email", "website"] as const)
    .map((channel) => profileLinkVisual(channel))
    .filter((data) => data !== null);

  const visuals: Array<{ name: string; visual: Visual }> = [
    { name: "projects", visual: { kind: "projects", heading: "Projects", projects: projectsVisual() } },
    ...(detail
      ? [{ name: "project-detail", visual: { kind: "project-detail" as const, project: detail } }]
      : []),
    { name: "skills", visual: { kind: "skills", groups: skillsVisual() } },
    { name: "education", visual: { kind: "education", entries: educationVisual() } },
    { name: "availability", visual: { kind: "availability", data: availabilityVisual() } },
    { name: "profile", visual: { kind: "profile", data: profileVisual() } },
    ...profileLinks.map((data) => ({
      name: `profile-link · ${data.channel}`,
      visual: { kind: "profile-link" as const, data },
    })),
    { name: "experience", visual: { kind: "experience", data: experienceVisual() } },
    {
      name: "contact-form · configured",
      visual: { kind: "contact-form", data: { ...contact, deliveryConfigured: true } },
    },
    {
      name: "contact-form · direct-email fallback",
      visual: { kind: "contact-form", data: { ...contact, deliveryConfigured: false } },
    },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="border-border mb-8 border-b pb-4">
        <h1 className="text-xl font-semibold tracking-tight">Visual answers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every card the deterministic intent layer can render, from real data. Development only.
        </p>
      </header>

      <div className="flex flex-col gap-8">
        {visuals.map(({ name, visual }) => (
          <section key={name}>
            <p className="text-muted-foreground mb-1 font-mono text-[11px]">{name}</p>
            <VisualBlock visual={visual} />
          </section>
        ))}
      </div>
    </main>
  );
}
