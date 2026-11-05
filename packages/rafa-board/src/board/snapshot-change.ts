/**
 * The text a spec snapshot holds and the reading of how a saved copy
 * differs from it: {@link snapshotText}, which joins an issue body and
 * the local notes under {@link LOCAL_NOTES_HEADING}, and
 * {@link readSnapshotChange}, which says which of the two parts a saved
 * copy no longer matches. `./issue.ts` writes the snapshot, decides what
 * a change leads to and re-exports every name here, so an importer of
 * `./issue.js` loads unchanged; `./snapshot-settle.ts` prints the lines
 * this module sums a change up in.
 *
 * Nothing here touches a file or spawns: the module reads texts the
 * caller has already read, which is why every case in
 * `./snapshot-change.test.ts` is a pure call.
 *
 * ## The text
 *
 * The body is normalised before it is written: CRLF line endings become
 * LF and trailing blank lines become one newline. Trailing SPACES are
 * left alone, since two of them end a line in markdown. The
 * normalisation is what makes the comparison stable — a body that reads
 * the same writes the same, run after run — and it changes no word.
 * Notes holding nothing but whitespace are no notes at all: the heading
 * is not written for them. `./issue.ts`'s module note holds why the
 * notes are joined to the body at all.
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
 * ## The refs block
 *
 * A saved copy may open with the `<!-- rafa:refs` block that keeps the
 * stamps of what the spec points at (`../refs/stamp.ts`, which holds the
 * codec). It is this machine's reading, not the issue's text, so
 * {@link readSnapshotChange} strips it before comparing, and a copy
 * whose body and notes match is `unchanged` whatever its block holds.
 * A block the codec will not read throws its `RefsBlockError`.
 */
import { readRefsBlock } from '../refs/stamp.js';

/** The heading the local notes are appended under. */
export const LOCAL_NOTES_HEADING = '## Local notes';

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

/**
 * The names of the headings whose text differs between the lines of two
 * bodies, or that one has and the other does not: the new body's order
 * first. The module note holds what a heading is.
 */
export function changedHeadings(before: readonly string[], after: readonly string[]): readonly string[] {
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
 * `unchanged` is the saved copy less its refs block equal to that text,
 * byte for byte, which is what `writeSpecSnapshot` (`./issue.ts`) leaves
 * alone.
 * `notes` is the body the same
 * and the notes not, `body` the reverse, and `both` both; the module
 * note holds how the two parts are told apart in a copy that holds
 * them joined, and where that reading can be fooled. The refs block is
 * stripped from the saved copy first, and one the codec will not read
 * throws its `RefsBlockError`.
 */
export function readSnapshotChange(options: SnapshotChangeOptions): SnapshotChange {
  const { body, notes, notesPath: path } = options;
  const saved = readRefsBlock(options.saved).body;
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

