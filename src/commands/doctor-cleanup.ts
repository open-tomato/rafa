/**
 * The cleanup reading `rafa doctor` prints one row for: how many rows
 * four of the five groups `rafa cleanup` lists would hold — Merged,
 * Stale, Not pushed and Worktrees, never Run records — read by
 * `src/cleanup/`'s {@link readCleanup} and counted by
 * {@link cleanupCounts}. This is the command half of
 * `../cleanup/settings.ts`, which holds the settings the reading runs
 * with (`doctorCleanupSettings`) and the input they are read from
 * (`DoctorCleanupInput`), for `rafa status` and the status hook to
 * read with the same ones.
 *
 * ## Without fetching
 *
 * `doctor` reads with `fetch: false`, so it runs no `git fetch --prune`
 * and sends nothing over the network for git: an upstream reads as gone
 * as of the last fetch that ran, which is `rafa cleanup`'s to refresh.
 * The only remote call is the pull request provider's merged listing,
 * and it goes through the `gh` runner `doctor` already opened for the
 * board rows (`DoctorCleanupInput.gh`), so a project whose
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
 * reads them, and `loop.worktreeDir`, which `rafa status` and the
 * status hook hand in too; a config that lacks it reads the loop's
 * worktrees under the default `.rafa/worktrees`.
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
import type { CleanupCounts, CleanupSeams } from '../cleanup/index.js';
import type { DoctorCleanupInput } from '../cleanup/settings.js';
import type { PullRequests } from '../pr/types.js';

import { cleanupCounts, defaultCleanupSeams, readCleanup } from '../cleanup/index.js';
import { doctorCleanupSettings } from '../cleanup/settings.js';
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

/** The counts, or the detail of a reading git refused. */
export type DoctorCleanupReading =
  | { readonly ok: true; readonly counts: CleanupCounts }
  | { readonly ok: false; readonly detail: string };

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
