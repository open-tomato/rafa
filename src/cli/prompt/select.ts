/**
 * The `select` prompt: one choice out of a list, picked in raw mode with
 * the arrows and narrowed by typing.
 *
 * The prompt reads {@link Key}s from its key source and redraws its frame
 * on the terminal seam after each key that changes it:
 *
 *   - `up` and `down` move the highlight one row among the choices that
 *     match the filter, wrapping from the last row to the first and back;
 *   - a printable character is appended to the filter, and `backspace`
 *     removes the filter's last character (a code point), doing nothing on
 *     an empty filter. A choice matches when its label holds the filter,
 *     ignoring case; an empty filter matches every choice;
 *   - when the filter changes, the highlight stays on the choice it was on
 *     if that choice still matches, and goes to the first match otherwise;
 *   - `enter` answers the highlighted choice's value, and does nothing
 *     when no choice matches;
 *   - `escape` answers `null`: the person declined to pick;
 *   - `ctrl-c` throws a {@link CommandExit} with
 *     {@link INTERRUPT_EXIT_CODE}, since in raw mode Ctrl-C is a key and
 *     not a signal.
 *
 * A key source that ends before `enter` or `escape` answers `null`.
 *
 * At most `pageSize` rows are shown. The window scrolls only as far as it
 * must to keep the highlight in view, so moving up from the bottom row
 * moves the highlight, not the window.
 *
 * The prompt runs inside {@link rawSession}, so raw mode is switched off
 * however it ends, and with no terminal it refuses before reading a key.
 * The frame is the message and filter on the first line, then one line
 * per shown row, the highlighted one marked `❯`, or `(no matches)`. Each
 * redraw moves back to the frame's first line and erases to the end of
 * the screen before drawing; the last draw replaces the frame with one
 * line naming the answer, ended by a line break.
 */
import type { Key, NoTerminalOptions, Terminal } from './terminal.js';

import { CommandExit } from '../command.js';

import { INTERRUPT_EXIT_CODE, processTerminal, rawSession, stdinKeys } from './terminal.js';

/** Rows shown at once when the caller names no page size. */
export const DEFAULT_PAGE_SIZE = 10;

/** The row shown when the filter matches no choice. */
export const NO_MATCHES_TEXT = '(no matches)';

/** Carriage return and erase from there to the end of the screen. */
const CLEAR_DOWN = '\r\u001b[J';

/** One choice in a {@link select} list. */
export interface Choice<T> {
  /** What the row shows, and what the filter is matched against. */
  readonly label: string;
  /** What the prompt answers when this choice is picked. */
  readonly value: T;
}

/** How a {@link select} prompt asks, and where it reads and writes. */
export interface SelectOptions<T> extends NoTerminalOptions {
  /** The question, shown before the filter. */
  readonly message: string;
  /** The choices, in the order shown. */
  readonly choices: readonly Choice<T>[];
  /** The index in `choices` highlighted when the prompt opens; 0 by default. */
  readonly initial?: number;
  /** The most rows shown at once; {@link DEFAULT_PAGE_SIZE} by default, at least 1. */
  readonly pageSize?: number;
  /** The key source; {@link stdinKeys} by default. */
  readonly keys?: AsyncIterable<Key>;
  /** The terminal seam; {@link processTerminal} by default. */
  readonly terminal?: Terminal;
}

/** What one frame shows. */
export interface SelectView {
  /** The question. */
  readonly message: string;
  /** The filter typed so far. */
  readonly filter: string;
  /** The labels of the rows in the window, top first. */
  readonly rows: readonly string[];
  /** The highlighted row's position in `rows`, or -1 when there are none. */
  readonly highlight: number;
}

/** The prompt's state: the filter, the matching choices' indexes, the highlight and the window's top, as positions in `matches`. */
interface SelectState {
  readonly filter: string;
  readonly matches: readonly number[];
  readonly cursor: number;
  readonly top: number;
}

/** The frame's lines, first line first; see the module note. */
export function renderSelect(view: SelectView): readonly string[] {
  const rows = view.rows.length === 0
    ? [`  ${NO_MATCHES_TEXT}`]
    : view.rows.map((label, at) => at === view.highlight
      ? `❯ ${label}`
      : `  ${label}`);
  return [`? ${view.message} ${view.filter}`, ...rows];
}

/** The indexes of the choices whose label holds `filter`, ignoring case. */
export function matchChoices(choices: readonly Choice<unknown>[], filter: string): readonly number[] {
  const needle = filter.toLowerCase();
  const indexes: number[] = [];
  choices.forEach((choice, index) => {
    if (choice.label.toLowerCase().includes(needle)) indexes.push(index);
  });
  return indexes;
}

/** `top` moved as little as it must to keep `cursor` inside a window of `pageSize` rows. */
function scrollTo(top: number, cursor: number, pageSize: number): number {
  if (cursor < top) return cursor;
  if (cursor >= top + pageSize) return cursor - pageSize + 1;
  return top;
}

/** `state` with the highlight moved `step` rows, wrapping. */
function move(state: SelectState, step: number, pageSize: number): SelectState {
  const count = state.matches.length;
  if (count === 0) return state;
  const cursor = (state.cursor + step + count) % count;
  return { ...state, cursor, top: scrollTo(state.top, cursor, pageSize) };
}

/** `state` under a new filter, keeping the highlighted choice when it still matches. */
function refilter(state: SelectState, choices: readonly Choice<unknown>[], filter: string, pageSize: number): SelectState {
  const current = state.matches[state.cursor];
  const matches = matchChoices(choices, filter);
  const kept = current === undefined
    ? -1
    : matches.indexOf(current);
  const cursor = Math.max(kept, 0);
  return { filter, matches, cursor, top: scrollTo(0, cursor, pageSize) };
}

/** The frame `state` shows. */
function viewOf(state: SelectState, message: string, choices: readonly Choice<unknown>[], pageSize: number): SelectView {
  const shown = state.matches.slice(state.top, state.top + pageSize);
  const rows = shown.map((index) => choices[index]?.label ?? '');
  const highlight = rows.length === 0
    ? -1
    : state.cursor - state.top;
  return { message, filter: state.filter, rows, highlight };
}

/** The text that erases a frame of `lines` lines, the cursor being on its last. */
function eraseFrame(lines: number): string {
  return lines > 1
    ? `\u001b[${lines - 1}A${CLEAR_DOWN}`
    : CLEAR_DOWN;
}

/** The state a prompt over `options` opens in. */
function openingState<T>(options: SelectOptions<T>, pageSize: number): SelectState {
  const matches = matchChoices(options.choices, '');
  const wanted = options.initial ?? 0;
  const cursor = wanted >= 0 && wanted < matches.length
    ? wanted
    : 0;
  return { filter: '', matches, cursor, top: scrollTo(0, cursor, pageSize) };
}

/** `state` after `key`, or the same state when the key changes nothing. */
function applyKey(state: SelectState, key: Key, choices: readonly Choice<unknown>[], pageSize: number): SelectState {
  if (key.name === 'up') return move(state, -1, pageSize);
  if (key.name === 'down') return move(state, 1, pageSize);
  if (key.name === 'char') return refilter(state, choices, `${state.filter}${key.char}`, pageSize);
  if (key.name === 'backspace' && state.filter !== '') {
    return refilter(state, choices, [...state.filter].slice(0, -1).join(''), pageSize);
  }
  return state;
}

/** Reads keys until one answers; see the module note. */
async function readSelect<T>(options: SelectOptions<T>, keys: AsyncIterable<Key>, terminal: Terminal): Promise<T | null> {
  const { message, choices } = options;
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  let state = openingState(options, pageSize);
  let drawn = renderSelect(viewOf(state, message, choices, pageSize));
  terminal.write(drawn.join('\n'));
  const finish = (answer: Choice<T> | null): T | null => {
    const named = answer === null
      ? `? ${message}`
      : `? ${message} ${answer.label}`;
    terminal.write(`${eraseFrame(drawn.length)}${named}\n`);
    return answer === null
      ? null
      : answer.value;
  };
  for await (const key of keys) {
    if (key.name === 'ctrl-c') throw new CommandExit(INTERRUPT_EXIT_CODE);
    if (key.name === 'escape') return finish(null);
    if (key.name === 'enter') {
      const picked = choices[state.matches[state.cursor] ?? -1];
      if (picked !== undefined) return finish(picked);
      continue;
    }
    const next = applyKey(state, key, choices, pageSize);
    if (next === state) continue;
    state = next;
    const frame = renderSelect(viewOf(state, message, choices, pageSize));
    terminal.write(`${eraseFrame(drawn.length)}${frame.join('\n')}`);
    drawn = frame;
  }
  return finish(null);
}

/**
 * Asks for one of `options.choices`; answers its value, or `null` on
 * `escape` or when the keys end. Throws a {@link CommandExit} on `ctrl-c`,
 * and refuses when standard input is not a terminal; see the module note.
 */
export async function select<T>(options: SelectOptions<T>): Promise<T | null> {
  const terminal = options.terminal ?? processTerminal();
  const refusal: NoTerminalOptions = options.instead === undefined
    ? {}
    : { instead: options.instead };
  return rawSession(terminal, async () => readSelect(options, options.keys ?? stdinKeys(), terminal), refusal);
}
