/**
 * The removal steps of `rafa cleanup` as data: which worktrees and
 * branches the ticked rows turn into, in which order, with which delete
 * flag, and the one runner that spawns them.
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
 *      one case: a row that is Merged by a merged pull request whose head
 *      commit is its tip, and NOT reachable from the base, is `-D`,
 *      because that is a squash merge and `-d` refuses it (measured
 *      below). A Stale or Not-pushed row is `-D`: the caller hands it
 *      over only once the person ticked it and, for Not pushed, answered
 *      the question naming its commit count.
 *
 * A branch a ticked worktree holds is deleted only when it is Merged,
 * and only after that worktree's removal succeeded: its step names the
 * worktree in {@link CleanupStep.after} and the runner leaves it unrun
 * when that removal failed. A Stale or Not-pushed branch a ticked
 * worktree holds is not a step at all but a {@link WithheldRemoval},
 * as is a worktree row the caller passed although it cannot be ticked.
 *
 * ## The force guard
 *
 * {@link forcedFlagRefusal} reads the argv about to be spawned, not the
 * rows it was built from, and the runner refuses a step it fires on
 * without spawning anything. `--force` with or without a value and any
 * short cluster holding `f` (`-f`, `-ff`, `-df`) are refused. `-D` is
 * not among them: it is the one forced delete the rules above allow,
 * and only this module's builder spells it.
 *
 * A branch name cannot smuggle a flag in: `git branch -- -f` answered
 * `fatal: '-f' is not a valid branch name`, exit 128, and a worktree
 * path comes from `git worktree list`, which prints it absolute.
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
 * Nothing here touches a remote: a Stale row names
 * `git push origin --delete <b>` for the person to run, and that line
 * is the renderer's, not a step.
 */
import type { MergedRow, NotPushedRow, StaleRow } from './groups.js';
import type { WorktreeRow } from './worktrees.js';
import type { GitRunner } from '../pr/git.js';

import { gitSaid } from '../pr/git.js';
import { shellQuote } from '../pr/preflight-items.js';

/** The flag spellings that make a worktree removal or branch delete forced. */
const FORCING_FLAG = /^(?:--force(?:=.*)?|-[^-]*f[^-]*)$/;

/** Which of the two removals a step is. */
export type CleanupStepKind = 'remove-worktree' | 'delete-branch';

/** One step: what it removes, and exactly what it runs. */
export interface CleanupStep {
  readonly kind: CleanupStepKind;
  /** The worktree path or the branch name it removes. */
  readonly subject: string;
  /** The whole command, `git` included, ready to spawn or to print. */
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
  /** The Not-pushed rows the person ticked and confirmed by the second question. */
  readonly notPushed: readonly NotPushedRow[];
}

/** What {@link cleanupSteps} answers. */
export interface CleanupPlan {
  /** Worktree removals first, then branch deletes. */
  readonly steps: readonly CleanupStep[];
  readonly withheld: readonly WithheldRemoval[];
}

/** How one step ended. Never a throw; see the module note. */
export interface CleanupOutcome {
  readonly step: CleanupStep;
  /** True when git was spawned for it. */
  readonly ran: boolean;
  /** True when git exited 0; false when it was not run at all. */
  readonly ok: boolean;
  /** The step as one line the person can paste. */
  readonly command: string;
  /** What git said, standard error first, or why it was not run. */
  readonly said: string;
}

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
 * Whether a Merged row is deleted with `-D`: merged by a pull request
 * at its tip and not reachable from the base, which is a squash merge.
 */
export function needsForcedDelete(row: MergedRow): boolean {
  return !row.mergedBy.includes('base')
    && row.mergedBy.includes('pull-request')
    && row.pullRequest !== null;
}

/** One ticked branch, with the flag its group decides. */
interface BranchPick {
  readonly name: string;
  readonly merged: boolean;
  readonly forced: boolean;
}

/** The ticked branch rows, Merged first, each with its flag. */
function branchPicks(selection: CleanupSelection): readonly BranchPick[] {
  return [
    ...selection.merged.map((row) => ({ name: row.branch.name, merged: true, forced: needsForcedDelete(row) })),
    ...selection.stale.map((row) => ({ name: row.branch.name, merged: false, forced: true })),
    ...selection.notPushed.map((row) => ({ name: row.branch.name, merged: false, forced: true })),
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

/** The step for one ticked branch, or why there is none. */
function branchStep(
  pick: BranchPick,
  removed: ReadonlyMap<string, string>,
  blocked: ReadonlyMap<string, string>,
): CleanupStep | WithheldRemoval {
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

/**
 * The steps the ticked rows turn into: worktree removals first, then
 * branch deletes, and every ticked row that is not a step with why; see
 * the module note for the order, the flags and what is withheld.
 */
export function cleanupSteps(selection: CleanupSelection): CleanupPlan {
  const removable = selection.worktrees.filter((row) => row.tickable);
  const untickable = selection.worktrees.filter((row) => !row.tickable);
  const branchEntries = branchPicks(selection)
    .map((pick) => branchStep(pick, holders(removable), holders(untickable)));
  return Object.freeze({
    steps: Object.freeze([
      ...removable.map((row) => removeWorktreeStep(row.path)),
      ...branchEntries.filter(isStep),
    ]),
    withheld: Object.freeze([
      ...untickable.map((row): WithheldRemoval => ({ kind: 'remove-worktree', subject: row.path, reason: row.reason })),
      ...branchEntries.filter((entry): entry is WithheldRemoval => !isStep(entry)),
    ]),
  });
}

/** `step` as one line the person can paste, each word shell-quoted. */
export function cleanupCommandLine(step: CleanupStep): string {
  return step.argv.map((word) => shellQuote(word)).join(' ');
}

/** What `--dry-run` prints: one command line per step, in run order. */
export function dryRunLines(plan: CleanupPlan): readonly string[] {
  return plan.steps.map((step) => cleanupCommandLine(step));
}

/** The words of `argv` that would force the removal, in order. */
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

/** Runs one step, unless the guard or its `after` worktree stops it. */
function runStep(git: GitRunner, step: CleanupStep, removed: ReadonlySet<string>): CleanupOutcome {
  const refusal = forcedFlagRefusal(step.argv);
  if (refusal !== null) return notRun(step, refusal);
  if (step.after !== null && !removed.has(step.after)) return notRun(step, afterFailedReason(step.after));
  const result = git(step.argv.slice(1));
  return { step, ran: true, ok: result.ok, command: cleanupCommandLine(step), said: gitSaid(result) };
}

/**
 * Runs `plan`'s steps in order through `git`, a runner made for the
 * repository the command runs in, answering one outcome per step. A
 * failed step does not stop the rest; see the module note.
 */
export function runCleanupSteps(git: GitRunner, plan: CleanupPlan): readonly CleanupOutcome[] {
  const removed = new Set<string>();
  return plan.steps.map((step) => {
    const outcome = runStep(git, step, removed);
    if (outcome.ok && step.kind === 'remove-worktree') removed.add(step.subject);
    return outcome;
  });
}
