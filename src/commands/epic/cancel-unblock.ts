/**
 * What `rafa epic cancel`'s UNBLOCK answer reads of a dependent before it
 * writes (`./cancel.ts`): the blockers it still has once the cancelled
 * epic's members are dropped, which the unblock note names
 * (`renderUnblockNote`, `src/board/epic-trail.ts`), and, in `labels` mode,
 * which of them may still be open, which decides whether `spec:blocked`
 * comes off. Nothing here writes, spawns or lists: each reading is a pure
 * function of the listing the cancel already holds, so every case in
 * `./cancel-unblock.test.ts` is a literal listing.
 *
 * ## Per mode
 *
 * The mode is the one `board.relationships` names, read through the
 * board's relationships port (`src/board/relations/port.ts`), `labels`
 * when the cancel is handed none.
 *
 * - In `labels` mode the dependent's `Blocked by:` line is read as the
 *   cancel read it before the port, with `readBlockedBy` against the
 *   listing's numbers: every id it names that is not a dropped member,
 *   in line order, then every foreign token as the line wrote it. An id
 *   that is open on the listing, and every foreign token, whose state is
 *   never read, MAY be open.
 * - In `native` mode no label and no line is read: the blockers are the
 *   port's `blockersOf` nodes, in the order `gh` answered them, less the
 *   dropped members and less every blocker `CLOSED`, since GitHub no
 *   longer holds an issue back on a closed blocker. Each is named `#<n>`
 *   on this board and `owner/name#<n>` on another. Nothing is cleared in
 *   `native` mode, so {@link UnblockStill.maybeOpen} is empty: the cancel
 *   takes no label off and removes no blocked-by link, and says so in
 *   {@link keptLinksLine}. A `blockedBy` list `gh` truncated names only
 *   the nodes it answered.
 */
import type { EpicRelations } from '../../board/epics.js';
import type { Blocker } from '../../board/relations/port.js';
import type { BoardIssue } from '../../board/roadmap-board.js';

import { readBlockedBy } from '../../board/blocked.js';

/** What the unblock answer reads of a dependent's other blockers; see the module note. */
export interface UnblockStill {
  /** Every blocker the note names as still blocking it, as the mode spells one. */
  readonly named: readonly string[];
  /** The ones that may still be open, which keep `spec:blocked` on; always empty in `native` mode. */
  readonly maybeOpen: readonly string[];
}

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** `#40` on this board, `owner/name#40` on another. */
function blockerRef(blocker: Blocker): string {
  return `${blocker.repository ?? ''}${ref(blocker.number)}`;
}

/** The `labels`-mode reading: `issue`'s `Blocked by:` line against the listing; see the module note. */
function labelsUnblockStill(issues: readonly BoardIssue[], issue: BoardIssue, waitsOn: readonly number[]): UnblockStill {
  const known = new Set(issues.map((each) => each.number));
  const open = new Set(issues.filter((each) => each.state === 'OPEN').map((each) => each.number));
  const reading = readBlockedBy(issue.number, issue.body, known);
  const stillIds = reading.blockers.filter((id) => !waitsOn.includes(id));
  return Object.freeze({
    named: Object.freeze([...stillIds.map(ref), ...reading.foreign]),
    maybeOpen: Object.freeze([...stillIds.filter((id) => open.has(id)).map(ref), ...reading.foreign]),
  });
}

/** The `native`-mode reading: `issue`'s `blockedBy` nodes through the port; see the module note. */
function nativeUnblockStill(relations: EpicRelations, issues: readonly BoardIssue[], issue: BoardIssue, waitsOn: readonly number[]): UnblockStill {
  const reading = relations.read(issues).blockersOf(issue);
  const blockers = reading.kind === 'blocked'
    ? reading.blockers
    : [];
  const dropped = (blocker: Blocker): boolean => blocker.repository === null && waitsOn.includes(blocker.number);
  const named = blockers.filter((blocker) => !dropped(blocker) && blocker.state !== 'CLOSED').map(blockerRef);
  return Object.freeze({ named: Object.freeze(named), maybeOpen: Object.freeze([]) });
}

/**
 * What `issue` still waits on once `waitsOn`, the cancelled epic's
 * members, are dropped, read over `issues` in the mode `relations`
 * answers; see the module note. Never throws for a listing read in that
 * mode.
 */
export function readUnblockStill(
  relations: EpicRelations,
  issues: readonly BoardIssue[],
  issue: BoardIssue,
  waitsOn: readonly number[],
): UnblockStill {
  return relations.mode === 'native'
    ? nativeUnblockStill(relations, issues, issue, waitsOn)
    : labelsUnblockStill(issues, issue, waitsOn);
}

/** The line a `native`-mode unblock prints in place of taking `spec:blocked` off: the links it keeps. */
export function keptLinksLine(issue: number, waitsOn: readonly number[]): string {
  const links = waitsOn.length === 1
    ? 'link'
    : 'links';
  return `${ref(issue)} keeps its blocked-by ${links} to ${waitsOn.map(ref).join(' ')}: in native mode the cancel clears`
    + ' nothing, and GitHub stops holding an issue back once its blocker closes.';
}
