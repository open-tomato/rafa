/**
 * The symbols an `out_of_scope_bugs` entry names ({@link symbolsOf}),
 * for the kind check's symbol row to look for in the plan's added lines:
 * an entry whose path lies outside the plan but whose symbol the plan's
 * own commits added is read as the plan's leftover.
 *
 * ## What a symbol is
 *
 * Read over the entry's `what` and `artifact`, a symbol is one of:
 *
 * - a backticked span's text (`` `loop.retries` `` names `loop.retries`);
 * - a quoted span's text, in single or double quotes (`'Repair the red'`);
 * - a camelCase name (`readPlanFiles`);
 * - a PascalCase name of two humps or more (`TakenBy`; `Board` is a word);
 * - a CONST_CASE name holding an `_` (`MIN_SYMBOL_LENGTH`; `README` is
 *   not one);
 * - a parenthesised phrase's text (`(the red step)`), no paren inside it.
 *
 * A span or phrase stays on one line, and its text is trimmed.
 *
 * ## What is left out
 *
 * - **`#<n>` refs.** An issue or pull request ref (`#1384`) is taken out
 *   of the text before anything is read, so neither `` `#1384` `` nor the
 *   phrase `(from #1384)` keeps it.
 * - **A quote right after a letter** opens no span: it is a possessive or
 *   a contraction (`run's, board's`, `doesn't`), and reading it as a
 *   quote would make a symbol of the words between two of them.
 * - **Short names.** A symbol shorter than {@link MIN_SYMBOL_LENGTH}
 *   characters is dropped, since a generic short name (`run`, `kind`,
 *   `files`) is in nearly any diff.
 *
 * The answer holds each symbol once, in the order the text first names it.
 */
import type { ReportBug } from '@open-tomato/rafa/report/parse';

/**
 * The fewest characters a symbol holds; a shorter one is dropped as too
 * generic to tell a plan's lines from anyone else's.
 */
export const MIN_SYMBOL_LENGTH = 6;

/** An issue or pull request ref, `#` and digits, taken out before reading. */
const ISSUE_REF = /#\d+\b/g;

/**
 * The spans and names a symbol is read from; the first group holding
 * text is the symbol. A quote opens a span only when no letter is right
 * before it.
 */
const SYMBOL_SHAPES: readonly RegExp[] = [
  /`([^`\n]+)`/g,
  /(?<!\p{L})'([^'\n]+)'/gu,
  /(?<!\p{L})"([^"\n]+)"/gu,
  /\(([^()\n]+)\)/g,
  /\b([a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)\b/g,
  /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)\b/g,
  /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g,
];

/** A symbol and where the text names it. */
interface Found {
  readonly symbol: string;
  readonly index: number;
}

/** Every match of `shape` in `text`, its symbol trimmed. */
function foundBy(shape: RegExp, text: string): readonly Found[] {
  return [...text.matchAll(shape)].map((match) => ({
    symbol: (match[1] ?? '').trim(),
    index: match.index,
  }));
}

/**
 * The symbols the entry's `what` and `artifact` name, each once, in the
 * order the text first names it, with `#<n>` refs, possessives and names
 * shorter than {@link MIN_SYMBOL_LENGTH} left out; see the module note.
 */
export function symbolsOf(entry: Pick<ReportBug, 'what' | 'artifact'>): readonly string[] {
  const text = `${entry.what ?? ''}\n${entry.artifact ?? ''}`.replace(ISSUE_REF, ' ');
  const found = SYMBOL_SHAPES
    .flatMap((shape) => foundBy(shape, text))
    .filter(({ symbol }) => symbol.length >= MIN_SYMBOL_LENGTH)
    .sort((a, b) => a.index - b.index);
  return [...new Set(found.map(({ symbol }) => symbol))];
}
