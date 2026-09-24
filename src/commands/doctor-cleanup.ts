/**
 * The cleanup reading `rafa doctor` prints one row for: how many rows
 * each of the four groups `rafa cleanup` lists would hold — Merged,
 * Stale, Not pushed and Worktrees — read by `src/cleanup/`'s
 * {@link readCleanup} and counted by {@link cleanupCounts}.
 *
 * ## Without fetching
 *
 * `doctor` reads with `fetch: false`, so it runs no `git fetch --prune`
 * and sends nothing over the network for git: an upstream reads as gone
 * as of the last fetch that ran, which is `rafa cleanup`'s to refresh.
 * The only remote call is the pull request provider's merged listing,
 * and it goes through the `gh` runner `doctor` already opened for the
 * board rows ({@link DoctorCleanupInput.gh}), so a project whose
 * provider is not `gh` reads no provider at all, exactly as
 * `rafa cleanup` does with `pr.provider: none`, and its Stale and
 * Not-pushed rows are still counted.
 *
 * ## Where it reads
 *
 * git runs in the project root, where every probe `doctor` checks runs,
 * not in the directory the command was typed in: the counts are the
 * project's, and a doctor run from a subdirectory reads the same ones.
 * The settings are the resolved config's `pr.base`, `cleanup.keep`,
 * `cleanup.staleDays` and `cleanup.worktreeIdleDays`, as `rafa cleanup`
 * reads them.
 *
 * ## The row
 *
 * {@link renderDoctorCleanup} gives one line, naming the count of every
 * group, zeros included, and `rafa cleanup` as the command that lists
 * and removes them — and only when any count is above zero, so a
 * repository with nothing to clean prints nothing. A reading git refuses,
 * such as a project that is no git repository, prints nothing either:
 * its detail is kept in the reading, which json mode gives as the
 * result's `cleanup`. Neither changes `doctor`'s exit code, and nothing
 * here deletes, prints or writes anything.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { CleanupCounts, CleanupSeams, CleanupSettings } from '../cleanup/index.js';
import type { RafaConfig } from '../config.js';
import type { PullRequests } from '../pr/types.js';

import { cleanupCounts, defaultCleanupSeams, readCleanup } from '../cleanup/index.js';
import { createGhPullRequests } from '../pr/index.js';

/** The command the row points at. */
export const CLEANUP_COMMAND = 'rafa cleanup';

/** How the cleanup reading is reached; each left out is the system's own. */
export interface DoctorCleanupSeams {
  /** The seams the reading runs through, git at `cwd`. `defaultCleanupSeams` when left out. */
  readonly cleanupSeams?: (cwd: string, pulls: PullRequests | null) => CleanupSeams;
  /** The clock the Stale and idle ages are read against. `new Date()` when left out. */
  readonly cleanupNow?: () => Date;
}

/** What {@link readDoctorCleanup} reads from. */
export interface DoctorCleanupInput {
  /** The project root: git runs here, and its `.rafa/runs/` holds the loop's sessions. */
  readonly root: string;
  /** The home `~/.rafa/worktrees/` is under. */
  readonly home: string;
  /** The resolved config the four settings are read from. */
  readonly config: Pick<RafaConfig, 'prBase' | 'cleanupKeep' | 'cleanupStaleDays' | 'cleanupWorktreeIdleDays'>;
  /** The `gh` runner `doctor` opened for the board, or null for a provider that is not `gh`. */
  readonly gh: GhRunner | null;
}

/** The counts, or the detail of a reading git refused. */
export type DoctorCleanupReading =
  | { readonly ok: true; readonly counts: CleanupCounts }
  | { readonly ok: false; readonly detail: string };

/** The settings `input` reads with: the config's, `fetch` false; see the module note. */
export function doctorCleanupSettings(input: DoctorCleanupInput, now: Date): CleanupSettings {
  const { config } = input;
  return {
    fetch: false,
    base: config.prBase,
    keep: config.cleanupKeep,
    staleDays: config.cleanupStaleDays,
    worktreeIdleDays: config.cleanupWorktreeIdleDays,
    now,
    home: input.home,
    cwd: input.root,
    projectRoot: input.root,
  };
}

/** The four counts for the project, read without fetching; see the module note. Never a rejection. */
export async function readDoctorCleanup(input: DoctorCleanupInput, seams: DoctorCleanupSeams = {}): Promise<DoctorCleanupReading> {
  const pulls = input.gh === null
    ? null
    : createGhPullRequests({ gh: input.gh });
  const cleanup = (seams.cleanupSeams ?? defaultCleanupSeams)(input.root, pulls);
  const now = (seams.cleanupNow ?? ((): Date => new Date()))();
  const reading = await readCleanup(cleanup, doctorCleanupSettings(input, now));
  if (!reading.ok) return { ok: false, detail: reading.detail };
  return { ok: true, counts: cleanupCounts(reading) };
}

/** Whether any group of `counts` holds a row. */
export function hasCleanup(counts: CleanupCounts): boolean {
  return counts.merged + counts.stale + counts.notPushed + counts.worktrees > 0;
}

/** The one row: every group's count, and the command that lists and removes them. */
export function cleanupRow(counts: CleanupCounts): string {
  const groups = [
    `${String(counts.merged)} merged`,
    `${String(counts.stale)} stale`,
    `${String(counts.notPushed)} not pushed`,
    `${String(counts.worktrees)} ${counts.worktrees === 1
      ? 'worktree'
      : 'worktrees'}`,
  ];
  return `Cleanup: ${groups.join(', ')}; run ${CLEANUP_COMMAND} to review and remove them.`;
}

/** The row for `reading`, or no line for a reading with nothing to clean or one git refused. */
export function renderDoctorCleanup(reading: DoctorCleanupReading): readonly string[] {
  if (!reading.ok || !hasCleanup(reading.counts)) return [];
  return [cleanupRow(reading.counts)];
}
