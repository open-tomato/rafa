/**
 * `rafa status`: where the project stands, in six sections — branch
 * and plan, loops, pull request, board, claims, housekeeping — read by
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
 * Between the two, once the config is known to be usable, it pulls the
 * other devices' effort rows through a hub contact's `status()` kind
 * (`createHubContact`, `packages/rafa-effort/src/effort/sync/contact.ts`),
 * so the store it reads holds what the project's sync strategy can bring
 * in first. The config is read once more for the contact, silently, as
 * `pullBeforeRead` reads it, since the warnings were written above. Under
 * `local` and `file` that contacts nothing and writes nothing.
 *
 * ## The hub line
 *
 * After a pull that answered, it prints the hub line the contact's
 * facts make (`hubLine`): `hub: reachable, contract <n>, project
 * <name>; pulled <n> rows`, ending `; <m> rows held back` when the pull
 * held rows back, at `info`, before the sections. The facts come from
 * the status answer the pull already read and kept, so the line costs
 * no second status read. A pull's notice, which the contact writes as a
 * `warn` line, comes first: two lines at most.
 *
 * When the pull did not answer, the line the contact wrote stands in the
 * hub line's place and no hub line is printed: the offline line for a
 * hub that cannot be reached, a skew or contract refusal naming its next
 * step, and a missing token or a project the hub does not serve inside
 * the contact's `pull over <kind> failed:` line. One line per contact
 * either way, and the sections are read from the local store all the
 * same: the pull never changes the exit code.
 *
 * ## What it writes
 *
 * The hub line, at `info`, in either mode, or the contact's line in its
 * place at `warn`. In text mode, each line `renderStatus` answers, at the
 * level it names: `info` for a section read and the lines under it,
 * `warn` for a section that was not. With `--output=json`, `statusData` is the data of the
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
 *   when something does not. A hub that cannot be reached, refuses or
 *   finds no token is one `warn` line, and exits 0 too.
 */
import type { StatusInput, StatusSections } from '../status/sections.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';
import type { HubStatusReading, PullBeforeReadInput } from '@open-tomato/rafa-effort';

import { createHubContact, hubLine } from '@open-tomato/rafa-effort';

import { resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';

import { renderStatus, statusData } from '../status/render.js';
import { readStatusSections } from '../status/sections.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa status';

/** The usage line its argument refusal names. */
export const STATUS_USAGE = 'rafa status';

/** The exit code of a positional word; see the module note. */
export const STATUS_ARGUMENT_EXIT = 2;

/** How the sections are read; each left out is the system's own. */
export interface StatusCommandSeams {
  /** Reads the six sections for `input`. `readStatusSections` with its own seams when left out. */
  readonly read?: (input: StatusInput) => Promise<StatusSections>;
  /**
   * Pulls the other devices' rows before the read and answers the hub
   * line's facts, null when it contacted nothing. {@link statusBeforeRead}
   * when left out.
   */
  readonly pull?: (input: PullBeforeReadInput) => Promise<HubStatusReading | null>;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_STATUS_SEAMS: StatusCommandSeams = Object.freeze({});

/**
 * The pull `rafa status` makes before it reads: the config read silently
 * under `roots`, as `pullBeforeRead` reads it, then one contact's
 * `status()` run. Null, having contacted nothing, for a config the loop
 * cannot run on; see the module note.
 */
export async function statusBeforeRead(input: PullBeforeReadInput): Promise<HubStatusReading | null> {
  const { roots, warn } = input;
  let resolved: ResolvedConfig;
  try {
    // Read silently: the command has read the config already and written its warnings once.
    resolved = await loadConfig(roots, {}, () => {});
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
  return createHubContact({ root: roots.root, home: roots.home, resolved, warn }).status();
}

/** The hub line a `status()` reading makes, or null when the pull did not answer and its own line stands instead. */
export function hubLineOf(reading: HubStatusReading | null): string | null {
  if (reading?.state !== 'contacted' || reading.hub.outcome !== 'done') return null;
  return hubLine(reading.hub.result);
}

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
  const config = await resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const reading = await (seams.pull ?? statusBeforeRead)({ roots: { root: project.root, home: project.home }, warn });
  const line = hubLineOf(reading);
  if (line !== null) context.output.info(line);
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
    summary: 'where the project stands: branch and plan, loops, pull request, board, claims and housekeeping',
    description: 'Pulls the other devices\' effort rows first and, when the sync strategy reached a hub, prints'
      + ' one hub line: `hub: reachable, contract <n>, project <name>; pulled <n> rows`, ending `; <m> rows held'
      + ' back` when the pull held rows back. A hub that cannot be reached, refuses or has no token is one `warn`'
      + ' line in its place, and under `effort.sync: local` or `file` nothing is printed for it. Then prints one'
      + ' line for each of six sections. Branch: the branch checked out at the project root and the plan its'
      + ' `feat/<stub>` names, with its task counts. Loops: how many sessions are running and'
      + ' how many tasks are blocked, with a line under it for each running loop and each blocked task. Pull'
      + ' request: the branch\'s open pull request, whether it can be merged and its checks. Board: the'
      + ' Roadmap\'s next issue and whether it is ready, and how many issues carry `spec:blocked`. Claims: each'
      + ' claim branch on origin as last fetched, the `naming.branch` template with a `rafa-<n>` stub'
      + ' (`feat/rafa-<n>-<slug>` by default), with a line under it for each naming the store that owns'
      + ' the claim, the stage label on its issue and whether it is stale. Housekeeping:'
      + ' what `rafa cleanup` would list, counted per group, and how many worktrees are idle. Git, the session'
      + ' records, the plans and the claim branches are read first; the pull request, the board and the stage'
      + ' labels are read through `gh` under a'
      + ' short deadline, and nothing is fetched. A section that cannot be read is one `warn` line saying why,'
      + ' and the others are printed all the same: neither a hub nor a section changes the exit code, and it'
      + ' exits 1 only for a config that cannot be used. With `--output=json` the six sections are the data of'
      + ' the terminal result event. Starts no session.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa status',
        note: 'Prints the six sections, one line each, with the running loops and blocked tasks under Loops.',
      },
      {
        cmd: 'rafa status --output=json',
        note: 'Gives the six sections as data, each with `read` and its reading or the problem.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runStatus(context, seams),
  };
  return Object.freeze(command);
}

const command: RafaCommand = createStatusCommand();
export default command;
