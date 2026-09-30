/**
 * The board relationships port: the one interface every reader and
 * writer of "this issue belongs to that epic" and "this issue waits on
 * that one" goes through, whichever way the board records them
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode").
 *
 * `board.relationships` picks the adapter. `labels`, the default, is
 * today's system: membership by `epic:<slug>` (`../epics.ts`), order by
 * the epic's checklist (`../epic-walk.ts`), waiting by `spec:blocked`
 * and the `Blocked by:` line with its four faults (`../blocked.ts`), and
 * the unblock and tick steps of `rafa pr merge`. `native` reads GitHub's
 * own `parent`, `subIssues` and `blockedBy` links off the listing
 * (`../roadmap-board.ts`). Only the configured mode is ever read; the
 * other mode's marks are `rafa doctor`'s to name, never merged in.
 *
 * ## Reads are pure over one listing
 *
 * {@link BoardRelations.read} takes the one `BoardIssue[]` listing the
 * command already holds and answers a {@link RelationsReading}: nothing
 * in it spawns, lists again or asks an issue's state one at a time. A
 * blocker's state is the listing's row in `labels` mode and the
 * `blockedBy` node in `native` mode, so no reader of either mode sends a
 * per-blocker `gh issue view`.
 *
 * An adapter handed a listing read without its mode's fields refuses it
 * with a `TypeError` naming `board.relationships`: a `native` reading of
 * a row with no `parent` key would otherwise read every issue as having
 * no epic and no blocker. {@link BoardRelations.listFields} is the
 * `--json` list a listing for the mode asks for (`boardListFields`).
 *
 * ## What both adapters answer alike
 *
 * One contract suite (`./contract.ts`) holds both adapters to the same
 * answer over a pair of fixture listings describing one board. Where the
 * answer differs by design the difference is spelled here, and the suite
 * declares it per adapter rather than skipping it:
 *
 *  - Truncation. `gh` answers the first 50 `blockedBy` nodes and the
 *    first 100 `subIssues`; a `native` reading keeps `truncated` when
 *    GitHub's `totalCount` is above them. A `Blocked by:` line and a
 *    label are read whole, so a `labels` reading never carries it. The
 *    key is left out, never set to undefined, when there is nothing
 *    past the nodes.
 *  - Faults. The `Blocked by:` line's four faults, and an issue whose
 *    `epic:` labels name no single epic, are marks only `labels` can
 *    hold. `native` has one parent per issue and a blocker per link.
 *  - A foreign blocker's state. `native` reads it off the node; `labels`
 *    never asks it, as `readBlockedBy` never did, so it is null there.
 *  - Order across repositories. A `labels` reading names a line's local
 *    ids, then its foreign tokens, each in line order; a `native` one
 *    names the nodes in the order `gh` answered them. Callers print the
 *    mode's own order, and the suite compares blockers as a set.
 *  - Writes. {@link BoardRelations.afterMerge} writes in `labels` mode
 *    and never in `native`, where GitHub clears a blocker when it closes.
 *
 * ## An issue on this board, or another
 *
 * A {@link RelatedIssue}'s `repository` is null for this board's own
 * repository and `owner/name` for any other, so a foreign `#1` never
 * reads as this board's `#1`. The `native` adapter therefore has to know
 * the board's repository to tell a node's `url` apart from a foreign
 * one; `labels` reads it off the token (`owner/repo#<n>`).
 *
 * ## Writes
 *
 * Writes go through the `GhRunner` seam (`src/adapters/tracker/github.ts`)
 * the adapter is made with; the `gh` argv is assembled in the adapter and
 * never in a command. Each write takes the listing because a `labels`
 * write reads what it edits off it (an epic's slug, a checklist line, a
 * `Blocked by:` line), and answers every write it sent as a
 * {@link RelationWrite}, naming the issue it touched so a caller can drop
 * that row from the kept listing (`invalidateRows`, `../board-cache.ts`):
 * a relationship write moves no `updated_at`, as `context/pull-requests.md`
 * ("Native relationships") records.
 *
 * A write REJECTS only when its first write, the one that is the
 * relationship, fails, and then nothing has changed. A later step that
 * fails (a checklist edit behind a label swap) is a record with status
 * `failed`, since the relationship already moved and a rejection would
 * say it had not. `afterMerge` never rejects: the merge has already
 * happened by the time it runs.
 */
import type { BoardRelationshipMode } from '../../config-sections.js';
import type { BlockedReading } from '../blocked.js';
import type { BoardIssue, BoardIssueState } from '../roadmap-board.js';

/** An issue named by a relationship, on this board's repository or another. */
export interface RelatedIssue {
  readonly number: number;
  /** `owner/name`, or null for this board's own repository; see the module note. */
  readonly repository: string | null;
}

/** One issue an issue waits on, with the state the mode read for it. */
export interface Blocker extends RelatedIssue {
  /**
   * `OPEN` or `CLOSED` as the board holds it, whatever the close reason,
   * so a blocker closed as `NOT_PLANNED` clears as one closed as done.
   * Null when the mode read no state: a foreign blocker in `labels` mode,
   * or a local one the listing does not hold.
   */
  readonly state: BoardIssueState | null;
}

/** A relationship list `gh` stopped short of: GitHub's own count of it. */
export interface Truncation {
  /** GitHub's `totalCount`, above the nodes answered. */
  readonly total: number;
}

/** An issue that waits on nothing: no `spec:blocked` label, or no `blockedBy` link. */
export interface NotBlockedReading {
  readonly kind: 'none';
  readonly issue: number;
}

/** An issue that names its blockers, cleared or not. */
export interface BlockedByReading {
  readonly kind: 'blocked';
  readonly issue: number;
  /** Every blocker, in the mode's own order; see the module note. Never empty. */
  readonly blockers: readonly Blocker[];
  /** Kept only when `gh` answered fewer nodes than GitHub holds; left out otherwise. */
  readonly truncated?: Truncation;
}

/** A `labels`-mode issue labelled `spec:blocked` whose `Blocked by:` line is one of the four faults. */
export interface BlockedFaultReading {
  readonly kind: 'fault';
  readonly issue: number;
  /** The line as `readBlockedBy` read it; its `kind` is never `blocked`. */
  readonly line: BlockedReading;
  /** `blockedFaultMessage`'s sentence for it, the one wording every report prints. */
  readonly message: string;
}

/** What an issue waits on, as {@link RelationsReading.blockersOf} reads it. */
export type BlockersReading = NotBlockedReading | BlockedByReading | BlockedFaultReading;

/** A mark naming an epic, and the epics on the listing that answer to it. */
export interface EpicMark {
  /** The mark as the board holds it: `epic:<slug>` in `labels`, `#<n>` or `owner/name#<n>` in `native`. */
  readonly mark: string;
  /** The epic rows answering to it, in ascending number: none, one, or several claiming one slug. */
  readonly owners: readonly number[];
}

/** An issue in no epic: it carries no mark, or it is an epic itself. */
export interface NoEpicReading {
  readonly kind: 'none';
  readonly issue: number;
}

/** An issue in exactly one epic on the listing. */
export interface InEpicReading {
  readonly kind: 'epic';
  readonly issue: number;
  /** The epic's issue number. */
  readonly epic: number;
  /** The mark that put it there. */
  readonly mark: string;
}

/**
 * An issue whose marks name no single epic: several marks (`labels`
 * only), or one mark no epic row on the listing answers to or several
 * do. A `native` parent that is not on the listing, is in another
 * repository, or is not typed `epic` is one mark with no owner.
 */
export interface UnresolvedEpicReading {
  readonly kind: 'unresolved';
  readonly issue: number;
  /** Every mark, in the order the board holds them. */
  readonly marks: readonly EpicMark[];
}

/** Which epic an issue is in, as {@link RelationsReading.epicOf} reads it. */
export type EpicOfReading = NoEpicReading | InEpicReading | UnresolvedEpicReading;

/** An epic's members, as {@link RelationsReading.membersOf} reads them. */
export interface MembersReading {
  readonly epic: number;
  /**
   * The rows in the epic, open and closed, never an epic themselves, in
   * the epic's order: its checklist, then the members it does not list in
   * ascending number, in `labels`; sub-issue order in `native`, never
   * sorted by number.
   */
  readonly members: readonly BoardIssue[];
  /** Kept only when `gh` answered fewer sub-issues than GitHub holds; left out otherwise. */
  readonly truncated?: Truncation;
}

/** The four reads, over one listing. */
export interface RelationsReading {
  /** Which epic `issue` is in. An epic row is in none. */
  readonly epicOf: (issue: BoardIssue) => EpicOfReading;
  /** `epic`'s members in order. Throws a `TypeError` for a row not typed `epic`. */
  readonly membersOf: (epic: BoardIssue) => MembersReading;
  /** What `issue` waits on. */
  readonly blockersOf: (issue: BoardIssue) => BlockersReading;
  /**
   * The open issues, in ascending number, that closing `closed` (this
   * board's issue numbers) frees: each has a blocker in `closed`, and is
   * not {@link isWaiting} once every issue in `closed` counts as closed.
   */
  readonly freedBy: (closed: readonly number[]) => readonly number[];
}

/** An issue moved into an epic, out of any epic it was in. */
export interface ParentChange {
  readonly issue: number;
  /** The epic it joins. */
  readonly parent: number;
}

/** An issue taken out of the epic it is in. */
export interface ParentRemoval {
  readonly issue: number;
}

/** A blocker added to or removed from an issue. */
export interface BlockerChange {
  readonly issue: number;
  readonly blocker: RelatedIssue;
}

/** Asks one yes-or-no question; answers true for yes. */
export type RelationAsk = (question: string) => Promise<boolean>;

/** What {@link BoardRelations.afterMerge} is asked once a pull request has merged. */
export interface AfterMergeRequest {
  /** The merged pull request's body, which the closing keywords are read out of. */
  readonly body: string;
  /** Asks before a write, or null when there is nobody to ask. */
  readonly ask: RelationAsk | null;
  /** Where each ordinary outcome says so. */
  readonly info: (message: string) => void;
  /** Where a step that came out badly says so. */
  readonly warn: (message: string) => void;
}

/** How one write came out. */
export type RelationWriteStatus =
  /** Sent, and the board took it. */
  | 'written'
  /** Nothing to send: the board already held it. */
  | 'unchanged'
  /** Sent, and the board refused it; see {@link RelationWrite.problem}. */
  | 'failed';

/** One write an adapter sent, or found it had no need to send. */
export interface RelationWrite {
  /** The issue the write touched, the row a kept listing drops. */
  readonly issue: number;
  /** One line naming the write, as a command prints it. */
  readonly what: string;
  readonly status: RelationWriteStatus;
  /** What the board said when it refused; null otherwise. */
  readonly problem: string | null;
}

/**
 * The board's relationships in one mode: its reads over a listing, and
 * its writes through the adapter's `GhRunner`. Property signatures, as
 * `EffortStore` spells its own, so an adapter's parameters are compared
 * strictly rather than bivariantly.
 */
export interface BoardRelations {
  /** The mode this adapter answers, as `board.relationships` names it. */
  readonly mode: BoardRelationshipMode;
  /** The `--json` fields a listing read for this mode asks `gh issue list` for. */
  readonly listFields: string;
  /** The four reads over `listing`; pure, see the module note. */
  readonly read: (listing: readonly BoardIssue[]) => RelationsReading;
  /** Moves `change.issue` into `change.parent`, out of any epic it was in, in one relationship write. */
  readonly setParent: (listing: readonly BoardIssue[], change: ParentChange) => Promise<readonly RelationWrite[]>;
  /** Takes `change.issue` out of its epic. */
  readonly removeParent: (listing: readonly BoardIssue[], change: ParentRemoval) => Promise<readonly RelationWrite[]>;
  /** Makes `change.issue` wait on `change.blocker`. */
  readonly addBlocker: (listing: readonly BoardIssue[], change: BlockerChange) => Promise<readonly RelationWrite[]>;
  /** Stops `change.issue` waiting on `change.blocker`. */
  readonly removeBlocker: (listing: readonly BoardIssue[], change: BlockerChange) => Promise<readonly RelationWrite[]>;
  /**
   * The step `rafa pr merge` runs once the merge is done: today's
   * `merge-unblock.ts` and `merge-tick.ts` steps in `labels`, nothing in
   * `native`. Never rejects.
   */
  readonly afterMerge: (request: AfterMergeRequest) => Promise<readonly RelationWrite[]>;
}

/**
 * True when `reading` still holds its issue back, in either mode:
 *
 *  - a fault, which is reported and never guessed at (`../blocked-line.ts`);
 *  - a truncated list, whose unread blockers may be open;
 *  - an `OPEN` blocker;
 *  - a blocker on this board whose state was not read, which counts as
 *    not cleared, the safe direction `../blocked-line.ts` records.
 *
 * A foreign blocker with no state does not hold: a `labels` reading never
 * asks one, and `readBlockedLine` and `rafa issue unblock` never waited
 * on one. Every blocker `CLOSED`, whatever the reason, is waiting done.
 */
export function isWaiting(reading: BlockersReading): boolean {
  if (reading.kind === 'none') return false;
  if (reading.kind === 'fault') return true;
  if (reading.truncated !== undefined) return true;
  return reading.blockers.some((blocker) => blocker.state === 'OPEN'
    || (blocker.state === null && blocker.repository === null));
}
