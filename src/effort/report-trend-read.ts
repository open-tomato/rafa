/**
 * Reads the trend report from the store and writes it through the active
 * output, for `rafa effort report --trend`.
 *
 * The session rows come from the store the config selects, resolved as
 * `report.ts` resolves the session report's, and the outcomes and agents
 * from the SQLite `task_reports` and `dispatches` tables under the repo
 * root, whichever backend `store` selects. `report-trend.ts` holds every
 * figure; this module only reads and writes.
 *
 * It sits apart from `report.ts`, which imports it, so the command module
 * stays under the size cap. The imports form a cycle all the same:
 * `report.ts` imports this module, which imports `report-trend.ts`, which
 * imports `groupKeyOf` and `sessionSpanMinutes` from `report.ts`. It is
 * safe while every use across it sits inside a function body; a value
 * read at module level on either side would meet it uninitialised.
 */
import type { TrendOptions, TrendReport, TrendSessionRow } from './report-trend.js';

import { homedir } from 'node:os';

import { activeOutput, activeOutputMode } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { loadConfig } from '../config-load.js';
import { ConfigError } from '../config.js';

import { formatTrendReport } from './report-trend-format.js';
import { summariseTrend } from './report-trend.js';
import { readSessionAgents } from './store/dispatches.js';
import { selectEffortStore } from './store/index.js';
import { readReportedSkills } from './store/reports.js';

/** Where the trend report reads from. */
export interface TrendReadOptions {
  /** The project root, with no default. Governs the config and the store. */
  repoRoot: string;
  /** The home the user scope's config is read under. No default. */
  home: string;
  options: TrendOptions;
}

/** What {@link summariseTrend} reads: the session rows, and each session's outcome and agent. */
export interface TrendInputs {
  rows: readonly TrendSessionRow[];
  outcomes: ReadonlyMap<string, string>;
  agents: ReadonlyMap<string, string>;
}

/**
 * The inputs of the trend report, read from the store under the repo root.
 *
 * Throws a `ConfigError`, having read no row, when a config file under
 * the repo root or the home is one the loop cannot run on.
 */
export function readTrendInputs(repoRoot: string, home: string): TrendInputs {
  const { config } = loadConfig({ root: repoRoot, home });
  return {
    rows: selectEffortStore(repoRoot, config).read('sessions'),
    outcomes: new Map(readReportedSkills(repoRoot).map((report) => [report.sessionId, report.outcome])),
    agents: new Map(readSessionAgents(repoRoot).map((dispatch) => [dispatch.sessionId, dispatch.agent])),
  };
}

/** The trend report over its inputs. */
export function trendReportOf(inputs: TrendInputs, options: TrendOptions): TrendReport {
  return summariseTrend(inputs.rows, inputs.outcomes, inputs.agents, options);
}

/**
 * The trend report over the store under the repo root. Throws as
 * {@link readTrendInputs} throws.
 */
export function readTrendReport({ repoRoot, home, options }: TrendReadOptions): TrendReport {
  return trendReportOf(readTrendInputs(repoRoot, home), options);
}

/**
 * Writes the trend report through the active output: the result in json
 * mode, the JSON on one `info` line under `--json` in text mode, and
 * `report-trend-format.ts`'s lines otherwise. A config the loop cannot
 * run on is refused with exit code 1, one line per problem, as the
 * session report refuses it.
 */
export function writeTrendReport(options: TrendOptions, json: boolean, repoRoot: string): void {
  let built: TrendReport;
  try {
    built = readTrendReport({ repoRoot, home: homedir(), options });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, error.problems.map((problem) => `rafa effort report: ${problem}`).join('\n'));
  }
  const output = activeOutput();
  if (activeOutputMode() === 'json') {
    output.result(built);
    return;
  }
  if (json) {
    output.info(JSON.stringify(built, null, 2));
    return;
  }
  for (const line of formatTrendReport(built)) output.info(line);
}
