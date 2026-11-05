/**
 * The text a spec snapshot holds and the reading of how a saved copy
 * differs from it: {@link snapshotText}, which joins an issue body, the
 * local notes under {@link LOCAL_NOTES_HEADING} and the stretch's rules
 * under {@link STRETCH_RULES_HEADING}, and {@link readSnapshotChange},
 * which says which parts a saved copy no longer matches. `./issue.ts` writes the snapshot, decides what
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
 * ## The stretch rules
 *
 * A stretch writes the working rules its person approved for every item
 * to `.rafa/stretch/<n>/rules.md`, and every item's planner reads them
 * as a third part of the snapshot: {@link STRETCH_RULES_HEADING} and the
 * trimmed rules, after the notes. The caller reads the file and hands
 * the text and its path in as {@link StretchRules}; nothing here reads
 * the environment or the stretch folder. Rules holding nothing but
 * whitespace write no heading, as notes do, and with no rules handed in
 * the snapshot is byte for byte the one the body and the notes alone
 * write.
 *
 * The rules are this machine's, like the notes, so a change in them is
 * read as a change in the notes: {@link readSnapshotChange} answers kind
 * `notes` for a copy whose body matches and whose notes or rules do not,
 * and `both` for one whose body also changed.
 *
 * ## Reading what changed
 *
 * {@link readSnapshotChange} says WHICH part of a snapshot differs —
 * the body, the notes (the rules counted with them), or both — and sums
 * each changed part up in one line. It reads texts and touches no file, so the caller that holds
 * the saved copy and the notes decides what the answer leads to.
 *
 * A snapshot joins the two parts, so telling them apart is a reading
 * of that join. The body is the SAME exactly when the saved copy is
 * the normalised body and a newline, or starts with the normalised body
 * followed by the blank line, {@link LOCAL_NOTES_HEADING} or
 * {@link STRETCH_RULES_HEADING}, and the blank line {@link snapshotText}
 * writes. That is a prefix test against the body as it reads now, so it
 * stays right when the body itself holds a `## Local notes` heading.
 * With the body the same, whatever else differs is the notes or the
 * rules, and the kind is `notes`.
 *
 * With the body changed there is no prefix to lean on. The old rules are
 * read as what follows the LAST rules separator, then the old notes as
 * what follows the LAST notes separator before it, each trimmed as it is
 * written; the old body is what comes before both. That reading can be
 * fooled one way: a body holding its own `## Local notes` or `## Stretch
 * rules` section, snapshotted without that part, reads as a body cut
 * short with that part after it, so the body line counts against that
 * shorter body and a notes line may be named for a file nobody touched.
 * The kind still says the body changed, which is the part a caller acts
 * on.
 *
 * Which of the notes and the rules changed is read from the same split,
 * the copy's tail after its body: the rules after the last rules
 * separator, the notes before it. Notes holding their own `## Stretch
 * rules` section after a blank line are read as notes and rules, so the
 * line may name the rules for an edit of the notes; the kind is right
 * either way, and a kind `notes` whose split names neither part names
 * the notes, as the base always did.
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
 * The notes line names each local part that changed, joined by `; `:
 * `local notes: <path> changed since the saved copy` for the notes and
 * `stretch rules: <path> changed since the saved copy` for the rules,
 * or {@link RULES_REMOVED_LINE} for rules the saved copy holds and this
 * run was handed none of, since no path is known then. With no rules
 * handed in and none in the copy, it is the notes clause alone, the
 * line the base wrote.
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

/** The heading the stretch's rules are appended under, after the notes. */
export const STRETCH_RULES_HEADING = '## Stretch rules';

/** The rules clause for a saved copy holding rules when this run was handed none. */
export const RULES_REMOVED_LINE = 'stretch rules: the saved copy holds rules, and this run was handed no rules file';

/** A stretch's rules file as the caller read it: its text, and the path the lines name. */
export interface StretchRules {
  /** The file's path, as the notes line names it. */
  readonly path: string;
  /** What the file holds, as it was read. */
  readonly text: string;
}

/** `text` with LF line endings and no trailing blank line; see the module note. */
function normalise(text: string): string {
  return text.replace(/\r\n?/gu, '\n').replace(/\n+$/u, '');
}

/** A local part as it is written: normalised and trimmed, the empty string for none. */
function localText(text: string | null): string {
  return text === null
    ? ''
    : normalise(text).trim();
}

/** `text` under `heading`, or the empty string when it holds nothing. */
function section(heading: string, text: string): string {
  return text === ''
    ? ''
    : `${heading}\n\n${text}`;
}

/**
 * The snapshot for a body, with `notes` appended under
 * {@link LOCAL_NOTES_HEADING} and then `rules` under
 * {@link STRETCH_RULES_HEADING}, each when it holds anything but
 * whitespace. Always ends with exactly one newline; with `rules` null or
 * left out it is the text the body and the notes alone write.
 */
export function snapshotText(body: string, notes: string | null, rules: string | null = null): string {
  const sections = [
    normalise(body),
    section(LOCAL_NOTES_HEADING, localText(notes)),
    section(STRETCH_RULES_HEADING, localText(rules)),
  ].filter((part) => part !== '');
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
  /** The stretch's rules as they read now, or null or left out when there is no rules file. */
  readonly rules?: StretchRules | null;
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
  /**
   * `local notes: <path> changed since the saved copy`, the rules clause,
   * or both joined by `; `; null when neither the notes nor the rules
   * changed. The module note holds the clauses.
   */
  readonly notesLine: string | null;
}

/** What separates the body from the notes in a saved copy; {@link snapshotText}'s own join. */
const NOTES_SEPARATOR = `\n\n${LOCAL_NOTES_HEADING}\n\n`;

/** What separates the rules from what comes before them; {@link snapshotText}'s own join. */
const RULES_SEPARATOR = `\n\n${STRETCH_RULES_HEADING}\n\n`;

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

/** The rules clause for the rules handed in, or {@link RULES_REMOVED_LINE} for none. */
function rulesChangeLine(rules: StretchRules | null): string {
  return rules === null
    ? RULES_REMOVED_LINE
    : `stretch rules: ${rules.path} changed since the saved copy`;
}

/** The two local parts of a snapshot, each as {@link localText} writes it. */
interface LocalParts {
  readonly notes: string;
  readonly rules: string;
}

/**
 * A saved copy split at its separators, the last of each, as the module
 * note reads one: the body before them, the notes and the rules after.
 * A copy without a separator is all body, as the base read it.
 */
function savedParts(saved: string): LocalParts & { readonly body: string } {
  const rulesAt = saved.lastIndexOf(RULES_SEPARATOR);
  const head = rulesAt === -1
    ? saved
    : saved.slice(0, rulesAt);
  const rules = rulesAt === -1
    ? ''
    : localText(saved.slice(rulesAt + RULES_SEPARATOR.length));
  const notesAt = head.lastIndexOf(NOTES_SEPARATOR);
  return {
    body: notesAt === -1
      ? head
      : head.slice(0, notesAt),
    notes: notesAt === -1
      ? ''
      : localText(head.slice(notesAt + NOTES_SEPARATOR.length)),
    rules,
  };
}

/**
 * The local parts of `saved` after the body `now`, when the copy holds
 * that body followed by nothing or by a separator, or null when the body
 * differs. The module note holds the prefix test and how the tail is
 * split.
 */
function tailParts(saved: string, now: string): LocalParts | null {
  if (saved === `${now}\n`) return { notes: '', rules: '' };
  if (!saved.startsWith(now)) return null;
  const tail = saved.slice(now.length);
  if (tail.startsWith(RULES_SEPARATOR)) return { notes: '', rules: localText(tail.slice(RULES_SEPARATOR.length)) };
  if (!tail.startsWith(NOTES_SEPARATOR)) return null;
  const rest = tail.slice(NOTES_SEPARATOR.length);
  const rulesAt = rest.lastIndexOf(RULES_SEPARATOR);
  return rulesAt === -1
    ? { notes: localText(rest), rules: '' }
    : {
      notes: localText(rest.slice(0, rulesAt)),
      rules: localText(rest.slice(rulesAt + RULES_SEPARATOR.length)),
    };
}

/**
 * The notes line for the old local parts `old` against the new ones, or
 * null when neither changed.
 */
function localChangeLine(old: LocalParts, now: LocalParts, options: SnapshotChangeOptions): string | null {
  const clauses = [
    old.notes === now.notes
      ? null
      : notesChangeLine(options.notesPath),
    old.rules === now.rules
      ? null
      : rulesChangeLine(options.rules ?? null),
  ].filter((clause) => clause !== null);
  return clauses.length === 0
    ? null
    : clauses.join('; ');
}

/**
 * Reads how the saved copy `options.saved` differs from the text
 * {@link snapshotText} writes for `options.body`, `options.notes` and
 * `options.rules`, answering which parts changed and one line for each
 * that did.
 *
 * `unchanged` is the saved copy less its refs block equal to that text,
 * byte for byte, which is what `writeSpecSnapshot` (`./issue.ts`) leaves
 * alone.
 * `notes` is the body the same
 * and the notes or the rules not, `body` the reverse, and `both` both;
 * a rules change reads as a notes change. The module
 * note holds how the two parts are told apart in a copy that holds
 * them joined, and where that reading can be fooled. The refs block is
 * stripped from the saved copy first, and one the codec will not read
 * throws its `RefsBlockError`.
 */
export function readSnapshotChange(options: SnapshotChangeOptions): SnapshotChange {
  const { body, notes } = options;
  const rules = options.rules ?? null;
  const saved = readRefsBlock(options.saved).body;
  if (saved === snapshotText(body, notes, rules?.text ?? null)) {
    return { kind: 'unchanged', bodyLine: null, notesLine: null };
  }

  const now = normalise(body);
  const local: LocalParts = { notes: localText(notes), rules: localText(rules?.text ?? null) };
  const tail = tailParts(saved, now);
  if (tail !== null) {
    const notesLine = localChangeLine(tail, local, options) ?? notesChangeLine(options.notesPath);
    return { kind: 'notes', bodyLine: null, notesLine };
  }

  const old = savedParts(saved);
  const bodyLine = bodyChangeLine(normalise(old.body), now);
  const notesLine = localChangeLine(old, local, options);
  return notesLine === null
    ? { kind: 'body', bodyLine, notesLine: null }
    : { kind: 'both', bodyLine, notesLine };
}

