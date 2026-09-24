/**
 * `rafa status`: where the project stands, in five sections — branch
 * and plan, loops, pull request, board, housekeeping — read by
 * `src/status/sections.ts` and worded by `src/status/render.ts`. It is
 * all code: it starts no Claude session and declares no `spends`.
 *
 * ## What it reads
 *
 * The config `loadConfig` resolves for the project root, through
 * `resolveProjectConfig` (`./plan/plan-files.ts`), then
 * `readStatusSections` over that root, the home and the config. The
 * reader adds nothing of its own: every section is a reader that
 * already exists, the local ones read first and the network ones under
 * `STATUS_NETWORK_TIMEOUT_MS`.
 *
 * ## What it writes
 *
 * In text mode, each line `renderStatus` answers, at the level it names:
 * `info` for a section read and the lines under it, `warn` for a section
 * that was not. With `--output=json`, `statusData` is the data of the
 * terminal result event, and no section line is written.
 *
 * ## Exit codes
 *
 * - **1**, only for a config that cannot be used: `loadConfig` refused
 *   it, and the refusal names every problem. Nothing is read then.
 * - **2** for a positional word, since the command takes none. That is a
 *   line typed wrong, not a project in trouble, and exit code 1 is kept
 *   for the one refusal above.
 * - **0** otherwise. A section that could not be read — git refusing,
 *   `gh` timing out, a provider that is not `gh` — is a `warn` line and
 *   not a failure, because `readStatusSections` never rejects: a status
 *   that could only be printed while everything answered would be no use
 *   when something does not.
 */
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { ProjectFound } from '../project/scope.js';
import type { StatusInput, StatusSections } from '../status/sections.js';

import { CommandExit } from '../cli/command.js';
import { renderStatus, statusData } from '../status/render.js';
import { readStatusSections } from '../status/sections.js';

import { resolveProjectConfig } from './plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa status';

/** The usage line its argument refusal names. */
export const STATUS_USAGE = 'rafa status';

/** The exit code of a positional word; see the module note. */
export const STATUS_ARGUMENT_EXIT = 2;

/** How the sections are read; each left out is the system's own. */
export interface StatusCommandSeams {
  /** Reads the five sections for `input`. `readStatusSections` with its own seams when left out. */
  readonly read?: (input: StatusInput) => Promise<StatusSections>;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_STATUS_SEAMS: StatusCommandSeams = Object.freeze({});

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa status runs inside a project, and was handed none');
  return context.project;
}

/** Refuses a positional word with {@link STATUS_ARGUMENT_EXIT}; see the module note. */
function expectNoWord(args: readonly string[]): void {
  if (args.length === 0) return;
  throw new CommandExit(
    STATUS_ARGUMENT_EXIT,
    `❌ ${COMMAND_NAME}: expected no argument, got ${String(args.length)}: ${args.join(' ')}\nUsage: ${STATUS_USAGE}`,
  );
}

/** Runs `status` with `seams`; see the module note. */
export async function runStatus(context: RafaContext, seams: StatusCommandSeams): Promise<void> {
  expectNoWord(context.args);
  const project = projectOf(context);
  const config = resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const read = seams.read ?? ((input: StatusInput): Promise<StatusSections> => readStatusSections(input));
  const sections = await read({ root: project.root, home: project.home, config });

  if (context.outputMode === 'json') {
    context.output.result(statusData(sections));
    return;
  }
  for (const line of renderStatus(sections)) {
    if (line.level === 'warn') context.output.warn(line.text);
    else context.output.info(line.text);
  }
}

/** The command, reading `seams`; see the module note. */
export function createStatusCommand(seams: StatusCommandSeams = DEFAULT_STATUS_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'status',
    subject: 'status',
    action: 'status',
    summary: 'where the project stands: branch and plan, loops, pull request, board and housekeeping',
    description: 'Prints one line for each of five sections. Branch: the branch checked out at the project root'
      + ' and the plan its `feat/<stub>` names, with its task counts. Loops: how many sessions are running and'
      + ' how many tasks are blocked, with a line under it for each running loop and each blocked task. Pull'
      + ' request: the branch\'s open pull request, whether it can be merged and its checks. Board: the'
      + ' Roadmap\'s next issue and whether it is ready, and how many issues carry `spec:blocked`. Housekeeping:'
      + ' what `rafa cleanup` would list, counted per group, and how many worktrees are idle. Git, the session'
      + ' records and the plans are read first; the pull request and the board are read through `gh` under a'
      + ' short deadline, and nothing is fetched. A section that cannot be read is one `warn` line saying why,'
      + ' and the others are printed all the same: it exits 1 only for a config that cannot be used. With'
      + ' `--output=json` the five sections are the data of the terminal result event. Starts no session.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa status',
        note: 'Prints the five sections, one line each, with the running loops and blocked tasks under Loops.',
      },
      {
        cmd: 'rafa status --output=json',
        note: 'Gives the five sections as data, each with `read` and its reading or the problem.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runStatus(context, seams),
  };
  return Object.freeze(command);
}

export default createStatusCommand();
