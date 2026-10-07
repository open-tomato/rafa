/**
 * `board.project.number` written into the project config, the last part
 * of the project step of `rafa init --board` (`./init-board-project.ts`):
 * once the project is copied, the number names it for every later
 * refresh (`.rafa/specs/rafa-791-github-project-each-repository.md`,
 * "Save the number").
 *
 * The setting is written INTO the commented config `rafa init` writes
 * (`src/project/scaffold.ts`), never over it, for the reason
 * `src/board/setup-config.ts` gives for `roadmap.issue`: a
 * `Bun.YAML.stringify` of the parsed document would drop every comment
 * an operator reads to learn what can be set.
 *
 * ## The shapes the edit covers, and the ones it refuses
 *
 * {@link withProjectNumber} is a line edit, two spaces to a level, as the
 * scaffold indents:
 *
 *  1. An uncommented `board:` on a line of its own: under its
 *     `  project:`, an uncommented `    number:` is replaced, else one is
 *     added below `  project:`; with no `  project:`, both lines are
 *     added below `board:`.
 *  2. No `board` key, and the commented block the scaffold writes
 *     (`# board:`, then lines of `#` and two or more spaces): `board:`
 *     and `  project:` are uncommented and the commented `    number:`
 *     line is replaced, dropping its trailing comment, which describes
 *     an unset number. The block's other lines, `template:` among them,
 *     stay commented. A block missing `project:` or `number:` gains the
 *     lines below `board:` instead.
 *  3. No `board` key and no commented block: the three lines are
 *     appended.
 *
 * A file naming `board` or `board.project` some other way — a flow
 * mapping such as `board: {relationships: native}` or
 * `  project: {number: 3}` — is REFUSED with null, never appended to:
 * `Bun.YAML.parse` answers the last of two duplicate keys silently
 * (`src/board/setup-config.ts` records the reading), so a second key
 * would read back as the new number and leave the file holding two.
 *
 * ## The parse-back
 *
 * {@link writeProjectNumber} writes nothing until the text it holds reads
 * back through `parseConfigText`, the reader `loadConfig` uses, as the
 * number it means AND as every other value the file read before the
 * edit. The second half is not belt and braces: under a `board:` whose
 * children are indented by four spaces, the two-space `  project:` the
 * edit adds parses, reads back as the number, and turns the
 * `    relationships:` below it into a key of `board.project`, so
 * `board.relationships` silently falls back to its default (measured on
 * bun 1.3.14, 2026-10-07, by this module's own test before the check was
 * added). Every value but the number, and every key no setting names,
 * must read the same before and after, which catches that and any edit
 * like it.
 *
 * Nothing here spawns or asks GitHub anything; the file is read and
 * written under the root the caller names, which every case in
 * `./init-board-project-setting.test.ts` points at its own temporary
 * directory.
 */
import type { ProjectPart } from './init-board-project.js';
import type { ConfigFile } from '../config.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { describeValue, isMapping, messageOf } from '../config-sections.js';
import { configFilePath, parseConfigText } from '../config.js';

/** The setting this module writes, as a row and a refusal name it. */
export const PROJECT_NUMBER_SETTING = 'board.project.number';

/** An uncommented `board:` at the top level. */
const BOARD_KEY = /^board:\s*$/u;

/** An uncommented `project:` one level under it. */
const PROJECT_KEY = /^ {2}project:\s*$/u;

/** A `project` key one level under `board:` in any other shape. */
const ANY_PROJECT_KEY = /^ {2}project:/u;

/** An uncommented `number:` two levels under `board:`. */
const NUMBER_KEY = /^ {4}number:/u;

/** The scaffold's commented `board:`. */
const COMMENTED_BOARD_KEY = /^#\s*board:\s*$/u;

/** A line of the commented block under it: `#`, then two or more spaces, then text. */
const COMMENTED_CHILD = /^# {2,}\S/u;

/** A line that opens a top-level key: text in the first column that is not a comment. */
const TOP_LEVEL = /^[^\s#]/u;

/** A line holding a key above the second level: fewer than four spaces before its text, not a comment. */
const ABOVE_SECOND_LEVEL = /^ {0,3}[^\s#]/u;

/** The lines that set the number, with the `  project:` above it when `withProject`. */
function settingLines(number: number, withProject: boolean): readonly string[] {
  return withProject
    ? ['  project:', numberLine(number)]
    : [numberLine(number)];
}

/** `lines` with `inserted` after index `at`. */
function insertedAfter(lines: readonly string[], at: number, inserted: readonly string[]): readonly string[] {
  return [...lines.slice(0, at + 1), ...inserted, ...lines.slice(at + 1)];
}

/** `lines` with the line at `at` replaced by `line`. */
function replacedAt(lines: readonly string[], at: number, line: string): readonly string[] {
  return lines.map((held, index) => (index === at
    ? line
    : held));
}

/** True for a line a pattern or a test picks out. */
type LineTest = (line: string) => boolean;

/** The test `pattern` makes, over the line as written. */
function matching(pattern: RegExp): LineTest {
  return (line) => pattern.test(line);
}

/** The test `pattern` makes, over the line with its `# ` taken off. */
function matchingUncommented(pattern: RegExp): LineTest {
  return (line) => pattern.test(line.replace(/^# /u, ''));
}

/** The index of the first line after `from`, below `end`, that `test` picks; -1 when none does. */
function indexAfter(lines: readonly string[], from: number, end: number, test: LineTest): number {
  const found = lines.slice(from + 1, end).findIndex(test);
  return found < 0
    ? -1
    : from + 1 + found;
}

/** Where the block opened at `open` ends, below `end`: the first later line `closes` picks, else `end`. */
function blockEnd(lines: readonly string[], open: number, end: number, closes: LineTest): number {
  const found = indexAfter(lines, open, end, closes);
  return found < 0
    ? end
    : found;
}

/** The replacement number line. */
function numberLine(number: number): string {
  return `    number: ${String(number)}`;
}

/** Branch 1 of the module note, over an uncommented `board:` at `open`; null for a `project` of another shape. */
function underOpenBoard(lines: readonly string[], open: number, number: number): readonly string[] | null {
  const end = blockEnd(lines, open, lines.length, matching(TOP_LEVEL));
  const project = indexAfter(lines, open, end, matching(PROJECT_KEY));
  if (project < 0) {
    return indexAfter(lines, open, end, matching(ANY_PROJECT_KEY)) < 0
      ? insertedAfter(lines, open, settingLines(number, true))
      : null;
  }
  const projectEnd = blockEnd(lines, project, end, matching(ABOVE_SECOND_LEVEL));
  const held = indexAfter(lines, project, projectEnd, matching(NUMBER_KEY));
  return held < 0
    ? insertedAfter(lines, project, settingLines(number, false))
    : replacedAt(lines, held, numberLine(number));
}

/** Branch 2 of the module note, over the commented `# board:` at `open`. */
function underCommentedBoard(lines: readonly string[], open: number, number: number): readonly string[] {
  const opened = replacedAt(lines, open, 'board:');
  const end = blockEnd(lines, open, lines.length, (line) => !COMMENTED_CHILD.test(line));
  const project = indexAfter(lines, open, end, matchingUncommented(PROJECT_KEY));
  if (project < 0) return insertedAfter(opened, open, settingLines(number, true));
  const projectEnd = blockEnd(lines, project, end, matchingUncommented(ABOVE_SECOND_LEVEL));
  const held = indexAfter(lines, project, projectEnd, matchingUncommented(NUMBER_KEY));
  const withProject = replacedAt(opened, project, '  project:');
  return held < 0
    ? insertedAfter(withProject, project, settingLines(number, false))
    : replacedAt(withProject, held, numberLine(number));
}

/** True when `text` parses to a document that already names `board`. */
function namesBoard(text: string): boolean {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch {
    return false;
  }
  return isMapping(document) && Object.hasOwn(document, 'board');
}

/** `lines` with `block` after the last line that holds anything. */
function appended(lines: readonly string[], block: readonly string[]): readonly string[] {
  const body = lines.at(-1) === ''
    ? lines.slice(0, -1)
    : [...lines];
  return [...body, ...block, ''];
}

/**
 * `text` with `board.project.number` set to `number`, the comments around
 * it kept, or null when the file names `board` or `board.project` in a
 * shape none of the branches of the module note edits. Pure, and
 * unchecked: {@link writeProjectNumber} parses what comes back before
 * writing it.
 */
export function withProjectNumber(text: string, number: number): string | null {
  const lines = text.split('\n');
  const open = lines.findIndex((line) => BOARD_KEY.test(line));
  if (open >= 0) return underOpenBoard(lines, open, number)?.join('\n') ?? null;
  if (namesBoard(text)) return null;
  const commented = lines.findIndex((line) => COMMENTED_BOARD_KEY.test(line));
  if (commented >= 0) return underCommentedBoard(lines, commented, number).join('\n');
  return appended(lines, ['board:', ...settingLines(number, true)]).join('\n');
}

/**
 * What `text` says `board.project.number` is, read through
 * `parseConfigText`; `path` labels the refusals only.
 *
 * @throws ConfigError when the text is not a config this rafa reads.
 */
export function projectNumberIn(text: string, path: string): number | null {
  return parseConfigText(text, path).values.boardProjectNumber ?? null;
}

/**
 * Why `written` does not read back as `text` with the number set to
 * `number`, or null when it does: see the module note on the parse-back.
 */
function readBackProblem(text: string, written: string, path: string, number: number): string | null {
  let before: ConfigFile;
  let after: ConfigFile;
  try {
    before = parseConfigText(text, path);
    after = parseConfigText(written, path);
  } catch (error) {
    return `does not parse: ${messageOf(error)}`;
  }
  const read = after.values.boardProjectNumber ?? null;
  if (read !== number) return `reads ${PROJECT_NUMBER_SETTING} as ${describeValue(read)}`;
  const others = (file: ConfigFile): unknown => ({ values: { ...file.values, boardProjectNumber: null }, extras: file.extras });
  return Bun.deepEquals(others(before), others(after), true)
    ? null
    : `reads a setting other than ${PROJECT_NUMBER_SETTING} differently, or a key no setting names`;
}

/** The setting part, as every outcome of {@link writeProjectNumber} builds it. */
function settingPart(outcome: ProjectPart['outcome'], detail: string): ProjectPart {
  return { kind: 'setting', name: PROJECT_NUMBER_SETTING, outcome, detail };
}

/**
 * Writes `board.project.number: <number>` into the project config under
 * `root`, having read the text back as that number first. `present`,
 * writing nothing, when the file already names it; `refused`, leaving
 * the file as it was, when it cannot be read, is in a shape the edit
 * refuses, or would not read back as `number`.
 */
export function writeProjectNumber(root: string, number: number): ProjectPart {
  const path = configFilePath(root);
  let text: string;
  let held: number | null;
  try {
    text = readFileSync(path, 'utf8');
    held = projectNumberIn(text, path);
  } catch (error) {
    return settingPart('refused', `${path} could not be read: ${messageOf(error)}`);
  }
  if (held === number) return settingPart('present', `${path} names project ${String(number)}`);

  const written = withProjectNumber(text, number);
  if (written === null) {
    const why = `it spells board or board.project in a shape this command does not edit, so set ${PROJECT_NUMBER_SETTING}: ${String(number)} by hand`;
    return settingPart('refused', `${path} was left as it was: ${why}`);
  }
  const problem = readBackProblem(text, written, path, number);
  if (problem !== null) return settingPart('refused', `${path} was left as it was: the file this run would have written ${problem}`);
  try {
    writeFileSync(path, written, 'utf8');
  } catch (error) {
    return settingPart('refused', `${path} could not be written: ${messageOf(error)}`);
  }
  return settingPart('created', `${path} now names project ${String(number)}`);
}
