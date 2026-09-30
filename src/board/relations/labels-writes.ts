/**
 * The four relationship writes of the `labels` adapter (`./labels.ts`):
 * an issue moved into an epic or out of it, and a blocker added to an
 * issue or taken off it, each through the adapter's `GhRunner`
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode").
 *
 * In `labels` mode membership IS the `epic:<slug>` label and the epic's
 * checklist orders it (`../epics.ts`, `../epic-walk.ts`); waiting is the
 * `spec:blocked` label with the `Blocked by:` line (`../blocked.ts`).
 * Every write here reads what it edits off the listing handed in, as the
 * port note on `./port.ts` requires, and assembles its own `gh` argv; no
 * command spells one.
 *
 * ## Moving an issue between epics
 *
 * {@link setLabelsParent} makes the writes `rafa epic move`'s
 * `applyEpicMove` (`src/commands/epic/move.ts`) makes, in its order:
 *
 * 1. One `gh issue edit <n>` taking every `epic:` label the issue carries
 *    but the target's off and putting the target's on, the swap
 *    `IssueBoard.swapLabels` sends for an issue in one epic. This is the
 *    relationship, so a refusal rejects and nothing else is sent. An issue
 *    carrying the target's label alone sends nothing and answers
 *    `unchanged`.
 * 2. The target epic's checklist gains the issue's line (`appendLine`,
 *    ticked when the old line was, or when the issue is closed and had no
 *    line), carrying the old line's why or the issue's title.
 * 3. Each epic it left, by the slug that epic owns (its first `epic:`
 *    label, as `readEpics` reads it), loses the line (`removeLine`).
 *
 * The checklist edits go through `editChecklist`
 * (`../epic-checklist.ts`), which reads each body afresh, writes, reads
 * it back and retries; an edit that ends `failed` is a
 * {@link RelationWrite} with status `failed`, never a rejection, since the
 * label already moved. Each checklist write carries `editChecklist`'s
 * `attempts`, the one write here that does. {@link removeLabelsParent}
 * is steps 1 and 3 with nothing put on.
 *
 * The target must be an epic on the listing carrying an `epic:` label,
 * and the issue must be on the listing and not an epic: anything else is
 * refused before a call is sent.
 *
 * ## Adding and removing a blocker
 *
 * One `gh issue edit <n> --body=<body>` carrying the edited `Blocked by:`
 * line (`./labels-blocked-edit.ts`), with `--add-label spec:blocked` in
 * the same call when the issue lacks it, or `--remove-label` for the
 * label as the issue carries it, whatever its case, when the line was
 * removed whole. Body and label land together or not
 * at all, so there is no later step to fail. A blocker already named, or
 * one the line does not name, sends nothing and answers `unchanged`. An
 * issue made to wait on itself is refused before a call.
 *
 * The body written is the listing's, edited: the listing is the one read
 * the command holds, and a `Blocked by:` edit racing another edit of the
 * same body loses that edit. The checklist edits above read afresh
 * because an epic's body is edited by every move into and out of it.
 */
import type { BlockerChange, ParentChange, ParentRemoval, RelationWrite, RelationWriteStatus } from './port.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { ChecklistEditResult } from '../epic-checklist.js';
import type { BoardIssue } from '../roadmap-board.js';
import type { RoadmapBody } from '../roadmap-tick.js';

import { describeValue } from '../../config-sections.js';
import { hasSpecBlockedLabel, SPEC_BLOCKED_LABEL } from '../blocked.js';
import { appendLine, editChecklist, removeLine, tickLine } from '../epic-checklist.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf, readEpics } from '../epics.js';
import { parseRoadmapBody } from '../roadmap.js';

import { addBlockerToBody, blockerToken, removeBlockerFromBody } from './labels-blocked-edit.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board relations labels';

/** No claims: `readEpics` is read here for slugs and owners alone. */
const NO_CLAIMS: ReadonlySet<number> = new Set();

/** The day handed to `readEpics`, whose lateness is not read here. */
const UNREAD_DAY = new Date(0);

/** What every write is made with. */
export interface LabelsWriteSeams {
  /** Runs the label and body edits. */
  readonly gh: GhRunner;
  /** Reads and writes an epic's body for its checklist edits. */
  readonly bodies: RoadmapBody;
}

/** `#<n>`, as every line here names an issue. */
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

/** `listing`'s row numbered `issue`; refuses, before any write, when it is missing. */
function rowOf(listing: readonly BoardIssue[], issue: number, member: string): BoardIssue {
  const row = listing.find((candidate) => candidate.number === issue);
  if (row === undefined) {
    throw new Error(`${PREFIX}: ${member} refused ${ref(issue)}, which is not on the board listing, so nothing was changed`);
  }
  return row;
}

/** What a failed `gh` call wrote, for a message. Never empty. */
function detailOf(result: GhResult): string {
  return result.stderr.trim() || result.stdout.trim() || 'gh failed and wrote nothing';
}

/** Sends `args`, the relationship write named `what`; rejects saying nothing changed when `gh` refuses it. */
async function sendRelationship(gh: GhRunner, args: readonly string[], what: string): Promise<void> {
  const result = await gh(args);
  if (!result.ok) throw new Error(`${PREFIX}: ${what} was refused, so nothing was changed: ${detailOf(result)}`);
}

/** The `gh issue edit` argv taking `removed` off `issue` and putting `added` on. */
function labelEditArgs(issue: number, removed: readonly string[], added: readonly string[]): readonly string[] {
  return [
    'issue',
    'edit',
    String(issue),
    ...removed.flatMap((label) => ['--remove-label', label]),
    ...added.flatMap((label) => ['--add-label', label]),
  ];
}

/** One write, spelled. */
function written(issue: number, what: string, status: RelationWriteStatus, problem: string | null = null): RelationWrite {
  return Object.freeze({ issue, what, status, problem });
}

/** A checklist edit's status as a write's. */
function checklistStatus(result: ChecklistEditResult): RelationWriteStatus {
  if (result.status === 'failed') return 'failed';
  return result.status === 'edited'
    ? 'written'
    : 'unchanged';
}

/** What a checklist edit came to, as a write carrying its attempts. */
function checklistWrite(result: ChecklistEditResult, what: string): RelationWrite {
  const problem = result.status === 'failed'
    ? result.problem
    : null;
  return Object.freeze({ ...written(result.issue, what, checklistStatus(result), problem), attempts: result.attempts });
}

/** The open or closed epics owning `slug`, as `readEpics` reads an epic's slug, ascending. */
function ownersOf(listing: readonly BoardIssue[], slug: string): readonly BoardIssue[] {
  const numbers = new Set(readEpics({ issues: listing, claims: NO_CLAIMS, today: UNREAD_DAY }).epics
    .filter((epic) => epic.slug === slug)
    .map((epic) => epic.number));
  return listing.filter((row) => numbers.has(row.number)).sort((left, right) => left.number - right.number);
}

/** The issue that moves, checked: on the listing and no epic. */
function memberRow(listing: readonly BoardIssue[], issue: number, member: string): BoardIssue {
  const row = rowOf(listing, issueNumber(issue, member), member);
  if (row.type === 'epic') {
    throw new Error(`${PREFIX}: ${member} refused ${ref(issue)}, which is an epic, and an epic belongs to no epic; nothing was changed`);
  }
  return row;
}

/** The target epic's slug, checked: an epic on the listing carrying an `epic:` label. */
function targetSlug(listing: readonly BoardIssue[], parent: number): string {
  const row = rowOf(listing, issueNumber(parent, 'setParent'), 'setParent');
  const slug = epicSlugsOf(row.labels)[0];
  if (row.type !== 'epic' || slug === undefined) {
    throw new Error(`${PREFIX}: setParent refused epic ${ref(parent)}, which is not an epic carrying an ${EPIC_LABEL_PREFIX}`
      + ' label, so it has no label to give; nothing was changed');
  }
  return slug;
}

/** The line `issue` moves with: the old epic's line's why and tick, else its title and whether it is closed. */
function movedLine(leaving: readonly BoardIssue[], issue: BoardIssue): { readonly why: string; readonly ticked: boolean } {
  const old = leaving.flatMap((epic) => parseRoadmapBody(epic.body)).find((line) => line.issue === issue.number);
  const why = old === undefined || old.why === ''
    ? issue.title
    : old.why;
  return { why, ticked: old?.ticked ?? issue.state === 'CLOSED' };
}

/** Takes `issue`'s line off each epic in `leaving`, one write each. */
async function removeLines(seams: LabelsWriteSeams, leaving: readonly BoardIssue[], issue: number): Promise<readonly RelationWrite[]> {
  let writes: readonly RelationWrite[] = [];
  for (const epic of leaving) {
    const result = await editChecklist({ issue: epic.number, edit: (body) => removeLine(body, issue), board: seams.bodies });
    writes = [...writes, checklistWrite(result, `take ${ref(issue)}'s line off epic ${ref(epic.number)}'s checklist`)];
  }
  return writes;
}

/** Moves `change.issue` into `change.parent`; the module note holds the writes and their order. */
export async function setLabelsParent(
  seams: LabelsWriteSeams,
  listing: readonly BoardIssue[],
  change: ParentChange,
): Promise<readonly RelationWrite[]> {
  const row = memberRow(listing, change.issue, 'setParent');
  const slug = targetSlug(listing, change.parent);
  const carried = epicSlugsOf(row.labels);
  const what = `move ${ref(row.number)} into epic ${ref(change.parent)}`;
  if (carried.length === 1 && carried[0] === slug) return [written(row.number, what, 'unchanged')];

  const leftSlugs = carried.filter((each) => each !== slug);
  const added = carried.includes(slug)
    ? []
    : [`${EPIC_LABEL_PREFIX}${slug}`];
  await sendRelationship(seams.gh, labelEditArgs(row.number, leftSlugs.map((each) => `${EPIC_LABEL_PREFIX}${each}`), added), what);

  const leaving = leftSlugs.flatMap((each) => ownersOf(listing, each));
  const line = movedLine(leaving, row);
  const appended = await editChecklist({
    issue: change.parent,
    edit: (body) => (line.ticked
      ? tickLine(appendLine(body, row.number, line.why), row.number)
      : appendLine(body, row.number, line.why)),
    board: seams.bodies,
  });
  return [
    written(row.number, what, 'written'),
    checklistWrite(appended, `put ${ref(row.number)}'s line on epic ${ref(change.parent)}'s checklist`),
    ...await removeLines(seams, leaving, row.number),
  ];
}

/** Takes `change.issue` out of every epic its labels name; the module note holds the writes. */
export async function removeLabelsParent(
  seams: LabelsWriteSeams,
  listing: readonly BoardIssue[],
  change: ParentRemoval,
): Promise<readonly RelationWrite[]> {
  const row = memberRow(listing, change.issue, 'removeParent');
  const carried = epicSlugsOf(row.labels);
  const what = `take ${ref(row.number)} out of its epic`;
  if (carried.length === 0) return [written(row.number, what, 'unchanged')];

  await sendRelationship(seams.gh, labelEditArgs(row.number, carried.map((each) => `${EPIC_LABEL_PREFIX}${each}`), []), what);
  const leaving = carried.flatMap((each) => ownersOf(listing, each));
  return [written(row.number, what, 'written'), ...await removeLines(seams, leaving, row.number)];
}

/** The issue a blocker write edits, checked: on the listing, and not its own blocker. */
function waitingRow(listing: readonly BoardIssue[], change: BlockerChange, member: string): BoardIssue {
  const row = rowOf(listing, issueNumber(change.issue, member), member);
  issueNumber(change.blocker.number, member);
  if (change.blocker.repository === null && change.blocker.number === row.number) {
    throw new Error(`${PREFIX}: ${member} refused to make ${ref(row.number)} wait on itself; nothing was changed`);
  }
  return row;
}

/** Makes `change.issue` wait on `change.blocker`; the module note holds the one call. */
export async function addLabelsBlocker(
  seams: LabelsWriteSeams,
  listing: readonly BoardIssue[],
  change: BlockerChange,
): Promise<readonly RelationWrite[]> {
  const row = waitingRow(listing, change, 'addBlocker');
  const what = `make ${ref(row.number)} wait on ${blockerToken(change.blocker)}`;
  const body = addBlockerToBody(row.number, row.body, change.blocker);
  const labelled = hasSpecBlockedLabel(row.labels);
  if (body === row.body && labelled) return [written(row.number, what, 'unchanged')];

  const args = [
    ...labelEditArgs(row.number, [], labelled
      ? []
      : [SPEC_BLOCKED_LABEL]),
    ...body === row.body
      ? []
      : [`--body=${body}`],
  ];
  await sendRelationship(seams.gh, args, what);
  return [written(row.number, what, 'written')];
}

/** Stops `change.issue` waiting on `change.blocker`; the module note holds the one call. */
export async function removeLabelsBlocker(
  seams: LabelsWriteSeams,
  listing: readonly BoardIssue[],
  change: BlockerChange,
): Promise<readonly RelationWrite[]> {
  const row = waitingRow(listing, change, 'removeBlocker');
  const what = `stop ${ref(row.number)} waiting on ${blockerToken(change.blocker)}`;
  const removal = removeBlockerFromBody(row.number, row.body, change.blocker);
  if (removal.body === row.body) return [written(row.number, what, 'unchanged')];

  const carried = row.labels.filter((label) => hasSpecBlockedLabel([label]));
  const args = [
    ...labelEditArgs(row.number, removal.emptied
      ? carried
      : [], []),
    `--body=${removal.body}`,
  ];
  await sendRelationship(seams.gh, args, what);
  return [written(row.number, what, 'written')];
}
