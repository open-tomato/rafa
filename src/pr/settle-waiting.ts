/**
 * What waits to be settled on a base branch: the reading the settle dry
 * run answers with when it folds the fragments there into a version,
 * and the one function that takes it.
 *
 * {@link SettleWaiting} is the shape two readers of that dry run share:
 * `rafa pr merge`'s settle follow-up, which turns it into the line
 * `<n> fragments wait on <base> and fold into <version>`, and `rafa
 * next`'s settle step (`src/next/settle-step.ts`), which turns it into
 * a state of its chain. {@link settleWaitingOn} is the reading both are
 * decided by, so the two cannot disagree about where settle is named:
 * the settle dry run (`readSettle`, `src/release/settle.ts`) over
 * `origin/<base>`, read only where the release runs (`release.enabled`,
 * as the wrap-up and the guard read it), and answered only for a
 * `folded` outcome. The dry run reads git objects alone and writes
 * nothing.
 *
 * This is the library half of two command files, and neither holds a
 * re-export of what left it. `src/commands/pr/merge-followups.ts` keeps
 * the follow-ups rule and imports the type; its other symbol that left
 * is `versionTag`, in `src/release/version-tag.ts`.
 * `src/commands/pr/merge-cleanup.ts` keeps the clean-up after a merge
 * and the gathering of the follow-ups, imports {@link settleWaitingOn},
 * and widens {@link SettleWaitingPlace} into its own follow-up place.
 * Nothing here imports from `src/commands/`.
 */
import type { GitRunner } from './git.js';
import type { MergeGuardSettings } from '../release/guard-merge.js';

import { resolveReleaseEnabled } from '../release/enabled.js';
import { readSettle } from '../release/settle.js';

/**
 * The remote whose `<base>` the dry run reads. `merge-cleanup.ts` has
 * its own spelling for the branch it probes and deletes; this one names
 * only the ref settle folds from.
 */
export const SETTLE_REMOTE = 'origin';

/** Where the settle dry run is read: the project, its base branch and its release settings. */
export interface SettleWaitingPlace {
  /** The project root, where `release.enabled` reads its files. */
  readonly root: string;
  /** The base branch the fragments wait on, read as `origin/<base>`. */
  readonly base: string;
  /** The release settings the settle dry run reads, `release.enabled` among them. */
  readonly release: MergeGuardSettings;
}

/**
 * What the settle dry run folded on the base branch: the fragments
 * waiting there and the version they fold into.
 */
export interface SettleWaiting {
  /** The base branch the fragments wait on, e.g. `main`. */
  readonly base: string;
  /** How many fragments the fold took, `level: none` ones included. */
  readonly fragments: number;
  /** The version settle would write. */
  readonly version: string;
}

/** What the settle dry run folded on `origin/<base>`, or null where the release is off or nothing folds. */
export function settleWaitingOn(place: SettleWaitingPlace, git: GitRunner): SettleWaiting | null {
  if (!resolveReleaseEnabled(place.release, place.root).enabled) return null;
  const reading = readSettle(git, `${SETTLE_REMOTE}/${place.base}`, place.release);
  if (reading.outcome !== 'folded') return null;
  return { base: place.base, fragments: reading.fragments.length, version: reading.version };
}
