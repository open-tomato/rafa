/**
 * `freedBy`, the one reading both relationships adapters answer the same
 * way over their own `blockersOf`: which open issues closing a set of
 * issues frees (`./port.ts`, {@link RelationsReading.freedBy}).
 *
 * The rule is the port's, and it is spelled once here so the two
 * adapters cannot read it two ways: an open issue is freed when one of
 * its blockers on this board is among the closed issues, and
 * {@link isWaiting} answers false for its reading once each of those
 * blockers counts as `CLOSED`. A fault, a truncated list, another blocker
 * still open and a blocker on this board whose state was not read all
 * keep it waiting, exactly as `isWaiting` reads them; a foreign blocker
 * is never among the closed issues, since `closed` numbers this board's
 * issues. An issue whose blockers were all closed already is freed again
 * when one of them is named: the reading is about the listing handed in,
 * not about what changed.
 *
 * Nothing here spawns or reads the board beyond the listing and the
 * `blockersOf` it is handed.
 */
import type { Blocker, BlockersReading, RelationsReading } from './port.js';
import type { BoardIssue } from '../roadmap-board.js';

import { isWaiting } from './port.js';

/** `blocker`, read as `CLOSED` when it is a local issue in `closed`. */
function closedIn(blocker: Blocker, closed: ReadonlySet<number>): Blocker {
  return blocker.repository === null && closed.has(blocker.number)
    ? { ...blocker, state: 'CLOSED' }
    : blocker;
}

/** True when `reading` names a local blocker in `closed` and waits on nothing once they count as closed. */
function freedIn(reading: BlockersReading, closed: ReadonlySet<number>): boolean {
  if (reading.kind !== 'blocked') return false;
  const touched = reading.blockers.some((blocker) => blocker.repository === null && closed.has(blocker.number));
  if (!touched) return false;
  return !isWaiting({ ...reading, blockers: reading.blockers.map((blocker) => closedIn(blocker, closed)) });
}

/**
 * The open issues on `listing`, in ascending number, that closing
 * `closed` frees, read through `blockersOf`; the module note holds the
 * rule. An empty `closed` frees nothing.
 */
export function freedByOver(
  listing: readonly BoardIssue[],
  closed: readonly number[],
  blockersOf: RelationsReading['blockersOf'],
): readonly number[] {
  const closedSet = new Set(closed);
  if (closedSet.size === 0) return Object.freeze([]);
  const freed = listing
    .filter((issue) => issue.state === 'OPEN' && freedIn(blockersOf(issue), closedSet))
    .map((issue) => issue.number)
    .sort((left, right) => left - right);
  return Object.freeze([...new Set(freed)]);
}
