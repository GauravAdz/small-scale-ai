import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { containsAuthoringPlaceholder, omitAuthoringParagraphs } from "@/lib/knowledge/placeholders";
import { educationSchema, frontmatterSchema, availabilitySchema } from "@/lib/knowledge/schema";
import { evidenceFromDocuments } from "@/lib/evidence/records";
import { chunkAll } from "@/lib/knowledge/chunk";
import { loadKnowledgeDocs } from "@/lib/knowledge/loader";
import { parseKnowledgeIndex, validateIndexReferences } from "@/lib/knowledge/manifest";

describe("authoring boundaries", () => {
  it.each(["TODO: subjects and grades.", "placeholder", "TbD", "FixMe", "replace me", "fill this in", "<!-- editor note -->", "[insert school]"])("rejects %s as a whole evidence proposition", (text) => {
    expect(containsAuthoringPlaceholder({ detail: text })).toBe(true);
    expect(evidenceFromDocuments([{ id: "test", text, title: "Education", type: "education", source: "data/education.md", weight: 1, sourceHash: "a".repeat(64) }])).toEqual([]);
  });

  it("omits invalid optional fields and accepts null or missing education details", () => {
    for (const detail of [undefined, null, "TODO: subjects and grades."]) {
      expect(educationSchema.parse({ school: "School", credential: "A Levels", detail }).detail).toBeUndefined();
    }
    expect(educationSchema.parse({ school: "School", credential: "A Levels" })).not.toHaveProperty("grades");
  });

  it("keeps taken, recognized, and planned coursework in separate structured fields", () => {
    const education = educationSchema.parse({
      school: "University",
      credential: "BSc",
      coursework: {
        taken: ["Introduction to AI"],
        recognized: ["Programming in Python I"],
        planned: ["Hands-on AI II"],
      },
    });
    expect(education.coursework).toEqual({
      taken: ["Introduction to AI"],
      recognized: ["Programming in Python I"],
      planned: ["Hands-on AI II"],
    });
  });

  it("omits optional frontmatter authoring fields before exact facts and rejects invalid required values", () => {
    expect(frontmatterSchema.parse({ title: "Project", summary: "TODO: description", role: null, status: "TBD" }))
      .toMatchObject({ summary: undefined, role: undefined, status: undefined });
    expect(availabilitySchema.parse({ label: "Open", note: "replace me" }).note).toBeUndefined();
    expect(() => frontmatterSchema.parse({ title: "PLACEHOLDER" })).toThrow();
  });

  it("keeps compact experience roles typed while the Markdown body owns narrative evidence", () => {
    const experience = frontmatterSchema.parse({
      title: "Experience",
      type: "experience",
      experienceRoles: [
        {
          title: "Science Teacher",
          organisation: "Budhanilkantha School",
          period: "December 2024 – May 2025",
          detail: "Taught integrated science and mentored makerspace students.",
        },
      ],
    });
    expect(experience.experienceRoles).toEqual([
      expect.objectContaining({
        title: "Science Teacher",
        organisation: "Budhanilkantha School",
      }),
    ]);
  });

  it("rejects the entire wrapped authoring paragraph while retaining independent facts and line positions", () => {
    const source = "# Education\n\nActual degree.\n\nTODO: add modules and\nsubjects to help recruiters.\n\nAnother valid fact.";
    const clean = omitAuthoringParagraphs(source);
    expect(clean).not.toMatch(/subjects|recruiters|TODO/);
    expect(clean.split("\n")[7]).toBe("Another valid fact.");
    expect(clean).toContain("Actual degree.");
    expect(omitAuthoringParagraphs("A claim <!-- note --> with uncertain context.")).toBe("");
    expect(omitAuthoringParagraphs("# TODO project\n\nMisleading fragment.\n\n# Valid\n\nActual work.")).not.toContain("Misleading");
  });

  it("keeps valid portfolio evidence and every generated index projection free of placeholders", () => {
    const docs = loadKnowledgeDocs().map((doc) => ({ ...doc, sourceHash: "a".repeat(64) }));
    const evidence = evidenceFromDocuments(docs);
    expect(evidence.some(({ id }) => id === "evidence:profile:education")).toBe(true);
    expect(containsAuthoringPlaceholder(evidence)).toBe(false);
    expect(containsAuthoringPlaceholder(chunkAll(docs, { size: 900, overlap: 150 }))).toBe(false);
    const index = parseKnowledgeIndex(JSON.parse(fs.readFileSync("data/.index/index.json", "utf8")));
    expect(validateIndexReferences(index)).toEqual([]);
    index.evidence[0].text = "TODO: subjects and grades.";
    expect(validateIndexReferences(index)).toContain(`Evidence ${index.evidence[0].id} contains authoring placeholders`);
  });
});
