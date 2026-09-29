/**
 * `rafa effort dashboard`: every effort reading in one call, one block
 * per widget in text and one key per widget in the JSON result
 * (`src/effort/dashboard.ts`).
 *
 * Its flags are the trend report's, read by the same parser
 * (`src/effort/report-args.ts`) so the two commands refuse a value alike:
 * `--days=`, `--recent=`, `--loops=` and `--by=`. It reads the store, the
 * session records and the clock, and writes nothing. Starts no Claude
 * session and declares no `spends`.
 *
 * Exit code 1 for an argument, for a flag value the parser refuses, and
 * for a config the loop cannot run on, one line per problem.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Dashboard } from '../../effort/dashboard.js';

import { homedir } from 'node:os';

import { CommandExit } from '../../cli/command.js';
import { ConfigError } from '../../config.js';
import { formatDashboard } from '../../effort/dashboard-format.js';
import { readDashboard } from '../../effort/dashboard.js';
import { parseReportArgs } from '../../effort/report-args.js';
import { expectNoArgument, requireProject } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort dashboard';

/** The line the refusals end with. */
const USAGE = 'rafa effort dashboard [--days=<n>] [--recent=<n>] [--loops=<n>] [--by=effort|model|agent]';

/** The flags handed on to the trend parser. */
const TREND_FLAGS = ['days', 'recent', 'loops', 'by'] as const;

/** What a test replaces. */
export interface DashboardCommandSeams {
  /** The clock the status measures to. */
  readonly now?: () => Date;
  /** The home the user scope's config is read under. */
  readonly home?: string;
}

/** Refuses with exit code 1, one line per problem, then the usage line. */
function refuse(problems: readonly string[]): never {
  throw new CommandExit(1, [...problems.map((problem) => `❌ ${COMMAND_NAME}: ${problem}`), `Usage: ${USAGE}`].join('\n'));
}

/** The trend options the flags ask for, through the trend parser. */
function trendOptionsOf(context: RafaContext): NonNullable<ReturnType<typeof parseReportArgs>['trend']> {
  const args = ['--trend'];
  for (const flag of TREND_FLAGS) {
    const value = context.flags[flag];
    if (value !== undefined) args.push(`--${flag}=${String(value)}`);
  }
  const parsed = parseReportArgs(args);
  if (parsed.errors.length > 0 || parsed.trend === null) refuse(parsed.errors);
  return parsed.trend;
}

/** Runs one invocation. See the module note. */
export function runDashboard(context: RafaContext, seams: DashboardCommandSeams): void {
  expectNoArgument(context.args, USAGE);
  const root = requireProject(context, COMMAND_NAME).root;
  const trend = trendOptionsOf(context);

  let dashboard: Dashboard;
  try {
    dashboard = readDashboard({
      repoRoot: root,
      home: seams.home ?? homedir(),
      trend,
      now: (seams.now ?? ((): Date => new Date()))(),
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    refuse(error.problems);
  }
  if (context.outputMode === 'json') {
    context.output.result(dashboard);
    return;
  }
  for (const line of formatDashboard(dashboard)) context.output.info(line);
}

/** The command, reaching the clock and the home through `seams`. */
export function createEffortDashboardCommand(seams: DashboardCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort dashboard',
    subject: 'effort',
    action: 'dashboard',
    summary: 'every effort reading in one call: running loops and their estimates, trend, loops, skills and totals',
    description: 'Reads the loops running now with their tasks done over total and three estimates of the time'
      + ' left (by the mean task session, by the time since the plan first started per task done, and'
      + ' `rafa loop status`\'s own), then the trend and loops segments of `rafa effort report --trend`, each'
      + ' plan\'s skills M1 and M2, and the totals of the stored sessions and task reports. With'
      + ' `--output=json` each widget is one key of the result\'s data, so a dashboard fills every widget'
      + ' from one call. It writes nothing; run `rafa effort collect` first for the newest sessions.',
    args: [],
    flags: [
      {
        name: 'days',
        description: 'Days of the trend baseline and of the loop window. 14 when left out.',
        type: 'string',
      },
      {
        name: 'recent',
        description: 'Days of the trend\'s recent window, the newest session\'s day included. 3 when left out.',
        type: 'string',
      },
      {
        name: 'loops',
        description: 'Lists the newest n loops, whatever their age, in place of the loop window.',
        type: 'string',
      },
      {
        name: 'by',
        description: 'Splits each loop row by `effort`, `model` or `agent`.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort dashboard',
        note: 'Prints the status, trend, loops, skills and totals blocks; run `rafa effort collect` first for'
          + ' the newest sessions.',
      },
      {
        cmd: 'rafa effort dashboard --loops=10 --by=effort --output=json',
        note: 'Writes one result whose data holds a key per widget, the ten newest loops split by effort.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runDashboard(context, seams),
  };
  return Object.freeze(command);
}

export default createEffortDashboardCommand();
