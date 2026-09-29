/**
 * The release guard as `rafa pr merge` runs it: the two fetches ahead
 * of the reading, the reading over the pull request's branches, and the
 * reaction the two settings choose for what it answers.
 *
 * ```text
 * readMergeGuard(input)             → fetch base and head, then readGuard       (git)
 * guardReaction(reading, settings)  → silent | print | report | ask | refuse | accept  (pure)
 * ```
 *
 * `./guard.ts` reads and fetches nothing; its caller fetches the base
 * when it wants a fresh one. `pr merge` does: the base and the head
 * branch are fetched from `origin`, one `git fetch <remote> <branch>`
 * each, so a head branch the remote no longer holds does not keep the
 * base from being fetched. A fetch that fails is a note and not a stop,
 * as `./prepare.ts` treats its own: the guard then reads whatever this
 * clone already holds for that ref, and the sentence joins the
 * reading's problems, which `guardLines` prints as notes ahead of the
 * fix line. The
 * branch is read as `origin/<head>` and not as the local branch, since
 * what merges is what the pull request's head holds on the remote.
 *
 * ## The reaction
 *
 * | answer              | reaction                                             |
 * | ------------------- | ---------------------------------------------------- |
 * | `clean`             | `print` — its lines, the forecast among them         |
 * | `missing`, `stale`  | `pr.versionCollision`: `allow` → `silent`, `report`, `ask`, `refuse` |
 * | `collision`         | `refuse`, or `accept` under `dangerous.acceptVersionCollision` |
 * | not read            | `report`                                             |
 *
 * A guard that could not read is reported and never refuses, whatever
 * `pr.versionCollision` says: the reading it fell short of is a git
 * reading (a head branch from a fork the remote does not hold, a base
 * with no merge base), and a refusal naming no answer would stop a merge
 * over a question nobody could answer. `refuse` and `ask` are reactions
 * to an answer the guard gave.
 */
import type { ReleaseFileSettings } from './enabled.js';
import type { GuardNotesReader, GuardReading } from './guard.js';
import type { SettleSettings } from './settle.js';
import type { VersionCollisionMode } from '../config-readers.js';
import type { GitRunner } from '../pr/git.js';

import { gitSaid } from '../pr/git.js';

import { readGuard } from './guard.js';
import { RELEASE_REMOTE } from './version.js';

/**
 * The settings the merge's guard reads: `./guard.ts`'s, `release.enabled`
 * that says whether it runs at all, and the two that choose the reaction.
 */
export interface MergeGuardSettings extends SettleSettings, ReleaseFileSettings {
  /** How `missing` and `stale` are met. `pr.versionCollision`. */
  readonly prVersionCollision: VersionCollisionMode;
  /** Whether a `collision` merges anyway. `dangerous.acceptVersionCollision`. */
  readonly dangerousAcceptVersionCollision: boolean;
}

/** What {@link readMergeGuard} reads. */
export interface MergeGuardInput {
  /** Git, run at the repository root. */
  readonly git: GitRunner;
  readonly settings: SettleSettings;
  /** The pull request's base branch, e.g. `main`. */
  readonly base: string;
  /** The pull request's head branch. */
  readonly head: string;
  /** The pull request's number. */
  readonly pullRequest: number;
  /** When the guard runs; see `./guard.ts`. */
  readonly now: Date;
  /** This machine's change notes, for the level report. */
  readonly readNotes?: GuardNotesReader;
  /** The remote both branches are fetched from. `origin` when left out. */
  readonly remote?: string;
}

/** How `pr merge` meets what the guard answered; see the module note. */
export type GuardReaction = 'silent' | 'print' | 'report' | 'ask' | 'refuse' | 'accept';

/** The copy of `config` holding the guard's settings alone, so a caller need not carry the whole config. */
export function mergeGuardSettings(config: MergeGuardSettings): MergeGuardSettings {
  return {
    releaseEnabled: config.releaseEnabled,
    releaseVersionFile: config.releaseVersionFile,
    releaseChangelog: config.releaseChangelog,
    releaseFragments: config.releaseFragments,
    releaseStrategy: config.releaseStrategy,
    releaseHeading: config.releaseHeading,
    prVersionCollision: config.prVersionCollision,
    dangerousAcceptVersionCollision: config.dangerousAcceptVersionCollision,
  };
}

/** Fetches `branch` from `remote`; a sentence naming what the guard reads instead when it fails, else null. */
function fetchBranch(git: GitRunner, remote: string, branch: string): string | null {
  const fetched = git(['fetch', remote, branch]);
  if (fetched.ok) return null;
  return `${branch} could not be fetched from ${remote}, so the guard reads whatever this clone`
    + ` already holds for ${remote}/${branch}: ${gitSaid(fetched)}`;
}

/**
 * `reading` with the fetch notes ahead of its own problems, or, for a
 * guard that could not read, after the one problem it names.
 */
function withFetchProblems(reading: GuardReading, fetchProblems: readonly string[]): GuardReading {
  if (fetchProblems.length === 0) return reading;
  if (reading.ok) return { ...reading, problems: [...fetchProblems, ...reading.problems] };
  return { ok: false, problem: [reading.problem, ...fetchProblems].join('; ') };
}

/**
 * The guard over the pull request's head against its base, both fetched
 * from `input.remote` first; see the module note. Never throws on git:
 * a fetch that failed is among the reading's problems.
 */
export function readMergeGuard(input: MergeGuardInput): GuardReading {
  const remote = input.remote ?? RELEASE_REMOTE;
  const fetchProblems = [input.base, input.head]
    .map((branch) => fetchBranch(input.git, remote, branch))
    .filter((problem): problem is string => problem !== null);
  const reading = readGuard({
    git: input.git,
    settings: input.settings,
    base: `${remote}/${input.base}`,
    branch: { ref: `${remote}/${input.head}`, name: input.head, pullRequest: input.pullRequest },
    now: input.now,
    readNotes: input.readNotes,
  });
  return withFetchProblems(reading, fetchProblems);
}

/** How `mode` meets a `missing` or `stale` answer. */
function modeReaction(mode: VersionCollisionMode): GuardReaction {
  return mode === 'allow'
    ? 'silent'
    : mode;
}

/** What `pr merge` does with `reading`, under the two settings; see the module note. */
export function guardReaction(
  reading: GuardReading,
  settings: Pick<MergeGuardSettings, 'prVersionCollision' | 'dangerousAcceptVersionCollision'>,
): GuardReaction {
  if (!reading.ok) return 'report';
  const { answer } = reading.verdict;
  if (answer === 'clean') return 'print';
  if (answer === 'collision') {
    return settings.dangerousAcceptVersionCollision
      ? 'accept'
      : 'refuse';
  }
  return modeReaction(settings.prVersionCollision);
}
