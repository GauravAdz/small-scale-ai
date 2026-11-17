import type { EvalCase, EvalPrediction } from "./schema";
import { loadEvalCases, loadEvalPredictions, predictionsById } from "./dataset";

export function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function evalCases(): EvalCase[] {
  return loadEvalCases(argument("--dataset"));
}

export function optionalPredictions(): ReadonlyMap<string, EvalPrediction> | null {
  const file = argument("--predictions");
  if (!file) return null;
  return predictionsById(loadEvalPredictions(file));
}

export function requirePredictionCases(
  suite: string,
): { cases: EvalCase[]; predictions: ReadonlyMap<string, EvalPrediction> } | null {
  const cases = evalCases();
  const predictions = optionalPredictions();
  if (!predictions) {
    console.log(
      `${suite}: ${cases.length} gold cases validated; no system results evaluated (pass --predictions <jsonl>).`,
    );
    return null;
  }
  return { cases, predictions };
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
