import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planVerification } from "./plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
let files = [];
let base;
let planOnly = false;
let release = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--plan") planOnly = true;
  else if (arg === "--release") release = true;
  else if (arg === "--base") {
    base = args[++index];
    if (!base || base.startsWith("-")) throw new Error("--base requires a Git revision.");
  } else if (arg === "--files") {
    const initialCount = files.length;
    while (index + 1 < args.length && !args[index + 1].startsWith("--")) files.push(args[++index]);
    if (files.length === initialCount) throw new Error("--files requires at least one project-relative path.");
  } else throw new Error(`Unknown option: ${arg}`);
}
if (base && files.length) throw new Error("Choose --base or --files, not both.");
if (!files.length) {
  const git = (...parts) => execFileSync("git", parts, { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  // Diff against HEAD includes staged and unstaged edits. Untracked files are
  // explicit candidates too; quoted paths and spaces are preserved with -z.
  if (base) execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { cwd: root, stdio: "pipe" });
  files = [...new Set([...git("diff", "--name-only", "-z", base ?? "HEAD", "--"), ...git("ls-files", "--others", "--exclude-standard", "-z")])];
}
for (const file of files) {
  const relative = path.relative(root, path.resolve(root, file));
  if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("Files must be inside this project.");
}
files = files.map(file => path.relative(root, path.resolve(root, file)));
const plan = planVerification(files, { release });
console.log(`Scope: ${plan.categories.join(", ") || "no changed files"}`);
console.log(`Checks: ${plan.checks.join(" → ") || "none"}`);
console.log("Paid model checks: excluded. UI requests require fixtures.");
if (!args.includes("--files")) console.log("For a dirty workspace, use --files to limit this run to the current task.");
if (planOnly || !plan.checks.length) process.exit(0);
for (const check of plan.checks) {
  const result = spawnSync("npm", ["run", check], { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
