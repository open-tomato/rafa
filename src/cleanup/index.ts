/**
 * What `rafa cleanup` lists, read in one call, and what a caller
 * outside `src/cleanup/` imports.
 *
 * {@link readCleanup} runs the readers of this directory in order:
 * `git fetch --prune` when asked, `./branches.ts` for the listable
 * branches, `./groups.ts` for Merged, Stale and Not pushed, and
 * `./worktrees.ts` for the worktrees, told which branches are in Merged
 * so a clean worktree on one starts ticked, then `./groups.ts`'s
 * `holdMergedRows` over those worktrees, so a Merged branch a worktree
 * that cannot be ticked holds starts unticked, and last `./runs.ts` for the
 * run records under the project's `.rafa/runs/`. {@link cleanupCounts} is
 * the number of rows in each branch group and in Worktrees, which
 * `rafa doctor` and `rafa status` print; the run records are listed for
 * `rafa cleanup` alone and are not counted there. Like every module here
 * it prints nothing and deletes nothing; `./steps.ts`, re-exported below,
 * builds and runs the removals.
 *
 * ## The fetch
 *
 * Only `rafa cleanup` fetches: `rafa doctor` reads the `[gone]` state
 * the last fetch left, so it reads with {@link CleanupSettings.fetch}
 * false and runs no network call. A fetch that fails is a note, not a
 * failure — the branches are still read, their `[gone]` state as of the
 * last fetch that ran. Measured on git 2.50.1 (Apple Git-155),
 * 2026-09-24: `git fetch --prune` in a repository with no remote exits 0
 * and writes nothing, and with an `origin` naming a path that is not a
 * repository exits 128 with `fatal: '<path>' does not appear to be a git
 * repository` as the first line.
 *
 * ## Why it answers rather than throws
 *
 * Each reader answers `{ ok: false, detail }` when git cannot be read,
 * and so does this one, passing the first such answer on: a branch
 * listing that cannot be read leaves no groups to count, and a worktree
 * listing that cannot be read leaves the Worktrees group unknown rather
 * than empty. The provider never fails the reading: `./groups.ts` turns
 * an unreachable one into a note.
 */
import type { BranchGroups, ReleasePaths } from './groups.js';
import type { RunRow, RunSeams } from './runs.js';
import type { WorktreeRow, WorktreeSeams } from './worktrees.js';
import type { PullRequests } from '../pr/types.js';

import { gitSaid } from '../pr/git.js';

import { readBranches } from './branches.js';
import { classifyBranches, holdMergedRows, readProviderMerges } from './groups.js';
import { readRunRecords } from './runs.js';
import { defaultWorktreeSeams, readWorktrees } from './worktrees.js';

export type {
  BranchesRead,
  BranchesReading,
  BranchesUnread,
  BranchSettings,
  LocalBranch,
} from './branches.js';
export type {
  BranchGroup,
  BranchHolder,
  BranchGroups,
  BranchGroupsReading,
  BranchGroupsUnread,
  BranchRow,
  GroupSettings,
  MergedBy,
  MergedRow,
  NotPushedRow,
  ProviderMerges,
  ReleasePaths,
  StaleRow,
} from './groups.js';
export type { PastHeadCommit, PastHeadRead } from './past-head.js';
export type { RunRow, RunSeams, RunsReading } from './runs.js';
export type {
  CleanupFiles,
  CleanupOutcome,
  CleanupPlan,
  CleanupSelection,
  CleanupStep,
  CleanupStepKind,
  WithheldRemoval,
} from './steps.js';
export type {
  WorktreeBlocker,
  WorktreeBlockKind,
  WorktreeRead,
  WorktreeRow,
  WorktreeSeams,
  WorktreesRead,
  WorktreesReading,
  WorktreesUnread,
} from './worktrees.js';

export { isKept, readBranches, resolveBaseBranch } from './branches.js';
export {
  classifyBranches,
  MERGED_STATE_UNKNOWN,
  readProviderMerges,
} from './groups.js';
export { readRunRecords } from './runs.js';
export {
  cleanupCommandLine,
  cleanupSteps,
  dryRunLines,
  forcedFlagRefusal,
  removeRunStep,
  runCleanupSteps,
} from './steps.js';
export { defaultWorktreeSeams, readWorktrees } from './worktrees.js';

/** The argv the remote-tracking branches are refreshed with. Never forced. */
export const FETCH_PRUNE = Object.freeze(['fetch', '--prune']);

/**
 * What {@link readCleanup} reads through: the worktree seams, the pid
 * probe the run records are read with, and the provider or null.
 */
export interface CleanupSeams extends WorktreeSeams, RunSeams {
  /** The pull request provider, or null when `pr.provider` is `none`. */
  readonly pulls: PullRequests | null;
}

/** What {@link readCleanup} needs besides its seams. */
export interface CleanupSettings {
  /** True to run {@link FETCH_PRUNE} first; `rafa doctor` passes false. */
  readonly fetch: boolean;
  /** `pr.base`, or null when nobody has named one. */
  readonly base: string | null;
  /** `cleanup.keep`. */
  readonly keep: readonly string[];
  /** `cleanup.staleDays`. */
  readonly staleDays: number;
  /** `cleanup.worktreeIdleDays`. */
  readonly worktreeIdleDays: number;
  /** The clock, read once by the caller. */
  readonly now: Date;
  /** The home directory `~/.rafa/worktrees/` is under. */
  readonly home: string;
  /** The directory the command runs from. */
  readonly cwd: string;
  /** The project root whose `.rafa/runs/` holds the loop's session records, and the run records listed. */
  readonly projectRoot: string;
  /** `loop.worktreeDir`, resolved from {@link projectRoot}; the loop's worktrees are listed from it. */
  readonly worktreeDir: string;
  /**
   * `release.fragments` and `release.changelog`, which tell a Merged
   * branch's commits past its pull request's head that the base holds;
   * the config's defaults when left out (`./groups.ts`).
   */
  readonly release?: ReleasePaths;
}

/** The five groups, and the notes about readings that could not be taken. */
export interface CleanupRead extends Omit<BranchGroups, 'notes'> {
  /** True when {@link FETCH_PRUNE} ran and git answered success. */
  readonly fetched: boolean;
  /** The listed worktrees, in the order git listed them. */
  readonly worktrees: readonly WorktreeRow[];
  /** The removable run records, oldest first; see `./runs.ts`. */
  readonly runs: readonly RunRow[];
  /** One-line notes: the fetch's first, then the groups', then the run records'; empty when every reading was taken. */
  readonly notes: readonly string[];
}

/** A reading git refused; see the module note. */
export interface CleanupUnread {
  readonly ok: false;
  /** What went wrong, git's own words where it said any. */
  readonly detail: string;
}

/** What {@link readCleanup} answers. Never a rejection. */
export type CleanupReading = CleanupRead | CleanupUnread;

/** The number of rows in each branch group and in Worktrees; the run records are not counted. */
export interface CleanupCounts {
  readonly merged: number;
  readonly stale: number;
  readonly notPushed: number;
  readonly worktrees: number;
}

/** The seams over the real git, session records and disk, git run in `cwd`. */
export function defaultCleanupSeams(cwd: string, pulls: PullRequests | null): CleanupSeams {
  return { ...defaultWorktreeSeams(cwd), pulls };
}

/** The one line saying the fetch failed and `[gone]` is read as of the last one. */
export function fetchFailedNote(detail: string): string {
  return `git fetch --prune failed (${detail}); upstreams read as gone as of the last fetch`;
}

/**
 * Every group `rafa cleanup` lists: {@link FETCH_PRUNE} first when
 * `settings.fetch` is true, then the branches, their three groups, the
 * worktrees with the Merged branches' names, and the run records under
 * `settings.projectRoot`. A run-record directory that cannot be read is
 * a note, never a failure.
 */
export async function readCleanup(seams: CleanupSeams, settings: CleanupSettings): Promise<CleanupReading> {
  const notes: string[] = [];
  let fetched = false;
  if (settings.fetch) {
    const result = seams.git(FETCH_PRUNE);
    fetched = result.ok;
    if (!result.ok) {
      notes.push(fetchFailedNote(firstLine(gitSaid(result)) || 'git said nothing'));
    }
  }

  const branches = readBranches(seams.git, { base: settings.base, keep: settings.keep });
  if (!branches.ok) {
    return branches;
  }
  const provider = await readProviderMerges(seams.pulls);
  const groups = classifyBranches(seams.git, branches, provider, {
    staleDays: settings.staleDays,
    now: settings.now,
    ...(settings.release === undefined
      ? {}
      : { release: settings.release }),
  });
  if (!groups.ok) {
    return groups;
  }

  const worktrees = readWorktrees(seams, {
    home: settings.home,
    cwd: settings.cwd,
    projectRoot: settings.projectRoot,
    worktreeDir: settings.worktreeDir,
    idleDays: settings.worktreeIdleDays,
    now: settings.now,
    mergedBranches: groups.merged.map((row) => row.branch.name),
  });
  if (!worktrees.ok) {
    return worktrees;
  }
  const runs = readRunRecords(settings.projectRoot, seams);

  return {
    ok: true,
    base: groups.base,
    fetched,
    merged: holdMergedRows(groups.merged, worktrees.worktrees),
    stale: groups.stale,
    notPushed: groups.notPushed,
    worktrees: worktrees.worktrees,
    runs: runs.runs,
    notes: [...notes, ...groups.notes, ...runs.notes],
  };
}

/**
 * How many rows each branch group and Worktrees of `read` hold, what
 * `rafa doctor` and `rafa status` print. `read.runs` is left out.
 */
export function cleanupCounts(read: CleanupRead): CleanupCounts {
  return {
    merged: read.merged.length,
    stale: read.stale.length,
    notPushed: read.notPushed.length,
    worktrees: read.worktrees.length,
  };
}

/** The first non-empty line of `text`, trimmed, so a note stays one line. */
function firstLine(text: string): string {
  return text.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
}
