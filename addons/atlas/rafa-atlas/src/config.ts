/**
 * `loadAtlasConfig`: the project's own Atlas settings, read from
 * `<root>/.rafa/atlas/config.json` (decision D10 of the data integration
 * plan). A module may not call core's `loadConfig`, which would load a
 * second core instance beside the runtime's, so Atlas keeps its two keys
 * in a file of its own:
 *
 *   - `budget.tokensPerWeek`: the weekly token budget `pm.budget-burn`
 *     draws as its goal.
 *   - `wipLimit`: the ceiling the WIP gauge draws against, once the board
 *     ingest serves it.
 *
 * Both are null when the file or the key is absent, or when the file
 * writes `null`: with no target, `pm.budget-burn` draws the spend alone
 * and says no target is set. A value is a whole number above zero; any
 * other value, an unknown key, or a file that is not a JSON object
 * throws `AtlasConfigError`, naming every problem at once.
 *
 * `withAtlasTargets` lays the targets over the metrics a registry serves,
 * so a caller that read the config hands the handler the metrics with
 * their goals set.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The config file under the project root, beside the replica. */
export const ATLAS_CONFIG_FILE: string = join('.rafa', 'atlas', 'config.json');

/** The metric whose goal is the weekly token budget. */
export const BUDGET_METRIC = 'pm.budget-burn';

/** What the project sets for Atlas; every target is null when unset. */
export interface AtlasProjectConfig {
  readonly budget: { readonly tokensPerWeek: number | null };
  readonly wipLimit: number | null;
}

/** The config of a project that sets nothing. */
export const DEFAULT_ATLAS_CONFIG: AtlasProjectConfig = Object.freeze({
  budget: Object.freeze({ tokensPerWeek: null }),
  wipLimit: null,
});

/** The config file holds something Atlas does not read; `problems` names each, one line apiece. */
export class AtlasConfigError extends Error {
  readonly file: string;
  readonly problems: readonly string[];

  constructor(file: string, problems: readonly string[]) {
    super(`atlas: ${file} holds ${problems.length} ${problems.length === 1
      ? 'problem'
      : 'problems'}`);
    this.name = 'AtlasConfigError';
    this.file = file;
    this.problems = problems;
  }
}

/** The config file under `projectRoot`, whether or not it exists. */
export function atlasConfigPathOf(projectRoot: string): string {
  return join(projectRoot, ATLAS_CONFIG_FILE);
}

/** True for a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A target: null when absent or null, the number when it is a whole number above zero, a problem otherwise. */
function readTarget(value: unknown, key: string, problems: string[]): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  problems.push(`${key} is ${JSON.stringify(value)}, expected a whole number above zero, or null for no target`);
  return null;
}

/** Names each key of `record` outside `known`. */
function unknownKeys(record: Record<string, unknown>, known: readonly string[], prefix: string, problems: string[]): void {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) problems.push(`${prefix}${key} is not a key Atlas reads; it reads ${known.map((name) => `${prefix}${name}`).join(' and ')}`);
  }
}

/** The config `parsed` writes, or every problem in it. */
function readConfig(parsed: unknown, problems: string[]): AtlasProjectConfig {
  if (!isRecord(parsed)) {
    problems.push('the file is not a JSON object');
    return DEFAULT_ATLAS_CONFIG;
  }
  unknownKeys(parsed, ['budget', 'wipLimit'], '', problems);
  const budget = parsed['budget'];
  let tokensPerWeek: number | null = null;
  if (isRecord(budget)) {
    unknownKeys(budget, ['tokensPerWeek'], 'budget.', problems);
    tokensPerWeek = readTarget(budget['tokensPerWeek'], 'budget.tokensPerWeek', problems);
  } else if (budget !== undefined && budget !== null) {
    problems.push(`budget is ${JSON.stringify(budget)}, expected an object holding tokensPerWeek`);
  }
  return { budget: { tokensPerWeek }, wipLimit: readTarget(parsed['wipLimit'], 'wipLimit', problems) };
}

/** True when reading the file failed because there is no file. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Reads `<projectRoot>/.rafa/atlas/config.json`; the defaults, every
 * target null, when there is no file. Throws `AtlasConfigError` for a
 * file Atlas cannot read as its config. Never calls core's `loadConfig`.
 */
export async function loadAtlasConfig(projectRoot: string): Promise<AtlasProjectConfig> {
  const file = atlasConfigPathOf(projectRoot);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return DEFAULT_ATLAS_CONFIG;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new AtlasConfigError(file, [`the file is not JSON: ${error instanceof Error
      ? error.message
      : String(error)}`]);
  }
  const problems: string[] = [];
  const config = readConfig(parsed, problems);
  if (problems.length > 0) throw new AtlasConfigError(file, problems);
  return config;
}

/**
 * The metrics with the config's targets laid over them, as a new map:
 * `pm.budget-burn` takes `budget.tokensPerWeek` as its goal when one is
 * set. Every other metric, and the budget metric with no target, is the
 * one handed in.
 */
export function withAtlasTargets(
  metrics: ReadonlyMap<string, MetricDefinition>,
  config: AtlasProjectConfig,
): ReadonlyMap<string, MetricDefinition> {
  const goal = config.budget.tokensPerWeek;
  const budget = metrics.get(BUDGET_METRIC);
  if (goal === null || budget === undefined) return metrics;
  return new Map([...metrics].map(([id, metric]) => [id, id === BUDGET_METRIC
    ? { ...budget, goal }
    : metric]));
}
