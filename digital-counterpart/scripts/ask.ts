/**
 * `npm run ask -- "what's your tech stack?"`
 *
 * Runs candidate retrieval and prints diagnostics. These scores are never a
 * factual-support verdict; use `npm run eval:support` for that layer.
 *
 * Does not call the LLM, so it costs nothing to run.
 */

import { Retriever, formatContext, toCitations } from "../src/lib/rag/retriever";
import { retrievalQuery } from "../src/lib/rag/query";
import { expandRetrievalQuery } from "../src/lib/chat/intent";

const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('Usage: npm run ask -- "your question here"');
    process.exit(1);
  }

  const retriever = Retriever.fromIndexFile();
  const stats = retriever.stats;

  console.log(
    dim(
      `\n${stats.chunks} chunks · ${stats.mode} retrieval · embedding=${stats.embedding.provider} · store=${stats.store.kind}`,
    ),
  );
  console.log(`\n${bold("?")} ${query}\n`);

  const started = Date.now();
  const result = await retriever.retrieve(retrievalQuery(query, expandRetrievalQuery(query)));
  const elapsed = Date.now() - started;

  const detail = `top ${result.diagnostics.topScore.toFixed(3)} · lexical coverage ${result.diagnostics.lexicalQueryCoverage.toFixed(2)}`;
  const verdict = green(`CANDIDATES (${detail})`);

  console.log(`  ${verdict} ${dim(`· ${elapsed}ms`)}\n`);

  if (result.candidates.length === 0) {
    console.log(dim("  no chunks matched at all\n"));
    return;
  }

  for (const [index, scored] of result.candidates.entries()) {
    const { chunk, score, lexicalScore, semanticScore } = scored;
    const section = chunk.headings.length > 0 ? ` › ${chunk.headings.join(" › ")}` : "";
    console.log(
      `  ${bold(`${index + 1}.`)} ${score.toFixed(3)}  ${chunk.title}${section}`,
    );
    console.log(
      dim(
        `      lex ${lexicalScore.toFixed(3)} · vec ${semanticScore.toFixed(3)} · ${chunk.source}`,
      ),
    );
    console.log(dim(`      ${chunk.text.replace(/\s+/g, " ").slice(0, 110)}…`));
  }

  console.log(`\n  ${bold("citations")} ${toCitations(result).map((c) => c.title).join(", ")}`);

  if (process.argv.includes("--context")) {
    console.log(`\n${bold("── context block ──")}\n`);
    console.log(formatContext(result));
  }

  console.log();
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
