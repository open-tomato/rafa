/**
 * Reading the local branches `rafa cleanup` may list: every branch
 * under `refs/heads/` with its upstream, whether that upstream is
 * `[gone]`, how many commits it is ahead of it and when it was last
 * committed to, less the branches the command never lists.
 *
 * This module prints nothing and deletes nothing. It answers data for
 * `./groups.ts` to classify, and it reaches git only through the
 * {@link GitRunner} it is handed, so a unit test scripts git's answers
 * rather than building a repository.
 *
 * ## One `for-each-ref` call
 *
 * Every field comes from a single `git for-each-ref refs/heads` whose
 * format is {@link BRANCH_FORMAT}: one line per branch, its fields
 * separated by a tab, which git refuses in a ref name
 * (`git check-ref-format` rejects every byte below 040), so no branch
 * name can shift a column. The current branch is read from the same
 * call, `%(HEAD)` being `*` on the branch checked out where git runs and
 * a space on every other; a detached HEAD marks none.
 *
 * Measured on git 2.50.1 (Apple Git-155) under macOS, 2026-09-24, in a
 * clone of a bare remote, with `%(upstream:track,nobracket)` as the
 * third field:
 *
 *   - a branch with no upstream answers an empty upstream AND an empty
 *     track;
 *   - a branch level with its upstream answers the upstream and an
 *     empty track;
 *   - a branch two commits past its upstream answers `ahead 2`, and one
 *     that is also behind answers `ahead 2, behind 1`;
 *   - a branch whose remote branch was deleted and then pruned answers
 *     its upstream, still named, and the track `gone`.
 *
 * `%(refname:lstrip=2)` is read rather than `%(refname:short)`, which
 * answers `heads/<name>` for a branch a tag of the same name makes
 * ambiguous.
 *
 * ## The never-listed set
 *
 * Three kinds of branch are dropped here, before any group sees them,
 * so no later reader can list one by mistake:
 *
 *   - the current branch, the `*` above;
 *   - the base branch, `pr.base` when it is set, else the branch the
 *     remote's `HEAD` names (`git symbolic-ref refs/remotes/origin/HEAD`),
 *     else {@link DEFAULT_BASE_BRANCH}, the base `rafa next` reads
 *     against where `pr.base` names none;
 *   - every branch a `cleanup.keep` pattern matches.
 *
 * A `cleanup.keep` pattern is matched with `Bun.Glob`, whose `*` stops
 * at a `/`. Measured on Bun 1.3.14: `release/*` matches `release/x` and
 * NOT `release/a/b`, which `release/**` matches. The config schema keeps
 * every pattern as written (`src/config-schema.ts`), and `Bun.Glob`
 * accepts every string (`src/schema/skill.ts`), so no pattern throws
 * here either.
 *
 * ## Why it answers rather than throws
 *
 * `rafa doctor` prints these counts beside every other row it reads, and
 * a repository git cannot read is a row there, not a crash. So a failed
 * `for-each-ref`, or a line this module cannot read, is answered as a
 * {@link BranchesUnread} naming what went wrong, the shape
 * {@link GitRunner} itself has.
 */
import type { GitRunner } from '../pr/git.js';

import { DEFAULT_BASE_BRANCH } from '../next/sources.js';
import { gitSaid } from '../pr/git.js';

/** The `for-each-ref` format every branch is read with; see the module note. */
export const BRANCH_FORMAT = [
  '%(refname:lstrip=2)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(committerdate:unix)',
  '%(HEAD)',
].join('%09');

/** The remote whose `HEAD` names the base when `pr.base` does not. */
const REMOTE = 'origin';

/** How many tab-separated fields {@link BRANCH_FORMAT} writes on each line. */
const FIELD_COUNT = 5;

/** Milliseconds in the second `%(committerdate:unix)` counts in. */
const MS_PER_SECOND = 1000;

/** The track git writes for an upstream whose remote branch is gone. */
const GONE_TRACK = 'gone';

/** One local branch, as `for-each-ref` described it. */
export interface LocalBranch {
  /** Its name, without `refs/heads/`. */
  readonly name: string;
  /** Its upstream as git abbreviates it (`origin/<name>`), or null when it has none. */
  readonly upstream: string | null;
  /** True when its upstream is set and git reports it `[gone]`. */
  readonly gone: boolean;
  /**
   * The commits it holds past its upstream, or null when there is no
   * upstream to count against: none set, or one that is gone.
   */
  readonly ahead: number | null;
  /** The committer date of its tip. */
  readonly lastCommit: Date;
}

/** The branches read, less the never-listed set, and the base they were read against. */
export interface BranchesRead {
  readonly ok: true;
  /** The base branch that was dropped, and the one the groups compare against. */
  readonly base: string;
  /** Every listable branch, in the order git wrote them (by name). */
  readonly branches: readonly LocalBranch[];
}

/** Git could not be read, or wrote a line this module could not read. */
export interface BranchesUnread {
  readonly ok: false;
  /** What went wrong, git's own words where it said any. */
  readonly detail: string;
}

/** What {@link readBranches} answers. Never a throw; see the module note. */
export type BranchesReading = BranchesRead | BranchesUnread;

/** What {@link readBranches} needs besides git. */
export interface BranchSettings {
  /** `pr.base`, or null when nobody has named one. */
  readonly base: string | null;
  /** `cleanup.keep`: glob patterns naming branches never listed. */
  readonly keep: readonly string[];
}

/**
 * The base branch: `configured` when it is set, else the branch
 * `origin`'s `HEAD` names, else {@link DEFAULT_BASE_BRANCH}. Runs git
 * only when `configured` is null.
 */
export function resolveBaseBranch(git: GitRunner, configured: string | null): string {
  if (configured !== null) {
    return configured;
  }
  const result = git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${REMOTE}/HEAD`]);
  const target = result.stdout.trim();
  const prefix = `${REMOTE}/`;
  if (!result.ok || !target.startsWith(prefix) || target.length === prefix.length) {
    return DEFAULT_BASE_BRANCH;
  }
  return target.slice(prefix.length);
}

/** True when `name` matches any of the `cleanup.keep` patterns. */
export function isKept(name: string, keep: readonly string[]): boolean {
  return keep.some((pattern) => new Bun.Glob(pattern).match(name));
}

/**
 * Every local branch `rafa cleanup` may list, read from one
 * `git for-each-ref` call, with the current branch, the base branch and
 * every `cleanup.keep` match dropped.
 */
export function readBranches(git: GitRunner, settings: BranchSettings): BranchesReading {
  const base = resolveBaseBranch(git, settings.base);
  const result = git(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads']);
  if (!result.ok) {
    const said = gitSaid(result);
    const detail = said === ''
      ? 'git for-each-ref failed'
      : `git for-each-ref failed: ${said}`;
    return { ok: false, detail };
  }

  const branches: LocalBranch[] = [];
  for (const line of result.stdout.split('\n')) {
    if (line === '') {
      continue;
    }
    const parsed = parseBranchLine(line);
    if (typeof parsed === 'string') {
      return { ok: false, detail: parsed };
    }
    if (!parsed.current && parsed.branch.name !== base && !isKept(parsed.branch.name, settings.keep)) {
      branches.push(parsed.branch);
    }
  }
  return { ok: true, base, branches };
}

/** One line of {@link BRANCH_FORMAT} output, and whether it is the current branch. */
export interface ParsedLine {
  readonly branch: LocalBranch;
  readonly current: boolean;
}

/**
 * Reads one line of {@link BRANCH_FORMAT} output, or answers why it
 * could not, naming the line.
 */
export function parseBranchLine(line: string): ParsedLine | string {
  const fields = line.split('\t');
  const [name = '', upstreamField = '', track = '', unix = '', head = ''] = fields;
  if (fields.length !== FIELD_COUNT || name === '') {
    return `git for-each-ref wrote a line with ${String(fields.length)} fields, expected ${String(FIELD_COUNT)}: ${JSON.stringify(line)}`;
  }
  const seconds = Number(unix);
  if (unix === '' || !Number.isInteger(seconds)) {
    return `git for-each-ref wrote no commit date for ${name}: ${JSON.stringify(unix)}`;
  }

  const lastCommit = new Date(seconds * MS_PER_SECOND);
  const current = head === '*';
  if (upstreamField === '') {
    return { current, branch: { name, upstream: null, gone: false, ahead: null, lastCommit } };
  }
  if (track === GONE_TRACK) {
    return { current, branch: { name, upstream: upstreamField, gone: true, ahead: null, lastCommit } };
  }
  return { current, branch: { name, upstream: upstreamField, gone: false, ahead: aheadOf(track), lastCommit } };
}

/** The `ahead N` count in a track such as `ahead 2, behind 1`, or 0 when it names none. */
function aheadOf(track: string): number {
  const count = /\bahead (\d+)/.exec(track)?.[1];
  if (count === undefined) {
    return 0;
  }
  return Number(count);
}
