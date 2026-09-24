/**
 * The since-last-command notice: what changed between the snapshot the
 * last command left (`./seen.ts`) and a fresh reading, and the one stderr
 * line that says so.
 *
 * ## What counts as new
 *
 * {@link compareSeen} counts four kinds of news, each against the
 * previous snapshot:
 *
 * - **An idle worktree**: a path idle now that the snapshot did not hold
 *   as idle, whether it was there and touched or not there at all.
 * - **A merged branch**: a name in Merged now that the snapshot did not
 *   hold.
 * - **A stopped loop**: a session the snapshot held as `running` or
 *   `paused` that now reads `stopped` or `done`. A session that is gone
 *   from the reading, or that was already stopped, is not news.
 * - **A blocked loop**: a session holding a blocked line the snapshot did
 *   not hold for it. A session absent from the snapshot counts when it
 *   holds any blocked line. One session counts once however many of its
 *   lines are new, and a line that cleared is not news.
 *
 * Nothing that went away is news: a worktree removed, a branch deleted.
 *
 * ## The line
 *
 * {@link noticeLine} answers null with no previous snapshot (a first run,
 * or a file `readSeenFile` could not parse) and when nothing is new.
 * Otherwise it answers one line, whatever combination is new, the counts
 * in the order above:
 *
 * `rafa: since your last command: 1 worktree went idle, 2 merged branches
 * left behind; run rafa cleanup`
 *
 * It names `rafa cleanup` when only housekeeping (idle worktrees, merged
 * branches) is new, and `rafa status` as soon as a loop stopped or holds
 * a new blocked task, with or without housekeeping news beside it. The
 * line carries no trailing newline; the caller writes it to stderr.
 */
import type { SeenSession, SeenSnapshot } from './seen.js';

/** The command the line names when only housekeeping is new. */
export const CLEANUP_COMMAND = 'rafa cleanup';

/** The command the line names when a loop stopped or blocked. */
export const STATUS_COMMAND = 'rafa status';

/** The line's opening words. */
export const NOTICE_PREFIX = 'rafa: since your last command: ';

/** The session states a loop is still going in. */
const LIVE_STATES: ReadonlySet<SeenSession['state']> = new Set(['running', 'paused']);

/** What changed since the previous snapshot; see the module note. */
export interface SeenNews {
  /** The worktree paths that went idle, sorted. */
  readonly idleWorktrees: readonly string[];
  /** The branch names newly in Merged, sorted. */
  readonly mergedBranches: readonly string[];
  /** The session ids that were running or paused and now read stopped or done, sorted. */
  readonly stoppedSessions: readonly string[];
  /** The session ids holding a blocked line the snapshot did not hold for them, sorted. */
  readonly blockedSessions: readonly string[];
}

/** The items of `current` that `previous` does not hold, sorted. */
function added(previous: readonly string[], current: readonly string[]): string[] {
  const seen = new Set(previous);
  return current.filter((item) => !seen.has(item)).sort();
}

/** True when the session went from running or paused to stopped or done. */
function hasStopped(before: SeenSession | undefined, now: SeenSession): boolean {
  return before !== undefined && LIVE_STATES.has(before.state) && !LIVE_STATES.has(now.state);
}

/** True when the session holds a blocked line the snapshot did not hold for it. */
function hasNewBlocked(before: SeenSession | undefined, now: SeenSession): boolean {
  const seen = new Set(before?.blocked ?? []);
  return now.blocked.some((line) => !seen.has(line));
}

/** What is new in `current` against `previous`; see the module note. */
export function compareSeen(previous: SeenSnapshot, current: SeenSnapshot): SeenNews {
  const ids = Object.keys(current.sessions).sort();
  const before = (id: string): SeenSession | undefined => Object.hasOwn(previous.sessions, id)
    ? previous.sessions[id]
    : undefined;
  return {
    idleWorktrees: added(previous.idleWorktrees, current.idleWorktrees),
    mergedBranches: added(previous.mergedBranches, current.mergedBranches),
    stoppedSessions: ids.filter((id) => hasStopped(before(id), current.sessions[id] as SeenSession)),
    blockedSessions: ids.filter((id) => hasNewBlocked(before(id), current.sessions[id] as SeenSession)),
  };
}

/** `singular` for a count of one, `many` otherwise, after the count. */
function counted(count: number, singular: string, many: string): string {
  return count === 1
    ? `1 ${singular}`
    : `${count} ${many}`;
}

/** The line for `news`, or null when nothing in it is new. */
export function newsLine(news: SeenNews): string | null {
  const parts = [
    [news.idleWorktrees.length, 'worktree went idle', 'worktrees went idle'],
    [news.mergedBranches.length, 'merged branch left behind', 'merged branches left behind'],
    [news.stoppedSessions.length, 'loop stopped', 'loops stopped'],
    [news.blockedSessions.length, 'loop has a new blocked task', 'loops have new blocked tasks'],
  ] as const;
  const said = parts.filter(([count]) => count > 0).map(([count, one, many]) => counted(count, one, many));
  if (said.length === 0) return null;
  const loops = news.stoppedSessions.length + news.blockedSessions.length;
  const command = loops > 0
    ? STATUS_COMMAND
    : CLEANUP_COMMAND;
  return `${NOTICE_PREFIX}${said.join(', ')}; run ${command}`;
}

/** The one stderr line for `current` against `previous`, or null; see the module note. */
export function noticeLine(previous: SeenSnapshot | null, current: SeenSnapshot): string | null {
  if (previous === null) return null;
  return newsLine(compareSeen(previous, current));
}
