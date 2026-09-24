/**
 * The `page` pager view: a long text shown a window of lines at a time in
 * raw mode, scrolled with the keys and left with Escape.
 *
 * The view reads {@link Key}s from its key source and redraws its frame
 * on the terminal seam after each key that moves the window:
 *
 *   - `up` and `down` scroll one line;
 *   - a space scrolls one window down and `b` one window up;
 *   - scrolling stops at both ends and never wraps: the window's top line
 *     stays between the text's first line and the line that puts the
 *     text's last line at the window's bottom. A key that would move the
 *     window past an end moves it only as far as the end, and a key that
 *     moves it nowhere draws nothing;
 *   - `escape` leaves the view;
 *   - `ctrl-c` throws a {@link CommandExit} with
 *     {@link INTERRUPT_EXIT_CODE}, since in raw mode Ctrl-C is a key and
 *     not a signal;
 *   - every other key, `enter` and `q` included, does nothing, so a caller
 *     keeps `q` for its own meaning.
 *
 * A key source that ends leaves the view as `escape` does. The view
 * answers nothing: leaving is its only outcome.
 *
 * The text is split into lines at LF and CR LF ({@link pageLines}). Tabs
 * are expanded to the next multiple of {@link TAB_WIDTH} columns, other
 * control characters are dropped, and a line longer than `width` is cut
 * to `width` code points, the last one {@link CUT_MARK}. A frame counts
 * its lines to erase itself, so a line the terminal wrapped would leave a
 * row behind; cutting is what keeps each line one row. The cut counts code
 * points, not columns, so a line of wide characters can still wrap. The
 * seam carries no terminal size: a caller over a real terminal passes
 * its `columns` as `width` and its `rows`, less the frame's other lines,
 * as `height`.
 *
 * The view runs inside {@link rawSession}, so raw mode is switched off
 * however it ends, and with no terminal it refuses before reading a key.
 * The frame is the title on the first line when there is one, then the
 * window's lines, or {@link EMPTY_PAGE_TEXT} for an empty text, then one
 * status line naming the lines shown and the keys. Each redraw moves back
 * to the frame's first line and erases to the end of the screen before
 * drawing; leaving erases the frame and draws nothing in its place, so the
 * cursor ends where the frame began.
 */
import type { Key, NoTerminalOptions, Terminal } from './terminal.js';

import { CommandExit } from '../command.js';

import { INTERRUPT_EXIT_CODE, processTerminal, rawSession, stdinKeys } from './terminal.js';

/** Lines shown at once when the caller names no height. */
export const DEFAULT_PAGE_HEIGHT = 20;

/** The longest line, in code points, when the caller names no width. */
export const DEFAULT_PAGE_WIDTH = 80;

/** The columns between tab stops. */
export const TAB_WIDTH = 8;

/** The code point a cut line ends with. */
export const CUT_MARK = '…';

/** The line shown in place of the window when the text has no lines. */
export const EMPTY_PAGE_TEXT = '(empty)';

/** The keys named on the status line. */
export const PAGE_KEYS_TEXT = '↑↓ scroll · space/b page · esc back';

/** Carriage return and erase from there to the end of the screen. */
const CLEAR_DOWN = '\r\u001b[J';

/** The key that scrolls one window up. */
const PAGE_UP_CHAR = 'b';

/** The key that scrolls one window down. */
const PAGE_DOWN_CHAR = ' ';

/** Code points below this one are control characters. */
const FIRST_PRINTABLE = 0x20;

/** The one control character above the printable range, DEL. */
const DELETE = 0x7f;

/** What a {@link page} view shows, and where it reads and writes. */
export interface PageOptions extends NoTerminalOptions {
  /** The text shown. */
  readonly text: string;
  /** A line shown above the window, when given. */
  readonly title?: string;
  /** The most lines of text shown at once; {@link DEFAULT_PAGE_HEIGHT} by default, at least 1. */
  readonly height?: number;
  /** The longest line in code points; {@link DEFAULT_PAGE_WIDTH} by default, at least 1. */
  readonly width?: number;
  /** The key source; {@link stdinKeys} by default. */
  readonly keys?: AsyncIterable<Key>;
  /** The terminal seam; {@link processTerminal} by default. */
  readonly terminal?: Terminal;
}

/** What one frame shows. */
export interface PageView {
  /** The title line, when there is one. */
  readonly title?: string;
  /** The lines in the window, top first. */
  readonly lines: readonly string[];
  /** The window's first line's position in the text, from 0. */
  readonly top: number;
  /** How many lines the text has. */
  readonly total: number;
}

/** `line` with tabs expanded to the next tab stop and other control characters dropped. */
function printable(line: string): string {
  let out = '';
  let column = 0;
  for (const char of line) {
    if (char === '\t') {
      const spaces = TAB_WIDTH - (column % TAB_WIDTH);
      out += ' '.repeat(spaces);
      column += spaces;
      continue;
    }
    const point = char.codePointAt(0) ?? 0;
    if (point < FIRST_PRINTABLE || point === DELETE) continue;
    out += char;
    column += 1;
  }
  return out;
}

/** `line` cut to `width` code points, the last one {@link CUT_MARK} when it was cut. */
function cut(line: string, width: number): string {
  const points = [...line];
  return points.length > width
    ? `${points.slice(0, width - 1).join('')}${CUT_MARK}`
    : line;
}

/**
 * The lines `text` is shown as, `width` code points at most each; see the
 * module note. An empty text has no lines, and a text ending in a line
 * break has no empty line after it.
 */
export function pageLines(text: string, width: number = DEFAULT_PAGE_WIDTH): readonly string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const cap = Math.max(1, width);
  return lines.map((line) => cut(printable(line), cap));
}

/** The status line: the lines shown out of the total, then the keys. */
function statusLine(view: PageView): string {
  if (view.total === 0) return `  ${PAGE_KEYS_TEXT}`;
  const last = view.top + view.lines.length;
  return `  lines ${view.top + 1}–${last} of ${view.total} · ${PAGE_KEYS_TEXT}`;
}

/** The frame's lines, first line first; see the module note. */
export function renderPage(view: PageView): readonly string[] {
  const title = view.title === undefined
    ? []
    : [view.title];
  const body = view.total === 0
    ? [EMPTY_PAGE_TEXT]
    : view.lines;
  return [...title, ...body, statusLine(view)];
}

/** `top` moved `step` lines, held between 0 and `total - height`. */
function scroll(top: number, step: number, total: number, height: number): number {
  const lowest = Math.max(0, total - height);
  return Math.min(lowest, Math.max(0, top + step));
}

/** How far `key` scrolls a window of `height` lines; 0 for a key that does not scroll. */
function stepOf(key: Key, height: number): number {
  if (key.name === 'up') return -1;
  if (key.name === 'down') return 1;
  if (key.name !== 'char') return 0;
  if (key.char === PAGE_DOWN_CHAR) return height;
  if (key.char === PAGE_UP_CHAR) return -height;
  return 0;
}

/** The text that erases a frame of `lines` lines, the cursor being on its last. */
function eraseFrame(lines: number): string {
  return lines > 1
    ? `\u001b[${lines - 1}A${CLEAR_DOWN}`
    : CLEAR_DOWN;
}

/** Reads keys until the view is left; see the module note. */
async function readPage(options: PageOptions, keys: AsyncIterable<Key>, terminal: Terminal): Promise<void> {
  const height = Math.max(1, options.height ?? DEFAULT_PAGE_HEIGHT);
  const lines = pageLines(options.text, options.width ?? DEFAULT_PAGE_WIDTH);
  const titled = options.title === undefined
    ? {}
    : { title: options.title };
  const frameAt = (top: number): readonly string[] => renderPage({
    ...titled,
    lines: lines.slice(top, top + height),
    top,
    total: lines.length,
  });
  let top = 0;
  let drawn = frameAt(top);
  terminal.write(drawn.join('\n'));
  for await (const key of keys) {
    if (key.name === 'ctrl-c') throw new CommandExit(INTERRUPT_EXIT_CODE);
    if (key.name === 'escape') break;
    const next = scroll(top, stepOf(key, height), lines.length, height);
    if (next === top) continue;
    top = next;
    const frame = frameAt(top);
    terminal.write(`${eraseFrame(drawn.length)}${frame.join('\n')}`);
    drawn = frame;
  }
  terminal.write(eraseFrame(drawn.length));
}

/**
 * Shows `options.text` a window at a time until `escape` or the keys end.
 * Throws a {@link CommandExit} on `ctrl-c`, and refuses when standard
 * input is not a terminal; see the module note.
 */
export async function page(options: PageOptions): Promise<void> {
  const terminal = options.terminal ?? processTerminal();
  const refusal: NoTerminalOptions = options.instead === undefined
    ? {}
    : { instead: options.instead };
  return rawSession(terminal, async () => readPage(options, options.keys ?? stdinKeys(), terminal), refusal);
}
