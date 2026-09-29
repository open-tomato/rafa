/**
 * The fragments present in one git tree, in the order the base branch
 * received them: what `rafa release settle` and the forecast hand to the
 * fold.
 *
 * ## What "present" means
 *
 * The settled state is the set of fragments in the tree, never a commit
 * trailer: settle deletes what it folds, so whatever is still under
 * `release.fragments` in the base branch's tree is waiting. A fragment
 * is a blob directly in that directory whose name is `<id>.md`, the id
 * matching {@link FRAGMENT_PLAN_ID_PATTERN} — the names
 * `allocateFragmentName` (`./fragment.ts`) hands out. Anything else
 * there (a subdirectory, a file of another extension, a name with a
 * space) is not a fragment and is not listed. A directory the tree does
 * not hold is an empty list, not a problem: a project that never wrote
 * a fragment has nothing waiting.
 *
 * Each fragment's text is read out of the tree's blob and parsed, and
 * the {@link FragmentReading} is answered as it came, refusals
 * included, so a caller decides what a malformed fragment on the base
 * branch means for it rather than this reader silently dropping it.
 *
 * ## The order
 *
 * A fragment's add commit is the commit of the tree's FIRST-PARENT
 * history that added its path, compared against its first parent.
 * Measured on git 2.50.1 (2026-09-29): with `--first-parent` and
 * `--diff-merges=first-parent`, a fragment brought in by a `--no-ff`
 * merge is listed under the merge commit, not the branch commit that
 * wrote it — the merge is when the base branch received it. A squash or
 * a rebase merge is itself the first-parent commit that adds it.
 *
 * First add wins: the order is the position of the add commit in the
 * first-parent chain, oldest first, and neither a later edit of the
 * fragment nor the commit's date moves it. Dates are author- and
 * clock-controlled and need not rise along the chain; the chain's order
 * is what every device reads the same. Fragments added by one commit
 * are ordered by id, compared by code unit, so the order is total.
 *
 * A path settle deleted and a later plan wrote again is a new fragment:
 * its add commit is the add that began the life present in the tree,
 * which in a newest-first walk is the first add met — a delete must lie
 * between any older add and it.
 *
 * ## The add date
 *
 * {@link TreeFragment.addedOn} is the add commit's committer date in
 * UTC, `YYYY-MM-DD`: the date the commit landed, where the author date
 * would be when the branch commit was first written. It is committed
 * data, so the section's `{date}` never reads the clock.
 *
 * ## Git
 *
 * Every call is a read, through the `GitRunner` seam, run at the
 * repository root. The tree is resolved to one commit first, so
 * `origin/main` moving mid-read cannot mix two trees into one answer,
 * and every later argv names that hash rather than caller text.
 */
import type { FragmentReading } from './fragment.js';
import type { GitRunner } from '../pr/index.js';

import { posix } from 'node:path';

import { gitSaid } from '../pr/index.js';

import { FRAGMENT_EXTENSION, FRAGMENT_PLAN_ID_PATTERN, parseFragment } from './fragment.js';

/** One fragment present in the tree, with the commit that added it. */
export interface TreeFragment {
  /** The file name without `.md`, the id a receipt comment names. */
  readonly id: string;
  /** The path from the repository root, e.g. `.changes/rafa-247.md`. */
  readonly path: string;
  /** The full hash of the first-parent commit that added the fragment. */
  readonly commit: string;
  /** The add commit's committer date in UTC, `YYYY-MM-DD`. */
  readonly addedOn: string;
  /** The fragment's text as parsed, refusal included. */
  readonly reading: FragmentReading;
}

/** What {@link readFragmentTree} answers. */
export type FragmentTreeReading =
  | {
    readonly ok: true;
    /** The full hash of the commit the tree was read at. */
    readonly commit: string;
    /** The fragments present, in add order; see the module note. */
    readonly fragments: readonly TreeFragment[];
  }
  | {
    readonly ok: false;
    /** One sentence naming what could not be read, for a caller to print. */
    readonly problem: string;
  };

/** Separates the commits of the add log; git writes it for `%x01`. */
const RECORD_SEPARATOR = '\x01';

/** Terminates every field of `ls-tree -z` and `log -z`. */
const FIELD_TERMINATOR = '\0';

/** One `ls-tree` line: mode, type, object, then the path after a tab. */
const LS_TREE_ENTRY = /^\d+ (\w+) ([0-9a-f]+)\t(.+)$/s;

/** How many milliseconds a committer timestamp's second is. */
const MILLISECONDS_PER_SECOND = 1000;

/** How long `YYYY-MM-DD` is at the head of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** A blob named in the tree as a fragment, before its add is known. */
interface PresentFragment {
  readonly id: string;
  readonly path: string;
  readonly object: string;
}

/** One commit of the add log: its hash, date and the paths it added. */
interface AddRecord {
  readonly commit: string;
  readonly addedOn: string;
  readonly paths: readonly string[];
}

/** A failed reading of `what`, with what git said. */
function unread(what: string, said: string): FragmentTreeReading {
  return { ok: false, problem: `${what} could not be read: ${said}` };
}

/**
 * `directory` as a path prefix from the root: `./.changes/` and
 * `.changes` both answer `.changes/`, and the root itself answers ''.
 */
export function directoryPrefix(directory: string): string {
  const normal = posix.normalize(directory.replace(/\\/g, '/')).replace(/\/+$/, '');
  return normal === '.' || normal === ''
    ? ''
    : `${normal}/`;
}

/** The pathspec naming the fragments directory from the root. */
function pathspecOf(prefix: string): string {
  return prefix === ''
    ? '.'
    : prefix;
}

/** The id `name` carries as a fragment, or null when it is none. */
function fragmentIdOf(name: string): string | null {
  if (!name.endsWith(FRAGMENT_EXTENSION)) return null;
  const id = name.slice(0, -FRAGMENT_EXTENSION.length);
  return FRAGMENT_PLAN_ID_PATTERN.test(id)
    ? id
    : null;
}

/** The fragments `ls-tree -z` listed directly under `prefix`. */
function presentFragments(listing: string, prefix: string): readonly PresentFragment[] {
  return listing.split(FIELD_TERMINATOR).flatMap((line) => {
    const match = LS_TREE_ENTRY.exec(line);
    if (match === null) return [];
    const [, type, object, path] = match;
    if (type !== 'blob' || object === undefined || path === undefined) return [];
    const name = path.slice(prefix.length);
    const id = name.includes('/')
      ? null
      : fragmentIdOf(name);
    return id === null
      ? []
      : [{ id, path, object }];
  });
}

/** A committer timestamp in seconds, as a UTC `YYYY-MM-DD`, or null. */
function utcDateOf(seconds: string): string | null {
  const value = Number(seconds);
  if (!Number.isInteger(value)) return null;
  return new Date(value * MILLISECONDS_PER_SECOND)
    .toISOString()
    .slice(0, ISO_DATE_LENGTH);
}

/**
 * The add log's commits, newest first. A record is `<hash> <seconds>`,
 * then the paths the commit added, each ended by NUL; git starts the
 * first path on a new line.
 */
function addRecords(log: string): readonly AddRecord[] {
  return log.split(RECORD_SEPARATOR).flatMap((record) => {
    const [head = '', ...rest] = record.split(FIELD_TERMINATOR);
    const [commit, seconds = ''] = head.trim().split(' ');
    const addedOn = utcDateOf(seconds);
    if (commit === undefined || commit === '' || addedOn === null) return [];
    const paths = rest.map((path) => path.replace(/^\n/, '')).filter((path) => path !== '');
    return [{ commit, addedOn, paths }];
  });
}

/** A fragment and its add commit's index in the newest-first add log. */
interface PlacedFragment {
  readonly fragment: TreeFragment;
  readonly position: number;
}

/** Add order: the older add commit first, then by id within one commit. */
function byAddOrder(left: PlacedFragment, right: PlacedFragment): number {
  if (left.position !== right.position) return right.position - left.position;
  if (left.fragment.id === right.fragment.id) return 0;
  return left.fragment.id < right.fragment.id
    ? -1
    : 1;
}

/**
 * The fragments under `directory` in the tree of `tree` (a commit-ish
 * such as `origin/main` or `HEAD`), ordered by the first-parent commit
 * that added each, with that commit and its UTC date; see the module
 * note. `git` runs at the repository root and only reads.
 */
export function readFragmentTree(git: GitRunner, tree: string, directory: string): FragmentTreeReading {
  const resolved = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${tree}^{commit}`]);
  const commit = resolved.stdout.trim();
  if (!resolved.ok || commit === '') {
    return unread(`the tree of ${tree}`, gitSaid(resolved) || 'git names no such commit');
  }

  const prefix = directoryPrefix(directory);
  const pathspec = pathspecOf(prefix);
  const listing = git(['ls-tree', '-z', '--full-tree', commit, '--', pathspec]);
  if (!listing.ok) return unread(`the fragments of ${tree}`, gitSaid(listing));
  const present = presentFragments(listing.stdout, prefix);
  if (present.length === 0) return { ok: true, commit, fragments: [] };

  const log = git([
    'log', '--first-parent', '--diff-merges=first-parent', '--no-renames', '--diff-filter=A',
    `--format=${RECORD_SEPARATOR}%H %ct`, '--name-only', '-z', commit, '--', pathspec,
  ]);
  if (!log.ok) return unread(`the history of the fragments of ${tree}`, gitSaid(log));
  const records = addRecords(log.stdout);

  const placed: PlacedFragment[] = [];
  for (const fragment of present) {
    const position = records.findIndex((record) => record.paths.includes(fragment.path));
    const record = records[position];
    if (record === undefined) {
      return unread(`the add commit of ${fragment.path} in ${tree}`, 'no first-parent commit adds it');
    }
    const blob = git(['cat-file', 'blob', fragment.object]);
    if (!blob.ok) return unread(`${fragment.path} in ${tree}`, gitSaid(blob));
    placed.push({
      fragment: {
        id: fragment.id,
        path: fragment.path,
        commit: record.commit,
        addedOn: record.addedOn,
        reading: parseFragment(blob.stdout),
      },
      position,
    });
  }

  const fragments = [...placed]
    .sort(byAddOrder)
    .map(({ fragment }) => fragment);
  return { ok: true, commit, fragments };
}
