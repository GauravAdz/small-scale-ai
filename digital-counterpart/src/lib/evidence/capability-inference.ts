import type { AtomicQuestion } from "./question";
import type { FactStore } from "./fact-store";
import { supportAssessmentSchema, type SupportAssessment } from "./support";
import { skillParts } from "@/lib/knowledge/schema";

const MOBILE_PRODUCT = /\b(mobile app|mobile application|ios|android|react native|flutter)\b/i;
const AGRICULTURE = /\b(agro|argo|agri(?:culture|cultural)?|farm(?:ing)?)\b/i;
const SENIORITY_CLAIM = /\b(senior|staff|principal|lead|expert)\b/i;
const MOBILE_TECH = /\b(react native|flutter|swift|kotlin|ios|android)\b/i;

function canonicalEvidenceExists(store: FactStore, ids: readonly string[]): boolean {
  return ids.every((id) => store.evidenceById.has(id));
}

/**
 * Conservative structured inference for adjacent capability questions.
 *
 * This does not equate web React with React Native. It combines documented
 * transferable product skills and relevant domain work, then preserves the
 * missing native-mobile evidence as an explicit uncertainty claim.
 */
export function inferCapabilityFromRecords(
  question: AtomicQuestion,
  store: FactStore,
): SupportAssessment | null {
  if (!MOBILE_PRODUCT.test(question.text) || SENIORITY_CLAIM.test(question.text)) return null;

  const allSkills = store.profile.skills.flatMap(({ items }) => items.map(skillParts));
  const documentedSkills = ["React JS", "TypeScript", "JavaScript", "Node JS", "HTML / CSS"]
    .flatMap((wanted) => allSkills.filter(({ name }) => name.toLowerCase() === wanted.toLowerCase()));
  const frontendProject = store.projects.find((project) =>
    /\bfrontend\b/i.test([project.summary ?? "", ...project.tags].join(" ")),
  ) ?? store.projects.find((project) =>
    /\b(web|react|javascript|typescript|html|css|next\.?js)\b/i.test(
      [project.summary ?? "", ...project.tags].join(" "),
    ),
  );
  const agricultureProject = AGRICULTURE.test(question.text)
    ? store.projects.find((project) =>
        /\b(agriculture|farm|iot|automation)\b/i.test(
          [project.title, project.summary ?? "", ...project.tags].join(" "),
        ),
      )
    : undefined;

  if (documentedSkills.length < 2 || !frontendProject) return null;

  const evidenceIds = [
    "evidence:profile:skills",
    `evidence:projects/${frontendProject.slug}`,
    ...(agricultureProject ? [`evidence:projects/${agricultureProject.slug}`] : []),
  ];
  if (!canonicalEvidenceExists(store, evidenceIds)) return null;

  const structuredMobileEvidence = [
    ...store.profile.skills.flatMap(({ items }) => items.map((item) => skillParts(item).name)),
    ...store.projects.flatMap((project) => [project.summary ?? "", ...project.tags]),
  ].some((value) => MOBILE_TECH.test(value));

  const skills = documentedSkills.slice(0, 3).map(({ name }) => name).join(", ");
  const domainEvidence = agricultureProject
    ? ` and his ${agricultureProject.title} agriculture/IoT work`
    : "";
  const target = agricultureProject ? "an agricultural mobile-app MVP" : "a mobile-app MVP";

  return supportAssessmentSchema.parse({
    questionId: question.id,
    question: question.text,
    status: structuredMobileEvidence ? "supported" : "partially-supported",
    claims: [
      {
        id: `${question.id}:capability-fit`,
        text: `Based on his documented ${skills} skills, ${frontendProject.title} frontend work${domainEvidence}, he appears to be a credible fit to build ${target}.`,
        kind: "inference",
        evidenceIds,
      },
      ...(!structuredMobileEvidence
        ? [{
            id: `${question.id}:mobile-uncertainty`,
            text: "That is a transferable-skills assessment, not evidence of a shipped native mobile app. Confirm the target platforms, offline requirements, device integrations, and production scope with him.",
            kind: "uncertainty" as const,
            evidenceIds: [],
          }]
        : []),
    ],
    evidenceIds,
    method: "structured-inference",
    reason: structuredMobileEvidence
      ? "Canonical skills or project metadata contains mobile-platform evidence."
      : "Canonical frontend and domain evidence is relevant, but native-mobile delivery is not established.",
  });
}
