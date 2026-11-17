import fs from "node:fs";
import path from "node:path";

function filesBelow(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? filesBelow(target)
      : /\.(?:ts|tsx)$/.test(entry.name)
        ? [target]
        : [];
  });
}

const errors: string[] = [];
const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
for (const forbidden of ["langchain", "llamaindex", "@langchain/core"]) {
  if (packageJson.dependencies?.[forbidden]) errors.push(`Forbidden runtime framework: ${forbidden}`);
}

for (const file of filesBelow(path.join(root, "src", "components"))) {
  const source = fs.readFileSync(file, "utf8");
  if (/\b(generateObject|generateText|streamText|getModel|getChatModel)\b/.test(source)) {
    errors.push(`${path.relative(root, file)} calls or imports model-generation logic`);
  }
}

const retriever = fs.readFileSync(path.join(root, "src/lib/rag/retriever.ts"), "utf8");
if (/\bgrounded\s*:/.test(retriever)) errors.push("Retriever still produces a grounded boolean");

const route = fs.readFileSync(path.join(root, "src/app/api/chat/route.ts"), "utf8");
if (/\b(generateObject|generateText|streamText)\b/.test(route)) {
  errors.push("Chat route contains factual planning or model generation instead of orchestration");
}

for (const error of errors) console.error(`error: ${error}`);
if (errors.length > 0) process.exit(1);
console.log("Architecture lint passed.");
