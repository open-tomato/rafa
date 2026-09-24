/**
 * Sorting the branches `./branches.ts` read into the three branch
 * groups of `rafa cleanup` — Merged, Stale and Not pushed — each row
 * carrying the reason it is listed and whether it starts ticked.
 *
 * This module prints nothing and deletes nothing. It reaches git only
 * through the {@link GitRunner} it is handed and the pull request
 * provider only through {@link readProviderMerges}, so a unit test
 * scripts both.
 *
 * ## The groups
 *
 * The spec's Design table, applied to each branch in this order, the
 * first that holds deciding:
 *
 *   1. **Merged**, ticked: `git branch --merged refs/heads/<base>` lists
 *      it; OR the provider answers a merged pull request whose head is
 *      the branch AND whose head commit is the branch's tip; OR its
 *      upstream reads `[gone]`. Every reading that holds is kept on the
 *      row ({@link MergedRow.mergedBy}) and in its reason, because the
 *      delete step picks `-d` or `-D` from them: a squash merge is not
 *      reachable, so `-d` refuses it, and `-D` is allowed only for the
 *      pull request whose head commit IS the tip.
 *   2. **Not pushed**, unticked: no upstream, or commits ahead of it.
 *      The row carries how many commits deleting it would lose
 *      ({@link NotPushedRow.commits}). It is decided before Stale so a
 *      stale branch holding commits no remote has goes through the
 *      question naming that count rather than past it.
 *   3. **Stale**, unticked: an upstream, and a last commit older than
 *      `cleanup.staleDays`.
 *
 * A branch none of them holds for — pushed, level with its upstream,
 * committed to recently — is somebody's current work and is not listed.
 *
 * ## The provider's reading, and its two absences
 *
 * The tip must equal the pull request's head commit because a pull
 * request names its head by BRANCH NAME, and a name is reused: a new
 * `feature` started after an old `feature` merged would otherwise read
 * as merged and be ticked. When a merged pull request names the branch
 * at another commit, the row stays where git puts it and its reason
 * says so.
 *
 * With no provider (`pr.provider: none`), every Stale and Not-pushed
 * row says {@link MERGED_STATE_UNKNOWN}: those are exactly the rows a
 * squash merge would have moved to Merged. With a provider that could
 * not be read, the rows say nothing more and the reading carries ONE
 * note, {@link unreachableNote}, so the command still runs from git
 * alone and says so once.
 *
 * ## The commit count
 *
 * `git rev-list --count refs/heads/<b> --not --remotes refs/heads/<base>`:
 * the commits on the branch that no remote-tracking branch and not the
 * base hold. Measured on git 2.50.1 (Apple Git-155), 2026-09-24, in a
 * clone whose local `main` was one commit past `origin/main`: a branch
 * merged into that local `main` counted 1 without the base and 0 with
 * it, so the base is excluded — the command never deletes the base, so
 * a commit on it is not lost. The count is NOT the upstream's `ahead`:
 * a commit another remote branch already holds is not lost either.
 *
 * ## When the base cannot be read
 *
 * `git branch --merged refs/heads/nope` exits 128 with
 * `fatal: malformed object name refs/heads/nope` (same reading). That is
 * an ordinary state — `origin/HEAD` unset, the base falling back to a
 * `main` a `master` repository lacks — so it is a note, not a failure:
 * no branch is Merged by reachability, the count runs without the base,
 * and every other reading still applies. Both directions of that are
 * the safe one: a merged branch lands unticked.
 *
 * Any other git failure answers {@link BranchGroupsUnread}, the shape
 * `./branches.ts` answers, so `rafa doctor` prints a row rather than
 * crashing.
 */
import type { BranchesRead, BranchesUnread, LocalBranch } from './branches.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { MergedPullRequest, PullRequests } from '../pr/types.js';

import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/git.js';

/** The wording every Stale and Not-pushed row carries when no provider is configured. */
export const MERGED_STATE_UNKNOWN = 'merged state unknown';

/** Milliseconds in one of the days `cleanup.staleDays` counts. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Which of the three branch groups a row is in. */
export type BranchGroup = 'merged' | 'stale' | 'not-pushed';

/**
 * One reading that makes a branch Merged: reachable from the base, a
 * merged pull request at its tip, or an upstream that is gone.
 */
export type MergedBy = 'base' | 'pull-request' | 'gone';

/** What every branch row carries. */
interface RowFields {
  /** The branch as `./branches.ts` read it. */
  readonly branch: LocalBranch;
  /** Why it is listed, one line, without the name or the date. */
  readonly reason: string;
}

/** A branch in Merged: ticked by default. */
export interface MergedRow extends RowFields {
  readonly group: 'merged';
  readonly ticked: true;
  /** Every reading that holds, in the order of {@link MergedBy}; never empty. */
  readonly mergedBy: readonly MergedBy[];
  /** The merged pull request whose head commit is the tip, or null when none is. */
  readonly pullRequest: MergedPullRequest | null;
}

/** A branch in Stale: unticked by default. */
export interface StaleRow extends RowFields {
  readonly group: 'stale';
  readonly ticked: false;
  /** Whole days since its last commit. */
  readonly idleDays: number;
}

/** A branch in Not pushed: unticked by default, and asked about again when ticked. */
export interface NotPushedRow extends RowFields {
  readonly group: 'not-pushed';
  readonly ticked: false;
  /** The commits deleting it would lose; see the module note. */
  readonly commits: number;
}

/** One listed branch. */
export type BranchRow = MergedRow | StaleRow | NotPushedRow;

/**
 * What the pull request provider said about merges: nothing configured,
 * configured but unreadable, or the merged pull requests it answered.
 */
export type ProviderMerges =
  | { readonly state: 'none' }
  | { readonly state: 'unreachable'; readonly detail: string }
  | { readonly state: 'read'; readonly pullRequests: readonly MergedPullRequest[] };

/** What {@link classifyBranches} needs besides git and the provider. */
export interface GroupSettings {
  /** `cleanup.staleDays`. */
  readonly staleDays: number;
  /** The clock, read once by the caller. */
  readonly now: Date;
}

/** The three branch groups, each in the order the branches were read. */
export interface BranchGroups {
  readonly ok: true;
  /** The base the groups were read against. */
  readonly base: string;
  readonly merged: readonly MergedRow[];
  readonly stale: readonly StaleRow[];
  readonly notPushed: readonly NotPushedRow[];
  /** One-line notes about readings that could not be taken; empty when all were. */
  readonly notes: readonly string[];
}

/** Git failed in a way the groups cannot be read past. */
export type BranchGroupsUnread = BranchesUnread;

/** What {@link classifyBranches} answers. Never a throw. */
export type BranchGroupsReading = BranchGroups | BranchGroupsUnread;

/** The one line saying the provider could not be read and git alone decided. */
export function unreachableNote(detail: string): string {
  return `pull request provider unreachable (${detail}); merged pull requests not read, grouped from git alone`;
}

/** The one line saying which branches are merged into the base could not be read. */
export function baseUnreadNote(base: string, detail: string): string {
  return `could not read which branches are merged into ${base} (${detail}); none is listed as merged into it`;
}

/**
 * Asks `pulls` for its merged pull requests. Null — no provider
 * configured — answers `none`; a provider that throws answers
 * `unreachable` with the first line of what it said. Never rejects.
 */
export async function readProviderMerges(pulls: PullRequests | null): Promise<ProviderMerges> {
  if (pulls === null) {
    return { state: 'none' };
  }
  try {
    return { state: 'read', pullRequests: await pulls.listMerged() };
  } catch (error) {
    return { state: 'unreachable', detail: firstLine(messageOf(error)) };
  }
}

/**
 * Sorts `read`'s branches into Merged, Stale and Not pushed by the
 * rules in the module note, running `git branch --merged` once, a tip
 * read when a merged pull request names a listed branch, and one
 * `rev-list --count` per Not-pushed branch.
 */
export function classifyBranches(
  git: GitRunner,
  read: BranchesRead,
  provider: ProviderMerges,
  settings: GroupSettings,
): BranchGroupsReading {
  const notes: string[] = provider.state === 'unreachable'
    ? [unreachableNote(provider.detail)]
    : [];

  const baseRef = `refs/heads/${read.base}`;
  const mergedRead = git(['branch', '--merged', baseRef, '--format=%(refname:lstrip=2)']);
  const reachable = new Set(mergedRead.ok
    ? lines(mergedRead.stdout)
    : []);
  if (!mergedRead.ok) {
    notes.push(baseUnreadNote(read.base, failure('git branch --merged', mergedRead)));
  }

  const named = provider.state === 'read'
    ? namedPullRequests(provider.pullRequests, read.branches)
    : new Map<string, readonly MergedPullRequest[]>();
  const tips = readTips(git, named);
  if (typeof tips === 'string') {
    return { ok: false, detail: tips };
  }

  const merged: MergedRow[] = [];
  const stale: StaleRow[] = [];
  const notPushed: NotPushedRow[] = [];
  const context: RowContext = {
    unknown: provider.state === 'none',
    exclude: mergedRead.ok
      ? [baseRef]
      : [],
  };
  for (const branch of read.branches) {
    const pulls = named.get(branch.name) ?? [];
    const atTip = pulls.find((pull) => pull.headRefOid === tips.get(branch.name)) ?? null;
    const mergedBy = mergedReadings(branch, reachable.has(branch.name), atTip);
    if (mergedBy.length > 0) {
      merged.push(mergedRow(branch, mergedBy, atTip, read.base));
      continue;
    }
    const suffix = rowSuffix(context, pulls[0] ?? null);
    if (branch.upstream === null || (branch.ahead ?? 0) > 0) {
      const commits = countLost(git, branch.name, context.exclude);
      if (typeof commits === 'string') {
        return { ok: false, detail: commits };
      }
      notPushed.push(notPushedRow(branch, commits, suffix));
      continue;
    }
    const age = settings.now.getTime() - branch.lastCommit.getTime();
    if (age > settings.staleDays * MS_PER_DAY) {
      const idleDays = Math.floor(age / MS_PER_DAY);
      stale.push({ group: 'stale', branch, ticked: false, idleDays, reason: `no commit in ${plural(idleDays, 'day')}${suffix}` });
    }
  }
  return { ok: true, base: read.base, merged, stale, notPushed, notes };
}

/** What every unmerged row's reason and count read from. */
interface RowContext {
  /** True when no provider is configured, so the merged state is unknown. */
  readonly unknown: boolean;
  /** The refs whose commits a Not-pushed count does not count as lost. */
  readonly exclude: readonly string[];
}

/** The merged pull requests naming each listed branch, newest created first. */
function namedPullRequests(
  pullRequests: readonly MergedPullRequest[],
  branches: readonly LocalBranch[],
): Map<string, readonly MergedPullRequest[]> {
  const listed = new Set(branches.map((branch) => branch.name));
  const named = new Map<string, readonly MergedPullRequest[]>();
  for (const pull of pullRequests) {
    if (listed.has(pull.headRefName)) {
      named.set(pull.headRefName, [...(named.get(pull.headRefName) ?? []), pull]);
    }
  }
  return named;
}

/**
 * The tip of every branch a merged pull request names, from one
 * `for-each-ref` call, or why it could not be read. Runs no git when no
 * branch is named.
 */
function readTips(
  git: GitRunner,
  named: ReadonlyMap<string, readonly MergedPullRequest[]>,
): Map<string, string> | string {
  const tips = new Map<string, string>();
  if (named.size === 0) {
    return tips;
  }
  const result = git(['for-each-ref', '--format=%(refname:lstrip=2)%09%(objectname)', 'refs/heads']);
  if (!result.ok) {
    return failure('git for-each-ref', result);
  }
  for (const line of lines(result.stdout)) {
    const [name = '', oid = ''] = line.split('\t');
    tips.set(name, oid);
  }
  return tips;
}

/** The readings that make `branch` Merged, in {@link MergedBy} order. */
function mergedReadings(
  branch: LocalBranch,
  reachable: boolean,
  atTip: MergedPullRequest | null,
): MergedBy[] {
  const readings: MergedBy[] = [];
  if (reachable) {
    readings.push('base');
  }
  if (atTip !== null) {
    readings.push('pull-request');
  }
  if (branch.gone) {
    readings.push('gone');
  }
  return readings;
}

/** A Merged row, its reason naming every reading that holds. */
function mergedRow(
  branch: LocalBranch,
  mergedBy: readonly MergedBy[],
  pullRequest: MergedPullRequest | null,
  base: string,
): MergedRow {
  const reasons = mergedBy.map((by) => {
    if (by === 'base') {
      return `merged into ${base}`;
    }
    if (by === 'pull-request') {
      return `pull request #${String(pullRequest?.number)} merged`;
    }
    return `upstream ${String(branch.upstream)} is gone`;
  });
  return { group: 'merged', branch, ticked: true, mergedBy, pullRequest, reason: reasons.join('; ') };
}

/** A Not-pushed row, its reason naming why and how many commits would be lost. */
function notPushedRow(branch: LocalBranch, commits: number, suffix: string): NotPushedRow {
  const why = branch.upstream === null
    ? 'no upstream'
    : `${String(branch.ahead)} ahead of ${branch.upstream}`;
  const reason = `${why}; ${plural(commits, 'commit')} not on any remote${suffix}`;
  return { group: 'not-pushed', branch, ticked: false, commits, reason };
}

/**
 * What an unmerged row's reason ends with: the merged state being
 * unknown, or a merged pull request naming the branch at another commit.
 */
function rowSuffix(context: RowContext, elsewhere: MergedPullRequest | null): string {
  if (context.unknown) {
    return `; ${MERGED_STATE_UNKNOWN}`;
  }
  if (elsewhere !== null) {
    return `; pull request #${String(elsewhere.number)} merged at another commit`;
  }
  return '';
}

/** The commits on `name` no remote and no excluded ref holds, or why git could not say. */
function countLost(git: GitRunner, name: string, exclude: readonly string[]): number | string {
  const result = git(['rev-list', '--count', `refs/heads/${name}`, '--not', '--remotes', ...exclude, '--']);
  const count = Number(result.stdout.trim());
  if (!result.ok || result.stdout.trim() === '' || !Number.isInteger(count)) {
    return failure(`git rev-list --count ${name}`, result);
  }
  return count;
}

/** `git <what> failed`, with what git said when it said anything. */
function failure(what: string, result: GitResult): string {
  const said = firstLine(gitSaid(result));
  return said === ''
    ? `${what} failed`
    : `${what} failed: ${said}`;
}

/** `1 day`, `2 days`. */
function plural(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${noun}s`;
}

/** The non-empty lines of `text`. */
function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

/** The first non-empty line of `text`, trimmed, so a note stays one line. */
function firstLine(text: string): string {
  return text.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
}
