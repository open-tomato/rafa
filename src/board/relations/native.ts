/**
 * The `native` relationships adapter: GitHub's own sub-issue parent and
 * blocked-by links behind the `BoardRelations` port (`./port.ts`), the
 * `native` value of `board.relationships`
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode").
 *
 * Its reads are pure over the one listing `parseBoardListing`
 * (`../roadmap-board.ts`) read in the `native` mode, whose rows carry
 * `parent`, `blockedBy`, `blocking`, `subIssuesSummary` and `subIssues`.
 * Nothing in a read spawns, lists again or asks an issue's state one at a
 * time: a blocker's state is its `blockedBy` node's. It never reads an
 * `epic:` label, `spec:blocked` or a `Blocked by:` line; those are the
 * `labels` mode's marks, and `rafa doctor` names them.
 *
 * ## The board's repository
 *
 * A linked issue's `repository` is read off its `url` and is always
 * `owner/name`, this board's own included (`context/pull-requests.md`,
 * "Native relationships"). The adapter is made with the board's
 * repository and answers a link on it with `repository: null`, as the
 * port's {@link RelatedIssue} spells a local issue, and any other with its
 * `owner/name`. GitHub reads `owner/name` without regard to case, so the
 * two are compared the same way. Only a local link is looked up on the
 * listing: a foreign `#7` is never this board's `#7`.
 *
 * ## A listing without the native fields
 *
 * `read` refuses a listing any row of which lacks one of the five native
 * keys, and each read refuses an issue handed to it that lacks them, with
 * a `TypeError` naming `board.relationships`: a `labels`-mode row read
 * here would otherwise answer no epic and no blocker for every issue.
 *
 * ## epicOf
 *
 * An epic row is in no epic, and so is an issue whose `parent` is null.
 * An issue whose `parent` is a local issue the listing holds typed `epic`
 * is in that epic, marked `#<n>`. Any other parent — a local issue not on
 * the listing or not typed `epic`, or one on another repository, marked
 * `owner/name#<n>` — is `unresolved`, one mark with no owner.
 *
 * ## membersOf
 *
 * An epic's members are the rows on the listing whose `parent` is that
 * epic, open and closed, never an epic themselves: `parent` decides who is
 * in. Their order is the epic's `subIssues` order, which
 * `context/pull-requests.md` ("`gh issue list --json subIssues` answers
 * the order GitHub holds") measured to be the order GitHub holds and to
 * move when it is reprioritised, so it is never sorted by number. A
 * member the epic's nodes do not name, which happens only past the 100
 * nodes `gh` answers or on a row read at another time than its epic's,
 * comes after the named ones in ascending number, since GitHub told the
 * listing nothing of its place. The reading keeps `truncated` when the
 * epic's `subIssues` did, and leaves the key out otherwise. A row not
 * typed `epic` is refused with a `TypeError`.
 *
 * ## blockersOf
 *
 * An issue with no `blockedBy` node waits on nothing. One with nodes is
 * `blocked`, naming each node in the order `gh` answered them, foreign
 * repositories kept with their own `owner/name` and the state the node
 * carries, whatever the blocker closed as. The reading keeps `truncated`
 * when the `blockedBy` list did, so `isWaiting` holds the issue back
 * rather than read a short list as the whole. A native reading has no
 * fault: GitHub holds one blocker per link.
 *
 * ## freedBy
 *
 * The port's rule over this adapter's `blockersOf`, spelled once for
 * both adapters in `./freed.ts`.
 *
 * ## Writes
 *
 * The native writes (`gh issue edit --parent`, `--remove-parent`,
 * `--add-blocked-by`, `--remove-blocked-by`) and an `afterMerge` that
 * writes nothing are the plan's next task. Until it lands, every write
 * member rejects naming itself and sends nothing; no command reaches this
 * adapter before `selectBoardRelations` does, which comes after them.
 */
import type {
  Blocker,
  BlockersReading,
  BoardRelations,
  EpicOfReading,
  MembersReading,
  RelatedIssue,
  RelationsReading,
  RelationWrite,
} from './port.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks } from '../roadmap-board.js';

import { boardListFields } from '../roadmap-board.js';

import { freedByOver } from './freed.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board relations native';

/** The five keys every row of a `native`-mode listing carries. */
const NATIVE_KEYS = ['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues'] as const;

/** A repository as `owner/name`, each part free of `/` and whitespace. */
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/u;

/** What {@link createNativeRelations} is made with. */
export interface NativeRelationsOptions {
  /** Runs every `gh` command the writes send. */
  readonly gh: GhRunner;
  /** The board's own repository, `owner/name`; see the module note. */
  readonly repository: string;
}

/** A row's native fields, read once it is known to carry all five. */
interface NativeFields {
  readonly parent: BoardIssueLink | null;
  readonly blockedBy: BoardIssueLinks;
  readonly subIssues: BoardIssueLinks;
}

/** `row`'s native fields; throws a `TypeError` naming `board.relationships` when any of the five is missing. */
function nativeFieldsOf(row: BoardIssue): NativeFields {
  const missing = NATIVE_KEYS.filter((key) => !Object.hasOwn(row, key));
  if (missing.length > 0) {
    throw new TypeError(
      `${PREFIX}: issue #${String(row.number)} was read without ${missing.join(', ')}; `
      + 'board.relationships is native, so the listing must be read with the native fields',
    );
  }
  return { parent: row.parent ?? null, blockedBy: row.blockedBy ?? { nodes: [] }, subIssues: row.subIssues ?? { nodes: [] } };
}

/** Answers `link` as the port names an issue: `repository` null on `board`, its `owner/name` elsewhere. */
function relatedOf(link: BoardIssueLink, board: string): RelatedIssue {
  return link.repository.toLowerCase() === board.toLowerCase()
    ? { number: link.number, repository: null }
    : { number: link.number, repository: link.repository };
}

/** `related` as a mark: `#<n>` on this board, `owner/name#<n>` elsewhere. */
function markOf(related: RelatedIssue): string {
  return `${related.repository ?? ''}#${String(related.number)}`;
}

/** `issue`'s epic; the module note holds the three answers. */
function epicOf(issue: BoardIssue, byNumber: ReadonlyMap<number, BoardIssue>, board: string): EpicOfReading {
  const { parent } = nativeFieldsOf(issue);
  if (issue.type === 'epic' || parent === null) return Object.freeze({ kind: 'none', issue: issue.number });
  const related = relatedOf(parent, board);
  const mark = markOf(related);
  const owner = related.repository === null
    ? byNumber.get(related.number)
    : undefined;
  if (owner?.type === 'epic') return Object.freeze({ kind: 'epic', issue: issue.number, epic: owner.number, mark });
  return Object.freeze({
    kind: 'unresolved',
    issue: issue.number,
    marks: Object.freeze([Object.freeze({ mark, owners: Object.freeze([]) })]),
  });
}

/** True when `row`'s parent is local issue `epic`. */
function isChildOf(row: BoardIssue, epic: number, board: string): boolean {
  const { parent } = nativeFieldsOf(row);
  if (parent === null) return false;
  const related = relatedOf(parent, board);
  return related.repository === null && related.number === epic;
}

/** `epic`'s members in its order; the module note holds the order. Throws a `TypeError` for a row that is no epic. */
function membersOf(epic: BoardIssue, listing: readonly BoardIssue[], board: string): MembersReading {
  if (epic.type !== 'epic') {
    throw new TypeError(`${PREFIX}: membersOf refused #${String(epic.number)}, which is not typed epic, so it has no members`);
  }
  const { subIssues } = nativeFieldsOf(epic);
  const children = listing.filter((row) => row.type !== 'epic' && isChildOf(row, epic.number, board));
  const byNumber = new Map(children.map((row) => [row.number, row]));
  const named = [...new Set(subIssues.nodes
    .map((node) => relatedOf(node, board))
    .filter((related) => related.repository === null && byNumber.has(related.number))
    .map((related) => related.number))];
  const unnamed = children
    .map((row) => row.number)
    .filter((number) => !named.includes(number))
    .sort((left, right) => left - right);
  const members = Object.freeze([...named, ...unnamed].flatMap((number) => byNumber.get(number) ?? []));
  return subIssues.truncated === undefined
    ? Object.freeze({ epic: epic.number, members })
    : Object.freeze({ epic: epic.number, members, truncated: Object.freeze({ total: subIssues.truncated.total }) });
}

/** What `issue` waits on; the module note holds the reading. */
function blockersOf(issue: BoardIssue, board: string): BlockersReading {
  const { blockedBy } = nativeFieldsOf(issue);
  if (blockedBy.nodes.length === 0) return Object.freeze({ kind: 'none', issue: issue.number });
  const blockers = Object.freeze(blockedBy.nodes.map((node): Blocker => Object.freeze({
    ...relatedOf(node, board),
    state: node.state,
  })));
  return blockedBy.truncated === undefined
    ? Object.freeze({ kind: 'blocked', issue: issue.number, blockers })
    : Object.freeze({
      kind: 'blocked',
      issue: issue.number,
      blockers,
      truncated: Object.freeze({ total: blockedBy.truncated.total }),
    });
}

/** The four reads over `listing` on `board`; refuses a listing read without the native fields. */
function readNative(listing: readonly BoardIssue[], board: string): RelationsReading {
  for (const row of listing) nativeFieldsOf(row);
  const byNumber = new Map(listing.map((row) => [row.number, row]));
  const blockers = (issue: BoardIssue): BlockersReading => blockersOf(issue, board);
  return Object.freeze({
    epicOf: (issue: BoardIssue) => epicOf(issue, byNumber, board),
    membersOf: (epic: BoardIssue) => membersOf(epic, listing, board),
    blockersOf: blockers,
    freedBy: (closed: readonly number[]) => freedByOver(listing, closed, blockers),
  });
}

/** A write member not yet built; rejects naming it and sends nothing. See the module note. */
function pendingWrite(member: string): Promise<readonly RelationWrite[]> {
  return Promise.reject(new Error(`${PREFIX}: ${member} is not built yet; the native writes land with the plan's next task`));
}

/**
 * The `native` adapter over `options.gh` for the board on
 * `options.repository`; the module note holds what each member answers.
 * Throws a `TypeError` when `repository` is not `owner/name`.
 */
export function createNativeRelations(options: NativeRelationsOptions): BoardRelations {
  const { repository } = options;
  if (!REPOSITORY.test(repository)) {
    throw new TypeError(`${PREFIX}: the board's repository "${repository}" is not owner/name`);
  }
  const relations: BoardRelations = {
    mode: 'native',
    listFields: boardListFields('native'),
    read: (listing) => readNative(listing, repository),
    setParent: () => pendingWrite('setParent'),
    removeParent: () => pendingWrite('removeParent'),
    addBlocker: () => pendingWrite('addBlocker'),
    removeBlocker: () => pendingWrite('removeBlocker'),
    afterMerge: () => pendingWrite('afterMerge'),
  };
  return Object.freeze(relations);
}
