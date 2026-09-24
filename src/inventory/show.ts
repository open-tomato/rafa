/**
 * The show view of one skill or agent, shared by `rafa skill show`,
 * `rafa agent show` and the browse view's Enter and `f` keys.
 *
 * A list row says where an item sits and whether it answers; the show
 * view says what it IS. It carries five parts, each built here once so
 * the two commands and the browse view can never print one item two
 * ways:
 *
 *   - **The record**, the {@link InventoryRecord} `buildInventory`
 *     decided, unchanged: kind, name, source, path, state, loop
 *     visibility, checker verdict, summary, `when_to_use`, `prevents`,
 *     `stack` and `tags`.
 *   - **The frontmatter**, as the file carries it: the parsed mapping
 *     for json mode and the block's own text for text mode, so a key
 *     the inventory does not read (`model`, `tools`, `user-invocable`)
 *     is still shown, and shown as written.
 *   - **Every other item of the same name**, with its source, state,
 *     path and loop visibility: the other holders of that kind and
 *     name, in precedence order. Shown from the answering holder, this
 *     lists what it shadows; shown from a shadowed one, it lists the
 *     holder that shadows it. A skill and an agent of one name never
 *     meet here, as they never shadow each other.
 *   - **The body's headings**, each with its level and its line in the
 *     FILE (frontmatter lines counted), so a person can jump to one.
 *   - **The whole file**, only when asked for (`--full`).
 *
 * ## Which item a name shows
 *
 * {@link findShown} answers the FIRST holder of the kind and name in
 * the inventory's order, which is precedence order within a name: the
 * one that answers, or the disabled one still holding the name. A
 * caller holding a row already (the browse view) passes that record to
 * {@link readShowView} directly, so a shadowed row shows itself rather
 * than its shadower.
 *
 * ## What counts as a heading
 *
 * An ATX heading, `#` to `######` after at most three spaces, followed
 * by whitespace or the end of the line, with an optional closing run of
 * `#` dropped — CommonMark's reading. A `#` line inside a fenced code
 * block (three or more backticks or tildes, closed by a fence of the
 * same character at least as long) is code, not a heading: a skill
 * quoting a shell comment must not grow a section. Setext headings (a
 * line underlined with `===` or `---`) are not read; the corpus of
 * skills and agents writes none, and a `---` underline is too easily a
 * rule.
 *
 * ## `--full` replaces two parts in text, and adds one in json
 *
 * In text mode `--full` prints the record and the other holders, then
 * the whole file in place of the frontmatter and headings sections,
 * since the file holds both and printing them twice would only push the
 * body further down. In json mode every part is always present and
 * {@link ShowView.text} carries the file under `--full` and is null
 * without it.
 *
 * ## A file that does not read is a part of the view, not a throw
 *
 * The inventory read every file moments ago, but it can be gone or
 * unreadable by the time it is shown. {@link readShowView} then answers
 * the record and the other holders, which came from the inventory,
 * with {@link ShowView.readError} naming what failed and no
 * frontmatter, headings or text. A file with no frontmatter block, or
 * one that does not parse, reads with `frontmatter: null` and its whole
 * text as the body.
 */
import type { InventoryKind, InventoryRecord } from './record.js';

import { readFileSync } from 'node:fs';

import { messageOf } from '../config-sections.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';

/** One other holder of the shown item's kind and name. */
export interface ShowHolder {
  readonly source: InventoryRecord['source'];
  readonly state: InventoryRecord['state'];
  readonly path: string;
  readonly visibleToLoop: boolean;
}

/** One ATX heading of the body. */
export interface ShowHeading {
  /** 1 for `#`, up to 6 for `######`. */
  readonly level: number;
  /** The heading's text, trimmed, with any closing `#` run dropped. */
  readonly text: string;
  /** The heading's 1-based line in the whole file, frontmatter included. */
  readonly line: number;
}

/** Everything the show view prints, and json mode's data. */
export interface ShowView {
  /** The item shown, as the inventory decided it. */
  readonly record: InventoryRecord;
  /** The frontmatter mapping, or null when the file carries none that parses. */
  readonly frontmatter: Readonly<Record<string, unknown>> | null;
  /** The frontmatter block's own text between the fences, or null. */
  readonly frontmatterText: string | null;
  /** Every other holder of the same kind and name, in precedence order. */
  readonly others: readonly ShowHolder[];
  /** The body's headings, in file order. */
  readonly headings: readonly ShowHeading[];
  /** The whole file under `--full`, null without it or when it did not read. */
  readonly text: string | null;
  /** Why the file did not read, or null when it did. */
  readonly readError: string | null;
}

/** How the view is read. */
export interface ShowOptions {
  /** Whether the whole file is carried (`--full`). */
  readonly full: boolean;
  /** Reads a definition file; `readFileSync` as UTF-8 by default. */
  readonly read?: (path: string) => string;
}

/** A fence line's character and length, or null when the line opens none. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** An ATX heading line: its `#` run and the rest of the line. */
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;

/** Every holder of `kind` and `name`, in the inventory's (precedence) order. */
export function holdersOf(
  records: readonly InventoryRecord[],
  kind: InventoryKind,
  name: string,
): readonly InventoryRecord[] {
  return records.filter((record) => record.kind === kind && record.name === name);
}

/** The item a name shows: the first holder of `kind` and `name`, or null when none holds it. */
export function findShown(
  records: readonly InventoryRecord[],
  kind: InventoryKind,
  name: string,
): InventoryRecord | null {
  return holdersOf(records, kind, name)[0] ?? null;
}

/** Whether two records are the same row: one source and one file. */
function sameRow(a: InventoryRecord, b: InventoryRecord): boolean {
  return a.source === b.source && a.path === b.path;
}

/** The other holders of `record`'s kind and name, as the view lists them. */
export function otherHolders(
  record: InventoryRecord,
  records: readonly InventoryRecord[],
): readonly ShowHolder[] {
  return holdersOf(records, record.kind, record.name)
    .filter((holder) => !sameRow(holder, record))
    .map(({ source, state, path, visibleToLoop }) => ({ source, state, path, visibleToLoop }));
}

/** A heading's text with its closing `#` run and surrounding space dropped. */
function headingText(rest: string | undefined): string {
  const trimmed = (rest ?? '').trim();
  if (/^#+$/.test(trimmed)) return '';
  return trimmed.replace(/[ \t]+#+$/, '').trim();
}

/**
 * The ATX headings of `body`, skipping fenced code. `firstLine` is the
 * file line `body` starts on, so each heading's line is the file's.
 */
export function bodyHeadings(body: string, firstLine = 1): readonly ShowHeading[] {
  const headings: ShowHeading[] = [];
  let fence: string | null = null;

  body.split(/\r?\n/).forEach((line, index) => {
    const opened = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (opened !== undefined && opened[0] === fence[0] && opened.length >= fence.length
        && line.trim() === opened) fence = null;
      return;
    }
    if (opened !== undefined) {
      fence = opened;
      return;
    }
    const heading = ATX_HEADING.exec(line);
    if (heading === null) return;
    headings.push({
      level: heading[1]?.length ?? 1,
      text: headingText(heading[2]),
      line: firstLine + index,
    });
  });

  return headings;
}

/** How many lines of `text` precede `body`, which it ends with. */
function linesBefore(text: string, body: string): number {
  return text.slice(0, text.length - body.length).split('\n').length - 1;
}

/**
 * The view of `record` over the file text already read. Pure: the
 * frontmatter, headings and, under `full`, the text come from `text`,
 * and the other holders from `records`.
 */
export function buildShowView(
  record: InventoryRecord,
  records: readonly InventoryRecord[],
  text: string,
  full: boolean,
): ShowView {
  const document = readFrontmatterDocument(text);
  const body = document?.body ?? text;

  return {
    record,
    frontmatter: document?.data ?? null,
    frontmatterText: document?.yaml ?? null,
    others: otherHolders(record, records),
    headings: bodyHeadings(body, linesBefore(text, body) + 1),
    text: full
      ? text
      : null,
    readError: null,
  };
}

/**
 * The view of `record`, reading its file through `options.read`. A file
 * that does not read gives a view with {@link ShowView.readError} set
 * rather than a throw; see the module note.
 */
export function readShowView(
  record: InventoryRecord,
  records: readonly InventoryRecord[],
  options: ShowOptions,
): ShowView {
  const read = options.read ?? ((path: string) => readFileSync(path, 'utf8'));
  let text: string;
  try {
    text = read(record.path);
  } catch (error) {
    return {
      record,
      frontmatter: null,
      frontmatterText: null,
      others: otherHolders(record, records),
      headings: [],
      text: null,
      readError: messageOf(error),
    };
  }
  return buildShowView(record, records, text, options.full);
}

/** A list as one cell, `(none)` when empty. */
function listCell(values: readonly string[]): string {
  return values.length === 0
    ? '(none)'
    : values.join(', ');
}

/** Whether a loop session resolves the item, in words. */
function loopCell(visibleToLoop: boolean): string {
  return visibleToLoop
    ? 'resolved by a loop session'
    : 'not resolved by a loop session';
}

/** The record's lines: a title, then one labelled line per field. */
export function recordLines(record: InventoryRecord): readonly string[] {
  const fields: ReadonlyArray<readonly [string, string | null]> = [
    ['path', record.path],
    ['state', record.state],
    ['loop', loopCell(record.visibleToLoop)],
    ['check', record.check],
    ['summary', record.summary === ''
      ? '(no description)'
      : record.summary],
    ['when', record.whenToUse],
    ['prevents', record.prevents],
    ['stack', listCell(record.stack)],
    ['tags', listCell(record.tags)],
  ];
  const present = fields.filter((field): field is readonly [string, string] => field[1] !== null);
  const width = Math.max(...present.map(([label]) => label.length));
  return [
    `${record.kind} ${record.name} (${record.source})`,
    ...present.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`),
  ];
}

/** The other holders' section. */
export function othersLines(view: ShowView): readonly string[] {
  const { kind, name } = view.record;
  if (view.others.length === 0) return [`Other holders of ${kind} ${name}:`, `  (no other ${kind} of this name)`];
  const width = Math.max(...view.others.map((holder) => holder.source.length));
  const stateWidth = Math.max(...view.others.map((holder) => holder.state.length));
  return [
    `Other holders of ${kind} ${name}:`,
    ...view.others.map((holder) => `  ${holder.source.padEnd(width)}  ${holder.state.padEnd(stateWidth)}  ${holder.path}`
      + (holder.visibleToLoop
        ? '  (resolved by a loop session)'
        : '')),
  ];
}

/** The frontmatter section: the block as written, indented. */
export function frontmatterLines(view: ShowView): readonly string[] {
  if (view.frontmatterText === null) return ['Frontmatter:', '  (none)'];
  const lines = view.frontmatterText.replace(/\r?\n$/, '').split(/\r?\n/);
  return ['Frontmatter:', ...lines.map((line) => `  ${line}`.trimEnd())];
}

/** The headings section: each indented by its level, with its file line. */
export function headingLines(view: ShowView): readonly string[] {
  if (view.headings.length === 0) return ['Headings:', '  (no heading)'];
  return [
    'Headings:',
    ...view.headings.map((heading) => `  ${'  '.repeat(heading.level - 1)}${'#'.repeat(heading.level)} ${heading.text}`
      + `  (line ${String(heading.line)})`),
  ];
}

/** The whole file's section, each line as written. */
function fileLines(view: ShowView, text: string): readonly string[] {
  return [`File ${view.record.path}:`, ...text.replace(/\r?\n$/, '').split(/\r?\n/)];
}

/**
 * Every line text mode writes: the record, the other holders, then the
 * frontmatter and the headings, or the whole file in their place when
 * the view carries it. A blank line separates the sections.
 */
export function renderShowView(view: ShowView): readonly string[] {
  const sections: ReadonlyArray<readonly string[]> = view.readError !== null
    ? [recordLines(view.record), othersLines(view), [`The file could not be read: ${view.readError}`]]
    : [
      recordLines(view.record),
      othersLines(view),
      ...(view.text === null
        ? [frontmatterLines(view), headingLines(view)]
        : [fileLines(view, view.text)]),
    ];
  return sections.flatMap((section, index) => (index === 0
    ? section
    : ['', ...section]));
}
