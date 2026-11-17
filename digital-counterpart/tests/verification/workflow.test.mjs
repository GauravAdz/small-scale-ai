import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { planVerification } from "../../scripts/verification/plan.mjs";
import { uiRequestAllowed } from "../../scripts/verification/ui-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = (script, args) => spawnSync(process.execPath, [script, ...args], {
  cwd: root, encoding: "utf8",
});

test("documentation has no checks, while authored knowledge verifies its index", () => {
  assert.deepEqual(planVerification(["README.md", "docs/notes.md"]).checks, []);
  const plan = planVerification(["data/projects/example.md"]);
  assert.ok(plan.checks.includes("verify:index"));
  assert.ok(plan.checks.includes("eval:all"));
});

test("UI changes use fixtures and logic changes retain the index gate", () => {
  const ui = planVerification(["src/components/chat/message.tsx", "src/app/globals.css"]);
  assert.ok(ui.checks.includes("test:ui"));
  assert.ok(!ui.checks.includes("eval:all"));
  const logic = planVerification(["src/lib/rag/retriever.ts"]);
  for (const check of ["test", "verify:index", "bench", "eval:all"]) assert.ok(logic.checks.includes(check));
  assert.deepEqual(logic.paidChecks, []);
});

test("release runs all offline gates even with no changed files", () => {
  const plan = planVerification([], { release: true });
  for (const check of ["typecheck", "lint", "test:verification", "test", "lint:knowledge", "verify:index", "bench", "eval:all", "test:ui", "build"]) {
    assert.ok(plan.checks.includes(check), check);
  }
  assert.deepEqual(plan.paidChecks, []);
});

test("mixed scopes deduplicate gates and never select paid execution", () => {
  const plan = planVerification(["package.json", "src/lib/config.ts", "tests/e2e/reliability.spec.ts"]);
  assert.equal(new Set(plan.checks).size, plan.checks.length);
  assert.ok(!plan.checks.some(check => ["test:live", "eval:models", "eval:natural"].includes(check)));
  assert.deepEqual(planVerification([".\\src\\components\\example.tsx"]), planVerification(["src/components/example.tsx"]));
});

test("plan CLI handles spaces and rejects invalid scope arguments", () => {
  const valid = run("scripts/verification/run.mjs", ["--plan", "--files", "docs/my notes.md"]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Checks: none/);
  for (const args of [["--files"], ["--files", "README.md", "--files"], ["--files", "../outside.ts"], ["--base", "--plan"], ["--base", "HEAD", "--files", "README.md"]]) {
    assert.notEqual(run("scripts/verification/run.mjs", ["--plan", ...args]).status, 0);
  }
});

test("paid entry points refuse to execute without explicit opt-in", () => {
  for (const kind of ["models", "natural", "azure", "ask", "browser"]) {
    const result = run("scripts/verification/paid.mjs", [kind]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Not run:.*API credits/);
  }
});

test("UI network guard permits local assets and blocks APIs and external origins", () => {
  const base = "http://127.0.0.1:3100";
  for (const path of ["/", "/_next/static/chunk.js", "/avatar.png"]) {
    assert.equal(uiRequestAllowed(base + path, base), true);
  }
  for (const url of [base + "/api/chat", base + "/%61pi/contact", base + "/API/chat", base + "/api%2fchat", "https://example.com/", "http://127.0.0.1:3000/", "http://localhost:3100/"]) {
    assert.equal(uiRequestAllowed(url, base), false, url);
  }
});
