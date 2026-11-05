/**
 * The release's stale-docs issue: one `chore` issue per release version
 * holding, as one checklist item each, the documentation lines a doc task
 * could not settle. {@link addStaleDocLine} adds one line to it.
 *
 * ## The issue
 *
 * Its title is {@link staleDocsTitle}, `Release <version>: update stale
 * docs`, and its body opens with {@link STALE_DOCS_MARKER}, the comment
 * `<!-- rafa:stale-docs -->`, which is how a reader tells the issue from
 * a person's issue of the same title. Each line is one unticked item,
 * `- [ ] <where>: <what>`, built by {@link staleDocLine}; an entry that
 * named no place is `- [ ] <what>`.
 *
 * ## The version
 *
 * {@link staleDocsVersion} names `<version>`, from what the caller has
 * read, so nothing here reads a file or git:
 *
 *   - release off: the word `next` ({@link NEXT_VERSION});
 *   - the settle forecast names a version (`settles`): that version;
 *   - the forecast names none (`none`, `empty`, `failed`, or not read):
 *     the patch bump of the version file's value;
 *   - that value is absent or no semantic version either: `next`, since
 *     no version can be named and the issue still needs a title.
 *
 * A forecast that shifts between two runs, a patch that becomes a minor,
 * names a new title. With a release reading the open issue of the old
 * title is retitled to the new one (below); without one a second issue
 * opens. That is why the readers of the open lines take every open issue
 * carrying the marker.
 *
 * ## Finding the issue
 *
 * `tracker.openIssues('chore')`, kept to those whose body holds the
 * marker. The caller's release reading, `newestRelease`, is the version
 * of the newest root release tag (null for none), and decides which of
 * them may take the line:
 *
 *   - read: an issue whose title, read back by
 *     {@link staleDocsTitleVersion}, names `next` or a semantic version
 *     above the newest tag ({@link isUnreleasedVersion}). A title naming
 *     a version at or below that tag is a released issue and is never
 *     touched, its own exact title included, and a title naming no
 *     version is a person's and is left alone too;
 *   - not read, or no semantic version: an issue whose title is the
 *     title exactly, and no retitle.
 *
 * Of those, the one titled for the version, else the oldest
 * ({@link olderFirst}: the earlier `createdAt`, then the lower issue
 * number, so every caller agrees which is oldest). Found: its body with
 * the item below it, written back whole through `tracker.edit` (the
 * port's `edit` writes a body whole; an append is the caller's), with the
 * title in the same edit when it differs, which is a moved forecast; the
 * answer carries `retitledFrom`. A line whose text the body already holds
 * as a checklist item, ticked or not, is not added a second time: the
 * answer is `held` and nothing but a needed retitle is written.
 *
 * ## Creating, and converging after it
 *
 * Only when no open issue may take the line, `tracker.create` with the
 * marker and the item. Two wrap-ups that list within seconds of each
 * other, as parallel stretch loops do, each find nothing and each create
 * (#1412 and #1413, three seconds apart), so a create is followed by a
 * second listing. When it holds an open issue that may take the line and
 * is older than the new one, the line goes to that older issue as above,
 * the new one is commented `Duplicate of #<older>` and moved to
 * `cancelled` through `transition`, and the answer is the older issue's,
 * carrying the new one as `duplicate`. The older-first order is total,
 * so of two racing creates the younger closes and the older stays.
 *
 * A tracker that cannot both list and edit is no place for the issue:
 * with no `edit` a found issue could not be appended to, and with no
 * `openIssues` the issue could never be found again, so each line would
 * open an issue of its own. No tracker at all, or one missing either
 * member, answers `kept` and makes no call; the caller keeps the line for
 * the print after the last task.
 *
 * The shapes {@link addStaleDocLine} is written over, `StaleDocsTracker`,
 * `StaleDocLineResult` and `AddStaleDocLineOptions`, are core's
 * (`packages/rafa/src/core/services/shapes.ts`), since board calls the
 * function through core's service registry; this module re-exports none.
 *
 * ## Untrusted text
 *
 * `where` and `what` are a session's text. {@link staleDocLine} puts each
 * on one line through `staleDocLineText` and `oneLine`, which core holds
 * (`packages/rafa/src/triage/stale-doc-line.ts`): every run of white
 * space (U+2028 and U+2029 included) one space and every other control
 * character dropped, so no entry can open a second item or a heading. A
 * `!` between `<` and `--` is written `\!`, as `escapeBlockerText`
 * (`utils/tracker.ts`) writes it, so no entry opens an HTML comment that
 * would hide the rest of the body on the tracker, or writes a marker of
 * its own. Redacting local paths is
 * the caller's, who knows the repository root: the line is written as it
 * is handed.
 *
 * ## Ticking a line
 *
 * A plan `rafa docs plan` wrote is titled {@link DOC_UPDATE_TITLE}, its
 * `rafa:plan` block names the oldest issue its lines came from, and each
 * task's text is {@link DOC_UPDATE_TASK_PREFIX} and the line escaped by
 * `escapeBlockerText` (`utils/tracker.ts`). {@link docUpdateLineText}
 * reads the line back off such a task's text, and
 * {@link tickStaleDocLine} ticks it in that issue once the task is done:
 * `tracker.openIssues('chore')`, kept to the issue whose id is the one
 * named and whose body holds the marker, then its first unticked item
 * whose text, trimmed, is the line, its box written `[x]` and the body
 * written back whole through `tracker.edit`. Nothing else in the body
 * changes, its line endings included.
 *
 * An issue no longer open, or holding no marker, answers `no-issue`; a
 * body holding no unticked item of that text, since a person ticked or
 * removed it or the line came from a second issue, answers `absent`;
 * neither writes anything. A tracker that cannot both list and edit
 * answers `untracked` with no call made. The issue itself is closed by a
 * person, never here.
 *
 * ## A failure
 *
 * Nothing here throws. A listing, an edit, a create, a comment or a
 * transition that rejects answers `failed` with a one-line `problem`
 * naming the step and what the tracker said, and the caller warns with
 * it: a failure here never stops the run, as triage's failures do not.
 * A failure after a create names the issue created, which holds the line.
 */
import type { SettleForecast } from '../release/forecast.js';
import type {
  AddStaleDocLineOptions,
  StaleDocLineResult,
  StaleDocsTracker,
} from '@open-tomato/rafa/core/services';
import type { IssueDraft, IssueEdit, IssueRef, OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { StaleDocEntry } from '@open-tomato/rafa/triage/stale-doc-line';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { unescapeBlockerText } from '@open-tomato/rafa/core/plan';
import { TRIAGE_MODULE } from '@open-tomato/rafa/triage/filed-text';
import { oneLine, staleDocLineText } from '@open-tomato/rafa/triage/stale-doc-line';

import { compareVersions } from '../release/status-readings.js';
import { nextVersion, parseSemanticVersion } from '../release/version.js';

/** The comment a stale-docs issue's body holds, which marks the issue as one. */
export const STALE_DOCS_MARKER = '<!-- rafa:stale-docs -->';

/** The version named when release is off, or when none can be named. */
export const NEXT_VERSION = 'next';

/** The sentence a new issue's body holds under the marker, above its lines. */
export const STALE_DOCS_OPENING: string = 'Documentation lines the loop could not settle before this release. '
  + 'Each item names the file, with the line when known, and what no longer matches.';

/** Why a line is kept for the print rather than added to an issue. */
export const NO_EDITABLE_TRACKER = 'no tracker resolved that can list and edit issues';

/** An unticked checklist item's opening. */
const UNTICKED = '- [ ] ';

/** A checklist item, ticked or not, and the text after its box. */
const CHECKLIST_ITEM = /^\s*- \[[ xX]\] (.*)$/;

/** An unticked checklist item: its indent, and the text after its box. */
const UNTICKED_ITEM = /^(\s*)- \[ \] (.*)$/;

/** The title a plan `rafa docs plan` writes carries. */
export const DOC_UPDATE_TITLE = 'chore(doc-update)';

/** What each task of such a plan opens with, before its escaped line. */
export const DOC_UPDATE_TASK_PREFIX = 'Repair the stale doc line at ';

/** The title of the stale-docs issue of `version`. */
export function staleDocsTitle(version: string): string {
  return `Release ${version}: update stale docs`;
}

/** A stale-docs issue's title, its version captured. */
const STALE_DOCS_TITLE = /^Release (\S+): update stale docs$/;

/** The version a stale-docs issue's title names, or null for a title of another shape. */
export function staleDocsTitleVersion(title: string): string | null {
  return STALE_DOCS_TITLE.exec(title)?.[1] ?? null;
}

/**
 * True when `version` is `next` or a semantic version above
 * `newestRelease`, any semantic version when that is null; false for a
 * version at or below it, for one that is no semantic version, and for
 * every version but `next` when `newestRelease` is no semantic version.
 */
export function isUnreleasedVersion(version: string, newestRelease: string | null): boolean {
  if (version === NEXT_VERSION) return true;
  const parsed = parseSemanticVersion(version);
  if (parsed === null) return false;
  if (newestRelease === null) return true;
  const newest = parseSemanticVersion(newestRelease);
  return newest !== null && compareVersions(parsed, newest) > 0;
}

/** The unticked checklist item for `entry`, as the issue's body holds it. */
export function staleDocLine(entry: StaleDocEntry): string {
  return `${UNTICKED}${staleDocLineText(entry)}`;
}

/** What {@link staleDocsVersion} reads; see the module note. */
export interface StaleDocsVersionInput {
  /** Whether the release runs in this repository. */
  readonly releaseEnabled: boolean;
  /** What settling the waiting fragments now would release, or null when not read. */
  readonly forecast: SettleForecast | null;
  /** The version the version file declares, or null when it was not read. */
  readonly versionFileValue: string | null;
}

/** The version the stale-docs issue is titled for; see the module note. */
export function staleDocsVersion(input: StaleDocsVersionInput): string {
  if (!input.releaseEnabled) return NEXT_VERSION;
  if (input.forecast?.kind === 'settles') return input.forecast.version;
  const patch = input.versionFileValue === null
    ? null
    : nextVersion(input.versionFileValue, 'patch');
  return patch ?? NEXT_VERSION;
}

/** True when `body` holds a checklist item, ticked or not, whose text is `text`. */
export function bodyHoldsLine(body: string, text: string): boolean {
  return body.split(/\r?\n/).some((line) => CHECKLIST_ITEM.exec(line)?.[1]?.trimEnd() === text);
}

/** `body` with `item` below its last line, as one list with any item above it. */
function appendItem(body: string, item: string): string {
  const trimmed = body.trimEnd();
  if (trimmed === '') return `${item}\n`;
  const last = trimmed.split(/\r?\n/).at(-1) ?? '';
  const gap = CHECKLIST_ITEM.test(last)
    ? '\n'
    : '\n\n';
  return `${trimmed}${gap}${item}\n`;
}

/** The body of a new stale-docs issue holding `item`. */
export function staleDocsBody(item: string): string {
  return `${STALE_DOCS_MARKER}\n\n${STALE_DOCS_OPENING}\n\n${item}\n`;
}

/** The draft of a new stale-docs issue titled `title`, holding `item`. */
function issueDraft(title: string, item: string): IssueDraft {
  return {
    opt: 0,
    title,
    body: staleDocsBody(item),
    type: 'chore',
    module: TRIAGE_MODULE,
    priority: null,
    project: null,
    blockedBy: [],
  };
}

/** A tracker that can both list and edit, and so can hold the issue. */
type HoldingTracker = StaleDocsTracker & Required<Pick<Tracker, 'openIssues' | 'edit'>>;

/** True when `tracker` can list its open issues and edit one; see the module note. */
function canHoldIssue(tracker: StaleDocsTracker | null): tracker is HoldingTracker {
  return tracker !== null && tracker.openIssues !== undefined && tracker.edit !== undefined;
}

/** A tracker call's value, or the one-line problem it rejected with. */
type CallOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/** Runs one tracker call, answering its rejection rather than throwing. */
async function call<T>(step: string, action: () => Promise<T>): Promise<CallOutcome<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, problem: oneLine(`${step} failed: ${messageOf(error)}`) };
  }
}

/** An issue's creation time in milliseconds, or null when it has none that reads as one. */
function createdMs(issue: OpenIssue): number | null {
  if (issue.createdAt === null) return null;
  const ms = Date.parse(issue.createdAt);
  return Number.isNaN(ms)
    ? null
    : ms;
}

/** Two issue ids in order: numerically when both are numbers, else as strings. */
function idOrder(left: string, right: string): number {
  const [a, b] = [Number(left), Number(right)];
  if (Number.isSafeInteger(a) && Number.isSafeInteger(b)) return a - b;
  return left.localeCompare(right);
}

/** Two open issues, the older first: the earlier creation time, then the lower id. */
export function olderFirst(left: OpenIssue, right: OpenIssue): number {
  const [a, b] = [createdMs(left), createdMs(right)];
  if (a !== null && b !== null && a !== b) return a - b;
  return idOrder(left.ref.externalId, right.ref.externalId);
}

/** Which open issues may take the line, and which title it is filed under. */
interface IssueChoice {
  /** The title the line's issue carries, the version's. */
  readonly title: string;
  /** The newest root release tag's version, null for none; undefined when not read. */
  readonly newestRelease: string | null | undefined;
}

/** The caller's release reading, a version that is no semantic version read as none taken. */
function releaseReading(newestRelease: string | null | undefined): string | null | undefined {
  return typeof newestRelease === 'string' && parseSemanticVersion(newestRelease) === null
    ? undefined
    : newestRelease;
}

/** True when `issue` is a marked issue that may take the line; see the module note. */
function mayTake(issue: OpenIssue, choice: IssueChoice): boolean {
  if (!issue.body.includes(STALE_DOCS_MARKER)) return false;
  if (choice.newestRelease === undefined) return issue.title === choice.title;
  const version = staleDocsTitleVersion(issue.title);
  return version !== null && isUnreleasedVersion(version, choice.newestRelease);
}

/** The issue that takes the line: the one of the title, else the oldest that may take it. */
function chooseIssue(open: readonly OpenIssue[], choice: IssueChoice): OpenIssue | undefined {
  const candidates = open.filter((issue) => mayTake(issue, choice)).sort(olderFirst);
  return candidates.find((issue) => issue.title === choice.title) ?? candidates[0];
}

/** The line to add, as the body's item and the text after its box. */
interface LineToAdd {
  readonly text: string;
  readonly item: string;
}

/** The edit adding `line` to `found` and retitling it to `title`, of which `held` leaves the body out. */
function issueChange(found: OpenIssue, title: string, line: LineToAdd, held: boolean): IssueEdit {
  if (held) return { title };
  const body = appendItem(found.body, line.item);
  return found.title === title
    ? { body }
    : { title, body };
}

/** Adds `line` to `found`, retitling it to `title` when it differs; see the module note. */
async function addToIssue(
  tracker: HoldingTracker,
  found: OpenIssue,
  title: string,
  line: LineToAdd,
): Promise<StaleDocLineResult> {
  const held = bodyHoldsLine(found.body, line.text);
  const action = held
    ? 'held'
    : 'appended';
  if (held && found.title === title) return { action, title, ref: found.ref };
  const change = issueChange(found, title, line, held);
  const edited = await call('editing the stale-docs issue', () => tracker.edit(found.ref, change));
  if (!edited.ok) return { action: 'failed', title, problem: edited.problem };
  return found.title === title
    ? { action, title, ref: found.ref }
    : { action, title, ref: found.ref, retitledFrom: found.title };
}

/** Closes `duplicate` as one of `older`: the comment, then the transition. */
async function closeDuplicate(
  tracker: HoldingTracker,
  duplicate: IssueRef,
  older: IssueRef,
): Promise<CallOutcome<unknown>> {
  const id = duplicate.externalId;
  const commented = await call(`commenting on the duplicate issue ${id}`, () => tracker.comment(duplicate, `Duplicate of #${older.externalId}`));
  if (!commented.ok) return commented;
  return call(`closing the duplicate issue ${id}`, () => tracker.transition(duplicate, 'cancelled'));
}

/** Creates the issue holding `line`, then converges on an older one a sibling created; see the module note. */
async function createAndConverge(
  tracker: HoldingTracker,
  choice: IssueChoice,
  line: LineToAdd,
): Promise<StaleDocLineResult> {
  const { title } = choice;
  const created = await call('creating the stale-docs issue', () => tracker.create(issueDraft(title, line.item)));
  if (!created.ok) return { action: 'failed', title, problem: created.problem };
  const ref = created.value;

  const relisted = await call(
    `listing the open chore issues after creating issue ${ref.externalId}`,
    () => tracker.openIssues('chore'),
  );
  if (!relisted.ok) return { action: 'failed', title, problem: relisted.problem };
  const own = relisted.value.find((issue) => issue.ref.externalId === ref.externalId)
    ?? { ref, title, body: '', createdAt: null };
  const older = chooseIssue(
    relisted.value.filter((issue) => issue.ref.externalId !== ref.externalId && olderFirst(issue, own) < 0),
    choice,
  );
  if (older === undefined) return { action: 'created', title, ref };

  const added = await addToIssue(tracker, older, title, line);
  if (added.action !== 'appended' && added.action !== 'held') return added;
  const closed = await closeDuplicate(tracker, ref, older.ref);
  return closed.ok
    ? { ...added, duplicate: ref }
    : { action: 'failed', title, problem: closed.problem };
}

/** Adds `entry` to the stale-docs issue of `version`; see the module note. Never throws. */
export async function addStaleDocLine(options: AddStaleDocLineOptions): Promise<StaleDocLineResult> {
  const { tracker, version, entry } = options;
  const title = staleDocsTitle(version);
  if (!canHoldIssue(tracker)) return { action: 'kept', title, reason: NO_EDITABLE_TRACKER };

  const text = staleDocLineText(entry);
  const line: LineToAdd = { text, item: `${UNTICKED}${text}` };
  const choice: IssueChoice = { title, newestRelease: releaseReading(options.newestRelease) };
  const listed = await call('listing the open chore issues', () => tracker.openIssues('chore'));
  if (!listed.ok) return { action: 'failed', title, problem: listed.problem };

  const found = chooseIssue(listed.value, choice);
  return found === undefined
    ? createAndConverge(tracker, choice, line)
    : addToIssue(tracker, found, title, line);
}

/**
 * The stale-docs line a task of a doc-update plan repairs, read back off
 * the task's text (its declaration already taken off), unescaped and
 * trimmed; null for a text that does not open with
 * {@link DOC_UPDATE_TASK_PREFIX} or names no line.
 */
export function docUpdateLineText(taskText: string): string | null {
  if (!taskText.startsWith(DOC_UPDATE_TASK_PREFIX)) return null;
  const text = unescapeBlockerText(taskText.slice(DOC_UPDATE_TASK_PREFIX.length)).trim();
  return text === ''
    ? null
    : text;
}

/** What {@link tickStaleDocLine} did with one line. */
export type StaleDocTickResult =
  /** The line's box was ticked in the issue. */
  | { readonly action: 'ticked'; readonly ref: IssueRef }
  /** The issue holds no unticked item of the line's text; nothing was written. */
  | { readonly action: 'absent'; readonly ref: IssueRef }
  /** No open issue of the id holds the marker; nothing was written. */
  | { readonly action: 'no-issue'; readonly issue: string }
  /** No tracker can hold the issue; no call was made. */
  | { readonly action: 'untracked'; readonly reason: string }
  /** A tracker call rejected; nothing more was tried. */
  | { readonly action: 'failed'; readonly problem: string };

/** What {@link tickStaleDocLine} ticks, and where. */
export interface TickStaleDocLineOptions {
  /** The tracker the run resolved, or null when it resolved none. */
  readonly tracker: StaleDocsTracker | null;
  /** The id of the issue the plan's `rafa:plan` block names. */
  readonly issue: string;
  /** The line's text after its box, as {@link docUpdateLineText} reads it. */
  readonly text: string;
}

/** `body` with its first unticked item of text `text` ticked, or null for none. */
function tickItem(body: string, text: string): string | null {
  const lines = body.split('\n');
  const index = lines.findIndex((line) => UNTICKED_ITEM.exec(line.replace(/\r$/, ''))?.[2]?.trim() === text);
  if (index === -1) return null;
  return lines
    .map((line, at) => at === index
      ? line.replace('- [ ] ', '- [x] ')
      : line)
    .join('\n');
}

/** Ticks `text` in the stale-docs issue `issue`; see the module note. Never throws. */
export async function tickStaleDocLine(options: TickStaleDocLineOptions): Promise<StaleDocTickResult> {
  const { tracker, issue, text } = options;
  if (!canHoldIssue(tracker)) return { action: 'untracked', reason: NO_EDITABLE_TRACKER };

  const listed = await call('listing the open chore issues', () => tracker.openIssues('chore'));
  if (!listed.ok) return { action: 'failed', problem: listed.problem };

  const found = listed.value.find((open) => open.ref.externalId === issue && open.body.includes(STALE_DOCS_MARKER));
  if (found === undefined) return { action: 'no-issue', issue };

  const body = tickItem(found.body, text);
  if (body === null) return { action: 'absent', ref: found.ref };
  const edited = await call('editing the stale-docs issue', () => tracker.edit(found.ref, { body }));
  return edited.ok
    ? { action: 'ticked', ref: found.ref }
    : { action: 'failed', problem: edited.problem };
}
