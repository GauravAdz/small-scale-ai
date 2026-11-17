import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";

import { evalCaseSchema, evalPredictionSchema, type EvalCase, type EvalPrediction } from "./schema";

export const DEFAULT_EVAL_DATASET_DIR = path.join(process.cwd(), "evals", "dataset");

function parseJsonLines<T>(filePath: string, schema: ZodType<T>): T[] {
  const rows: T[] = [];
  const seenIds = new Set<string>();
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: invalid JSON: ${String(error)}`);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${filePath}:${index + 1}: ${parsed.error.message}`);
    }
    const id = (parsed.data as { id?: unknown }).id;
    if (typeof id === "string") {
      if (seenIds.has(id)) throw new Error(`${filePath}:${index + 1}: duplicate id ${id}`);
      seenIds.add(id);
    }
    rows.push(parsed.data);
  }
  return rows;
}

export function loadEvalCases(directory = DEFAULT_EVAL_DATASET_DIR): EvalCase[] {
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
  const cases = files.flatMap((file) => parseJsonLines(path.join(directory, file), evalCaseSchema));
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate eval case id across dataset: ${item.id}`);
    ids.add(item.id);
  }
  return cases;
}

export function loadEvalPredictions(filePath: string): EvalPrediction[] {
  return parseJsonLines(path.resolve(filePath), evalPredictionSchema);
}

export function predictionsById(predictions: readonly EvalPrediction[]): ReadonlyMap<string, EvalPrediction> {
  return new Map(predictions.map((prediction) => [prediction.id, prediction]));
}
