/** Deterministic change classification. This module never runs checks or reads secrets. */
export function planVerification(files, { release = false } = {}) {
  const categories = new Set();
  const checks = new Set();
  const add = (...names) => names.forEach(name => checks.add(name));
  for (const raw of files) {
    const file = raw.replaceAll("\\", "/").replace(/^\.\//, "");
    if (/^(?:README\.md|AGENTS\.md|docs\/)|\.md$/.test(file) && !file.startsWith("data/")) {
      categories.add("documentation");
    } else if (/^data\//.test(file)) {
      categories.add("knowledge");
      add("lint:knowledge", "verify:index", "eval:all");
    } else if (/^scripts\/verification\/|^tests\/verification\//.test(file)) {
      categories.add("verification tooling");
      add("test:verification");
    } else if (/^tests\/e2e\/reliability\.spec\.ts$|^playwright\.live\.config\.ts$/.test(file)) {
      categories.add("live test definitions (execution requires opt-in)");
      add("typecheck", "test:verification");
    } else if (/^tests\/e2e\/|^playwright\.config\.ts$/.test(file)) {
      categories.add("UI tests");
      add("typecheck", "test:verification", "test:ui");
    } else if (/^public\/|\.(?:css|scss)$/.test(file)) {
      categories.add("styles and assets");
      add("test:ui");
    } else if (/^src\/components\/|^src\/app\/(?!api\/).*\.[jt]sx?$|^src\/lib\/ui\//.test(file)) {
      categories.add("UI");
      add("typecheck", "lint", "test:ui");
    } else if (/^(?:src\/lib\/|src\/types\/|src\/app\/api\/|evals\/|tests\/(?:unit|integration|property)\/)/.test(file)) {
      categories.add("application logic");
      add("typecheck", "lint", "test", "verify:index", "bench", "eval:all");
    } else {
      categories.add("configuration or tooling");
      add("typecheck", "lint", "test:verification", "test", "bench");
      if (/package(?:-lock)?\.json$|next\.config\./.test(file)) add("test:ui");
    }
  }
  const order = ["typecheck", "lint", "test:verification", "test", "lint:knowledge", "verify:index", "bench", "eval:all", "test:ui", "build"];
  if (release) add(...order);
  return { categories: [...categories], checks: order.filter(name => checks.has(name)), paidChecks: [] };
}
