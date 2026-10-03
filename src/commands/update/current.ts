/**
 * `rafa update current`: brings the project to the installed rafa when
 * the installed version is within `~` of the version `rafa.lock` records
 * (#714, under the update epic #713). The other `update` actions are
 * stubs (`./stub.ts`).
 *
 * ## What it does
 *
 * It reads the lock (`project/lock.ts`) and checks the move
 * (`project/update-range.ts`): no lock adopts the project, a newer patch
 * or the same version goes on, and a newer minor or major or an older
 * installed rafa refuses with exit code 1. Then it reads every change
 * (`project/update-current.ts`) and prints one line per step. With
 * `--dry-run` it stops there. Otherwise it warns that the changes cannot
 * be rolled back and asks once; `--yes` answers, and with no terminal and
 * no `--yes` it refuses with exit code 1, so an unattended run never
 * changes a project nobody said yes for. A plan that changes nothing
 * prints `Nothing to change.` and asks nothing.
 *
 * ## The exit code
 *
 * 0 applied, nothing to change, a dry run, or a no to the question. 1 for
 * an argument, a flag value, a refused move, and no terminal without
 * `--yes`. 2 when it could not run: a lock or a config that cannot be
 * read, or a folder that cannot be written.
 *
 * ## Seams
 *
 * The installed version, `gh`, the `origin` probe and the prompter are
 * {@link UpdateCurrentSeams}, so a case plants a project and drives a
 * recorded `gh` with no network.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { ProjectFound } from '../../project/scope.js';
import type { BoardAccess, UpdateApplied, UpdatePlan } from '../../project/update-current.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { RAFA_VERSION } from '../../cli/version.js';
import { loadConfig } from '../../config-load.js';
import { messageOf } from '../../config-sections.js';
import { resolvePrProvider } from '../../pr/provider.js';
import { LOCK_FILE, readProjectLock } from '../../project/lock.js';
import { applyUpdatePlan, planChanges, readUpdatePlan } from '../../project/update-current.js';
import { readCurrentRange } from '../../project/update-range.js';
import { gitRemoteUrl } from '../../schema/project-id.js';
import { expectNoArgument } from '../plan/plan-files.js';

/** The usage line a refusal ends with. */
const USAGE = 'rafa update current [--dry-run] [--yes]';

/** The question asked before anything is written. */
export const APPLY_QUESTION = 'Apply these changes? [y/N] ';

/** The answers that mean yes. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** What the command reaches the world through; see the module note. */
export interface UpdateCurrentSeams {
  /** The rafa version installed: the build's own. */
  readonly installed: string;
  /** Opens the `gh` runner for the project root. */
  readonly openGh: (root: string) => GhRunner;
  /** The `origin` URL of a directory, or null. */
  readonly readRemote: (dir: string) => string | null;
  /** True when a question can be answered. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter: () => Prompter;
}

/** The seams the registered command runs with. */
export const DEFAULT_UPDATE_CURRENT_SEAMS: UpdateCurrentSeams = Object.freeze({
  installed: RAFA_VERSION,
  openGh: (root: string) => createGhRunner({ cwd: root }),
  readRemote: gitRemoteUrl,
  isTerminal: () => process.stdin.isTTY === true,
  openPrompter: () => createLinePrompter(process.stdin, process.stderr),
});

/** What json mode gives as the terminal result's `data`. */
export interface UpdateCurrentResult {
  readonly plan: UpdatePlan;
  /** What was written; null for a dry run, a plan with nothing to change, or a no. */
  readonly applied: UpdateApplied | null;
}

/** A boolean flag, bare or `=true|false`; see `self-update`'s `--force`. */
export function readSwitch(context: RafaContext, name: string): boolean {
  const value = context.flags[name];
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(1, `❌ --${name} takes no value, and read "${String(value)}" as one\nUsage: ${USAGE}`);
}

function couldNotRun(problem: string): CommandExit {
  return new CommandExit(2, `FAIL — ${problem}\nnothing was changed.`);
}

function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa update current runs inside a project, and was handed none');
  return context.project;
}

/** The board the plan reads: `gh` when the project resolves to it. */
function boardAccess(project: ProjectFound, seams: UpdateCurrentSeams): BoardAccess {
  let configured;
  try {
    configured = loadConfig({ root: project.root, home: project.home }, {}, () => {}).config.prProvider;
  } catch (error) {
    throw couldNotRun(`config: ${messageOf(error)}`);
  }
  const provider = resolvePrProvider({ configured, dir: project.root, readRemote: seams.readRemote }).provider;
  return provider === 'gh'
    ? { gh: seams.openGh(project.root), reason: '' }
    : { gh: null, reason: `pr.provider is ${provider}, so there is no GitHub board` };
}

function foldersText(plan: UpdatePlan): string {
  if (plan.folders.length === 0) return 'nothing missing';
  return `create ${plan.folders.join(', ')}`;
}

function boardText(plan: UpdatePlan): string {
  if (plan.board.kind === 'skipped') return `skipped: ${plan.board.reason}`;
  if (plan.board.missing.length === 0) return 'every label present';
  return `create labels ${plan.board.missing.join(', ')}`;
}

function deprecationsText(plan: UpdatePlan): string {
  if (plan.deprecations.length === 0) return 'none registered yet (#718)';
  return `${String(plan.deprecations.length)} to run`;
}

function lockText(plan: UpdatePlan): string {
  if (plan.lock === 'unchanged') return `unchanged at ${plan.to}`;
  if (plan.lock === 'created') return `create at ${plan.to}`;
  return `update ${String(plan.from)} → ${plan.to}`;
}

/** The lines the plan prints, one per step. */
export function planLines(plan: UpdatePlan): readonly string[] {
  const from = plan.from ?? `no ${LOCK_FILE}`;
  return [
    `rafa update current: ${plan.root}, from ${from} to ${plan.to}`,
    `  folders       ${foldersText(plan)}`,
    `  board         ${boardText(plan)}`,
    `  deprecations  ${deprecationsText(plan)}`,
    `  ${LOCK_FILE}     ${lockText(plan)}`,
  ];
}

/** The lines naming what was written, and a warning per refused label. */
function appliedLines(applied: UpdateApplied, plan: UpdatePlan, context: RafaContext): void {
  for (const path of applied.folders) context.output.info(`created ${path}`);
  for (const part of applied.labels) {
    if (part.outcome === 'created') context.output.info(`created label ${part.name}`);
    if (part.outcome === 'refused') context.output.warn(`label ${part.name} was not created: ${part.detail}`);
  }
  if (applied.lock !== 'unchanged') context.output.info(`wrote ${LOCK_FILE} at ${plan.to}`);
}

/** Whether to apply: `--yes`, or a yes to the question; refuses with no terminal. */
async function confirmed(yes: boolean, seams: UpdateCurrentSeams): Promise<boolean> {
  if (yes) return true;
  if (!seams.isTerminal()) {
    throw new CommandExit(1, 'REFUSED — rafa update current asks before it changes anything, and there is no'
      + ' terminal to ask on. Run it with --dry-run to see the changes, then with --yes to apply them.'
      + '\nnothing was changed.');
  }
  const prompter = seams.openPrompter();
  try {
    const answer = await prompter.ask(APPLY_QUESTION);
    return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
  } finally {
    prompter.close();
  }
}

/** Reads the lock and the range, refusing a move `current` does not make. */
function readRange(root: string, installed: string): Exclude<ReturnType<typeof readCurrentRange>, { kind: 'refused' }> {
  let recorded: string | null;
  try {
    recorded = readProjectLock(root)?.rafa ?? null;
  } catch (error) {
    throw couldNotRun(messageOf(error));
  }
  const range = readCurrentRange(recorded, installed);
  if (range.kind === 'refused') throw new CommandExit(1, `REFUSED — ${range.message}\nnothing was changed.`);
  return range;
}

async function runUpdateCurrent(context: RafaContext, seams: UpdateCurrentSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const dryRun = readSwitch(context, 'dry-run');
  const yes = readSwitch(context, 'yes');
  const project = projectOf(context);
  const range = readRange(project.root, seams.installed);
  const access = boardAccess(project, seams);
  const plan = await readUpdatePlan(project.root, range, access);
  for (const line of planLines(plan)) context.output.info(line);

  const finish = (applied: UpdateApplied | null): void => {
    if (context.outputMode === 'json') context.output.result({ plan, applied } satisfies UpdateCurrentResult);
  };
  if (!planChanges(plan)) {
    context.output.info('Nothing to change.');
    finish(null);
    return;
  }
  if (dryRun) {
    context.output.info('Dry run: nothing was written. Run rafa update current to apply it.');
    finish(null);
    return;
  }
  context.output.warn('rafa cannot roll these changes back. Run it with --dry-run first to only see them.');
  if (!(await confirmed(yes, seams))) {
    context.output.info('Nothing was changed.');
    finish(null);
    return;
  }
  let applied: UpdateApplied;
  try {
    applied = await applyUpdatePlan(plan, access.gh);
  } catch (error) {
    throw couldNotRun(`folders: ${messageOf(error)}`);
  }
  appliedLines(applied, plan, context);
  finish(applied);
}

/** `rafa update current` over `seams`. */
export function createUpdateCurrentCommand(seams: UpdateCurrentSeams = DEFAULT_UPDATE_CURRENT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'update current',
    subject: 'update',
    action: 'current',
    summary: 'bring this project to the installed rafa, within its patch range',
    description: 'Brings the project to the installed rafa when the installed version shares the major and'
      + ` minor of the version \`${LOCK_FILE}\` records at the project root, and is the same patch or newer.`
      + ' A project with no lock is adopted at the installed version. It creates the missing `.rafa/` folders'
      + ' and the missing board labels on a GitHub board, runs the deprecations step (none registered yet),'
      + ` and writes \`${LOCK_FILE}\`. It prints every change first; \`--dry-run\` stops there. Otherwise it`
      + ' warns that the changes cannot be rolled back and asks once, `--yes` answering; with no terminal and'
      + ' no `--yes` it refuses with exit code 1. A newer minor or major, or an installed rafa older than the'
      + ' lock, refuses with exit code 1. A lock or config that cannot be read, or a folder that cannot be'
      + ' written, exits 2. With `--output=json` the plan and what was applied are the data of the terminal'
      + ' result event.',
    args: [],
    flags: [
      { name: 'dry-run', description: 'Print every change and write nothing.', type: 'boolean' },
      { name: 'yes', description: 'Apply the changes without asking.', type: 'boolean' },
    ],
    examples: [
      { cmd: 'rafa update current --dry-run', note: 'Lists the folders, labels and lock it would write, and writes nothing.' },
      { cmd: 'rafa update current --yes', note: 'Applies them without asking, as a script or a loop host runs it.' },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runUpdateCurrent(context, seams),
  };
  return Object.freeze(command);
}

export default createUpdateCurrentCommand();
