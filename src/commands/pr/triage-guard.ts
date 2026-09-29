/**
 * The release guard as `rafa pr triage` reads it: the verdict
 * `classifyTriage` turns into `conflict-version` when the branch
 * stamped a version (`src/pr/triage/classify.ts`).
 *
 * What the guard answers and how it reads is `src/release/guard.ts`'s.
 * This module only chooses the refs and the moment, the way
 * `./triage-read.ts` does for the conflict:
 *
 *   - It runs only where the release does — `release.enabled` read as
 *     `rafa pr merge`'s guard step reads it (`src/release/enabled.ts`) —
 *     and answers `null` everywhere else, so a project with no version
 *     file or no changelog under `auto` spends no git call on it and is
 *     classed as it was before the guard.
 *   - It FETCHES NOTHING. `rafa pr merge` fetches both branches before
 *     its guard (`src/release/guard-merge.ts`) because it is about to
 *     write the base; a triage is a read, and `./triage-read.ts`'s note
 *     gives the reason it never writes the operator's object database.
 *   - The refs are the conflict reading's candidates
 *     (`baseCandidates`, `headCandidates`), the first that resolves
 *     taken, so the guard reads the head commit the triage is pinned to
 *     and `origin/<base>` before `<base>`. A side that resolves to
 *     nothing answers a {@link GuardUnread} naming what was tried,
 *     which `classifyTriage` reads as no stamp.
 */
import type { ConflictRefs } from './triage-read.js';
import type { GitRunner } from '../../pr/index.js';
import type { MergeGuardSettings } from '../../release/guard-merge.js';
import type { GuardReading } from '../../release/guard.js';

import { resolveReleaseEnabled } from '../../release/enabled.js';
import { readGuard } from '../../release/guard.js';

import { baseCandidates, headCandidates, resolvesRef } from './triage-read.js';

/** What one pull request's guard is read from. */
export interface TriageGuardInput {
  /** Git at the project root. */
  readonly git: GitRunner;
  /** The release settings, as `PrContext.versionGuard` carries them. */
  readonly settings: MergeGuardSettings;
  /** The project root, where `release.enabled` reads the two files. */
  readonly root: string;
  /** The pull request's refs and number. */
  readonly pr: ConflictRefs & { readonly number: number };
  /** When the triage runs; the forecast dates the branch's fragments with it. */
  readonly now: Date;
}

/** Reads one pull request's guard; `null` where the release does not run. */
export type TriageGuardReader = (input: TriageGuardInput) => GuardReading | null;

/** The first candidate git resolves, or null when none does. */
function firstResolved(git: GitRunner, candidates: readonly string[]): string | null {
  return candidates.find((ref) => resolvesRef(git, ref)) ?? null;
}

/**
 * The guard over the pull request's head against its base, read with
 * no fetch, or `null` where the release does not run; see the module
 * note. Never throws on git: `readGuard` answers an unread reading.
 */
export function readTriageGuard(input: TriageGuardInput): GuardReading | null {
  const { git, pr, settings } = input;
  if (!resolveReleaseEnabled(settings, input.root).enabled) return null;
  const bases = baseCandidates(pr);
  const heads = headCandidates(pr);
  const base = firstResolved(git, bases);
  if (base === null) return { ok: false, problem: `no base ref resolved locally (tried ${bases.join(', ')})` };
  const head = firstResolved(git, heads);
  if (head === null) return { ok: false, problem: `no head ref resolved locally (tried ${heads.join(', ')})` };
  return readGuard({
    git,
    settings,
    base,
    branch: { ref: head, name: pr.headRefName, pullRequest: pr.number },
    now: input.now,
  });
}
