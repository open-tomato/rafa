/**
 * The removal steps of `rafa cleanup` as data: which worktrees, local
 * branches, branches on `origin` and run records the ticked rows turn
 * into, in which order, with which delete flag, and the one runner that
 * carries them out.
 *
 * `src/pr/worktree.ts` draws the line this module copies: a step is an
 * argv that can be read in a test without a repository, printed as the
 * line a person would paste (`--dry-run` prints exactly those lines),
 * and run by a thin runner that answers each step's outcome rather than
 * throwing, since {@link GitRunner} does not throw either.
 *
 * ## Order and flags
 *
 *   1. Every ticked worktree first, `git worktree remove <path>`, never
 *      `--force`.
 *   2. Then every ticked branch. A Merged row is `git branch -d`, save
 *      two cases, both NOT reachable from the base, which `-d` refuses
 *      (measured below), so `-D` ({@link needsForcedDelete}): a row
 *      Merged by a merged pull request whose head commit is its tip, a
 *      squash merge; and a row whose tip is past such a head
 *      ({@link MergedRow.pastHead}, `./groups.ts`) when every commit
 *      past it is a release fragment the base already holds
 *      (`./past-head.ts`), so deleting it loses nothing. A Stale or
 *      Not-pushed row is `-D`: the caller hands it
 *      over only once the person ticked it and, for Not pushed, answered
 *      the question naming its commit count. A Not-pushed row that is
 *      withheld below is handed over unasked; see "Which Not-pushed
 *      rows are asked about".
 *   3. Then every ticked remote-only row (`./remote-only.ts`),
 *      `git push origin --delete <name>`: one step per row, never a
 *      force flag, waiting on nothing. See "The one remote write".
 *   4. Last, every ticked run record (`./runs.ts`), `rm <record>
 *      [<events file>]`: one step per record, removing the record and,
 *      when the row names one, its events file. An unticked run row is no
 *      step. The runner does not spawn `rm`: it removes the step's paths
 *      itself, in argv order, through {@link CleanupFiles}, stopping at
 *      the first that fails, so the printed line and what ran are the
 *      same paths. A run record holds no worktree or branch, so these
 *      steps wait on nothing.
 *
 * A branch a ticked worktree holds is deleted only when it is Merged,
 * and only after that worktree's removal succeeded: its step names the
 * worktree in {@link CleanupStep.after} and the runner leaves it unrun
 * when that removal failed. A Stale or Not-pushed branch a ticked
 * worktree holds is not a step at all but a {@link WithheldRemoval},
 * as is a worktree row the caller passed although it cannot be ticked.
 *
 * A Merged row whose commits past its pull request's head are not all
 * held release fragments starts unticked (`./groups.ts`). Ticked anyway,
 * it is one {@link WithheldRemoval} naming every commit past the head
 * the base does not hold, short hash and subject
 * ({@link unheldPastHeadReason}), never a step: `-d` refuses it and
 * `-D` would lose those commits.
 *
 * A branch row a listed worktree that cannot be ticked holds (its
 * `heldBy`, `./groups.ts`), Merged, Stale or Not pushed, starts
 * unticked. Ticked anyway, it is one {@link WithheldRemoval} naming that
 * worktree and its blockers, never a step, so `--dry-run` prints no line
 * for it and a Stale or Not-pushed one never becomes a `git branch -D`
 * (#852): git refuses to delete a branch a worktree has checked out,
 * and that worktree is not removed.
 *
 * ## Which Not-pushed rows are asked about
 *
 * The question naming a Not-pushed row's commits is the caller's, and
 * which rows get it is decided here: {@link deletedNotPushed} names the
 * ticked Not-pushed rows of a selection that become a `delete-branch`
 * step, by the same rule {@link cleanupSteps} builds its steps with, so
 * the two cannot drift apart. A row a ticked, removable worktree holds
 * (#978) and a row an untickable worktree holds (#860) are both left
 * out: each is withheld whatever is answered, so a question about
 * commits it will not lose would have no effect. The caller asks the
 * named rows alone and hands every other ticked row on unasked, to be
 * withheld with its reason.
 *
 * ## The one remote write
 *
 * A `delete-remote-branch` step is the only step that reaches a remote,
 * and its argv the only one built here whose git verb is `push`. The
 * remote is always `origin`, the one `./remote-only.ts` reads.
 *
 * It is built from {@link CleanupSelection.remoteOnly} and from nothing
 * else. A remote-only row never starts ticked (`RemoteOnlyRow.ticked` is
 * the literal `false`), so a row is in that list only because the person
 * ticked it: being handed over IS the tick, and a listed row that was
 * not handed over is no step and no {@link WithheldRemoval}. No other
 * group builds one. A Stale row still names
 * `git push origin --delete <b>` for the person to run, and that line is
 * the renderer's, not a step.
 *
 * The row has no local branch, so no worktree holds it and its step
 * waits on nothing. The delete is not conditional on the tip the reading
 * saw: a commit pushed to the branch between the fetch and the step goes
 * with it (measured below). `--force-with-lease=<name>:<sha>` would make
 * it conditional, and is a force flag this module never spells.
 *
 * A row whose name opens with `-` is a {@link WithheldRemoval}
 * ({@link dashNameReason}), never a step: unlike a local branch, a
 * branch on a remote can be named `-f` or `--force` (measured below),
 * and git would read that word as an option of `push`. The reason names
 * the line that does delete it, `--` before the name, for the person to
 * run. A leading `+` is left alone: under `--delete` it forces nothing.
 *
 * ## The force guard
 *
 * {@link forcedFlagRefusal} reads the argv about to be spawned, not the
 * rows it was built from, and the runner refuses a step it fires on
 * without spawning anything. `--force` with or without a value, every
 * word opening `--force-` (`--force-with-lease`, `--force-if-includes`,
 * both flags of `git push`) and any short cluster holding
 * `f` (`-f`, `-ff`, `-df`) are refused. `-D` is not among them: it is
 * the one forced delete the rules above allow, and only this module's
 * builder spells it. The guard reads a `delete-remote-branch` step as it
 * reads every other: it is about force flags, and an option that forces
 * nothing passes it, which is why the builder withholds a dash name.
 *
 * A local branch name cannot smuggle a flag in: `git branch -- -f`
 * answered `fatal: '-f' is not a valid branch name`, exit 128, and a
 * worktree path comes from `git worktree list`, which prints it
 * absolute. A name read off a remote can; see "The one remote write".
 *
 * ## Measured
 *
 * On git 2.50.1 (Apple Git-155), 2026-09-24, under `LC_ALL=C`, in a
 * scratch repository with `main` checked out:
 *
 *   - `git branch -d` over a branch squash-merged into `main` exits 1:
 *     `error: the branch 'sq' is not fully merged`.
 *   - `git branch -d` over a branch a worktree holds exits 1:
 *     `error: cannot delete branch 'w' used by worktree at '<path>'`;
 *     after `git worktree remove` of that worktree it exits 0.
 *   - `git worktree remove` over a worktree holding an untracked file
 *     exits 128: `fatal: '<path>' contains modified or untracked files,
 *     use --force to delete it`. That refusal is reported, never
 *     answered with `--force`.
 *
 * On git 2.53.0 under Linux, 2026-10-13, under `LC_ALL=C`, in a clone of
 * a bare remote reached by its path, the remote's branches written
 * there with `git update-ref`:
 *
 *   - `git push origin --delete <name>` exits 0, writes
 *     ` - [deleted]         <name>` on standard error, and drops the
 *     clone's `refs/remotes/origin/<name>` with the remote's branch.
 *   - The same line again exits 1: `error: unable to delete '<name>':
 *     remote ref does not exist`. The runner reports it as a step that
 *     did not run clean.
 *   - A branch whose tip was moved on the remote after the clone's last
 *     fetch is deleted all the same, exit 0.
 *   - The remote holds branches named `-f` and `--force`, and the clone
 *     tracks them as `origin/-f` and `origin/--force`.
 *     `git push origin --delete -f`, and the same with `--force`, exits
 *     128 with `fatal: --delete doesn't make sense without any refs` and
 *     deletes nothing; `git push origin --delete -- -f` deletes `-f`.
 *   - With `+plus` and `plus` both on the remote,
 *     `git push origin --delete +plus` deletes `+plus` and leaves `plus`.
 */
import type { RemoteOnlyRow } from './remote-only.js';
import type { RunRow } from './runs.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type {
  BranchHolder,
  MergedRow,
  NotPushedRow,
  StaleRow,
  WorktreeRow,
} from '@open-tomato/rafa-pr';
import type { PastHeadRead } from '@open-tomato/rafa-release';

import { rmSync } from 'node:fs';

import { heldReason as checkedOutReason } from '@open-tomato/rafa-pr';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { gitSaid } from '@open-tomato/rafa/core/git';
import { shellQuote } from '@open-tomato/rafa/utils/shell';

/** How many characters of a commit hash a withheld reason shows. */
const SHORT_HASH_LENGTH = 7;

/** The flag spellings that make a worktree removal, a branch delete or a push forced. */
const FORCING_FLAG = /^(?:--force(?:[=-].*)?|-[^-]*f[^-]*)$/;

/** The remote a `delete-remote-branch` step writes to: the one `./remote-only.ts` reads its rows off. */
const REMOTE = 'origin';

/** What a word git reads as an option opens with. */
const OPTION_MARK = '-';

/** Which of the four removals a step is; `delete-remote-branch` is the only one that reaches a remote. */
export type CleanupStepKind = 'remove-worktree' | 'delete-branch' | 'delete-remote-branch' | 'remove-run';

/** One step: what it removes, and exactly what it runs. */
export interface CleanupStep {
  readonly kind: CleanupStepKind;
  /** The worktree path, the branch name (without `origin/` for a remote one) or the run record's path it removes. */
  readonly subject: string;
  /** The whole command, `git` or `rm` included, ready to print; see the module note for `rm`. */
  readonly argv: readonly string[];
  /** The worktree whose removal must succeed first, or null. */
  readonly after: string | null;
}

/** A ticked row that is not a step, and why. */
export interface WithheldRemoval {
  readonly kind: CleanupStepKind;
  readonly subject: string;
  /** One line. */
  readonly reason: string;
}

/** The ticked rows, as the command hands them over. */
export interface CleanupSelection {
  /** The worktree rows the person ticked. */
  readonly worktrees: readonly WorktreeRow[];
  /** The Merged rows the person ticked. */
  readonly merged: readonly MergedRow[];
  /** The Stale rows the person ticked and confirmed. */
  readonly stale: readonly StaleRow[];
  /** The Not-pushed rows the person ticked and confirmed by the second question, and the ticked ones {@link deletedNotPushed} leaves out, unasked. */
  readonly notPushed: readonly NotPushedRow[];
  /**
   * The remote-only rows the person ticked, each deleted on `origin`. A
   * row's own `ticked` is always false, so only a row handed over here
   * becomes a step; see "The one remote write". None when left out.
   */
  readonly remoteOnly?: readonly RemoteOnlyRow[];
  /** The run-record rows; only the ticked ones become steps. None when left out. */
  readonly runs?: readonly RunRow[];
}

/** What {@link cleanupSteps} answers. */
export interface CleanupPlan {
  /** Worktree removals first, then local branch deletes, then the deletes on `origin`, then run-record removals. */
  readonly steps: readonly CleanupStep[];
  readonly withheld: readonly WithheldRemoval[];
}

/** How one step ended. Never a throw; see the module note. */
export interface CleanupOutcome {
  readonly step: CleanupStep;
  /** True when git was spawned for it, or the run record's removal was tried. */
  readonly ran: boolean;
  /** True when git exited 0 (for a delete on `origin`, the push did) or every path was removed; false when it was not run at all. */
  readonly ok: boolean;
  /** The step as one line the person can paste. */
  readonly command: string;
  /** What git said, standard error first, why a path was not removed, or why it was not run. */
  readonly said: string;
}

/** How the runner removes a run-record step's files. */
export interface CleanupFiles {
  /** Removes the file at `path`; throws when it cannot. */
  readonly remove: (path: string) => void;
}

/** The real disk: `rmSync`, never recursive, never forced. */
export const DEFAULT_CLEANUP_FILES: CleanupFiles = Object.freeze({
  remove: (path: string) => {
    rmSync(path);
  },
});

/** Freezes a step and the argv inside it. */
function frozenStep(step: CleanupStep): CleanupStep {
  return Object.freeze({ ...step, argv: Object.freeze([...step.argv]) });
}

/** The step removing the worktree at `path`. Never `--force`. */
export function removeWorktreeStep(path: string): CleanupStep {
  return frozenStep({
    kind: 'remove-worktree',
    subject: path,
    argv: ['git', 'worktree', 'remove', path],
    after: null,
  });
}

/**
 * The step deleting `branch` with `-d`, or `-D` when `forced`; see the
 * module note for when the builder asks for which.
 */
export function deleteBranchStep(branch: string, forced: boolean, after: string | null = null): CleanupStep {
  const flag = forced
    ? '-D'
    : '-d';
  return frozenStep({
    kind: 'delete-branch',
    subject: branch,
    argv: ['git', 'branch', flag, branch],
    after,
  });
}

/**
 * The step deleting the branch `name` on `origin`:
 * `git push origin --delete <name>`, never a force flag. The one step
 * that writes to a remote; {@link cleanupSteps} builds it for a ticked
 * remote-only row alone, and withholds a name that opens with `-`.
 */
export function deleteRemoteBranchStep(name: string): CleanupStep {
  return frozenStep({
    kind: 'delete-remote-branch',
    subject: name,
    argv: ['git', 'push', REMOTE, '--delete', name],
    after: null,
  });
}

/**
 * Why a remote-only row whose name opens with `-` is not deleted, with
 * the line that does delete it, `--` before the name, for the person to
 * run; see "The one remote write" in the module note.
 */
export function dashNameReason(name: string): string {
  const byHand = ['git', 'push', REMOTE, '--delete', '--', name].map((word) => shellQuote(word)).join(' ');
  return `its name opens with \`${OPTION_MARK}\`, which git reads as an option, not as a branch; to delete it on ${REMOTE}: ${byHand}`;
}

/** The step for one ticked remote-only row, or why there is none. */
function remoteBranchStep(row: RemoteOnlyRow): CleanupStep | WithheldRemoval {
  if (row.name.startsWith(OPTION_MARK)) {
    return { kind: 'delete-remote-branch', subject: row.name, reason: dashNameReason(row.name) };
  }
  return deleteRemoteBranchStep(row.name);
}

/**
 * The step removing the run record `row` names, and its events file when
 * the row names one: `rm <record> [<events file>]`, never `-f`.
 */
export function removeRunStep(row: RunRow): CleanupStep {
  const events = row.eventsPath === null
    ? []
    : [row.eventsPath];
  return frozenStep({
    kind: 'remove-run',
    subject: row.path,
    argv: ['rm', row.path, ...events],
    after: null,
  });
}

/**
 * Whether a Merged row is deleted with `-D`: not reachable from the
 * base, and either merged by a pull request at its tip, which is a
 * squash merge, or past a merged pull request's head by commits that
 * are all release fragments the base holds; see the module note.
 */
export function needsForcedDelete(row: MergedRow): boolean {
  if (row.mergedBy.includes('base')) {
    return false;
  }
  if (row.mergedBy.includes('pull-request') && row.pullRequest !== null) {
    return true;
  }
  return row.pastHead?.held === true;
}

/**
 * Why a Merged row past a merged pull request's head is not deleted:
 * the commits past the head the base does not hold, each as short hash
 * and subject, comma-joined oldest first.
 */
export function unheldPastHeadReason(reading: PastHeadRead): string {
  const unheld = reading.commits.filter((commit) => !commit.held);
  const named = unheld.map((commit) => `${commit.hash.slice(0, SHORT_HASH_LENGTH)} ${commit.subject}`).join(', ');
  const head = `#${String(reading.pullRequest.number)}'s head`;
  const counted = unheld.length === 1
    ? `1 commit past ${head} is not a release fragment`
    : `${String(unheld.length)} commits past ${head} are not release fragments`;
  return `${counted} the base holds: ${named}; deleting it would lose them`;
}

/** One ticked branch, with the flag its group decides. */
interface BranchPick {
  readonly name: string;
  readonly merged: boolean;
  readonly forced: boolean;
  /** The untickable worktree holding the branch, when `./groups.ts` named one. */
  readonly holder: BranchHolder | null;
  /** A Merged row's commits past its pull request's head when they are not all held, else null. */
  readonly unheld: PastHeadRead | null;
}

/** A ticked Stale or Not-pushed row as a pick: never Merged, always `-D`. */
function unmergedPick(row: StaleRow | NotPushedRow): BranchPick {
  return {
    name: row.branch.name,
    merged: false,
    forced: true,
    holder: row.heldBy ?? null,
    unheld: null,
  };
}

/** The ticked branch rows, Merged first, each with its flag. */
function branchPicks(selection: CleanupSelection): readonly BranchPick[] {
  return [
    ...selection.merged.map((row) => ({
      name: row.branch.name,
      merged: true,
      forced: needsForcedDelete(row),
      holder: row.heldBy ?? null,
      unheld: row.pastHead === undefined || row.pastHead.held
        ? null
        : row.pastHead,
    })),
    ...[...selection.stale, ...selection.notPushed].map((row) => unmergedPick(row)),
  ];
}

/** Why a non-Merged branch a ticked worktree holds is not deleted. */
function heldReason(path: string): string {
  return `held by the worktree at ${path}; only a Merged branch is deleted with its worktree`;
}

/** Why a branch whose worktree cannot be removed is not deleted. */
function blockedHolderReason(path: string): string {
  return `held by the worktree at ${path}, which is not removed`;
}

/** Why a branch an untickable worktree holds is not deleted. */
function untickableHolderReason(holder: BranchHolder): string {
  return `${checkedOutReason(holder)}, which is not removed`;
}

/** The step for one ticked branch, or why there is none. */
function branchStep(
  pick: BranchPick,
  removed: ReadonlyMap<string, string>,
  blocked: ReadonlyMap<string, string>,
): CleanupStep | WithheldRemoval {
  if (pick.holder !== null) {
    return { kind: 'delete-branch', subject: pick.name, reason: untickableHolderReason(pick.holder) };
  }
  if (pick.unheld !== null) {
    return { kind: 'delete-branch', subject: pick.name, reason: unheldPastHeadReason(pick.unheld) };
  }
  const blockedPath = blocked.get(pick.name);
  if (blockedPath !== undefined) {
    return { kind: 'delete-branch', subject: pick.name, reason: blockedHolderReason(blockedPath) };
  }
  const path = removed.get(pick.name) ?? null;
  if (path !== null && !pick.merged) {
    return { kind: 'delete-branch', subject: pick.name, reason: heldReason(path) };
  }
  return deleteBranchStep(pick.name, pick.forced, path);
}

/** Whether `entry` is a step rather than a withheld removal. */
function isStep(entry: CleanupStep | WithheldRemoval): entry is CleanupStep {
  return 'argv' in entry;
}

/** Maps each branch held by one of `rows` to the path holding it. */
function holders(rows: readonly WorktreeRow[]): ReadonlyMap<string, string> {
  return new Map(rows.flatMap((row) => (row.branch === null
    ? []
    : [[row.branch, row.path] as const])));
}

/** The ticked worktrees of `selection` as the two maps {@link branchStep} reads: removable, then untickable. */
function heldBranches(selection: CleanupSelection): readonly [ReadonlyMap<string, string>, ReadonlyMap<string, string>] {
  return [
    holders(selection.worktrees.filter((row) => row.tickable)),
    holders(selection.worktrees.filter((row) => !row.tickable)),
  ];
}

/**
 * The ticked Not-pushed rows of `selection` that become a
 * `delete-branch` step, in the order handed over: the only ones worth
 * asking about. A row any ticked worktree holds, or an untickable one
 * holds (its `heldBy`), is left out; see the module note.
 */
export function deletedNotPushed(selection: CleanupSelection): readonly NotPushedRow[] {
  const [removed, blocked] = heldBranches(selection);
  return selection.notPushed.filter((row) => isStep(branchStep(unmergedPick(row), removed, blocked)));
}

/**
 * The steps the ticked rows turn into: worktree removals first, then
 * local branch deletes, then the deletes on `origin` of the ticked
 * remote-only rows, then the ticked run records, and every ticked row
 * that is not a step with why; see the module note for the order, the
 * flags and what is withheld.
 */
export function cleanupSteps(selection: CleanupSelection): CleanupPlan {
  const removable = selection.worktrees.filter((row) => row.tickable);
  const untickable = selection.worktrees.filter((row) => !row.tickable);
  const [removed, blocked] = heldBranches(selection);
  const branchEntries = branchPicks(selection).map((pick) => branchStep(pick, removed, blocked));
  const remoteEntries = (selection.remoteOnly ?? []).map((row) => remoteBranchStep(row));
  return Object.freeze({
    steps: Object.freeze([
      ...removable.map((row) => removeWorktreeStep(row.path)),
      ...branchEntries.filter(isStep),
      ...remoteEntries.filter(isStep),
      ...(selection.runs ?? []).filter((row) => row.ticked).map((row) => removeRunStep(row)),
    ]),
    withheld: Object.freeze([
      ...untickable.map((row): WithheldRemoval => ({ kind: 'remove-worktree', subject: row.path, reason: row.reason })),
      ...branchEntries.filter((entry): entry is WithheldRemoval => !isStep(entry)),
      ...remoteEntries.filter((entry): entry is WithheldRemoval => !isStep(entry)),
    ]),
  });
}

/** `step` as one line the person can paste, each word shell-quoted. */
export function cleanupCommandLine(step: CleanupStep): string {
  return step.argv.map((word) => shellQuote(word)).join(' ');
}

/**
 * What `--dry-run` prints: one command line per step, in run order, a
 * `delete-remote-branch` step as the `git push origin --delete <name>`
 * it would run.
 */
export function dryRunLines(plan: CleanupPlan): readonly string[] {
  return plan.steps.map((step) => cleanupCommandLine(step));
}

/** The words of `argv` that would force the removal or the push, in order. */
function forcingWords(argv: readonly string[]): readonly string[] {
  return argv.filter((word) => FORCING_FLAG.test(word));
}

/**
 * Why `argv` must not be spawned, or null when it carries no force
 * flag. Names every word that made it forced.
 */
export function forcedFlagRefusal(argv: readonly string[]): string | null {
  const forcing = forcingWords(argv);
  if (forcing.length === 0) return null;
  const words = forcing.map((word) => `\`${word}\``).join(', ');
  return `rafa cleanup refuses a forced removal: ${words}. Nothing was run.`;
}

/** Why a step waiting on the worktree at `path` was not run. */
function afterFailedReason(path: string): string {
  return `not run: the worktree at ${path} was not removed`;
}

/** The outcome of a step that was not spawned. */
function notRun(step: CleanupStep, said: string): CleanupOutcome {
  return { step, ran: false, ok: false, command: cleanupCommandLine(step), said };
}

/** Removes a run-record step's paths in order, stopping at the first that fails. */
function removeRun(files: CleanupFiles, step: CleanupStep): CleanupOutcome {
  const command = cleanupCommandLine(step);
  for (const path of step.argv.slice(1)) {
    try {
      files.remove(path);
    } catch (error) {
      return { step, ran: true, ok: false, command, said: `cannot remove ${path}: ${messageOf(error)}` };
    }
  }
  return { step, ran: true, ok: true, command, said: '' };
}

/** Runs one step, a `delete-remote-branch` one as the push its argv spells, unless the guard or its `after` worktree stops it. */
function runStep(git: GitRunner, files: CleanupFiles, step: CleanupStep, removed: ReadonlySet<string>): CleanupOutcome {
  const refusal = forcedFlagRefusal(step.argv);
  if (refusal !== null) return notRun(step, refusal);
  if (step.after !== null && !removed.has(step.after)) return notRun(step, afterFailedReason(step.after));
  if (step.kind === 'remove-run') return removeRun(files, step);
  const result = git(step.argv.slice(1));
  return { step, ran: true, ok: result.ok, command: cleanupCommandLine(step), said: gitSaid(result) };
}

/**
 * Runs `plan`'s steps in order through `git`, a runner made for the
 * repository the command runs in, and the run-record steps through
 * `files`, answering one outcome per step. A failed step does not stop
 * the rest; see the module note.
 */
export function runCleanupSteps(
  git: GitRunner,
  plan: CleanupPlan,
  files: CleanupFiles = DEFAULT_CLEANUP_FILES,
): readonly CleanupOutcome[] {
  const removed = new Set<string>();
  return plan.steps.map((step) => {
    const outcome = runStep(git, files, step, removed);
    if (outcome.ok && step.kind === 'remove-worktree') removed.add(step.subject);
    return outcome;
  });
}
