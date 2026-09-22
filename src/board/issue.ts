/**
 * The issue a plan is written from: the one `gh` command that reads it,
 * the two refusals that keep a plan from being written off the wrong
 * issue, the snapshot of its body written under `specs.dir` with the
 * local notes appended, and the reading of how a snapshot already there
 * differs from the one this run would write.
 *
 * `plan create --issue=<n>` plans from an issue, and the planner reads a
 * FILE (`.rafa/specs/rafa-20-pr-commands.md`). This module is what turns one
 * into the other: it reads the issue, refuses the ones no plan may be
 * written from, and writes the body to
 * `<specs.dir>/rafa-<n>-<slug>.md`, whose name is `./naming.ts`'s.
 *
 * It composes with nothing else here. The trust check (`./trust.ts`),
 * the label and completeness checks (`./readiness.ts`) and the leak
 * refusal (`./leak.ts`) each read what this module answers, and the
 * order they run in — trust BEFORE the body is snapshotted — is the
 * command's, not this module's, which is why {@link readGhSpecIssue}
 * and {@link writeSpecSnapshot} are two functions with the checks
 * fitting between them rather than one that does everything.
 *
 * Nothing here spawns: the issue arrives through the {@link GhRunner}
 * seam declared in `src/adapters/tracker/github.ts`, as it does for the
 * tracker, the pull request provider and the trust reading. The
 * filesystem is reached only under the `repoRoot` a caller names, so
 * every case in `./issue.test.ts` drives a fake runner and writes in its
 * own temporary directory: none reaches GitHub, spawns `gh`, or writes
 * outside `tmpdir`.
 *
 * ## The read
 *
 * `gh issue view <n> --json number,title,body,state,labels,author`, the
 * spec's own command and its own field list with `author` added to it.
 * The payload is checked by hand rather than cast, as the tracker
 * adapter checks its own, and a field that is not the shape read here
 * fails the command naming what came back.
 *
 * `author` is the one the trust check reads — check 0 of the readiness
 * gate, which asks whether the login behind a body may reach an agent's
 * prompt (`./trust.ts`). GitHub answers it as a mapping,
 * `{"id","is_bot","login","name"}` for a person, read on 2026-09-21
 * from `gh issue view 1 --repo cli/cli --json author` with `gh`
 * 2.100.0; only the login is kept, as {@link SpecIssue.author}.
 *
 * It is also the one field a payload may leave out without failing the
 * command. A payload naming no `author`, or naming one that is not a
 * mapping carrying a string `login`, reads as the EMPTY login, the way
 * `./issue-board.ts` reads a comment's, rather than as a refusal. That
 * is safe because the empty login is not trust: it names no account, so
 * the permission lookup the trust check spends on it cannot come back
 * `admin`, `maintain` or `write`, and what the caller gets is a refusal
 * either way. Refusing here instead would turn a shape GitHub changed
 * into a command that cannot run at all, which is a worse answer than
 * one refused check.
 *
 * One thing the field list still does NOT carry is worth naming,
 * because a reader expecting it would find it missing:
 *
 *  - `url`, which is how the tracker adapter tells an issue from a pull
 *    request: `gh issue view` answers a pull request's number too, and
 *    only the URL says which it was. Without it, an open pull request
 *    reads as an open issue, and what stands between it and a plan is
 *    the `type:spec` label — a pull request carrying that label would be
 *    snapshotted as a spec. A merged one is refused anyway, since its
 *    state reads `MERGED` and not `OPEN` or `CLOSED`.
 *
 * ## The two refusals
 *
 * A CLOSED issue and an issue without `type:spec` are both refused with
 * exit {@link ISSUE_REFUSAL_EXIT}, the code every neighbouring board
 * refusal uses. They are cheap and they are about the issue rather than
 * the text in it, which is why they sit here and not in
 * `./readiness.ts`: a closed issue is work that is over, and an issue
 * without the label was never a spec, so neither is worth reading a body
 * for.
 *
 * The label is matched trimmed and case-insensitively, as
 * `hasSpecReadyLabel` matches its own, because GitHub label names are
 * compared that way by the people typing them.
 *
 * ## Why a snapshot, and what `--refresh` is for
 *
 * The body is WRITTEN DOWN rather than handed to the session as text.
 * The planner reads a spec file, so the session, the plan stub, the
 * stamp and the classifier keys are the ones `--spec` already produces,
 * and the run keeps the exact text it planned from even when somebody
 * edits the issue an hour later.
 *
 * That only holds while the file is not silently rewritten, so a
 * snapshot that is already there and DIFFERS from what this run would
 * write refuses the command, and `--refresh` is the word that says
 * "take the issue as it reads now". A snapshot that matches is left
 * alone and reported {@link SpecSnapshot.action} `unchanged` — the file
 * is not rewritten, so its modification time still says when the text
 * was first taken.
 *
 * "Differs" is measured against the WHOLE file this run would write, the
 * appended notes included. A notes file edited since the snapshot was
 * taken is a changed spec, because the planner reads the appended text
 * as part of it, and a rule that compared the issue body alone would let
 * that edit through unnoticed.
 *
 * The body is normalised before it is written: CRLF line endings become
 * LF and trailing blank lines become one newline. Trailing SPACES are
 * left alone, since two of them end a line in markdown. The
 * normalisation is what makes the comparison stable — a body that reads
 * the same writes the same, run after run — and it changes no word, so
 * the leak and readiness checks, which read the issue body itself, see
 * what the snapshot carries.
 *
 * ## Reading what changed
 *
 * {@link readSnapshotChange} says WHICH part of a snapshot differs —
 * the body, the notes, or both — and sums each changed part up in one
 * line. It reads texts and touches no file, so the caller that holds
 * the saved copy and the notes decides what the answer leads to.
 *
 * A snapshot joins the two parts, so telling them apart is a reading
 * of that join. The body is the SAME exactly when the saved copy is
 * the normalised body and a newline, or starts with the normalised body
 * followed by the blank line, {@link LOCAL_NOTES_HEADING} and the blank
 * line {@link snapshotText} writes. That is a prefix test against the
 * body as it reads now, so it stays right when the body itself holds a
 * `## Local notes` heading. With the body the same, whatever else
 * differs is the notes.
 *
 * With the body changed there is no prefix to lean on, and the old
 * notes are read as what follows the LAST such separator, trimmed as
 * the notes are written; the old body is what comes before it. That
 * reading can be fooled one way: a body holding its own `## Local
 * notes` section, snapshotted with no notes file, reads as a body cut
 * short with notes after it, so the body line counts against that
 * shorter body and a notes line may be named for a notes file nobody
 * touched. The kind still says the body changed, which is the part a
 * caller acts on.
 *
 * The body line is `issue body: +<a> -<r> lines; headings changed:
 * <h1>, <h2>`. The added and removed counts are the lines of each body
 * outside their longest common subsequence, so a line moved counts
 * once each way and a line edited counts as one of each. A heading is
 * a markdown heading line — one to six `#` and a space — outside a
 * fenced code block, since a shell comment in a fence is not one; it
 * is named, without its `#` marks, when the text under it up to the
 * next heading of any level differs, or when one body has it and the
 * other does not. With none named the clause reads `no heading
 * changed`, which is also what a change above the first heading reads.
 *
 * The notes line is `local notes: <path> changed since the saved copy`.
 *
 * ## The local notes
 *
 * Issue bodies are public. `<specs.dir>/rafa-<n>-notes.md` is where the
 * machine paths, the private hostnames and the local repro steps live,
 * and this is the one place they are joined to the spec: appended to the
 * snapshot under {@link LOCAL_NOTES_HEADING}, on the way IN.
 *
 * The direction matters. Nothing here sends anything to the board, so
 * the notes cannot travel back to the issue; and the caller runs the
 * leak refusal over the ISSUE BODY, before it is snapshotted, so the
 * notes file — which exists to hold exactly what that refusal
 * forbids — is never read by it. A caller that checked the composed
 * snapshot instead would refuse every notes file worth writing.
 *
 * A notes file holding nothing but whitespace is no notes at all: the
 * heading is not written for it, so an empty file left behind does not
 * change what the planner reads.
 *
 * One collision is refused rather than papered over. The notes file is
 * named from the id alone and the snapshot from the id and the slug, so
 * an issue titled "Notes" spells both names the same
 * (`rafa-20-notes.md`). Writing the snapshot there would overwrite
 * somebody's notes with a copy of the issue body, silently, so
 * {@link writeSpecSnapshot} refuses the pair and names them.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { CommandExit } from '../cli/command.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

import { REFRESH_FLAG } from './flags.js';
import { notesPath, specPath } from './naming.js';

/** What every refusal and every failure this module raises opens with. */
const PREFIX = 'board issue';

/** The fields the read asks for; the spec's five and `author`, and the module note holds what is not in it. */
export const ISSUE_VIEW_FIELDS = 'number,title,body,state,labels,author';

/** The label an issue must carry to be planned from. */
export const SPEC_LABEL = 'type:spec';

/** The exit code a refused issue ends the command with; the spec's own. */
export const ISSUE_REFUSAL_EXIT = 2;

/**
 * The flag that takes the issue as it reads now over a snapshot that
 * differs, re-exported: the rule and the refusal that names it are this
 * module's, and the word is `./flags.js`'s, which records why.
 */
export { REFRESH_FLAG };

/** The heading the local notes are appended under. */
export const LOCAL_NOTES_HEADING = '## Local notes';

/** An issue as this module reads it: the six fields and nothing else. */
export interface SpecIssue {
  /** The issue number, as the payload answered it. */
  readonly number: number;
  /** The title, whole, which the slug and the plan stub are read from. */
  readonly title: string;
  /** The body, as written, before any normalisation. */
  readonly body: string;
  /** Whether GitHub holds the issue open. */
  readonly state: 'OPEN' | 'CLOSED';
  /** Every label on the issue, by name, in the order they came back. */
  readonly labels: readonly string[];
  /**
   * The login that opened the issue, which the trust check weighs, or
   * the empty string when the payload named none; see the module note
   * for why an unnamed author is read and not refused.
   */
  readonly author: string;
}

/** One issue read by number; the seam a caller plants a fake behind. */
export type SpecIssueReader = (issue: number) => Promise<SpecIssue>;

/** What {@link createGhSpecIssueReader} is made with. */
export interface GhSpecIssueReaderOptions {
  /** Runs the one `gh` command the read sends. */
  readonly gh: GhRunner;
}

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** The issue number a read was handed, as an argument. */
function issueNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `${PREFIX}: the read refused issue number ${describeValue(value)}, expected a positive whole number`,
    );
  }
  return String(value);
}

/** The names of a payload's labels, or null when they are not named labels. */
function labelNames(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const names = (value as readonly unknown[]).map((label) => (isMapping(label)
    ? label['name']
    : null));
  return names.every((name) => typeof name === 'string')
    ? (names as readonly string[])
    : null;
}

/** The login on a payload's `author`, or the empty string when it names none. */
function authorLogin(value: unknown): string {
  const login = isMapping(value)
    ? value['login']
    : null;
  return typeof login === 'string'
    ? login
    : '';
}

/** The first thing wrong with the payload of a read of issue `number`, or null. */
function viewProblem(payload: unknown, number: number): string | null {
  if (!isMapping(payload)) return `${describeValue(payload)}, expected a mapping`;
  const { title, body, state } = payload;
  if (payload['number'] !== number) {
    return `number ${describeValue(payload['number'])}, expected the issue asked for, ${String(number)}`;
  }
  if (typeof title !== 'string') return `title ${describeValue(title)}, expected a string`;
  if (typeof body !== 'string') return `body ${describeValue(body)}, expected a string`;
  if (state !== 'OPEN' && state !== 'CLOSED') {
    return `state ${describeValue(state)}, expected "OPEN" or "CLOSED"`;
  }
  return labelNames(payload['labels']) === null
    ? 'labels that are not a list of named labels'
    : null;
}

/** The issue the read wrote, checked. Throws, naming the command, when it is not one. */
function readViewedIssue(stdout: string, number: number, command: string): SpecIssue {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }

  const problem = viewProblem(payload, number);
  if (problem !== null) throw new Error(`${PREFIX}: ${command} answered ${problem}`);

  // Every field but the author was checked above; that one is read
  // rather than checked, as the module note records.
  const checked = payload as {
    title: string;
    body: string;
    state: 'OPEN' | 'CLOSED';
    labels: unknown;
    author: unknown;
  };
  return {
    number,
    title: checked.title,
    body: checked.body,
    state: checked.state,
    labels: labelNames(checked.labels) ?? [],
    author: authorLogin(checked.author),
  };
}

/**
 * The reader over `options.gh`: one `gh issue view` per issue, answered
 * as a {@link SpecIssue}. Rejects with an `Error` naming the command
 * when `gh` failed or answered another shape, and with a `TypeError`
 * for a number that is not a positive whole one, which is a defect in
 * the caller rather than a person's typo.
 */
export function createGhSpecIssueReader(options: GhSpecIssueReaderOptions): SpecIssueReader {
  const { gh } = options;

  return async (issue: number): Promise<SpecIssue> => {
    const number = issueNumber(issue);
    const command = `gh issue view ${number} --json ${ISSUE_VIEW_FIELDS}`;
    const result = await gh(['issue', 'view', number, '--json', ISSUE_VIEW_FIELDS]);
    if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
    return readViewedIssue(result.stdout, issue, command);
  };
}

/** True when `labels` carries {@link SPEC_LABEL}, whatever its case or padding. */
export function hasSpecLabel(labels: readonly string[]): boolean {
  return labels.some((label) => label.trim().toLowerCase() === SPEC_LABEL);
}

/** The sentence a closed issue is refused with. */
export function closedIssueMessage(issue: number): string {
  return `issue #${String(issue)} is closed, and a plan is written from an issue that is open;`
    + ' reopen it, or plan from the issue that took its place';
}

/** The sentence an issue without the label is refused with. */
export function missingSpecLabelMessage(issue: number): string {
  return `issue #${String(issue)} is not labelled ${SPEC_LABEL}, so it is not a spec;`
    + ` label it ${SPEC_LABEL}, or plan from the spec issue instead`;
}

/**
 * Lets an open, labelled issue through, and throws
 * `CommandExit({@link ISSUE_REFUSAL_EXIT}, ...)` for one that is closed
 * or carries no `type:spec` label.
 *
 * The state is weighed first: a closed issue that also lost its label is
 * over either way, and being told it is closed is the sentence that
 * sends the operator to the right place.
 */
export function requireSpecIssue(issue: SpecIssue): void {
  if (issue.state === 'CLOSED') {
    throw new CommandExit(ISSUE_REFUSAL_EXIT, closedIssueMessage(issue.number));
  }
  if (!hasSpecLabel(issue.labels)) {
    throw new CommandExit(ISSUE_REFUSAL_EXIT, missingSpecLabelMessage(issue.number));
  }
}

/** `text` with LF line endings and no trailing blank line; see the module note. */
function normalise(text: string): string {
  return text.replace(/\r\n?/gu, '\n').replace(/\n+$/u, '');
}

/**
 * The snapshot for a body, with `notes` appended under
 * {@link LOCAL_NOTES_HEADING} when they hold anything but whitespace.
 * Always ends with exactly one newline.
 */
export function snapshotText(body: string, notes: string | null): string {
  const local = notes === null
    ? ''
    : normalise(notes).trim();
  const sections = [
    normalise(body),
    local === ''
      ? ''
      : `${LOCAL_NOTES_HEADING}\n\n${local}`,
  ].filter((section) => section !== '');
  return `${sections.join('\n\n')}\n`;
}

/** What differs between a saved copy and the text this run would write. */
export type SnapshotChangeKind = 'unchanged' | 'notes' | 'body' | 'both';

/** What {@link readSnapshotChange} compares. */
export interface SnapshotChangeOptions {
  /** The saved copy, byte for byte as it was read. */
  readonly saved: string;
  /** The issue body as it reads now, before any normalisation. */
  readonly body: string;
  /** The local notes as they read now, or null when there is no notes file. */
  readonly notes: string | null;
  /** The notes file's path, as the notes line names it. */
  readonly notesPath: string;
}

/** How a saved copy differs, and the one line each changed part is summed up in. */
export interface SnapshotChange {
  /** Which parts differ. */
  readonly kind: SnapshotChangeKind;
  /**
   * `issue body: +<a> -<r> lines; headings changed: <h1>, <h2>`, or
   * `...; no heading changed`; null when the body is unchanged.
   */
  readonly bodyLine: string | null;
  /** `local notes: <path> changed since the saved copy`, or null when they did not. */
  readonly notesLine: string | null;
}

/** What separates the body from the notes in a saved copy; {@link snapshotText}'s own join. */
const NOTES_SEPARATOR = `\n\n${LOCAL_NOTES_HEADING}\n\n`;

/** A markdown ATX heading line: one to six `#` and a space, or nothing, after them. */
const HEADING = /^#{1,6}(?:[ \t]|$)/u;

/** A line that opens or closes a fenced code block, whose `#` lines are not headings. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/u;

/** The number of lines `before` and `after` share in order: their longest common subsequence. */
function commonLines(before: readonly string[], after: readonly string[]): number {
  let previous = new Uint32Array(after.length + 1);
  for (const line of before) {
    const row = new Uint32Array(after.length + 1);
    after.forEach((other, index) => {
      row[index + 1] = line === other
        ? (previous[index] ?? 0) + 1
        : Math.max(previous[index + 1] ?? 0, row[index] ?? 0);
    });
    previous = row;
  }
  return previous[after.length] ?? 0;
}

/** A heading as the summary names it: its text without the `#` marks, or the line when that is empty. */
function headingName(line: string): string {
  const text = line
    .replace(/^#+/u, '')
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .trim();
  return text === ''
    ? line.trim()
    : text;
}

/**
 * The text under each heading of `lines`, keyed by the heading line and
 * in the order the headings appear, a heading written twice keeping
 * both. Lines inside a fenced code block are text, not headings, and
 * the text before the first heading belongs to none.
 */
function headingSections(lines: readonly string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let fenced = false;
  let current: { key: string; lines: string[] } | null = null;
  const close = (): void => {
    if (current === null) return;
    sections.set(current.key, [...(sections.get(current.key) ?? []), current.lines.join('\n')]);
  };
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced || !HEADING.test(line)) {
      current?.lines.push(line);
      continue;
    }
    close();
    current = { key: line.trim(), lines: [] };
  }
  close();
  return sections;
}

/** The names of the headings whose text differs, or that one body has and the other does not. */
function changedHeadings(before: readonly string[], after: readonly string[]): readonly string[] {
  const old = headingSections(before);
  const now = headingSections(after);
  const keys = [...now.keys(), ...[...old.keys()].filter((key) => !now.has(key))];
  const changed = keys.filter((key) => JSON.stringify(old.get(key) ?? []) !== JSON.stringify(now.get(key) ?? []));
  return [...new Set(changed.map(headingName))];
}

/** The body line for an old and a new body, both normalised. */
function bodyChangeLine(before: string, after: string): string {
  const old = before.split('\n');
  const now = after.split('\n');
  const common = commonLines(old, now);
  const headings = changedHeadings(old, now);
  const clause = headings.length === 0
    ? 'no heading changed'
    : `headings changed: ${headings.join(', ')}`;
  return `issue body: +${String(now.length - common)} -${String(old.length - common)} lines; ${clause}`;
}

/** The notes line for the notes file at `path`. */
function notesChangeLine(path: string): string {
  return `local notes: ${path} changed since the saved copy`;
}

/**
 * Reads how the saved copy `options.saved` differs from the text
 * {@link snapshotText} writes for `options.body` and `options.notes`,
 * answering which parts changed and one line for each that did.
 *
 * `unchanged` is the saved copy equal to that text, byte for byte, as
 * {@link writeSpecSnapshot} compares it. `notes` is the body the same
 * and the notes not, `body` the reverse, and `both` both; the module
 * note holds how the two parts are told apart in a copy that holds
 * them joined, and where that reading can be fooled.
 */
export function readSnapshotChange(options: SnapshotChangeOptions): SnapshotChange {
  const { saved, body, notes, notesPath: path } = options;
  if (saved === snapshotText(body, notes)) return { kind: 'unchanged', bodyLine: null, notesLine: null };

  const now = normalise(body);
  if (saved === `${now}\n` || saved.startsWith(`${now}${NOTES_SEPARATOR}`)) {
    return { kind: 'notes', bodyLine: null, notesLine: notesChangeLine(path) };
  }

  const split = saved.lastIndexOf(NOTES_SEPARATOR);
  const oldBody = split === -1
    ? saved
    : saved.slice(0, split);
  const oldNotes = split === -1
    ? ''
    : normalise(saved.slice(split + NOTES_SEPARATOR.length)).trim();
  const newNotes = notes === null
    ? ''
    : normalise(notes).trim();
  const bodyLine = bodyChangeLine(normalise(oldBody), now);
  return oldNotes === newNotes
    ? { kind: 'body', bodyLine, notesLine: null }
    : { kind: 'both', bodyLine, notesLine: notesChangeLine(path) };
}

/** What is at `file`, or null when nothing is. Refuses anything that is not a file. */
function readIfFile(file: string, what: string): string | null {
  if (!existsSync(file)) return null;
  if (!statSync(file).isFile()) {
    throw new CommandExit(ISSUE_REFUSAL_EXIT, `${what} ${file} is not a file, and a spec is one`);
  }
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new CommandExit(ISSUE_REFUSAL_EXIT, `${what} ${file} could not be read: ${messageOf(error)}`);
  }
}

/**
 * What the local notes file for `issue` holds, or null when there is
 * none. `specsDir` is read against `repoRoot`, as `specs.dir` is
 * everywhere, so a relative setting names a file in the project.
 */
export function readLocalNotes(repoRoot: string, specsDir: string, issue: number): string | null {
  return readIfFile(resolve(repoRoot, notesPath(specsDir, issue)), 'the local notes');
}

/** The sentence a snapshot that no longer matches the issue is refused with. */
export function snapshotDiffersMessage(path: string, issue: number): string {
  return `${path} is a snapshot of issue #${String(issue)} that no longer matches it:`
    + ' the issue body, or the local notes appended to it, changed since the snapshot was written;'
    + ` pass ${REFRESH_FLAG} to plan from the issue as it reads now, or --spec=${path} to plan from`
    + ' the snapshot as it stands';
}

/** The sentence the one name collision is refused with; see the module note. */
export function notesCollisionMessage(path: string, issue: number): string {
  return `the snapshot of issue #${String(issue)} and its local notes are both ${path},`
    + ' so writing the snapshot would overwrite the notes; retitle the issue';
}

/** What a write did to the snapshot file. */
export type SnapshotAction = 'created' | 'refreshed' | 'unchanged';

/** What {@link writeSpecSnapshot} is asked. */
export interface SpecSnapshotOptions {
  /** The project root the two paths are resolved against. */
  readonly repoRoot: string;
  /** Where snapshots live, as `specs.dir` resolved it. */
  readonly specsDir: string;
  /** The issue read, checked by {@link requireSpecIssue} already. */
  readonly issue: SpecIssue;
  /** True under `--refresh`: a snapshot that differs is rewritten, not refused. */
  readonly refresh: boolean;
}

/** The snapshot a write left behind. */
export interface SpecSnapshot {
  /** Where it is, as the planner is handed it: under `specs.dir` as configured. */
  readonly path: string;
  /** The same file, resolved against the project root. */
  readonly absolute: string;
  /** What the write did. */
  readonly action: SnapshotAction;
  /** The local notes file appended, as a path, or null when there was none. */
  readonly notes: string | null;
  /** The text the file now holds. */
  readonly text: string;
}

/**
 * Writes issue `options.issue` to `<specs.dir>/rafa-<n>-<slug>.md`,
 * with its local notes appended, and answers where it went and what the
 * write did.
 *
 * Throws `CommandExit({@link ISSUE_REFUSAL_EXIT},
 * {@link snapshotDiffersMessage})` when a snapshot is already there,
 * differs from what this run would write and `options.refresh` is
 * false; the module note holds what "differs" measures and why.
 */
export function writeSpecSnapshot(options: SpecSnapshotOptions): SpecSnapshot {
  const { repoRoot, specsDir, issue, refresh } = options;
  const path = specPath(specsDir, issue.number, issue.title);
  const notes = notesPath(specsDir, issue.number);
  if (path === notes) {
    throw new CommandExit(ISSUE_REFUSAL_EXIT, notesCollisionMessage(path, issue.number));
  }

  const local = readLocalNotes(repoRoot, specsDir, issue.number);
  const text = snapshotText(issue.body, local);
  const absolute = resolve(repoRoot, path);
  const existing = readIfFile(absolute, 'the spec snapshot');
  const written: SpecSnapshot = {
    path,
    absolute,
    action: 'created',
    notes: local === null
      ? null
      : notes,
    text,
  };

  if (existing === text) return { ...written, action: 'unchanged' };
  if (existing !== null && !refresh) {
    throw new CommandExit(ISSUE_REFUSAL_EXIT, snapshotDiffersMessage(path, issue.number));
  }

  try {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  } catch (error) {
    throw new Error(`${PREFIX}: the snapshot ${path} could not be written: ${messageOf(error)}`, { cause: error });
  }

  return existing === null
    ? written
    : { ...written, action: 'refreshed' };
}
