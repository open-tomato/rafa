/**
 * Reading the worktrees `rafa cleanup` may list: every checkout
 * `git worktree list --porcelain` names under `<repo>/.claude/worktrees/`
 * or `<home>/.rafa/worktrees/`, each marked with whether it may be
 * ticked, why not when it may not, and whether it starts ticked.
 *
 * This module prints nothing and removes nothing. It reaches git only
 * through the runners it is handed, the session records only through
 * {@link WorktreeSeams.sessions} and the disk only through
 * {@link WorktreeSeams.modifiedAt} and {@link WorktreeSeams.realPath},
 * so a unit test scripts every reading.
 *
 * ## Which worktrees are listed
 *
 * The two directories worktrees are made in on a person's behalf:
 * Claude Code's `<repo>/.claude/worktrees/<name>`, and
 * `rafa pr triage --resolve`'s `<home>/.rafa/worktrees/pr-<n>`
 * (`WORKTREES_SUBDIR`, `src/pr/worktree.ts`). `<repo>` is the main
 * worktree, the block git lists first, so the reading is the same from
 * whichever checkout the command runs in. Any other checkout is somebody's
 * own and is not listed.
 *
 * Git writes each path resolved — `/private/var/...` for a macOS
 * temporary directory spelled `/var/...` (`src/pr/merge.ts`'s note) —
 * so the home and the working directory are compared through
 * {@link WorktreeSeams.realPath}, in both spellings.
 *
 * ## What makes a worktree untickable
 *
 * Every rule that holds is kept on the row ({@link WorktreeRow.blockers}),
 * not just the first, so the row says everything standing in the way:
 *
 *   - **dirty**: `git status` lists an uncommitted change or an untracked
 *     file. Ignored files, such as `node_modules/`, do not count, which
 *     is also what `git worktree remove` without `--force` refuses on.
 *   - **locked**: its block carries a `locked` line, with or without a
 *     reason after it.
 *   - **current**: the command's working directory is the worktree or a
 *     directory inside it.
 *   - **session**: a loop session record reads `running` or `paused`
 *     (`readState`, `src/loop/sessions.ts`: a pid that is gone reads
 *     `stopped`) and is either kept under the worktree's own
 *     `.rafa/runs/`, or kept under the project root's and names the
 *     worktree's branch. The second is the common case: `.rafa/` is
 *     untracked, so a loop started inside a `.claude/worktrees/` checkout
 *     walks up to the main checkout's config and records there, and git
 *     checks one branch out in one worktree only, so the branch names
 *     the checkout.
 *   - **recent**: it was modified within `cleanup.worktreeIdleDays`; see
 *     below.
 *   - **unreadable**: one of the readings above could not be taken. A
 *     rule that cannot be read is a rule that may hold, so the worktree
 *     is kept rather than guessed clean.
 *
 * A worktree nothing blocks is ticked by default only when its branch is
 * in Merged ({@link WorktreeRead.mergedBranches}); a detached one never
 * is.
 *
 * ## What "modified" reads
 *
 * The newest modification time among the worktree's directory and three
 * files of its administrative directory (`git rev-parse
 * --absolute-git-dir`): `HEAD`, which a checkout rewrites, `logs/HEAD`,
 * which every commit, checkout and reset appends to, and `index`, which
 * an add and a status refresh rewrite. Walking every file of the
 * checkout would also catch an edit, but an edit leaves the worktree
 * dirty, which blocks it already.
 *
 * Those times are read BEFORE the status, and the status runs as
 * `git --no-optional-locks status`, because a plain status rewrites the
 * index. Measured on git 2.50.1 (Apple Git-155), 2026-09-24, in a linked
 * worktree whose `index` and one tracked file were dated 2026-01-01: a
 * plain `git status --porcelain` moved the index's time to the moment
 * it ran, while `--no-optional-locks` left it at 2026-01-01. Without
 * both, reading a worktree would make it recent.
 *
 * ## Why it answers rather than throws
 *
 * As `./branches.ts` explains, `rafa doctor` prints these counts beside
 * every other row it reads. A `git worktree list` git refuses answers
 * {@link WorktreesUnread}; a failure reading one worktree is that
 * worktree's `unreadable` blocker.
 */
import type { SessionRecord } from '../loop/sessions.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { messageOf } from '../config-sections.js';
import { readSessions, runsDir } from '../loop/sessions.js';
import { createGitRunner, gitSaid } from '../pr/git.js';
import { parseWorktrees } from '../pr/merge.js';
import { WORKTREES_SUBDIR } from '../pr/worktree.js';

/** Where under the repository Claude Code makes its worktrees. */
export const CLAUDE_WORKTREES_SUBDIR = join('.claude', 'worktrees');

/** The argv the worktrees are listed with. */
export const WORKTREE_LIST = Object.freeze(['worktree', 'list', '--porcelain']);

/** The argv a worktree's administrative directory is read with. */
export const GIT_DIR = Object.freeze(['rev-parse', '--absolute-git-dir']);

/** The argv a worktree's changes are read with; see the module note. */
export const WORKTREE_STATUS = Object.freeze([
  '--no-optional-locks',
  'status',
  '--porcelain=v1',
  '--untracked-files=all',
]);

/** The files of the administrative directory whose times count as modifying it. */
export const ADMIN_FILES = Object.freeze(['HEAD', join('logs', 'HEAD'), 'index']);

/** Milliseconds in one of the days `cleanup.worktreeIdleDays` counts. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** What a porcelain status line opens with for an untracked file. */
const UNTRACKED_MARK = '?? ';

/** The line a locked worktree's block carries, alone or before its reason. */
const LOCKED_LINE = 'locked';

/** The session states a live loop reads as. */
const LIVE_STATES: ReadonlySet<string> = new Set(['running', 'paused']);

/** Which rule makes a worktree untickable; see the module note. */
export type WorktreeBlockKind = 'dirty' | 'locked' | 'current' | 'session' | 'recent' | 'unreadable';

/** One rule that holds for a worktree, and the words its row shows. */
export interface WorktreeBlocker {
  readonly kind: WorktreeBlockKind;
  /** One line, without the path. */
  readonly reason: string;
}

/** One listed worktree. */
export interface WorktreeRow {
  /** Its path, as git resolved it. */
  readonly path: string;
  /** The branch it holds, or null when it is detached. */
  readonly branch: string | null;
  /** When it was last modified, or null when that could not be read. */
  readonly lastModified: Date | null;
  /** True when its branch is in Merged. */
  readonly branchMerged: boolean;
  /** Every rule that holds, in {@link WorktreeBlockKind} order; empty when it may be ticked. */
  readonly blockers: readonly WorktreeBlocker[];
  /** True when nothing blocks it. */
  readonly tickable: boolean;
  /** True when it may be ticked and its branch is in Merged. */
  readonly ticked: boolean;
  /** One line: the blockers when there are any, else its state. */
  readonly reason: string;
}

/** The worktrees read, in the order git listed them. */
export interface WorktreesRead {
  readonly ok: true;
  readonly worktrees: readonly WorktreeRow[];
}

/** Git could not list the worktrees. */
export interface WorktreesUnread {
  readonly ok: false;
  /** What went wrong, git's own words where it said any. */
  readonly detail: string;
}

/** What {@link readWorktrees} answers. Never a throw. */
export type WorktreesReading = WorktreesRead | WorktreesUnread;

/** What {@link readWorktrees} reads through; {@link defaultWorktreeSeams} for the real ones. */
export interface WorktreeSeams {
  /** Git in the directory the command runs from. */
  readonly git: GitRunner;
  /** Git in another directory: a listed worktree. */
  readonly gitAt: (dir: string) => GitRunner;
  /** The session records under a root, each with the state it reads as. May throw. */
  readonly sessions: (root: string) => readonly SessionRecord[];
  /** A path's modification time, or null when it cannot be read. */
  readonly modifiedAt: (path: string) => Date | null;
  /** A path with every link followed, or the path as given when it does not resolve. */
  readonly realPath: (path: string) => string;
}

/** What {@link readWorktrees} needs besides its seams. */
export interface WorktreeRead {
  /** The home directory `~/.rafa/worktrees/` is under. */
  readonly home: string;
  /** The directory the command runs from. */
  readonly cwd: string;
  /** The project root whose `.rafa/runs/` holds the loop's session records. */
  readonly projectRoot: string;
  /** `cleanup.worktreeIdleDays`. */
  readonly idleDays: number;
  /** The clock, read once by the caller. */
  readonly now: Date;
  /** The names of the branches in Merged. */
  readonly mergedBranches: readonly string[];
}

/** The seams over the real git, session records and disk, git run where `cwd` names. */
export function defaultWorktreeSeams(cwd: string): WorktreeSeams {
  return {
    git: createGitRunner(cwd),
    gitAt: createGitRunner,
    sessions: (root) => readSessions(root),
    modifiedAt: (path) => {
      try {
        return statSync(path).mtime;
      } catch {
        return null;
      }
    },
    realPath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    },
  };
}

/**
 * Every worktree under `<repo>/.claude/worktrees/` or
 * `<home>/.rafa/worktrees/`, each marked by the rules in the module
 * note.
 */
export function readWorktrees(seams: WorktreeSeams, read: WorktreeRead): WorktreesReading {
  const listed = seams.git(WORKTREE_LIST);
  if (!listed.ok) {
    return { ok: false, detail: failure('git worktree list', listed) };
  }
  const entries = parseWorktrees(listed.stdout);
  const main = entries[0]?.path;
  if (main === undefined) {
    return { ok: true, worktrees: [] };
  }

  const roots = [
    ...pathForms(seams, join(main, CLAUDE_WORKTREES_SUBDIR)),
    ...pathForms(seams, join(read.home, WORKTREES_SUBDIR)),
  ];
  const locks = parseLocks(listed.stdout);
  const context: RowContext = {
    seams,
    read,
    cwd: pathForms(seams, read.cwd),
    projectSessions: readLive(seams, read.projectRoot),
    merged: new Set(read.mergedBranches),
  };
  const worktrees = entries.slice(1)
    .filter((entry) => roots.some((root) => isInside(entry.path, root)))
    .map((entry) => worktreeRow(context, entry.path, entry.branch, locks.get(entry.path) ?? null));
  return { ok: true, worktrees };
}

/**
 * The lock reason of every locked worktree in `git worktree list
 * --porcelain` output, keyed by its path: empty for a lock with no
 * reason. A worktree that is not locked is absent.
 */
export function parseLocks(stdout: string): ReadonlyMap<string, string> {
  const locks = new Map<string, string>();
  let path: string | null = null;
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length).trim();
      continue;
    }
    if (path !== null && (line === LOCKED_LINE || line.startsWith(`${LOCKED_LINE} `))) {
      locks.set(path, line.slice(LOCKED_LINE.length).trim());
    }
  }
  return locks;
}

/**
 * The uncommitted and untracked paths of `git status --porcelain=v1`
 * output, counted apart.
 */
export function countChanges(stdout: string): { readonly changed: number; readonly untracked: number } {
  const entries = stdout.split('\n').filter((line) => line.trim() !== '');
  const untracked = entries.filter((line) => line.startsWith(UNTRACKED_MARK)).length;
  return { changed: entries.length - untracked, untracked };
}

/** What every row is read against. */
interface RowContext {
  readonly seams: WorktreeSeams;
  readonly read: WorktreeRead;
  /** The command's working directory, in both spellings. */
  readonly cwd: readonly string[];
  /** The live sessions under the project root, or why they could not be read. */
  readonly projectSessions: readonly SessionRecord[] | string;
  readonly merged: ReadonlySet<string>;
}

/** One worktree's row. */
function worktreeRow(context: RowContext, path: string, branch: string | null, lock: string | null): WorktreeRow {
  const { seams, read } = context;
  const git = seams.gitAt(path);
  const modified = lastModified(seams, git, path);
  const blockers: WorktreeBlocker[] = [];

  blockers.push(...dirtyBlockers(git));
  if (lock !== null) {
    const reason = lock === ''
      ? LOCKED_LINE
      : `${LOCKED_LINE}: ${lock}`;
    blockers.push({ kind: 'locked', reason });
  }
  if (context.cwd.some((dir) => dir === path || isInside(dir, path))) {
    blockers.push({ kind: 'current', reason: 'rafa cleanup runs from it' });
  }
  blockers.push(...sessionBlockers(context, path, branch));
  blockers.push(...recentBlockers(modified, read));

  const ordered = orderBlockers(blockers);
  const branchMerged = branch !== null && context.merged.has(branch);
  const tickable = ordered.length === 0;
  return {
    path,
    branch,
    lastModified: typeof modified === 'string'
      ? null
      : modified,
    branchMerged,
    blockers: ordered,
    tickable,
    ticked: tickable && branchMerged,
    reason: rowReason(ordered, branch, branchMerged),
  };
}

/**
 * The newest time among the worktree's directory and its
 * {@link ADMIN_FILES}, or why it could not be read. Runs before the
 * status; see the module note.
 */
function lastModified(seams: WorktreeSeams, git: GitRunner, path: string): Date | string {
  const gitDir = git(GIT_DIR);
  const adminDir = gitDir.stdout.trim();
  if (!gitDir.ok || adminDir === '') {
    return failure('git rev-parse --absolute-git-dir', gitDir);
  }
  const times = [path, ...ADMIN_FILES.map((file) => join(adminDir, file))]
    .map((file) => seams.modifiedAt(file))
    .filter((time): time is Date => time !== null)
    .map((time) => time.getTime());
  if (times.length === 0) {
    return `no modification time could be read under ${path} or ${adminDir}`;
  }
  return new Date(Math.max(...times));
}

/** The `dirty` blocker, or an `unreadable` one when the status could not be read. */
function dirtyBlockers(git: GitRunner): WorktreeBlocker[] {
  const status = git(WORKTREE_STATUS);
  if (!status.ok) {
    return [{ kind: 'unreadable', reason: `its changes could not be read: ${failure('git status', status)}` }];
  }
  const { changed, untracked } = countChanges(status.stdout);
  const parts = [
    ...changed > 0
      ? [plural(changed, 'uncommitted change')]
      : [],
    ...untracked > 0
      ? [plural(untracked, 'untracked file')]
      : [],
  ];
  return parts.length === 0
    ? []
    : [{ kind: 'dirty', reason: parts.join(', ') }];
}

/** The `session` blockers: a live record under the worktree, or one under the project root naming its branch. */
function sessionBlockers(context: RowContext, path: string, branch: string | null): WorktreeBlocker[] {
  const own = readLive(context.seams, path);
  const readings: Array<readonly SessionRecord[] | string> = [own];
  if (typeof context.projectSessions === 'string') {
    readings.push(context.projectSessions);
  } else if (branch !== null) {
    readings.push(context.projectSessions.filter((record) => record.branch === branch));
  }

  const blockers: WorktreeBlocker[] = [];
  for (const reading of readings) {
    if (typeof reading === 'string') {
      blockers.push({ kind: 'unreadable', reason: reading });
      continue;
    }
    for (const record of reading) {
      blockers.push({ kind: 'session', reason: `loop session ${record.sessionId} is ${record.state} in it` });
    }
  }
  return blockers;
}

/** The `recent` blocker, or an `unreadable` one when the time could not be read. */
function recentBlockers(modified: Date | string, read: WorktreeRead): WorktreeBlocker[] {
  if (typeof modified === 'string') {
    return [{ kind: 'unreadable', reason: `when it was last modified could not be read: ${modified}` }];
  }
  const age = read.now.getTime() - modified.getTime();
  if (age >= read.idleDays * MS_PER_DAY) {
    return [];
  }
  const days = Math.max(0, Math.floor(age / MS_PER_DAY));
  const when = days === 0
    ? 'today'
    : `${plural(days, 'day')} ago`;
  return [{ kind: 'recent', reason: `modified ${when}, within cleanup.worktreeIdleDays (${String(read.idleDays)})` }];
}

/** The live sessions recorded under `root`, or why they could not be read. */
function readLive(seams: WorktreeSeams, root: string): readonly SessionRecord[] | string {
  try {
    return seams.sessions(root).filter((record) => LIVE_STATES.has(record.state));
  } catch (error) {
    return `the session records under ${runsDir(root)} could not be read: ${messageOf(error)}`;
  }
}

/** The kinds in the order a row names them. */
const BLOCK_ORDER: readonly WorktreeBlockKind[] = ['dirty', 'locked', 'current', 'session', 'recent', 'unreadable'];

/** `blockers` in {@link BLOCK_ORDER}, each kind's own order kept. */
function orderBlockers(blockers: readonly WorktreeBlocker[]): WorktreeBlocker[] {
  return BLOCK_ORDER.flatMap((kind) => blockers.filter((blocker) => blocker.kind === kind));
}

/** The row's one line: what blocks it, else whether it starts ticked. */
function rowReason(blockers: readonly WorktreeBlocker[], branch: string | null, merged: boolean): string {
  if (blockers.length > 0) {
    return blockers.map((blocker) => blocker.reason).join('; ');
  }
  if (branch === null) {
    return 'clean; detached HEAD';
  }
  return merged
    ? `clean; branch ${branch} is merged`
    : `clean; branch ${branch} is not merged`;
}

/** `path` as given and resolved, the two only once when they agree. */
function pathForms(seams: WorktreeSeams, path: string): readonly string[] {
  const resolved = seams.realPath(path);
  return resolved === path
    ? [path]
    : [path, resolved];
}

/** True when `path` is strictly below `dir`. */
function isInside(path: string, dir: string): boolean {
  const prefix = dir.endsWith(sep)
    ? dir
    : `${dir}${sep}`;
  return path.startsWith(prefix);
}

/** `git <what> failed`, with the first line git said when it said anything. */
function failure(what: string, result: GitResult): string {
  const said = gitSaid(result).split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
  return said === ''
    ? `${what} failed`
    : `${what} failed: ${said}`;
}

/** `1 untracked file`, `2 untracked files`. */
function plural(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${noun}s`;
}
