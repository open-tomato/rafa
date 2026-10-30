/**
 * `rafa cleanup [--dry-run]`: the local branches, worktrees and run
 * records that have piled up, and the unmerged branches that exist only
 * on `origin`, listed in six groups — Merged, Stale, Not pushed,
 * Worktrees, Run records and Only on origin — and the ones the person
 * ticks removed. It is all code: it starts no Claude session and
 * declares no `spends`.
 *
 * ## What it reads
 *
 * `src/cleanup/`'s {@link readCleanup}, fetch included, over the
 * config's `pr.base` and `cleanup.*` settings, git run in the directory
 * the command runs from, and the pull request provider
 * `resolvePrProvider` (`packages/rafa/src/pr/provider.ts`) resolves for the project
 * root: `gh` gives the provider {@link ghPullRequestsIn} makes there,
 * `none` gives none, and the Stale and Not-pushed rows then say
 * `merged state unknown`. The run records are the ones
 * `packages/rafa-run/src/cleanup/runs.ts` lists under the project root's `.rafa/runs/`:
 * every record but a live run's and the newest of each plan's. The
 * sixth group is `packages/rafa-run/src/cleanup/remote-only.ts`'s: the branches `origin`
 * holds and this clone does not, not merged into the base and not the
 * head of an open pull request, which the same provider lists. With no
 * provider, or one that cannot be read, the open pull requests are
 * unknown, so the group lists nothing and the reading carries one note
 * saying why. A reading git refuses is exit code 1, as is a config
 * `loadConfig` refuses.
 *
 * ## Listing only
 *
 * With `--output=json`, or when {@link CleanupCommandSeams.terminal}
 * answers no terminal, it asks nothing and removes nothing, exiting 0:
 * text mode prints `renderCleanup`'s lines (`./cleanup-render.ts`), the
 * notes and all six groups, and json mode gives `cleanupData` as the
 * terminal result's data, the branches only on `origin` as its
 * `remoteOnly`. `--dry-run` changes neither, since nothing would be run
 * without a checklist answered.
 *
 * ## Asking
 *
 * With a terminal, each reading note is one warning, and the six
 * groups are one grouped `multiSelect` (`src/cli/prompt/`), each row
 * the line the listing prints, ticked as `src/cleanup/` ticks it: every
 * Merged row, every clean worktree on a Merged branch and every run
 * record. No Only on origin row starts ticked: nothing in the reading
 * says its work is merged, so the person ticks each one, or the whole
 * group with `a`. The group is the last one, and the checklist draws ten
 * lines at a time, headings included (`DEFAULT_PAGE_SIZE`,
 * `src/cli/prompt/select.ts`): under a longer reading it comes into
 * view once the highlight reaches it, and a person who answers before
 * that removes none of it. A worktree that cannot be ticked shows its
 * path and date, and its reason beside the disabled mark. A reading
 * with no row at all asks nothing. Then:
 *
 *   1. Escape, or keys that end, removes nothing; so does Enter with
 *      nothing ticked.
 *   2. Each ticked Not-pushed row that would be deleted gets a second
 *      question naming the commits deleting it loses
 *      ({@link notPushedQuestion}); only a yes keeps it in. Which rows
 *      those are is `packages/rafa-run/src/cleanup/steps.ts`'s to say, through
 *      `deletedNotPushed`: a row a ticked worktree holds (#978), or a
 *      listed worktree that cannot be ticked holds (its `heldBy`,
 *      `packages/rafa-pr/src/cleanup/groups.ts`, #860), is never deleted, so it gets no
 *      question and is handed on unasked for step 3 to withhold.
 *      `--dry-run` asks the same questions as a real run.
 *   3. The ticked rows become `packages/rafa-run/src/cleanup/steps.ts`'s steps, a
 *      ticked Only on origin row the one `git push origin --delete
 *      <name>` among them. Every ticked row that is not a step is one
 *      warning, `not removed:` with its reason.
 *   4. `--dry-run` prints each step's command line and stops.
 *      Otherwise {@link cleanupQuestion} asks `Delete <n> local
 *      branches and <o> branches on origin, remove <m> worktrees and
 *      remove <r> run records? [y/N]`, the deletes on `origin` counted
 *      apart from the local ones, and a yes runs the steps: one
 *      `✓ <command>` line per step that ran clean, one warning per step
 *      that did not, and exit code 1 when any did not.
 *
 * The yes-or-no questions, yes being `y` or `yes`, go through a line
 * {@link Prompter} that `lazyPrompter` (`@open-tomato/rafa/core/command`) opens only
 * once the checklist has answered, since two readers over one standard
 * input would each take part of what is typed. A stale row is
 * confirmed by the final question alone, and so is an Only on origin
 * row, whose count that question names apart; the second question is
 * for the commits no remote holds.
 *
 * ## Never, and the one remote write
 *
 * Nothing is run with `--force`: the steps and their force guard are
 * `packages/rafa-run/src/cleanup/steps.ts`'s. The one thing deleted on a remote is an
 * Only on origin row the person ticked and the final question confirmed,
 * by that module's `delete-remote-branch` step; a Stale row's line still
 * only names the `git push origin --delete <b>` the person may run. The
 * current branch, the base branch and every `cleanup.keep` match are
 * never listed (`packages/rafa-pr/src/cleanup/branches.ts`), and neither is a branch on
 * `origin` that is the base, a `cleanup.keep` match, under `stretch/`,
 * the head of an open pull request or a claim another store holds
 * (`packages/rafa-run/src/cleanup/remote-only.ts`).
 */
import type { MultiGroup } from '../cli/prompt/multi-select.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { RafaCommand, RafaContext , Prompter } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';
import type { PullRequests } from '@open-tomato/rafa-pr';
import type {
  BranchRow,
  CleanupOutcome,
  CleanupPlan,
  CleanupRead,
  CleanupReading,
  CleanupSeams,
  CleanupSelection,
  CleanupSettings,
  CleanupStepKind,
  MergedRow,
  NotPushedRow,
  RemoteOnlyRow,
  RunRow,
  StaleRow,
  WorktreeRow,
} from '@open-tomato/rafa-run';

import { ghPullRequestsIn, resolvePrProvider } from '@open-tomato/rafa-pr';
import {
  cleanupSteps,
  defaultCleanupSeams,
  deletedNotPushed,
  dryRunLines,
  readCleanup,
  runCleanupSteps,
} from '@open-tomato/rafa-run';

import { expectNoArgument, readSwitch, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit , createLinePrompter, lazyPrompter } from '@open-tomato/rafa/core/command';

import { multiSelect } from '../cli/prompt/multi-select.js';
import { processTerminal } from '../cli/prompt/terminal.js';

import {
  branchRowLine,
  CLEANUP_GROUP_TITLES,
  cleanupData,
  cleanupNameWidth,
  remoteOnlyRowLine,
  renderCleanup,
  runRowLine,
  worktreeRowLine,
} from './cleanup-render.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa cleanup';

/** The usage line its argument refusal names. */
export const CLEANUP_USAGE = 'rafa cleanup [--dry-run]';

/** The flag printing the steps instead of running them. */
const DRY_RUN_FLAG = 'dry-run';

/** The remote the final question names for the Only on origin rows: the one their step deletes on. */
const REMOTE = 'origin';

/** The checklist's question. */
export const CLEANUP_MESSAGE = 'Tick what to remove (space ticks, a ticks a group, enter goes on)';

/** The line a reading with no row at all prints. */
export const NOTHING_LISTED_TEXT = 'Nothing to clean up: no branch, worktree or run record is listed.';

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

/** One row of the checklist: a local branch's row, a worktree row, a run record's row, or the row of a branch only on `origin`. */
export type CleanupRow = BranchRow | WorktreeRow | RunRow | RemoteOnlyRow;

/** Whether `row` is the row of a branch that exists only on `origin`. */
function isRemoteOnlyRow(row: CleanupRow): row is RemoteOnlyRow {
  return 'group' in row && row.group === 'remote-only';
}

/** Whether `row` is a local branch's row: Merged, Stale or Not pushed. */
function isBranchRow(row: CleanupRow): row is BranchRow {
  return 'group' in row && row.group !== 'remote-only';
}

/** Whether `row` is a run record's row. */
function isRunRow(row: CleanupRow): row is RunRow {
  return 'sessionId' in row;
}

/** Whether `row` is a worktree row. */
function isWorktreeRow(row: CleanupRow): row is WorktreeRow {
  return !('group' in row) && !isRunRow(row);
}

/** `count` and `noun`, or `pluralNoun` unless the count is 1. */
function counted(count: number, noun: string, pluralNoun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${pluralNoun}`;
}

/**
 * The final question, over `branches` local deletes, `worktrees`
 * removals, `runs` run-record removals and `originBranches` deletes on
 * `origin`, which are counted apart from the local ones and named even
 * when there are none, so the question always says what reaches the
 * remote.
 */
export function cleanupQuestion(branches: number, worktrees: number, runs: number, originBranches = 0): string {
  const deleted = `${counted(branches, 'local branch', 'local branches')} and ${counted(originBranches, 'branch', 'branches')} on ${REMOTE}`;
  const removed = `${counted(worktrees, 'worktree', 'worktrees')} and remove ${counted(runs, 'run record', 'run records')}`;
  return `Delete ${deleted}, remove ${removed}? [y/N] `;
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

/**
 * The six groups of the checklist, each row the line the listing
 * prints; the last, the branches only on `origin`, never holds a ticked
 * row. See the module note.
 */
export function cleanupGroups(read: CleanupRead): readonly MultiGroup<CleanupRow>[] {
  const branchWidth = cleanupNameWidth(read, 'branches');
  const worktreeWidth = cleanupNameWidth(read, 'worktrees');
  const runWidth = cleanupNameWidth(read, 'runs');
  const remoteWidth = cleanupNameWidth(read, 'remoteOnly');
  const branches = (title: string, rows: readonly BranchRow[]): MultiGroup<CleanupRow> => ({
    title,
    choices: rows.map((row) => ({ label: branchRowLine(row, branchWidth), value: row, checked: row.ticked })),
  });
  return [
    branches(CLEANUP_GROUP_TITLES.merged, read.merged),
    branches(CLEANUP_GROUP_TITLES.stale, read.stale),
    branches(CLEANUP_GROUP_TITLES.notPushed, read.notPushed),
    {
      title: CLEANUP_GROUP_TITLES.worktrees,
      choices: read.worktrees.map((row) => ({
        label: worktreeLabel(row, worktreeWidth),
        value: row,
        checked: row.ticked,
        ...(row.tickable
          ? {}
          : { disabled: row.reason }),
      })),
    },
    {
      title: CLEANUP_GROUP_TITLES.runs,
      choices: read.runs.map((row) => ({ label: runRowLine(row, runWidth), value: row, checked: row.ticked })),
    },
    {
      title: CLEANUP_GROUP_TITLES.remoteOnly,
      choices: read.remoteOnly.map((row) => ({ label: remoteOnlyRowLine(row, remoteWidth), value: row, checked: false })),
    },
  ];
}

/** The ticked rows, split by group as `cleanupSteps` takes them, before any second question. */
export function selectionOf(rows: readonly CleanupRow[]): CleanupSelection {
  const branches = rows.filter(isBranchRow);
  return {
    worktrees: rows.filter(isWorktreeRow),
    merged: branches.filter((row): row is MergedRow => row.group === 'merged'),
    stale: branches.filter((row): row is StaleRow => row.group === 'stale'),
    notPushed: branches.filter((row): row is NotPushedRow => row.group === 'not-pushed'),
    remoteOnly: rows.filter(isRemoteOnlyRow),
    runs: rows.filter(isRunRow),
  };
}

/** Whether `read` lists no row in any group. */
function isEmpty(read: CleanupRead): boolean {
  const local = read.merged.length + read.stale.length + read.notPushed.length + read.worktrees.length + read.runs.length;
  return local + read.remoteOnly.length === 0;
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

/**
 * The Not-pushed rows of `selection` the person answered yes for, one
 * question each, asked only of the rows `deletedNotPushed` names, and
 * every other row unasked: `cleanupSteps` withholds that one whatever
 * is answered, so asking about commits it will not lose would be a
 * question with no effect.
 */
async function confirmNotPushed(selection: CleanupSelection, ask: (question: string) => Promise<boolean>): Promise<CleanupSelection> {
  const deleted = new Set(deletedNotPushed(selection));
  const kept: NotPushedRow[] = [];
  for (const row of selection.notPushed) {
    if (!deleted.has(row) || await ask(notPushedQuestion(row))) kept.push(row);
  }
  return { ...selection, notPushed: kept };
}

/** How many steps of `plan` are of each kind, as the final question counts them. */
interface StepCounts {
  /** Local branch deletes. */
  readonly branches: number;
  readonly worktrees: number;
  readonly runs: number;
  /** Deletes on `origin`, never counted among {@link branches}. */
  readonly originBranches: number;
}

/** How many steps of `plan` are local branch deletes, worktree removals, run-record removals and deletes on `origin`. */
function stepCounts(plan: CleanupPlan): StepCounts {
  const of = (kind: CleanupStepKind): number => plan.steps.filter((step) => step.kind === kind).length;
  return {
    branches: of('delete-branch'),
    worktrees: of('remove-worktree'),
    runs: of('remove-run'),
    originBranches: of('delete-remote-branch'),
  };
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
    if (!await prompter.ask(cleanupQuestion(counts.branches, counts.worktrees, counts.runs, counts.originBranches))) {
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
  const config = await resolveProjectConfig(project, COMMAND_NAME, (message) => {
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
    worktreeDir: config.loopWorktreeDir,
    release: { fragments: config.releaseFragments, changelog: config.releaseChangelog },
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
    summary: 'list merged, stale and unpushed branches, unmerged branches only on origin, leftover worktrees'
      + ' and old run records; remove the ones ticked',
    description: 'Runs `git fetch --prune`, then lists the local branches, worktrees and run records that have'
      + ' piled up, and the unmerged branches that exist only on `origin`, in six groups, each row its name,'
      + ' its date and why it is listed: Merged (reachable from'
      + ' the base, its pull request merged per the provider, or its upstream gone), Stale (an upstream, not'
      + ' merged, no commit in `cleanup.staleDays`), Not pushed (no upstream, or commits ahead of it),'
      + ' Worktrees (under `.claude/worktrees/`, `~/.rafa/worktrees/` and `loop.worktreeDir`), Run records'
      + ' (the session records under `.rafa/runs/`, each named by its plan and the day it started, with its'
      + ' events file; a running or paused run and the newest run of each plan are never listed) and Only on'
      + ' origin (a branch `origin` holds and this clone does not, which the base does not reach; its row says'
      + ' how many of its commits have no patch-equal copy on the base, as `git cherry` counts them, or that'
      + ' every commit has a copy; never the head of an open pull request, a `stretch/` branch or a claim'
      + ' branch another store holds, and with no pull request provider, or one that cannot be read, the'
      + ' group lists nothing and a note says why). The current'
      + ' branch, the base and every name a `cleanup.keep` glob matches are never listed. With a terminal'
      + ' the groups are one checklist: space ticks a row, `a` ticks a whole group, and Merged rows, clean'
      + ' worktrees on a Merged branch and run records start ticked, an Only on origin row never; a worktree'
      + ' that is dirty, locked, the'
      + ' current one, running a loop session or modified within `cleanup.worktreeIdleDays` cannot be ticked,'
      + ' and says why, and a Merged, Stale or Not-pushed branch such a worktree holds starts unticked,'
      + ' naming it, and is not deleted even when ticked: it is printed as `not removed:` with that'
      + ' worktree. A Merged branch listed only because its upstream is gone also starts'
      + ' unticked, saying the base does not reach its tip or, when its tip is past a merged pull request\'s'
      + ' head, `<n> commits past #<pr>\'s head: <subjects>`. A ticked Not-pushed branch asks again, naming'
      + ' the commits deleting it loses, only when it would be deleted: one a worktree that cannot be ticked'
      + ' holds, or a ticked worktree holds, is asked nothing and printed as `not removed:` with why, under'
      + ' `--dry-run` too. Enter'
      + ' then asks `Delete <n> local branches and <o> branches on origin, remove <m> worktrees and remove'
      + ' <r> run records? [y/N]`, the deletes on `origin` counted apart, and a yes'
      + ' runs `git worktree remove` for each worktree and `git branch -d` for each Merged branch, `-D` for a'
      + ' squash-merged one, for one whose commits past its pull request\'s head are release fragments the'
      + ' base already holds (any other such branch is not deleted, its commits named), and for a Stale or'
      + ' Not-pushed branch ticked and confirmed, then `git push origin --delete <name>` for each ticked Only'
      + ' on origin branch (one whose name opens with `-` is not deleted, and is printed as `not removed:`'
      + ' with the line to run by hand), then removes each run'
      + ' record and its events file. Nothing runs with `--force`, and that delete of a ticked Only on origin'
      + ' branch is the one thing removed on a remote: a Stale row'
      + ' names the `git push origin --delete <b>` to run by hand. It exits 1 when a step did not run clean.'
      + ' Without a terminal, or with `--output=json`, it prints the six groups, asks nothing and removes'
      + ' nothing, exiting 0; with `--output=json` they are the data of the terminal result event, the'
      + ' branches only on `origin` its `remoteOnly`. Starts no session.',
    args: [],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Show the checklist and ask as usual, then print the commands the answer would run'
          + ' instead of running them. Removes nothing.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa cleanup',
        note: 'Lists the six groups and removes what is ticked, once the final question is answered yes.',
      },
      {
        cmd: 'rafa cleanup --dry-run',
        note: 'Prints the `git` and `rm` commands the ticked rows would run, a ticked Only on origin branch as'
          + ' its `git push origin --delete <name>`, running none of them.',
      },
      {
        cmd: 'rafa cleanup --output=json',
        note: 'Gives the six groups as data, asking nothing and removing nothing.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runCleanup(context, seams),
  };
  return Object.freeze(command);
}

const command: RafaCommand = createCleanupCommand();
export default command;
