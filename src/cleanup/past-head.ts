/**
 * Reading what a branch holds past a merged pull request's head: for a
 * local branch whose tip DESCENDS from the head commit a merged pull
 * request carries, the commits between that head and the tip, and
 * whether deleting the branch would lose anything the base does not
 * already hold.
 *
 * A squash merge leaves the base unable to reach the branch, so
 * `git branch -d` refuses it, and a merged pull request at the tip is
 * what lets `./steps.ts` use `-D`. A branch the wrap-up committed
 * one release fragment to after its pull request's head was taken
 * (#710, #149) has neither: the base does not reach it, and its tip is
 * one commit past the head. This module answers what those commits are,
 * so the cleanup can tell a fragment the base already carries from work
 * nobody merged: `./groups.ts` reads it for a Merged row listed only
 * because its upstream is gone, and `./steps.ts` deletes that row with
 * `-D` only when every commit past the head is held.
 *
 * This module prints nothing and deletes nothing. It reaches git only
 * through the {@link GitRunner} it is handed, and every call is a read.
 *
 * ## Held
 *
 * A commit past the head is held when every path it touches is a
 * release fragment the base already holds. A fragment is a file
 * directly under `release.fragments` named `<id>.md`, the id matching
 * `FRAGMENT_PLAN_ID_PATTERN` (`fragmentIdOf` of
 * `../release/fragment-tree.ts`, the reader settle uses, so the two
 * cannot disagree about which file is a fragment). The base holds it
 * when either:
 *
 *   - the base branch's tree has a file at that path, a fragment still
 *     waiting to be settled; or
 *   - a `<!-- rafa:fragments … -->` receipt in the base's changelog
 *     (`release.changelog`) names its id, a fragment settle already
 *     folded and deleted. The receipts are read by `changelogSections`
 *     of `../release/receipt.ts`, the reader `rafa release tag` uses.
 *
 * Presence is what is compared, not content: a fragment edited after
 * the base received it reads as held. A base with no changelog holds
 * no receipt, which is not a failure.
 *
 * The paths a commit touches are `git diff-tree -r -m --name-only`'s.
 * With `-m` a merge commit lists its changes against EVERY parent
 * (measured on git 2.53.0, 2026-10-06: a `--no-ff` merge of a branch
 * adding `x.ts` into one adding `.changes/a.md` listed both), so a
 * merge of the base into the branch reads as not held, the safe way. A
 * commit touching no path (`--allow-empty`) loses nothing and is held,
 * and a tip equal to the head has no commit past it, so it counts zero
 * and is held.
 *
 * ## The head must be an ancestor of the tip
 *
 * `git merge-base --is-ancestor` answers it. Measured on git 2.53.0
 * (2026-10-06): exit 0 for an ancestor; exit 1 with nothing on stderr
 * for a commit that is not; exit 128 with
 * `fatal: Not a valid commit name <oid>` for a head the clone does not
 * have. A head the clone does not have cannot be an ancestor of a local
 * tip, so it is checked first with `git rev-parse --verify --quiet`
 * and answered {@link PastHeadNotDescended}, like a head that is there
 * and not an ancestor. Any other failure is {@link PastHeadUnread}.
 */
import type { GitResult, GitRunner } from '../pr/git.js';
import type { MergedPullRequest } from '../pr/types.js';

import { posix } from 'node:path';

import { gitSaid } from '../pr/git.js';
import { directoryPrefix, fragmentIdOf } from '../release/fragment-tree.js';
import { changelogSections } from '../release/receipt.js';

/** Terminates every path `diff-tree -z` and `ls-tree -z` write. */
const PATH_TERMINATOR = '\0';

/** Separates a commit's hash from its subject in the log format. */
const FIELD_SEPARATOR = '\t';

/** One commit past the head. */
export interface PastHeadCommit {
  /** Its full hash. */
  readonly hash: string;
  /** Its subject line. */
  readonly subject: string;
  /** Every path it touches, against every parent; see the module note. */
  readonly paths: readonly string[];
  /** True when every path is a fragment the base holds; see the module note. */
  readonly held: boolean;
}

/** The head is an ancestor of the tip: the commits past it, oldest first. */
export interface PastHeadRead {
  readonly kind: 'past-head';
  /** The merged pull request whose head the tip descends from. */
  readonly pullRequest: MergedPullRequest;
  /** How many commits the tip holds past the head; 0 when the tip is the head. */
  readonly count: number;
  /** The commits past the head, oldest first. */
  readonly commits: readonly PastHeadCommit[];
  /** True when every commit is held; true for a count of 0. */
  readonly held: boolean;
}

/** The head is not an ancestor of the tip, or the clone does not have it. */
export interface PastHeadNotDescended {
  readonly kind: 'not-descended';
}

/** Git could not be read. */
export interface PastHeadUnread {
  readonly kind: 'unread';
  /** What went wrong, git's own words where it said any. */
  readonly detail: string;
}

/** What {@link readPastHead} answers. Never a throw. */
export type PastHeadReading = PastHeadRead | PastHeadNotDescended | PastHeadUnread;

/** What {@link readPastHead} needs besides git, the branch and the pull request. */
export interface PastHeadSettings {
  /** The base branch, read as `refs/heads/<base>`. */
  readonly base: string;
  /** `release.fragments`, from the repository root. */
  readonly fragments: string;
  /** `release.changelog`, from the repository root. */
  readonly changelog: string;
}

/** One commit as `git log` listed it. */
interface LoggedCommit {
  readonly hash: string;
  readonly subject: string;
}

/** What the base holds: the fragment paths in its tree and the ids its receipts name. */
interface BaseHolding {
  readonly paths: ReadonlySet<string>;
  readonly receiptIds: ReadonlySet<string>;
}

/** An unread answer naming the git command that failed and what git said. */
function unread(command: string, result: GitResult): PastHeadUnread {
  const said = gitSaid(result);
  return {
    kind: 'unread',
    detail: said === ''
      ? `git ${command} failed`
      : `git ${command} failed: ${said}`,
  };
}

/** NUL-terminated output as its non-empty entries. */
function terminated(output: string): readonly string[] {
  return output.split(PATH_TERMINATOR).filter((entry) => entry !== '');
}

/**
 * Whether `head` is an ancestor of `tip`: true, false, or the failure.
 * A head the clone lacks is false; see the module note.
 */
function isAncestor(git: GitRunner, head: string, tip: string): boolean | PastHeadUnread {
  if (!git(['rev-parse', '--verify', '--quiet', `${head}^{commit}`]).ok) {
    return false;
  }
  const result = git(['merge-base', '--is-ancestor', head, tip]);
  if (result.ok) {
    return true;
  }
  return result.stderr.trim() === ''
    ? false
    : unread('merge-base --is-ancestor', result);
}

/** The ids every receipt of `changelog` on `baseRef` names; none when it has no changelog. */
function receiptIds(git: GitRunner, baseRef: string, changelog: string): ReadonlySet<string> | PastHeadUnread {
  const path = posix.normalize(changelog.replace(/\\/g, '/'));
  const listed = git(['ls-tree', '-z', '--name-only', baseRef, '--', path]);
  if (!listed.ok) {
    return unread('ls-tree', listed);
  }
  if (!terminated(listed.stdout).includes(path)) {
    return new Set();
  }
  const shown = git(['cat-file', 'blob', `${baseRef}:${path}`]);
  if (!shown.ok) {
    return unread('cat-file', shown);
  }
  return new Set(changelogSections(shown.stdout).flatMap((section) => section.receipt ?? []));
}

/** What the base holds, read off `baseRef`'s tree and changelog. */
function readBaseHolding(git: GitRunner, baseRef: string, settings: PastHeadSettings): BaseHolding | PastHeadUnread {
  const prefix = directoryPrefix(settings.fragments);
  const listed = git(['ls-tree', '-r', '-z', '--name-only', baseRef, '--', prefix === ''
    ? '.'
    : prefix]);
  if (!listed.ok) {
    return unread('ls-tree', listed);
  }
  const ids = receiptIds(git, baseRef, settings.changelog);
  if ('kind' in ids) {
    return ids;
  }
  return { paths: new Set(terminated(listed.stdout)), receiptIds: ids };
}

/** True when `path` is a fragment directly under `prefix` that `holding` holds. */
function isHeldFragment(path: string, prefix: string, holding: BaseHolding): boolean {
  if (!path.startsWith(prefix)) {
    return false;
  }
  const name = path.slice(prefix.length);
  const id = name.includes('/')
    ? null
    : fragmentIdOf(name);
  if (id === null) {
    return false;
  }
  return holding.paths.has(path) || holding.receiptIds.has(id);
}

/** The commits in `range`, oldest first, as hash and subject. */
function commitsIn(git: GitRunner, range: string): readonly LoggedCommit[] | PastHeadUnread {
  const logged = git(['log', '--reverse', `--format=%H${FIELD_SEPARATOR}%s`, range, '--']);
  if (!logged.ok) {
    return unread('log', logged);
  }
  return logged.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const at = line.indexOf(FIELD_SEPARATOR);
      return at === -1
        ? { hash: line, subject: '' }
        : { hash: line.slice(0, at), subject: line.slice(at + 1) };
    });
}

/**
 * For `branch` and a merged pull request, the commits past the pull
 * request's head commit and whether each is held, or
 * {@link PastHeadNotDescended} when the head is not an ancestor of the
 * branch's tip. See the module note for what held means.
 */
export function readPastHead(
  git: GitRunner,
  branch: string,
  pullRequest: MergedPullRequest,
  settings: PastHeadSettings,
): PastHeadReading {
  const tip = `refs/heads/${branch}`;
  const descends = isAncestor(git, pullRequest.headRefOid, tip);
  if (descends === false) {
    return { kind: 'not-descended' };
  }
  if (descends !== true) {
    return descends;
  }

  const listed = commitsIn(git, `${pullRequest.headRefOid}..${tip}`);
  if ('kind' in listed) {
    return listed;
  }
  if (listed.length === 0) {
    return { kind: 'past-head', pullRequest, count: 0, commits: [], held: true };
  }

  const holding = readBaseHolding(git, `refs/heads/${settings.base}`, settings);
  if ('kind' in holding) {
    return holding;
  }
  const prefix = directoryPrefix(settings.fragments);
  const commits: PastHeadCommit[] = [];
  for (const { hash, subject } of listed) {
    const touched = git(['diff-tree', '-r', '-m', '--no-commit-id', '--name-only', '-z', hash]);
    if (!touched.ok) {
      return unread('diff-tree', touched);
    }
    const paths = [...new Set(terminated(touched.stdout))];
    const held = paths.every((path) => isHeldFragment(path, prefix, holding));
    commits.push({ hash, subject, paths, held });
  }
  return {
    kind: 'past-head',
    pullRequest,
    count: commits.length,
    commits,
    held: commits.every((each) => each.held),
  };
}
