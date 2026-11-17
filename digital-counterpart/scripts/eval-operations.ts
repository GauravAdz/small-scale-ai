import { loadEvalCases } from "../src/lib/evals/dataset";
import { runEvalCases } from "../src/lib/evals/runner";
import { operationalMetrics, type OperationalTurn } from "../src/lib/evals/operations";
import { InMemoryVerificationCache } from "../src/lib/evidence/verification-cache";
import { readEnv } from "../src/lib/config";

async function main() {
  const env = readEnv();
  const turns: OperationalTurn[] = [];
  const options = { env, cache: new InMemoryVerificationCache(env.verificationCache), onOperations: (turn: OperationalTurn) => turns.push(turn) };
  const cases = loadEvalCases();
  await runEvalCases(cases, options);
  await runEvalCases(cases, options);
  console.log("Operational routing (offline verifier fixture; latency is local, token usage/cost unavailable):");
  console.log(JSON.stringify(operationalMetrics(turns), null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Operational evaluation failed"); process.exitCode = 1; });
