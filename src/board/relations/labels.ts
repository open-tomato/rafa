/**
 * The `labels` relationships adapter: today's board system behind the
 * `BoardRelations` port (`./port.ts`), the default of
 * `board.relationships`
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode").
 *
 * Its reads WRAP the modules every reader uses today and reimplement
 * none of them, so a reading through the port answers what those
 * modules answer:
 *
 *  - membership and an epic's slug are `readEpics` (`../epics.ts`), whose
 *    `Epic.members` is `groupByEpicLabel`'s group for the epic's first
 *    `epic:` label;
 *  - an epic's order is its checklist as `epicLines` (`../epic-walk.ts`)
 *    reads it;
 *  - waiting is `readBlockedBy` (`../blocked.ts`), and a fault's sentence
 *    is `blockedFaultMessage`'s.
 *
 * Nothing in a read spawns or lists again: `read(listing)` reads the
 * epics once and answers four pure functions over that one listing. A
 * `labels` listing carries no field beyond `BOARD_LIST_FIELDS`, and a
 * listing read for the `native` mode carries those too, so no listing is
 * refused here: handed a native one, the adapter reads its labels and
 * bodies, which is the only mode it ever reads.
 *
 * ## epicOf
 *
 * An epic row is in no epic, and so is an issue carrying no `epic:`
 * label. An issue carrying one, owned by exactly one epic on the listing
 * (an epic owns its FIRST `epic:` label's slug, as `readEpics` reads it),
 * is in that epic, marked `epic:<slug>`. Anything else is `unresolved`
 * with every mark in label order and each mark's owners in ascending
 * number: two `epic:` labels (the fault `../epic-problems.ts` names), a
 * slug no epic owns, or one several do.
 *
 * ## membersOf
 *
 * The epic's members are its `readEpics` members, open and closed: the
 * ones its checklist lists first, in checklist order (a line listed twice
 * counts once, and a checklist line naming an issue without the label is
 * no member), then every member it does not list, in ascending number.
 * `rafa epics` and the `--next` walk print `epicLines`' own `lines`,
 * which also hold a checklist line without the label and leave a closed
 * unlisted member out; those callers keep reading `epicLines` for what
 * they print. A labels reading is read whole, so it never carries
 * `truncated`. A row not typed `epic` is refused with a `TypeError`.
 *
 * ## blockersOf
 *
 * An issue without `spec:blocked` waits on nothing, whatever its body
 * says: the label is what a person set (`../blocked-line.ts`). One
 * carrying it is `blocked` when its line reads, naming its local ids,
 * then its foreign `owner/repo#<n>` tokens, each in line order, and a
 * `fault` otherwise, with `readBlockedBy`'s reading and
 * `blockedFaultMessage`'s sentence.
 *
 * `readBlockedBy` is asked WITHOUT the listing's numbers, as the `--next`
 * walk asks it: the listing reads the newest issues only
 * (`BOARD_LISTING_LIMIT`), so an id it lacks may be an older issue and is
 * not called unknown. Such a blocker's state is null, which
 * `isWaiting` counts as not cleared. A local blocker's state is its row's
 * on the listing; a foreign blocker's is never asked and is null.
 *
 * The reading is exported as {@link labelsBlockersOf} for
 * `../blocked-line.ts`, which reads the `--next` walk's lines through it
 * rather than through `readBlockedBy` again. It hands an empty map, since
 * the walk holds an issue and not a listing row, and fills each local
 * blocker's state from the walk's own memoised reader, which also reads
 * an issue older than the listing.
 *
 * {@link labelsLineBlockersOf} is the same reading of a bare body, as
 * though it carried `spec:blocked`, for `src/refs/extract.ts`: a spec's
 * references are marked by what its `Blocked by:` line names, whatever
 * its labels, as they were before the port.
 *
 * ## freedBy
 *
 * The port's rule over this adapter's `blockersOf`, spelled once for
 * both adapters in `./freed.ts`.
 *
 * ## Writes
 *
 * The four relationship writes are `./labels-writes.ts`'s. `afterMerge`
 * runs, for a merged pull request whose body closes an issue, the two
 * board steps `rafa pr merge` runs today in this order: the epic
 * checklist tick (`tickEpics`, `src/commands/pr/merge-tick.ts`) and the
 * unblock reading (`unblockAfterMerge`, `src/commands/pr/merge-unblock.ts`).
 * Each prints what it came to through the request's `info` and `warn`
 * exactly as `pr merge` prints it, and each outcome is also answered as
 * a {@link RelationWrite}: an epic's tick names the epic, an unblock
 * outcome the issue it read. A body closing no issue answers an empty
 * list and sends nothing, as both steps did. The roadmap boards' tick is
 * not a relationship and is not run here. `afterMerge` never rejects.
 */
import type {
  AfterMergeRequest,
  Blocker,
  BlockersReading,
  BoardRelations,
  EpicMark,
  EpicOfReading,
  MembersReading,
  RelationsReading,
  RelationWrite,
  RelationWriteStatus,
} from './port.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { UnblockReport, UnblockStatus } from '../../commands/issue/unblock.js';
import type { EpicTickResult } from '../../commands/pr/merge-tick.js';
import type { Epic } from '../epics.js';
import type { BoardIssue } from '../roadmap-board.js';
import type { RoadmapBody } from '../roadmap-tick.js';

import { epicTickProblemLine, epicTickSentence, tickEpics } from '../../commands/pr/merge-tick.js';
import { unblockAfterMerge } from '../../commands/pr/merge-unblock.js';
import { messageOf } from '../../config-sections.js';
import { blockedFaultMessage, hasSpecBlockedLabel, readBlockedBy, SPEC_BLOCKED_LABEL } from '../blocked.js';
import { epicLines } from '../epic-walk.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf, readEpics } from '../epics.js';
import { boardListFields } from '../roadmap-board.js';
import { createGhRoadmapBody } from '../roadmap-tick.js';
import { closedIssuesIn } from '../roadmap.js';

import { freedByOver } from './freed.js';
import { addLabelsBlocker, removeLabelsBlocker, removeLabelsParent, setLabelsParent } from './labels-writes.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board relations labels';

/** No claims: `readEpics` is read for members and slugs alone, never for its state. */
const NO_CLAIMS: ReadonlySet<number> = new Set();

/** The day handed to `readEpics`, whose lateness is not read here. */
const UNREAD_DAY = new Date(0);

/** A foreign `owner/repo#<n>` token, as `readBlockedBy` keeps it. */
const FOREIGN_TOKEN = /^(.+)#(\d+)$/u;

/** What {@link createLabelsRelations} is made with. */
export interface LabelsRelationsOptions {
  /** Runs every `gh` command the writes and `afterMerge` send. */
  readonly gh: GhRunner;
  /** Reads and writes an epic's body for its checklist edits. Made over `gh` when left out. */
  readonly bodies?: RoadmapBody;
}

/** `listing`'s epics as `readEpics` reads them. */
function epicsOf(listing: readonly BoardIssue[]): readonly Epic[] {
  return readEpics({ issues: listing, claims: NO_CLAIMS, today: UNREAD_DAY }).epics;
}

/** Every slug an epic on `epics` owns, with its owners in ascending number. */
function ownersBySlug(epics: readonly Epic[]): ReadonlyMap<string, readonly number[]> {
  const owners = new Map<string, readonly number[]>();
  for (const epic of epics) {
    if (epic.slug !== null) owners.set(epic.slug, [...owners.get(epic.slug) ?? [], epic.number]);
  }
  return owners;
}

/** `issue`'s epic; the module note holds the three answers. */
function epicOf(issue: BoardIssue, owners: ReadonlyMap<string, readonly number[]>): EpicOfReading {
  const slugs = issue.type === 'epic'
    ? []
    : epicSlugsOf(issue.labels);
  if (slugs.length === 0) return Object.freeze({ kind: 'none', issue: issue.number });
  const marks: readonly EpicMark[] = slugs.map((slug) => Object.freeze({
    mark: `${EPIC_LABEL_PREFIX}${slug}`,
    owners: Object.freeze([...owners.get(slug) ?? []]),
  }));
  const [only] = marks;
  if (marks.length === 1 && only !== undefined && only.owners.length === 1) {
    return Object.freeze({ kind: 'epic', issue: issue.number, epic: only.owners[0] ?? 0, mark: only.mark });
  }
  return Object.freeze({ kind: 'unresolved', issue: issue.number, marks: Object.freeze(marks) });
}

/** `epic`'s members in its order; the module note holds the order. Throws a `TypeError` for a row that is no epic. */
function membersOf(epic: BoardIssue, listing: readonly BoardIssue[], epics: readonly Epic[]): MembersReading {
  if (epic.type !== 'epic') {
    throw new TypeError(`${PREFIX}: membersOf refused #${String(epic.number)}, which is not typed epic, so it has no members`);
  }
  const read = epics.find((candidate) => candidate.number === epic.number)
    ?? epicsOf([...listing, epic]).find((candidate) => candidate.number === epic.number);
  const members = read?.members ?? [];
  const byNumber = new Map(members.map((member) => [member.number, member]));
  const listed = [...new Set(read === undefined
    ? []
    : epicLines(read, epic).checklist.map((line) => line.issue))]
    .filter((number) => byNumber.has(number));
  const unlisted = members.filter((member) => !listed.includes(member.number));
  const ordered = [...listed.flatMap((number) => byNumber.get(number) ?? []), ...unlisted];
  return Object.freeze({ epic: epic.number, members: Object.freeze(ordered) });
}

/** A foreign token, split into its repository and number. */
function foreignBlocker(token: string): Blocker {
  const found = FOREIGN_TOKEN.exec(token);
  return Object.freeze({ number: Number(found?.[2] ?? 0), repository: found?.[1] ?? token, state: null });
}

/**
 * What `issue` waits on, each local blocker's state its row's on
 * `byNumber`; the module note holds the reading.
 */
export function labelsBlockersOf(
  issue: Pick<BoardIssue, 'number' | 'labels' | 'body'>,
  byNumber: ReadonlyMap<number, Pick<BoardIssue, 'state'>>,
): BlockersReading {
  if (!hasSpecBlockedLabel(issue.labels)) return Object.freeze({ kind: 'none', issue: issue.number });
  const read = readBlockedBy(issue.number, issue.body);
  if (read.kind !== 'blocked') {
    return Object.freeze({ kind: 'fault', issue: issue.number, line: read, message: blockedFaultMessage(read) });
  }
  const local = read.blockers.map((number): Blocker => Object.freeze({
    number,
    repository: null,
    state: byNumber.get(number)?.state ?? null,
  }));
  return Object.freeze({
    kind: 'blocked',
    issue: issue.number,
    blockers: Object.freeze([...local, ...read.foreign.map(foreignBlocker)]),
  });
}

/**
 * What the `Blocked by:` line in `body` names, read as
 * {@link labelsBlockersOf} reads an issue carrying `spec:blocked`: a
 * `blocked` reading, or a `fault` whose `line` still holds every id and
 * token the line named. No state is read; see the module note.
 */
export function labelsLineBlockersOf(issue: number, body: string): BlockersReading {
  return labelsBlockersOf({ number: issue, labels: [SPEC_BLOCKED_LABEL], body }, new Map());
}

/** The four reads over `listing`; see the module note. */
function readLabels(listing: readonly BoardIssue[]): RelationsReading {
  const epics = epicsOf(listing);
  const owners = ownersBySlug(epics);
  const byNumber = new Map(listing.map((row) => [row.number, row]));
  const blockers = (issue: BoardIssue): BlockersReading => labelsBlockersOf(issue, byNumber);
  return Object.freeze({
    epicOf: (issue: BoardIssue) => epicOf(issue, owners),
    membersOf: (epic: BoardIssue) => membersOf(epic, listing, epics),
    blockersOf: blockers,
    freedBy: (closed: readonly number[]) => freedByOver(listing, closed, blockers),
  });
}

/**
 * The `labels` adapter's reads alone, with no `gh` to make: what a
 * reader handed no port reads, so `labels` stays its default without a
 * write seam it never uses.
 */
export const LABELS_READS: Pick<BoardRelations, 'mode' | 'read'> = Object.freeze({ mode: 'labels', read: readLabels });

/** An epic tick's status as a write's. */
function epicTickStatus(result: EpicTickResult): RelationWriteStatus {
  if (result.status === 'failed') return 'failed';
  return result.status === 'edited'
    ? 'written'
    : 'unchanged';
}

/** An epic tick's result as a write naming the epic. */
function epicTickWrite(result: EpicTickResult): RelationWrite {
  return Object.freeze({
    issue: result.issue,
    what: epicTickSentence(result),
    status: epicTickStatus(result),
    problem: result.status === 'failed'
      ? result.problem
      : null,
  });
}

/** An unblock outcome's status as a write's: the label came off, the reading failed, or nothing was sent. */
function unblockStatus(status: UnblockStatus): RelationWriteStatus {
  if (status === 'removed') return 'written';
  return status === 'failed'
    ? 'failed'
    : 'unchanged';
}

/** Every outcome `report` holds, as writes naming the issue each read. */
function unblockWrites(report: UnblockReport | null): readonly RelationWrite[] {
  return (report?.issues ?? []).map((outcome) => Object.freeze({
    issue: outcome.issue,
    what: outcome.message,
    status: unblockStatus(outcome.status),
    problem: outcome.status === 'failed'
      ? outcome.message
      : null,
  }));
}

/** The epic tick then the unblock reading; see the module note. Never rejects. */
async function afterMerge(gh: GhRunner, request: AfterMergeRequest): Promise<readonly RelationWrite[]> {
  const { body, ask, info, warn } = request;
  if (closedIssuesIn(body).length === 0) return Object.freeze([]);

  let ticks: readonly RelationWrite[] = [];
  try {
    await tickEpics({
      gh,
      warn,
      epicTicked: (result) => {
        if (result.status === 'failed') warn(epicTickSentence(result));
        else info(epicTickSentence(result));
        ticks = [...ticks, epicTickWrite(result)];
      },
    }, closedIssuesIn(body));
  } catch (error) {
    warn(epicTickProblemLine(messageOf(error)));
  }

  const report = await unblockAfterMerge({ body, gh, ask, info, warn });
  return Object.freeze([...ticks, ...unblockWrites(report)]);
}

/** The `labels` adapter over `options.gh`; the module note holds what each member answers. */
export function createLabelsRelations(options: LabelsRelationsOptions): BoardRelations {
  const { gh } = options;
  const seams = { gh, bodies: options.bodies ?? createGhRoadmapBody({ gh }) };
  const relations: BoardRelations = {
    mode: 'labels',
    listFields: boardListFields('labels'),
    read: readLabels,
    setParent: (listing, change) => setLabelsParent(seams, listing, change),
    removeParent: (listing, change) => removeLabelsParent(seams, listing, change),
    addBlocker: (listing, change) => addLabelsBlocker(seams, listing, change),
    removeBlocker: (listing, change) => removeLabelsBlocker(seams, listing, change),
    afterMerge: (request) => afterMerge(gh, request),
  };
  return Object.freeze(relations);
}
