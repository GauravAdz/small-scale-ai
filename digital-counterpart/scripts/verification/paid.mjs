import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [kind, ...args] = process.argv.slice(2);
const scripts = { models: "eval-models.ts", natural: "eval-natural.ts", understanding: "eval-understanding.ts", latency: "bench-live.ts", azure: "smoke-azure.ts", ask: "ask.ts" };
if (!Object.hasOwn(scripts, kind) && kind !== "browser") throw new Error("Unknown paid check.");
if (!args.includes("--allow-paid")) {
  console.error("Not run: this check can spend API credits. After an explicit request, add --allow-paid. Routine design verification uses npm run test:ui.");
  process.exit(2);
}
const forwarded = args.filter(arg => arg !== "--allow-paid");
const command = kind === "browser"
  ? ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.live.config.ts", ...forwarded]
  : ["--env-file-if-exists=.env.local", "--import", "tsx", `scripts/${scripts[kind]}`, ...forwarded];
const result = spawnSync(process.execPath, command, {
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  env: { ...process.env, COUNTERPART_PAID_CHECKS: "1" },
  stdio: "inherit",
  shell: false,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
