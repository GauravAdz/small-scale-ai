/** Explicit paid latency benchmark. Keeps provider variance out of `npm run bench`. */
import { answerPortfolioQuestion } from "../src/lib/chat/pipeline";
import { readEnv } from "../src/lib/config";
import { loadProfile, loadProjects } from "../src/lib/knowledge/loader";
import { Retriever } from "../src/lib/rag/retriever";
import { recordOperations } from "../src/lib/evals/operations";
import { AiNaturalAnswerModel, type NaturalAnswerModel } from "../src/lib/llm/natural-answer";

type BenchmarkCase = Readonly<{
  name: string;
  question: string;
  forceRendererFallback?: boolean;
}>;

type Sample = Readonly<{
  class: string;
  route: "local" | "answer";
  support: string;
  requestTotalMs: number;
  stages: Record<string, number>;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
  cacheMisses: number;
}>;

const cases: readonly BenchmarkCase[] = [
  { name: "local identity", question: "Who are you?" },
  { name: "profile link", question: "LinkedIn please" },
  { name: "exact profile fact", question: "Where is Gaurav based?" },
  { name: "education fact", question: "What is Gaurav studying?" },
  { name: "project metadata", question: "What technologies are used in Udaan?" },
  { name: "out-of-domain", question: "What is the capital of France?" },
  { name: "semantic recovery deterministic", question: "where he studyin" },
  { name: "narrative project answer", question: "What problem does Digital Counterpart solve, and how?" },
  { name: "hiring evidence", question: "Why should an applied AI team hire Gaurav?" },
  { name: "complex inference", question: "Could Gaurav contribute to a robotics product that also needs a web interface?" },
  { name: "renderer fallback", question: "Why should an applied AI team interview Gaurav?", forceRendererFallback: true },
];

const stageNames = [
  "resolution_ms",
  "interpretation_ms",
  "semantic_recovery_ms",
  "retrieval_ms",
  "verification_ms",
  "planning_ms",
  "rendering_ms",
] as const;

function percentile(values: readonly number[], fraction: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}

function distribution(values: readonly number[]) {
  return {
    min: values.length ? Math.min(...values) : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

function countCalls(events: ReturnType<typeof recordOperations>["turn"]["events"]): number {
  return events.filter(({ name }) =>
    ["semantic_recovery_attempted", "verification_llm", "renderer_llm", "renderer_review_llm"].includes(name),
  ).length;
}

async function main() {
  const samplesArg = process.argv.find((arg) => arg.startsWith("--samples="));
  const samplesPerClass = samplesArg ? Number(samplesArg.split("=")[1]) : 3;
  if (!Number.isInteger(samplesPerClass) || samplesPerClass < 1 || samplesPerClass > 20) {
    throw new Error("--samples must be an integer from 1 to 20.");
  }

  const configured = readEnv({
    ...process.env,
    LLM_RENDERER_ENABLED: "true",
    LLM_RENDERER_PROVIDER: process.env.LLM_RENDERER_PROVIDER || process.env.LLM_VERIFIER_PROVIDER,
    LLM_RENDERER_MODEL: process.env.LLM_RENDERER_MODEL || process.env.LLM_VERIFIER_MODEL,
  });
  // Measure warm-provider/cache-miss traffic as one cohort. Application cache
  // hits are intentionally excluded so they are never compared with cold work.
  const env = {
    ...configured,
    verificationCache: { ...configured.verificationCache, enabled: false },
    naturalAnswers: { ...configured.naturalAnswers, cacheEnabled: false },
  };
  const profile = loadProfile();
  const projects = loadProjects();
  const retriever = Retriever.fromIndexFile(undefined, env);

  const run = async (item: BenchmarkCase): Promise<Sample> => {
    const operations = recordOperations();
    const liveModel = new AiNaturalAnswerModel(env, operations.observe);
    const naturalAnswerModel: NaturalAnswerModel | undefined = item.forceRendererFallback
      ? {
          rewrite: (input, signal) => liveModel.rewrite(input, signal),
          review: async (input, rewrite, signal) => {
            const reviewed = await liveModel.review(input, rewrite, signal);
            return { checks: reviewed.checks.map((check) => ({ ...check, equivalent: false })) };
          },
        }
      : undefined;
    const started = performance.now();
    const result = await answerPortfolioQuestion({
      question: item.question,
      history: [],
      env,
      profile,
      projects,
      retriever,
      naturalAnswerModel,
      onVerificationEvent: operations.observe,
    });
    const elapsed = performance.now() - started;
    const value = (name: string) => operations.turn.events
      .filter((event) => event.name === name)
      .reduce((sum, event) => sum + (event.value ?? 0), 0);
    return {
      class: item.name,
      route: result.kind,
      support: result.kind === "answer" ? result.answer.support : "local",
      requestTotalMs: value("request_total_ms") || elapsed,
      stages: Object.fromEntries(stageNames.map((name) => [name, value(name)])),
      llmCalls: countCalls(operations.turn.events),
      inputTokens: value("input_tokens"),
      outputTokens: value("output_tokens"),
      cacheHits: value("verification_cache_hit") + value("renderer_cache_hit"),
      cacheMisses: value("verification_cache_miss") + value("renderer_cache_miss"),
    };
  };

  // Prime provider connections and code paths. These observations are not part
  // of the measured cohort.
  await run(cases.find(({ name }) => name === "semantic recovery deterministic")!);
  await run(cases.find(({ name }) => name === "narrative project answer")!);

  const samples: Sample[] = [];
  for (const item of cases) {
    for (let index = 0; index < samplesPerClass; index += 1) samples.push(await run(item));
  }

  const report = cases.map((item) => {
    const cohort = samples.filter((sample) => sample.class === item.name);
    const stageTimings = Object.fromEntries(stageNames.map((name) => [
      name,
      distribution(cohort.map((sample) => sample.stages[name] ?? 0)),
    ]));
    return {
      class: item.name,
      samples: cohort.length,
      cacheMode: "disabled (warm provider, cache miss cohort)",
      latencyMs: distribution(cohort.map(({ requestTotalMs }) => requestTotalMs)),
      stageTimings,
      llmCalls: cohort.map(({ llmCalls }) => llmCalls),
      inputTokens: cohort.map(({ inputTokens }) => inputTokens),
      outputTokens: cohort.map(({ outputTokens }) => outputTokens),
      cacheHits: cohort.map(({ cacheHits }) => cacheHits),
      cacheMisses: cohort.map(({ cacheMisses }) => cacheMisses),
      supportOutcomes: cohort.map(({ support }) => support),
      routes: cohort.map(({ route }) => route),
    };
  });
  console.log(JSON.stringify({ cohort: "warm-provider-cache-miss", samplesPerClass, report }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Live latency benchmark failed");
  process.exitCode = 1;
});
