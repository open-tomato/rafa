/**
 * The config trust rule of `rafa pr triage --resolve`: a pull request
 * whose head carries a `rafa.config.ts` or `rafa.config.mjs` that the
 * base branch does not hold, byte for byte, is refused before its
 * worktree is added, unless the line says `--allow-local-config`.
 *
 * ## Why a config file is a trust question
 *
 * A YAML config is data. A `rafa.config.ts` or `rafa.config.mjs` is a
 * module rafa IMPORTS, so whatever it runs, it runs with the operator's
 * shell, credentials and remotes. A resolve run checks the pull
 * request's branch out into `~/.rafa/worktrees/pr-<n>` and starts
 * `rafa loop start` inside it (`./resolve-loop.ts`), which loads the
 * config it finds there. The author trust check
 * (`./triage-trust.ts`) asks who OPENED the pull request; this one asks
 * what the branch would make rafa execute, since a trusted author's
 * branch can still carry a config nobody has reviewed onto the base.
 *
 * So the rule is the narrow one: a config module the base already holds
 * with the same blob was merged by somebody allowed to merge, and runs
 * here as it runs in every checkout of the base. Anything else — a file
 * the base lacks, or one whose content differs — is refused with exit
 * {@link CONFIG_TRUST_REFUSE_EXIT}, naming the file, the base and the
 * flag. `--allow-local-config` is the operator saying they read it: the
 * run goes on with one warning line naming what it let through.
 *
 * ## What is compared, through `git rev-parse` alone
 *
 * Each of {@link CONFIG_CODE_FILES} is read as a blob id,
 * `git rev-parse --verify --quiet <rev>:<file>`, on both sides. Two
 * equal ids are the same bytes, so nothing is read or hashed here. Both
 * names are checked, not only the one the loader would pick first: a
 * `.mjs` the `.ts` imports is code the run executes too.
 *
 * The head is the revision the worktree will hold. `git worktree add
 * <path> <branch>` takes the local branch when there is one and DWIMs
 * `origin/<branch>` otherwise (`src/pr/worktree.ts`), so the head is
 * read in the same order, {@link headRevision}. A branch neither ref
 * names answers no head and nothing to compare: the add that follows
 * fails on the same missing branch, and no config is loaded.
 *
 * The base is `origin/<base>` as last fetched. Nothing is fetched here,
 * as `./list-forecast.ts` fetches nothing: whatever a stale copy holds
 * was merged onto the base by somebody allowed to merge. A repository
 * with no `origin/<base>` at all holds no base copy, so a head config
 * there is read as absent from the base and refused.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { Output } from '@open-tomato/rafa/ports';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { ALLOW_LOCAL_CONFIG_FLAG } from './declarations.js';

/** The exit code a config refusal ends with. */
export const CONFIG_TRUST_REFUSE_EXIT = 1;

/**
 * The config files that are code, in the loader's order
 * (`packages/rafa/src/core/config/config-load.ts`). `.rafa/config.yaml` is data and
 * is not one of them.
 */
export const CONFIG_CODE_FILES: readonly string[] = Object.freeze(['rafa.config.ts', 'rafa.config.mjs']);

/** The remote whose copy of the base is the trusted one. */
const BASE_REMOTE = 'origin';

/** Why a head config is not the base's. */
export type ConfigDriftReason = 'absent' | 'differs';

/** One config file the head holds and the base does not hold the same. */
export interface ConfigDrift {
  /** The file name, as it sits at the repository root. */
  readonly file: string;
  /** The base it was compared with, `origin/<base>`. */
  readonly base: string;
  /** `absent` when the base holds no such file, `differs` when it holds another blob. */
  readonly reason: ConfigDriftReason;
}

/** What one config trust check is handed. */
export interface ConfigTrustCheck {
  /** The git runner for the operator checkout the worktree is added from. */
  readonly git: GitRunner;
  /** The pull request number, for the refusal. */
  readonly number: number;
  /** The branch the worktree will hold. */
  readonly headRefName: string;
  /** The branch the pull request targets. */
  readonly baseRefName: string;
  /** True under `--allow-local-config`. */
  readonly allowLocalConfig: boolean;
  /** Where the one warning line goes when the flag lets a config through. */
  readonly output: Pick<Output, 'warn'>;
}

/** The object id `spec` names, or null when git names none. */
function objectId(git: GitRunner, spec: string): string | null {
  const read = git(['rev-parse', '--verify', '--quiet', spec]);
  if (!read.ok) return null;
  const id = read.stdout.trim();
  return id === ''
    ? null
    : id;
}

/**
 * The ref the worktree for `branch` would hold: the local branch, then
 * `origin/<branch>`, or null when neither is a commit. See the module note.
 */
export function headRevision(git: GitRunner, branch: string): string | null {
  const candidates = [`refs/heads/${branch}`, `refs/remotes/${BASE_REMOTE}/${branch}`];
  return candidates.find((ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) ?? null;
}

/**
 * Every config file `head` holds that `origin/<base>` does not hold as
 * the same blob, in {@link CONFIG_CODE_FILES} order. Empty when the head
 * holds none, or holds each one as the base does.
 */
export function readConfigDrift(git: GitRunner, head: string, base: string): readonly ConfigDrift[] {
  const baseRef = `${BASE_REMOTE}/${base}`;
  return CONFIG_CODE_FILES.flatMap((file): ConfigDrift[] => {
    const headBlob = objectId(git, `${head}:${file}`);
    if (headBlob === null) return [];
    const baseBlob = objectId(git, `refs/remotes/${baseRef}:${file}`);
    if (baseBlob === headBlob) return [];
    return [{
      file,
      base: baseRef,
      reason: baseBlob === null
        ? 'absent'
        : 'differs',
    }];
  });
}

/** How one drift is said: the file and how it stands against the base. */
function driftPhrase(drift: ConfigDrift): string {
  return drift.reason === 'absent'
    ? `\`${drift.file}\`, which \`${drift.base}\` does not hold`
    : `\`${drift.file}\`, which differs from \`${drift.base}\`'s`;
}

/** The refusal for `drifts` on pull request `number`. */
export function configTrustRefusal(number: number, drifts: readonly ConfigDrift[]): string {
  const phrases = drifts.map(driftPhrase).join(' and ');
  return `❌ rafa pr triage --resolve refuses #${number}: its head carries ${phrases}.`
    + ' A config module is code rafa runs when the resolve loop starts in the worktree, so only the base\'s'
    + ' own copy is trusted and no worktree was added.'
    + ` Read the file, then pass \`--${ALLOW_LOCAL_CONFIG_FLAG}\` to run it anyway.`;
}

/** The one warning line a run let through by the flag prints. */
export function configTrustWarning(number: number, drifts: readonly ConfigDrift[]): string {
  const phrases = drifts.map(driftPhrase).join(' and ');
  return `⚠️ --${ALLOW_LOCAL_CONFIG_FLAG}: running #${number}'s ${phrases}.`;
}

/**
 * Refuses a resolve run whose head carries a config module the base
 * does not hold as the same blob, with exit {@link CONFIG_TRUST_REFUSE_EXIT};
 * under `--allow-local-config` warns once and lets it through. Called
 * before the worktree is added. See the module note.
 */
export function requireTrustedConfig(check: ConfigTrustCheck): void {
  const head = headRevision(check.git, check.headRefName);
  if (head === null) return;
  const drifts = readConfigDrift(check.git, head, check.baseRefName);
  if (drifts.length === 0) return;
  if (!check.allowLocalConfig) {
    throw new CommandExit(CONFIG_TRUST_REFUSE_EXIT, configTrustRefusal(check.number, drifts));
  }
  check.output.warn(configTrustWarning(check.number, drifts));
}
