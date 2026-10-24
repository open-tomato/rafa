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
 * names a new title and so opens a second issue. That is why the readers
 * of the open lines take every open issue carrying the marker.
 *
 * ## Adding a line
 *
 * `tracker.openIssues('chore')`, kept to those whose body holds the
 * marker, then the first whose title is the title exactly. Found: its
 * body with the item below it, written back whole through `tracker.edit`
 * (the port's `edit` writes a body whole; an append is the caller's).
 * Not found: `tracker.create` with the marker and the item. A line whose
 * text the body already holds as a checklist item, ticked or not, is not
 * added a second time: the answer is `held` and nothing is written.
 *
 * A tracker that cannot both list and edit is no place for the issue:
 * with no `edit` a found issue could not be appended to, and with no
 * `openIssues` the issue could never be found again, so each line would
 * open an issue of its own. No tracker at all, or one missing either
 * member, answers `kept` and makes no call; the caller keeps the line for
 * the print after the last task.
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
 * Nothing here throws. A listing, an edit or a create that rejects
 * answers `failed` with a one-line `problem` naming the step and what the
 * tracker said, and the caller warns with it: a failure here never stops
 * the run, as triage's failures do not.
 */
import type { SettleForecast } from '../release/forecast.js';
import type { IssueDraft, IssueRef, OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { StaleDocEntry } from '@open-tomato/rafa/triage/stale-doc-line';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { unescapeBlockerText } from '@open-tomato/rafa/core/plan';
import { TRIAGE_MODULE } from '@open-tomato/rafa/triage/filed-text';
import { oneLine, staleDocLineText } from '@open-tomato/rafa/triage/stale-doc-line';

import { nextVersion } from '../release/version.js';

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

/** What {@link addStaleDocLine} did with one line. */
export type StaleDocLineResult =
  /** No issue of the title was open: one was created holding the line. */
  | { readonly action: 'created'; readonly title: string; readonly ref: IssueRef }
  /** The issue was found and the line appended to its body. */
  | { readonly action: 'appended'; readonly title: string; readonly ref: IssueRef }
  /** The issue already holds the line; nothing was written. */
  | { readonly action: 'held'; readonly title: string; readonly ref: IssueRef }
  /** No tracker can hold the issue; the caller keeps the line. */
  | { readonly action: 'kept'; readonly title: string; readonly reason: string }
  /** A tracker call rejected; nothing more was tried. */
  | { readonly action: 'failed'; readonly title: string; readonly problem: string };

/** The tracker members adding a line calls. */
export type StaleDocsTracker = Pick<Tracker, 'create'> & Partial<Pick<Tracker, 'openIssues' | 'edit'>>;

/** A tracker that can both list and edit, and so can hold the issue. */
type HoldingTracker = StaleDocsTracker & Required<Pick<Tracker, 'openIssues' | 'edit'>>;

/** True when `tracker` can list its open issues and edit one; see the module note. */
function canHoldIssue(tracker: StaleDocsTracker | null): tracker is HoldingTracker {
  return tracker !== null && tracker.openIssues !== undefined && tracker.edit !== undefined;
}

/** What {@link addStaleDocLine} adds, and where. */
export interface AddStaleDocLineOptions {
  /** The tracker the run resolved, or null when it resolved none. */
  readonly tracker: StaleDocsTracker | null;
  /** The version the issue is titled for, from {@link staleDocsVersion}. */
  readonly version: string;
  /** The line to add. */
  readonly entry: StaleDocEntry;
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

/** The open issue titled `title` whose body holds the marker, or undefined. */
function findIssue(open: readonly OpenIssue[], title: string): OpenIssue | undefined {
  return open.find((issue) => issue.body.includes(STALE_DOCS_MARKER) && issue.title === title);
}

/** Adds `entry` to the stale-docs issue of `version`; see the module note. Never throws. */
export async function addStaleDocLine(options: AddStaleDocLineOptions): Promise<StaleDocLineResult> {
  const { tracker, version, entry } = options;
  const title = staleDocsTitle(version);
  if (!canHoldIssue(tracker)) return { action: 'kept', title, reason: NO_EDITABLE_TRACKER };

  const text = staleDocLineText(entry);
  const item = `${UNTICKED}${text}`;
  const listed = await call('listing the open chore issues', () => tracker.openIssues('chore'));
  if (!listed.ok) return { action: 'failed', title, problem: listed.problem };

  const found = findIssue(listed.value, title);
  if (found === undefined) {
    const created = await call('creating the stale-docs issue', () => tracker.create(issueDraft(title, item)));
    return created.ok
      ? { action: 'created', title, ref: created.value }
      : { action: 'failed', title, problem: created.problem };
  }

  if (bodyHoldsLine(found.body, text)) return { action: 'held', title, ref: found.ref };
  const body = appendItem(found.body, item);
  const edited = await call('editing the stale-docs issue', () => tracker.edit(found.ref, { body }));
  return edited.ok
    ? { action: 'appended', title, ref: found.ref }
    : { action: 'failed', title, problem: edited.problem };
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
