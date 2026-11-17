import fs from "node:fs";
import path from "node:path";

import { loadMarkdownDocs, loadProfile } from "../src/lib/knowledge/loader";
import counterpartConfig from "../counterpart.config";
import { containsAuthoringPlaceholder } from "../src/lib/knowledge/placeholders";
import { parseKnowledgeIndex, validateIndexReferences } from "../src/lib/knowledge/manifest";

const dataDir = path.join(process.cwd(), "data");

function validUrl(value: string): boolean {
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function main(): void {
  const profile = loadProfile(dataDir);
  const docs = loadMarkdownDocs(dataDir);
  const errors: string[] = [];
  const warnings: string[] = [];
  const indexPath = path.join(dataDir, ".index", "index.json");
  if (fs.existsSync(indexPath)) {
    errors.push(...validateIndexReferences(parseKnowledgeIndex(JSON.parse(fs.readFileSync(indexPath, "utf8")))));
  }

  const slugs = new Map<string, string[]>();
  for (const doc of docs) slugs.set(doc.slug, [...(slugs.get(doc.slug) ?? []), doc.relativePath]);
  for (const [slug, sources] of slugs) {
    if (sources.length > 1) errors.push(`Duplicate slug ${slug}: ${sources.join(", ")}`);
  }
  for (const pinned of profile.pinnedProjects) {
    if (!slugs.has(pinned)) errors.push(`Unknown pinned project slug: ${pinned}`);
  }

  const urls = [
    ...Object.entries(profile.contact)
      .filter(([label]) => label !== "email")
      .map(([label, value]) => ({ label: `contact.${label}`, value })),
    ...profile.links.map((link) => ({ label: `link.${link.label}`, value: link.href })),
    ...docs.flatMap((doc) =>
      [doc.frontmatter.url, doc.frontmatter.repo]
        .filter((value): value is string => Boolean(value))
        .map((value) => ({ label: doc.relativePath, value })),
    ),
  ];
  for (const item of urls) {
    if (item.value && !validUrl(item.value)) errors.push(`Malformed URL in ${item.label}: ${item.value}`);
  }
  if (!/^\S+@\S+\.\S+$/.test(profile.contact.email)) {
    errors.push(`Malformed email in contact.email: ${profile.contact.email}`);
  }

  for (const doc of docs) {
    if (containsAuthoringPlaceholder(doc.body)) warnings.push(`${doc.relativePath} contains excluded authoring placeholders`);
    if (/\b(?:currently |this site )?(?:runs on|powered by|uses)\s+(?:gemma|gemini|claude|gpt)/i.test(doc.body)) {
      errors.push(`${doc.relativePath} duplicates a mutable runtime deployment fact`);
    }
    if (doc.frontmatter.type === "project" && !doc.frontmatter.slug) {
      errors.push(`${doc.relativePath} is a project without an explicit slug`);
    }
  }
  if (JSON.stringify(profile).includes("TODO")) warnings.push("profile.json contains TODO placeholders");
  if (!profile.freshness?.locationVerifiedAt) warnings.push("location has no freshness timestamp");
  if (profile.age && !profile.freshness?.ageVerifiedAt) warnings.push("age has no freshness timestamp");
  if (profile.availability && !profile.freshness?.availabilityVerifiedAt) {
    warnings.push("availability has no freshness timestamp");
  }
  if (profile.education.length > 0 && !profile.freshness?.educationVerifiedAt) {
    warnings.push("education status has no freshness timestamp");
  }

  const freshness = counterpartConfig.knowledge.freshnessDays;
  const stale = (label: string, timestamp: string | undefined, maxDays: number) => {
    if (!timestamp) return;
    const ageDays = (Date.now() - Date.parse(timestamp)) / 86_400_000;
    if (ageDays > maxDays) warnings.push(`${label} was last verified ${Math.floor(ageDays)} days ago (limit ${maxDays})`);
  };
  stale("age", profile.freshness?.ageVerifiedAt, freshness.age);
  stale("location", profile.freshness?.locationVerifiedAt, freshness.location);
  stale("availability", profile.freshness?.availabilityVerifiedAt, freshness.availability);
  stale("education status", profile.freshness?.educationVerifiedAt, freshness.education);

  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(`Knowledge lint passed with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`);
}

main();
