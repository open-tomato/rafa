/**
 * The count `rafa status` ends its board line with: how many open issues
 * are held back by a blocker, read in the mode the board's relationships
 * port (`src/board/relations/port.ts`) answers.
 *
 * | Mode | What is counted | What it reads |
 * | --- | --- | --- |
 * | `labels`, or no port | every open issue labelled `spec:blocked` | `readBlockedIssues` (`src/commands/doctor-blocked.ts`), its own `gh issue list --label spec:blocked` |
 * | `native` | every open issue on the listing whose `blockedBy` reading still holds it (`isWaiting`) | the one board listing the section already holds |
 *
 * `labels` mode is what `rafa status` counted before the port, command for
 * command and word for word. `native` mode sends no command of its own:
 * the listing is the memoised one the walk and the place read, so the
 * count costs nothing more, and no `spec:blocked` label or `Blocked by:`
 * line is read. An issue counts there while `isWaiting` says so: an open
 * blocker, or a `blockedBy` list `gh` stopped short of, whose unread
 * nodes may be open. A blocker closed for any reason, `NOT_PLANNED`
 * included, holds nothing, since the tracker cleared it.
 *
 * A listing that failed is a null count and one note naming what could
 * not be read, in the mode's own words: `native` catches the listing's
 * rejection, and `readBlockedIssues` answers its own failure as the
 * report's `problem` rather than rejecting.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardRelations } from '../board/relations/port.js';
import type { BoardListing } from '../board/roadmap-board.js';
import type { BlockedIssuesReport } from '../commands/doctor-blocked.js';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { isWaiting } from '../board/relations/port.js';
import { messageOf } from '../config-sections.js';

/** The half of the port the count reads: its mode, and its reads over one listing. */
export type BlockedCountRelations = Pick<BoardRelations, 'mode' | 'read'>;

/** What {@link readBlockedCount} reads through. */
export interface BlockedCountOptions {
  /** The section's bounded runner, which the `labels` listing is sent through. */
  readonly gh: GhRunner;
  /** The board's relationships; `labels` mode when left out. */
  readonly relations?: BlockedCountRelations;
  /** The board listing the section holds, read in `native` mode only. */
  readonly listing: BoardListing;
  /** The `spec:blocked` listing, read in `labels` mode only. */
  readonly blockedIssues: (gh: GhRunner) => Promise<BlockedIssuesReport>;
}

/** How many open issues are held back, or null with the note saying why they were not counted. */
export interface BlockedCount {
  readonly count: number | null;
  readonly notes: readonly string[];
}

/** The count `labels` mode reads: the open issues labelled `spec:blocked`. */
async function labelsCount(options: BlockedCountOptions): Promise<BlockedCount> {
  const report = await options.blockedIssues(options.gh);
  return report.problem === null
    ? { count: report.readings.length, notes: [] }
    : { count: null, notes: [`the issues labelled ${SPEC_BLOCKED_LABEL} could not be read: ${report.problem}`] };
}

/** The count `native` mode reads: the open issues on the listing a blocker still holds. */
async function nativeCount(relations: BlockedCountRelations, listing: BoardListing): Promise<BlockedCount> {
  try {
    const rows = await listing();
    const { blockersOf } = relations.read(rows);
    const held = rows.filter((row) => row.state === 'OPEN' && isWaiting(blockersOf(row)));
    return { count: held.length, notes: [] };
  } catch (error) {
    return { count: null, notes: [`the issues with an open blocker could not be read: ${messageOf(error)}`] };
  }
}

/** The blocked count in the mode `options.relations` answers; see the module note. Never rejects. */
export function readBlockedCount(options: BlockedCountOptions): Promise<BlockedCount> {
  const { relations } = options;
  return relations?.mode === 'native'
    ? nativeCount(relations, options.listing)
    : labelsCount(options);
}
