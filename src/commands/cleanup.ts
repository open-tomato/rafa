/**
 * `rafa cleanup [--dry-run]`: the local branches and worktrees that have
 * piled up, listed in four groups — Merged, Stale, Not pushed and
 * Worktrees — and the ones the person ticks removed. It is all code: it
 * starts no Claude session and declares no `spends`.
 *
 * ## What it reads
 *
 * `src/cleanup/`'s {@link readCleanup}, fetch included, over the
 * config's `pr.base` and `cleanup.*` settings, git run in the directory
 * the command runs from, and the pull request provider
 * `resolvePrProvider` (`src/pr/provider.ts`) resolves for the project
 * root: `gh` gives the provider {@link ghPullRequestsIn} makes there,
 * `none` gives none, and the Stale and Not-pushed rows then say
 * `merged state unknown`. A reading git refuses is exit code 1, as is a
 * config `loadConfig` refuses.
 *
 * ## Listing only
 *
 * With `--output=json`, or when {@link CleanupCommandSeams.terminal}
 * answers no terminal, it asks nothing and removes nothing, exiting 0:
 * text mode prints `renderCleanup`'s lines (`./cleanup-render.ts`), the
 * notes and all four groups, and json mode gives `cleanupData` as the
 * terminal result's data. `--dry-run` changes neither, since nothing
 * would be run without a checklist answered.
 *
 * ## Asking
 *
 * With a terminal, each reading note is one warning, and the four
 * groups are one grouped `multiSelect` (`src/cli/prompt/`), each row
 * the line the listing prints, ticked as `src/cleanup/` ticks it: every
 * Merged row and every clean worktree on a Merged branch. A worktree
 * that cannot be ticked shows its path and date, and its reason beside
 * the disabled mark. A reading with no row at all asks nothing. Then:
 *
 *   1. Escape, or keys that end, removes nothing; so does Enter with
 *      nothing ticked.
 *   2. Each ticked Not-pushed row gets a second question naming the
 *      commits deleting it loses ({@link notPushedQuestion}); only a
 *      yes keeps it in.
 *   3. The ticked rows become `src/cleanup/steps.ts`'s steps. Every
 *      ticked row that is not a step is one warning with its reason.
 *   4. `--dry-run` prints each step's command line and stops.
 *      Otherwise {@link cleanupQuestion} asks
 *      `Delete <n> branches and remove <m> worktrees? [y/N]`, and a
 *      yes runs the steps: one `✓ <command>` line per step that ran
 *      clean, one warning per step that did not, and exit code 1 when
 *      any did not.
 *
 * The yes-or-no questions, yes being `y` or `yes`, go through a line
 * {@link Prompter} that `lazyPrompter` (`./issue/ready.ts`) opens only
 * once the checklist has answered, since two readers over one standard
 * input would each take part of what is typed. A stale row is
 * confirmed by the final question alone; the second question is for
 * the commits no remote holds.
 *
 * ## Never
 *
 * Nothing is run with `--force`, and nothing remote is deleted: the
 * steps and their force guard are `src/cleanup/steps.ts`'s, and a Stale
 * row's line names the `git push origin --delete <b>` the person may
 * run. The current branch, the base branch and every `cleanup.keep`
 * match are never listed (`src/cleanup/branches.ts`).
 */
import type {
  BranchRow,
  CleanupOutcome,
  CleanupPlan,
  CleanupRead,
  CleanupReading,
  CleanupSeams,
  CleanupSelection,
  CleanupSettings,
  MergedRow,
  NotPushedRow,
  StaleRow,
  WorktreeRow,
} from '../cleanup/index.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { MultiGroup } from '../cli/prompt/multi-select.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { RafaConfig } from '../config.js';
import type { PullRequests } from '../pr/types.js';
import type { ProjectFound } from '../project/scope.js';

import {
  cleanupSteps,
  defaultCleanupSeams,
  dryRunLines,
  readCleanup,
  runCleanupSteps,
} from '../cleanup/index.js';
import { CommandExit } from '../cli/command.js';
import { createLinePrompter } from '../cli/prompt/confirm.js';
import { multiSelect } from '../cli/prompt/multi-select.js';
import { processTerminal } from '../cli/prompt/terminal.js';
import { ghPullRequestsIn, resolvePrProvider } from '../pr/index.js';

import {
  branchRowLine,
  CLEANUP_GROUP_TITLES,
  cleanupData,
  cleanupNameWidth,
  renderCleanup,
  worktreeRowLine,
} from './cleanup-render.js';
import { lazyPrompter } from './issue/ready.js';
import { expectNoArgument, readSwitch, resolveProjectConfig } from './plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa cleanup';

/** The usage line its argument refusal names. */
export const CLEANUP_USAGE = 'rafa cleanup [--dry-run]';

/** The flag printing the steps instead of running them. */
const DRY_RUN_FLAG = 'dry-run';

/** The checklist's question. */
export const CLEANUP_MESSAGE = 'Tick what to remove (space ticks, a ticks a group, enter goes on)';

/** The line a reading with no row at all prints. */
export const NOTHING_LISTED_TEXT = 'Nothing to clean up: no branch or worktree is listed.';

/** The line every run that removes nothing by the person's answer ends with. */
export const NOTHING_REMOVED_TEXT = 'Nothing removed.';

/** How the reading, the terminal and the questions are reached; each left out is the system's own. */
export interface CleanupCommandSeams {
  /** The directory the command runs from: git runs there, and its worktree is never ticked. `process.cwd()` when left out. */
  readonly cwd?: () => string;
  /** The clock, read once. `new Date()` when left out. */
  readonly now?: () => Date;
  /** The `origin` probe `resolvePrProvider` takes. `gitRemoteUrl` when left out. */
  readonly readRemote?: (dir: string) => string | null;
  /** The provider for a project root whose provider resolves to `gh`. {@link ghPullRequestsIn} when left out. */
  readonly pullRequests?: (root: string) => PullRequests;
  /** The seams the reading and the steps run through. {@link defaultCleanupSeams} when left out. */
  readonly cleanupSeams?: (cwd: string, pulls: PullRequests | null) => CleanupSeams;
  /** The reading itself. {@link readCleanup} when left out. */
  readonly read?: (seams: CleanupSeams, settings: CleanupSettings) => Promise<CleanupReading>;
  /** The terminal the checklist runs on; `processTerminal()` when left out. */
  readonly terminal?: () => Terminal;
  /** The keys the checklist reads; standard input's when left out. */
  readonly keys?: () => AsyncIterable<Key>;
  /** Opens the prompter the yes-or-no questions go through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_CLEANUP_SEAMS: CleanupCommandSeams = Object.freeze({});

/** One row of the checklist: a branch row, or a worktree row. */
export type CleanupRow = BranchRow | WorktreeRow;

/** Whether `row` is a branch row rather than a worktree row. */
function isBranchRow(row: CleanupRow): row is BranchRow {
  return 'group' in row;
}

/** `count` and `noun`, or `pluralNoun` unless the count is 1. */
function counted(count: number, noun: string, pluralNoun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${pluralNoun}`;
}

/** The final question, over `branches` deletes and `worktrees` removals. */
export function cleanupQuestion(branches: number, worktrees: number): string {
  return `Delete ${counted(branches, 'branch', 'branches')} and remove ${counted(worktrees, 'worktree', 'worktrees')}? [y/N] `;
}

/** The second question a ticked Not-pushed row gets, naming the commits deleting it loses. */
export function notPushedQuestion(row: NotPushedRow): string {
  const commits = counted(row.commits, 'commit', 'commits');
  return `${row.branch.name} holds ${commits} no remote has, which deleting it loses. Delete ${row.branch.name}? [y/N] `;
}

/** The label a worktree row shows: its line, or, when it cannot be ticked, its path and date alone. */
function worktreeLabel(row: WorktreeRow, width: number): string {
  return row.tickable
    ? worktreeRowLine(row, width)
    : worktreeRowLine({ ...row, reason: '' }, width).trimEnd();
}

/** The four groups of the checklist, each row the line the listing prints; see the module note. */
export function cleanupGroups(read: CleanupRead): readonly MultiGroup<CleanupRow>[] {
  const width = cleanupNameWidth(read);
  const branches = (title: string, rows: readonly BranchRow[]): MultiGroup<CleanupRow> => ({
    title,
    choices: rows.map((row) => ({ label: branchRowLine(row, width), value: row, checked: row.ticked })),
  });
  return [
    branches(CLEANUP_GROUP_TITLES.merged, read.merged),
    branches(CLEANUP_GROUP_TITLES.stale, read.stale),
    branches(CLEANUP_GROUP_TITLES.notPushed, read.notPushed),
    {
      title: CLEANUP_GROUP_TITLES.worktrees,
      choices: read.worktrees.map((row) => ({
        label: worktreeLabel(row, width),
        value: row,
        checked: row.ticked,
        ...(row.tickable
          ? {}
          : { disabled: row.reason }),
      })),
    },
  ];
}

/** The ticked rows, split by group as `cleanupSteps` takes them, before any second question. */
export function selectionOf(rows: readonly CleanupRow[]): CleanupSelection {
  const branches = rows.filter(isBranchRow);
  return {
    worktrees: rows.filter((row): row is WorktreeRow => !isBranchRow(row)),
    merged: branches.filter((row): row is MergedRow => row.group === 'merged'),
    stale: branches.filter((row): row is StaleRow => row.group === 'stale'),
    notPushed: branches.filter((row): row is NotPushedRow => row.group === 'not-pushed'),
  };
}

/** Whether `read` lists no row in any group. */
function isEmpty(read: CleanupRead): boolean {
  return read.merged.length + read.stale.length + read.notPushed.length + read.worktrees.length === 0;
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa cleanup runs inside a project, and was handed none');
  return context.project;
}

/** The provider the project root resolves to, or null for `none`. */
function pullsFor(root: string, config: RafaConfig, seams: CleanupCommandSeams): PullRequests | null {
  const reading = resolvePrProvider({ configured: config.prProvider, dir: root, readRemote: seams.readRemote });
  if (reading.provider !== 'gh') return null;
  return (seams.pullRequests ?? ghPullRequestsIn)(root);
}

/** The Not-pushed rows of `selection` the person answered yes for, one question each. */
async function confirmNotPushed(selection: CleanupSelection, ask: (question: string) => Promise<boolean>): Promise<CleanupSelection> {
  const kept: NotPushedRow[] = [];
  for (const row of selection.notPushed) {
    if (await ask(notPushedQuestion(row))) kept.push(row);
  }
  return { ...selection, notPushed: kept };
}

/** How many steps of `plan` are branch deletes and how many worktree removals. */
function stepCounts(plan: CleanupPlan): { readonly branches: number; readonly worktrees: number } {
  const branches = plan.steps.filter((step) => step.kind === 'delete-branch').length;
  return { branches, worktrees: plan.steps.length - branches };
}

/** Writes what the steps came to, refusing with exit code 1 when any did not run clean. */
function writeOutcomes(context: RafaContext, outcomes: readonly CleanupOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.ok) context.output.info(`✓ ${outcome.command}`);
    else context.output.warn(`✗ ${outcome.command}: ${outcome.said.trim() || 'git said nothing'}`);
  }
  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  if (failed === 0) return;
  throw new CommandExit(1, `❌ ${COMMAND_NAME}: ${counted(failed, 'step', 'steps')} of ${String(outcomes.length)} did not run clean; each is named above.`);
}

/** What a run with a terminal reads, asks and does; see the module note. */
interface AskingRun {
  readonly context: RafaContext;
  readonly read: CleanupRead;
  readonly cleanup: CleanupSeams;
  readonly terminal: Terminal;
  readonly seams: CleanupCommandSeams;
  readonly dryRun: boolean;
}

/** Asks over the checklist and the questions, then prints or runs the steps; see the module note. */
async function askAndRemove(run: AskingRun): Promise<void> {
  const { context, read, seams } = run;
  for (const note of read.notes) context.output.warn(note);
  if (isEmpty(read)) {
    context.output.info(NOTHING_LISTED_TEXT);
    return;
  }
  const ticked = await multiSelect({
    message: CLEANUP_MESSAGE,
    groups: cleanupGroups(read),
    terminal: run.terminal,
    ...(seams.keys === undefined
      ? {}
      : { keys: seams.keys() }),
  });
  if (ticked === null || ticked.length === 0) {
    context.output.info(NOTHING_REMOVED_TEXT);
    return;
  }
  const prompter = lazyPrompter(seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr)));
  try {
    const plan = cleanupSteps(await confirmNotPushed(selectionOf(ticked), prompter.ask));
    for (const withheld of plan.withheld) context.output.warn(`not removed: ${withheld.subject}: ${withheld.reason}`);
    if (plan.steps.length === 0) {
      context.output.info(NOTHING_REMOVED_TEXT);
      return;
    }
    if (run.dryRun) {
      for (const line of dryRunLines(plan)) context.output.info(line);
      return;
    }
    const counts = stepCounts(plan);
    if (!await prompter.ask(cleanupQuestion(counts.branches, counts.worktrees))) {
      context.output.info(NOTHING_REMOVED_TEXT);
      return;
    }
    writeOutcomes(context, runCleanupSteps(run.cleanup.git, plan));
  } finally {
    prompter.close();
  }
}

/** The reading the settings and seams answer, refusing one git refused. */
async function readOrRefuse(seams: CleanupCommandSeams, cleanup: CleanupSeams, settings: CleanupSettings): Promise<CleanupRead> {
  const reading = await (seams.read ?? readCleanup)(cleanup, settings);
  if (!reading.ok) throw new CommandExit(1, `❌ ${COMMAND_NAME}: the repository cannot be read: ${reading.detail}`);
  return reading;
}

/** Runs `cleanup` with `seams`; see the module note. */
export async function runCleanup(context: RafaContext, seams: CleanupCommandSeams): Promise<void> {
  expectNoArgument(context.args, CLEANUP_USAGE);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], `Usage: ${CLEANUP_USAGE}`);
  const project = projectOf(context);
  const config = resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const cwd = (seams.cwd ?? ((): string => process.cwd()))();
  const cleanup = (seams.cleanupSeams ?? defaultCleanupSeams)(cwd, pullsFor(project.root, config, seams));
  const read = await readOrRefuse(seams, cleanup, {
    fetch: true,
    base: config.prBase,
    keep: config.cleanupKeep,
    staleDays: config.cleanupStaleDays,
    worktreeIdleDays: config.cleanupWorktreeIdleDays,
    now: (seams.now ?? ((): Date => new Date()))(),
    home: project.home,
    cwd,
    projectRoot: project.root,
  });

  if (context.outputMode === 'json') {
    context.output.result(cleanupData(read));
    return;
  }
  const terminal = (seams.terminal ?? processTerminal)();
  if (!terminal.isTTY) {
    for (const line of renderCleanup(read)) context.output.info(line);
    return;
  }
  await askAndRemove({ context, read, cleanup, terminal, seams, dryRun });
}

/** The command, reading `seams`; see the module note. */
export function createCleanupCommand(seams: CleanupCommandSeams = DEFAULT_CLEANUP_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'cleanup',
    subject: 'cleanup',
    action: 'cleanup',
    summary: 'list merged, stale and unpushed branches and leftover worktrees; remove the ones ticked',
    description: 'Runs `git fetch --prune`, then lists the local branches and worktrees that have piled up in'
      + ' four groups, each row its name, its last commit date and why it is listed: Merged (reachable from'
      + ' the base, its pull request merged per the provider, or its upstream gone), Stale (an upstream, not'
      + ' merged, no commit in `cleanup.staleDays`), Not pushed (no upstream, or commits ahead of it) and'
      + ' Worktrees (under `.claude/worktrees/` and `~/.rafa/worktrees/`). The current branch, the base and'
      + ' every name a `cleanup.keep` glob matches are never listed. With a terminal the groups are one'
      + ' checklist: space ticks a row, `a` ticks a whole group, and Merged rows and clean worktrees on a'
      + ' Merged branch start ticked; a worktree that is dirty, locked, the current one, running a loop'
      + ' session or modified within `cleanup.worktreeIdleDays` cannot be ticked, and says why. A ticked'
      + ' Not-pushed branch asks again, naming the commits deleting it loses. Enter then asks `Delete <n>'
      + ' branches and remove <m> worktrees? [y/N]`, and a yes runs `git worktree remove` for each worktree'
      + ' and `git branch -d` for each Merged branch, `-D` for a squash-merged one and for a Stale or'
      + ' Not-pushed branch ticked and confirmed. Nothing runs with `--force` and nothing remote is'
      + ' deleted: a Stale row names the `git push origin --delete <b>` to run by hand. It exits 1 when a'
      + ' step did not run clean. Without a terminal, or with `--output=json`, it prints the four groups,'
      + ' asks nothing and removes nothing, exiting 0; with `--output=json` they are the data of the terminal'
      + ' result event. Starts no session.',
    args: [],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Show the checklist and ask as usual, then print the `git` commands the answer would run'
          + ' instead of running them. Removes nothing.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa cleanup',
        note: 'Lists the four groups and removes what is ticked, once the final question is answered yes.',
      },
      {
        cmd: 'rafa cleanup --dry-run',
        note: 'Prints the `git` commands the ticked rows would run, running none of them.',
      },
      {
        cmd: 'rafa cleanup --output=json',
        note: 'Gives the four groups as data, asking nothing and removing nothing.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runCleanup(context, seams),
  };
  return Object.freeze(command);
}

export default createCleanupCommand();
