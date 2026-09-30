/**
 * The four relationship writes of the `native` adapter (`./native.ts`):
 * an issue moved into an epic or out of it, and a blocker added to an
 * issue or taken off it, each one `gh issue edit` through the adapter's
 * `GhRunner` (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode").
 *
 * In `native` mode membership IS GitHub's sub-issue `parent` link and
 * waiting IS its `blockedBy` link, so each write is the one flag of
 * `gh issue edit` that sets that link, and nothing follows it: no label,
 * no checklist line, no `Blocked by:` line. The argv is assembled here
 * and never in a command, as the port note on `./port.ts` requires.
 *
 * | Member | argv |
 * |---|---|
 * | `setParent` | `issue edit <n> --parent <epic>` |
 * | `removeParent` | `issue edit <n> --remove-parent` |
 * | `addBlocker` | `issue edit <n> --add-blocked-by <blocker>` |
 * | `removeBlocker` | `issue edit <n> --remove-blocked-by <blocker>` |
 *
 * No argv carries `-R`: `gh` resolves the board's repository from the
 * directory the runner runs in, as every `labels` write does.
 *
 * ## Moving an issue that already has an epic
 *
 * `context/pull-requests.md` ("`gh issue edit --parent` on an issue that
 * has a parent moves it") measured that `--parent` sends `addSubIssue`
 * with `replaceParent: true`, which moves the issue out of its old parent
 * in the same call. The alternative the plan allowed for, `--parent`
 * refusing an issue that has a parent, is what the mutation does WITHOUT
 * `replaceParent`, and `gh` never sends that. So {@link setNativeParent}
 * sends one call whatever parent the issue had, and never a
 * `--remove-parent` first: a remove first would leave the issue in no
 * epic if the move then failed. The moved issue goes last in its new
 * epic's order, as the same answer records.
 *
 * ## A blocker on another repository
 *
 * A local blocker is written by number. A foreign one is written by its
 * issue URL, `https://github.com/<owner>/<name>/issues/<n>`, which
 * `gh`'s `ResolveIssueRef` resolves to its own repository
 * (`context/pull-requests.md`, "A blocker in another repository adds and
 * reads with its own state"). `gh` refuses a URL on another host than
 * the board's, so a board on a GitHub Enterprise host cannot be given a
 * foreign blocker through this adapter; a blocker whose `repository` is
 * the board's own, in any case, is written as a local one.
 *
 * ## Nothing to send
 *
 * Each write reads the issue's row off the listing first, as the port
 * note requires, and refuses before sending anything when the row is
 * missing or was read without the native fields. When the row already
 * holds what the write asks for — its parent is the epic, it has no
 * parent, the blocker is one of its `blockedBy` nodes, or it is not —
 * the write answers `unchanged` and sends nothing. A `blockedBy` list
 * `gh` truncated does not prove a blocker absent, so `addBlocker` and
 * `removeBlocker` send their call on a truncated list whatever its nodes
 * say.
 *
 * ## Refusals
 *
 * The one call is the relationship, so a call `gh` refuses REJECTS
 * naming the write and saying nothing changed, as the port note
 * requires, and a write that went through is one `written` record naming
 * the issue, the row a kept listing drops (`invalidateRows`,
 * `../board-cache.ts`): a relationship write moves no `updated_at`.
 */
import type { BlockerChange, ParentChange, ParentRemoval, RelatedIssue, RelationWrite, RelationWriteStatus } from './port.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks } from '../roadmap-board.js';

import { describeValue } from '../../config-sections.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board relations native';

/** A repository as `owner/name`, each part free of `/` and whitespace. */
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/u;

/** The host a foreign blocker's URL names; see the module note. */
const GITHUB_HOST = 'https://github.com';

/** What every write is made with. */
export interface NativeWriteSeams {
  /** Runs the one `gh issue edit` each write sends. */
  readonly gh: GhRunner;
  /** The board's own repository, `owner/name`. */
  readonly repository: string;
}

/** A row's native link fields a write reads. */
interface WriteFields {
  readonly parent: BoardIssueLink | null;
  readonly blockedBy: BoardIssueLinks;
}

/** `#<n>`, as every line here names a local issue. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** `value`, checked as an issue number a write was handed. */
function issueNumber(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${PREFIX}: ${member} refused issue number ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

/** True when `repository` names the board's own repository, compared without regard to case. */
function isBoard(repository: string, board: string): boolean {
  return repository.toLowerCase() === board.toLowerCase();
}

/** `listing`'s row numbered `issue`, checked; refuses, before any write, when it is missing or lacks the native fields. */
function rowOf(listing: readonly BoardIssue[], issue: number, member: string): { readonly row: BoardIssue; readonly fields: WriteFields } {
  const number = issueNumber(issue, member);
  const row = listing.find((candidate) => candidate.number === number);
  if (row === undefined) {
    throw new Error(`${PREFIX}: ${member} refused ${ref(issue)}, which is not on the board listing, so nothing was changed`);
  }
  if (!Object.hasOwn(row, 'parent') || !Object.hasOwn(row, 'blockedBy')) {
    throw new TypeError(
      `${PREFIX}: ${member} refused ${ref(issue)}, which was read without parent and blockedBy; `
      + 'board.relationships is native, so the listing must be read with the native fields',
    );
  }
  return { row, fields: { parent: row.parent ?? null, blockedBy: row.blockedBy ?? { nodes: [] } } };
}

/** The issue that moves, checked: on the listing and no epic. */
function memberRow(listing: readonly BoardIssue[], issue: number, member: string): { readonly row: BoardIssue; readonly fields: WriteFields } {
  const found = rowOf(listing, issue, member);
  if (found.row.type === 'epic') {
    throw new Error(`${PREFIX}: ${member} refused ${ref(issue)}, which is an epic, and an epic belongs to no epic; nothing was changed`);
  }
  return found;
}

/** The target epic, checked: an issue on the listing typed `epic`. */
function targetEpic(listing: readonly BoardIssue[], parent: number): number {
  const number = issueNumber(parent, 'setParent');
  const row = listing.find((candidate) => candidate.number === number);
  if (row?.type !== 'epic') {
    throw new Error(`${PREFIX}: setParent refused epic ${ref(parent)}, which is not an issue typed epic on the board listing;`
      + ' nothing was changed');
  }
  return row.number;
}

/** `blocker` with the board's own repository spelled null, as the port names a local issue; refuses a malformed one. */
function normalBlocker(blocker: RelatedIssue, board: string, member: string): RelatedIssue {
  const number = issueNumber(blocker.number, member);
  const { repository } = blocker;
  if (repository === null || isBoard(repository, board)) return { number, repository: null };
  if (!REPOSITORY.test(repository)) {
    throw new TypeError(`${PREFIX}: ${member} refused blocker repository "${repository}", which is not owner/name`);
  }
  return { number, repository };
}

/** `blocker` as `gh issue edit` takes it: its number on the board, its URL elsewhere; the move's writer (`./move.ts`) sends it too. */
export function blockerArg(blocker: RelatedIssue): string {
  return blocker.repository === null
    ? String(blocker.number)
    : `${GITHUB_HOST}/${blocker.repository}/issues/${String(blocker.number)}`;
}

/** `blocker` as a line names it: `#<n>`, or `owner/name#<n>`. */
function blockerToken(blocker: RelatedIssue): string {
  return `${blocker.repository ?? ''}${ref(blocker.number)}`;
}

/** True when one of `blockedBy`'s nodes is `blocker`. */
function holdsBlocker(blockedBy: BoardIssueLinks, blocker: RelatedIssue, board: string): boolean {
  return blockedBy.nodes.some((node) => node.number === blocker.number
    && (blocker.repository === null
      ? isBoard(node.repository, board)
      : isBoard(node.repository, blocker.repository)));
}

/** What a failed `gh` call wrote, for a message. Never empty. */
function detailOf(result: GhResult): string {
  return result.stderr.trim() || result.stdout.trim() || 'gh failed and wrote nothing';
}

/** One write, spelled. */
function written(issue: number, what: string, status: RelationWriteStatus): readonly RelationWrite[] {
  return Object.freeze([Object.freeze({ issue, what, status, problem: null })]);
}

/** Sends the one `gh issue edit <issue> ...flags` named `what`; rejects saying nothing changed when `gh` refuses it. */
async function send(gh: GhRunner, issue: number, flags: readonly string[], what: string): Promise<readonly RelationWrite[]> {
  const result = await gh(['issue', 'edit', String(issue), ...flags]);
  if (!result.ok) throw new Error(`${PREFIX}: ${what} was refused, so nothing was changed: ${detailOf(result)}`);
  return written(issue, what, 'written');
}

/** Moves `change.issue` into `change.parent` in one call; the module note holds why no remove goes first. */
export async function setNativeParent(
  seams: NativeWriteSeams,
  listing: readonly BoardIssue[],
  change: ParentChange,
): Promise<readonly RelationWrite[]> {
  const { row, fields } = memberRow(listing, change.issue, 'setParent');
  const epic = targetEpic(listing, change.parent);
  const what = `move ${ref(row.number)} into epic ${ref(epic)}`;
  const { parent } = fields;
  if (parent !== null && parent.number === epic && isBoard(parent.repository, seams.repository)) {
    return written(row.number, what, 'unchanged');
  }
  return send(seams.gh, row.number, ['--parent', String(epic)], what);
}

/** Takes `change.issue` out of its epic in one call. */
export async function removeNativeParent(
  seams: NativeWriteSeams,
  listing: readonly BoardIssue[],
  change: ParentRemoval,
): Promise<readonly RelationWrite[]> {
  const { row, fields } = memberRow(listing, change.issue, 'removeParent');
  const what = `take ${ref(row.number)} out of its epic`;
  if (fields.parent === null) return written(row.number, what, 'unchanged');
  return send(seams.gh, row.number, ['--remove-parent'], what);
}

/** The issue a blocker write edits and the blocker, checked: on the listing, and not its own blocker. */
function blockerWrite(
  seams: NativeWriteSeams,
  listing: readonly BoardIssue[],
  change: BlockerChange,
  member: string,
): { readonly row: BoardIssue; readonly fields: WriteFields; readonly blocker: RelatedIssue } {
  const { row, fields } = rowOf(listing, change.issue, member);
  const blocker = normalBlocker(change.blocker, seams.repository, member);
  if (blocker.repository === null && blocker.number === row.number) {
    throw new Error(`${PREFIX}: ${member} refused to make ${ref(row.number)} wait on itself; nothing was changed`);
  }
  return { row, fields, blocker };
}

/** Makes `change.issue` wait on `change.blocker` in one call; the module note holds when it sends nothing. */
export async function addNativeBlocker(
  seams: NativeWriteSeams,
  listing: readonly BoardIssue[],
  change: BlockerChange,
): Promise<readonly RelationWrite[]> {
  const { row, fields, blocker } = blockerWrite(seams, listing, change, 'addBlocker');
  const what = `make ${ref(row.number)} wait on ${blockerToken(blocker)}`;
  if (fields.blockedBy.truncated === undefined && holdsBlocker(fields.blockedBy, blocker, seams.repository)) {
    return written(row.number, what, 'unchanged');
  }
  return send(seams.gh, row.number, ['--add-blocked-by', blockerArg(blocker)], what);
}

/** Stops `change.issue` waiting on `change.blocker` in one call; the module note holds when it sends nothing. */
export async function removeNativeBlocker(
  seams: NativeWriteSeams,
  listing: readonly BoardIssue[],
  change: BlockerChange,
): Promise<readonly RelationWrite[]> {
  const { row, fields, blocker } = blockerWrite(seams, listing, change, 'removeBlocker');
  const what = `stop ${ref(row.number)} waiting on ${blockerToken(blocker)}`;
  if (fields.blockedBy.truncated === undefined && !holdsBlocker(fields.blockedBy, blocker, seams.repository)) {
    return written(row.number, what, 'unchanged');
  }
  return send(seams.gh, row.number, ['--remove-blocked-by', blockerArg(blocker)], what);
}
