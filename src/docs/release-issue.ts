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
 * on one line, every run of white space (U+2028 and U+2029 included) one
 * space and every other control character dropped, so no entry can open
 * a second item or a heading. A `!` between `<` and `--` is written
 * `\!`, as `escapeBlockerText` (`utils/tracker.ts`) writes it, so no
 * entry opens an HTML comment that would hide the rest of the body on
 * the tracker, or writes a marker of its own. Redacting local paths is
 * the caller's, who knows the repository root: the line is written as it
 * is handed.
 *
 * ## A failure
 *
 * Nothing here throws. A listing, an edit or a create that rejects
 * answers `failed` with a one-line `problem` naming the step and what the
 * tracker said, and the caller warns with it: a failure here never stops
 * the run, as triage's failures do not.
 */
import type { IssueDraft, IssueRef, OpenIssue, Tracker } from '../ports/index.js';
import type { SettleForecast } from '../release/forecast.js';

import { messageOf } from '../core/config/sections.js';
import { nextVersion } from '../release/version.js';
import { TRIAGE_MODULE } from '../triage/triage.js';

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

/** A run of white space, the line and paragraph separators included. */
const WHITE_SPACE = /\s+/g;

/** True for a control character that is not white space, or DEL. */
function isDroppedControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x08 || (code >= 0x0E && code <= 0x1F) || code === 0x7F;
}

/** A `!` that would open an HTML comment after a `<`. */
const COMMENT_OPEN = /(?<=<)!(?=--)/g;

/** The title of the stale-docs issue of `version`. */
export function staleDocsTitle(version: string): string {
  return `Release ${version}: update stale docs`;
}

/** One stale documentation line: where it is, and what no longer matches. */
export interface StaleDocEntry {
  /** The file, with the line when known, or null when none was named. */
  readonly where: string | null;
  /** What no longer matches. */
  readonly what: string;
}

/** `text` on one line, each white space run one space, no comment opened. */
function oneLine(text: string): string {
  return Array.from(text)
    .filter((char) => !isDroppedControl(char))
    .join('')
    .replace(WHITE_SPACE, ' ')
    .trim()
    .replace(COMMENT_OPEN, '\\!');
}

/**
 * The text of the checklist item for `entry`, after its box:
 * `<where>: <what>`, or `<what>` when the entry named no place or a
 * blank one; see the module note for what is escaped.
 */
export function staleDocLineText(entry: StaleDocEntry): string {
  const what = oneLine(entry.what);
  const where = entry.where === null
    ? ''
    : oneLine(entry.where);
  return where === ''
    ? what
    : `${where}: ${what}`;
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
