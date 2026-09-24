/**
 * The `multiSelect` prompt: any number of choices out of a list, checked
 * in raw mode with the space bar and narrowed by typing.
 *
 * It reads its keys as {@link select} does, with one addition, the space
 * bar:
 *
 *   - `up` and `down` move the highlight one row among the choices that
 *     match the filter, wrapping from the last row to the first and back;
 *   - a space checks the highlighted choice, or unchecks it when it is
 *     checked, and does nothing when no choice matches. A space is
 *     therefore never part of the filter;
 *   - any other printable character is appended to the filter, and
 *     `backspace` removes the filter's last character (a code point),
 *     doing nothing on an empty filter. A choice matches when its label
 *     holds the filter, ignoring case ({@link matchChoices}); an empty
 *     filter matches every choice;
 *   - when the filter changes, the highlight stays on the choice it was on
 *     if that choice still matches, and goes to the first match otherwise.
 *     Narrowing never unchecks a choice: a checked choice the filter hides
 *     stays checked and is answered;
 *   - `enter` answers the values of every checked choice, in the order of
 *     `choices` and not the order they were checked in. Nothing checked
 *     answers an empty list, and `enter` answers even when no choice
 *     matches the filter;
 *   - `escape` answers `null`: the person declined to pick;
 *   - `ctrl-c` throws a {@link CommandExit} with
 *     {@link INTERRUPT_EXIT_CODE}, since in raw mode Ctrl-C is a key and
 *     not a signal.
 *
 * A key source that ends before `enter` or `escape` answers `null`, so a
 * caller can tell "picked nothing" (`[]`) from "gave no answer" (`null`).
 *
 * At most `pageSize` rows are shown, and the window scrolls only as far as
 * it must to keep the highlight in view.
 *
 * The prompt runs inside {@link rawSession}, so raw mode is switched off
 * however it ends, and with no terminal it refuses before reading a key.
 * The frame is the message, the count checked and the filter on the first
 * line, then one line per shown row, `◉` before a checked label and `◯`
 * before an unchecked one, the highlighted row marked `❯`, or
 * `(no matches)`. Each redraw moves back to the frame's first line and
 * erases to the end of the screen before drawing; the last draw replaces
 * the frame with one line naming the answer — the checked labels joined
 * by `, `, or {@link NONE_CHECKED_TEXT} — ended by a line break.
 */
import type { Choice } from './select.js';
import type { Key, NoTerminalOptions, Terminal } from './terminal.js';

import { CommandExit } from '../command.js';

import { DEFAULT_PAGE_SIZE, matchChoices, NO_MATCHES_TEXT } from './select.js';
import { INTERRUPT_EXIT_CODE, processTerminal, rawSession, stdinKeys } from './terminal.js';

/** The answer line's text when `enter` is pressed with nothing checked. */
export const NONE_CHECKED_TEXT = '(none)';

/** The mark before a checked label. */
export const CHECKED_MARK = '◉';

/** The mark before an unchecked label. */
export const UNCHECKED_MARK = '◯';

/** The character that checks and unchecks the highlighted choice. */
const TOGGLE_CHAR = ' ';

/** Carriage return and erase from there to the end of the screen. */
const CLEAR_DOWN = '\r\u001b[J';

/** One choice in a {@link multiSelect} list. */
export interface MultiChoice<T> extends Choice<T> {
  /** Whether the choice is checked when the prompt opens; unchecked by default. */
  readonly checked?: boolean;
}

/** How a {@link multiSelect} prompt asks, and where it reads and writes. */
export interface MultiSelectOptions<T> extends NoTerminalOptions {
  /** The question, shown before the count and the filter. */
  readonly message: string;
  /** The choices, in the order shown and answered. */
  readonly choices: readonly MultiChoice<T>[];
  /** The most rows shown at once; {@link DEFAULT_PAGE_SIZE} by default, at least 1. */
  readonly pageSize?: number;
  /** The key source; {@link stdinKeys} by default. */
  readonly keys?: AsyncIterable<Key>;
  /** The terminal seam; {@link processTerminal} by default. */
  readonly terminal?: Terminal;
}

/** One row of a {@link MultiSelectView}. */
export interface MultiSelectRow {
  /** The choice's label. */
  readonly label: string;
  /** Whether the choice is checked. */
  readonly checked: boolean;
}

/** What one frame shows. */
export interface MultiSelectView {
  /** The question. */
  readonly message: string;
  /** The filter typed so far. */
  readonly filter: string;
  /** How many choices are checked, the hidden ones included. */
  readonly checkedCount: number;
  /** The rows in the window, top first. */
  readonly rows: readonly MultiSelectRow[];
  /** The highlighted row's position in `rows`, or -1 when there are none. */
  readonly highlight: number;
}

/** The prompt's state: the checked choices' indexes, and the filter, matches, highlight and window top as {@link select} keeps them. */
interface MultiSelectState {
  readonly checked: ReadonlySet<number>;
  readonly filter: string;
  readonly matches: readonly number[];
  readonly cursor: number;
  readonly top: number;
}

/** The frame's lines, first line first; see the module note. */
export function renderMultiSelect(view: MultiSelectView): readonly string[] {
  const rows = view.rows.length === 0
    ? [`  ${NO_MATCHES_TEXT}`]
    : view.rows.map((row, at) => {
      const pointer = at === view.highlight
        ? '❯'
        : ' ';
      const mark = row.checked
        ? CHECKED_MARK
        : UNCHECKED_MARK;
      return `${pointer} ${mark} ${row.label}`;
    });
  return [`? ${view.message} (${view.checkedCount} checked) ${view.filter}`, ...rows];
}

/** `top` moved as little as it must to keep `cursor` inside a window of `pageSize` rows. */
function scrollTo(top: number, cursor: number, pageSize: number): number {
  if (cursor < top) return cursor;
  if (cursor >= top + pageSize) return cursor - pageSize + 1;
  return top;
}

/** The text that erases a frame of `lines` lines, the cursor being on its last. */
function eraseFrame(lines: number): string {
  return lines > 1
    ? `\u001b[${lines - 1}A${CLEAR_DOWN}`
    : CLEAR_DOWN;
}

/** `state` with the highlight moved `step` rows, wrapping. */
function move(state: MultiSelectState, step: number, pageSize: number): MultiSelectState {
  const count = state.matches.length;
  if (count === 0) return state;
  const cursor = (state.cursor + step + count) % count;
  return { ...state, cursor, top: scrollTo(state.top, cursor, pageSize) };
}

/** `state` under a new filter, keeping the highlighted choice when it still matches. */
function refilter(state: MultiSelectState, choices: readonly Choice<unknown>[], filter: string, pageSize: number): MultiSelectState {
  const current = state.matches[state.cursor];
  const matches = matchChoices(choices, filter);
  const kept = current === undefined
    ? -1
    : matches.indexOf(current);
  const cursor = Math.max(kept, 0);
  return { ...state, filter, matches, cursor, top: scrollTo(0, cursor, pageSize) };
}

/** `state` with the highlighted choice checked or unchecked. */
function toggle(state: MultiSelectState): MultiSelectState {
  const index = state.matches[state.cursor];
  if (index === undefined) return state;
  const checked = new Set(state.checked);
  if (checked.has(index)) checked.delete(index);
  else checked.add(index);
  return { ...state, checked };
}

/** The frame `state` shows. */
function viewOf(state: MultiSelectState, message: string, choices: readonly Choice<unknown>[], pageSize: number): MultiSelectView {
  const shown = state.matches.slice(state.top, state.top + pageSize);
  const rows = shown.map((index) => ({ label: choices[index]?.label ?? '', checked: state.checked.has(index) }));
  const highlight = rows.length === 0
    ? -1
    : state.cursor - state.top;
  return { message, filter: state.filter, checkedCount: state.checked.size, rows, highlight };
}

/** The state a prompt over `choices` opens in. */
function openingState(choices: readonly MultiChoice<unknown>[]): MultiSelectState {
  const checked = new Set<number>();
  choices.forEach((choice, index) => {
    if (choice.checked === true) checked.add(index);
  });
  return { checked, filter: '', matches: matchChoices(choices, ''), cursor: 0, top: 0 };
}

/** `state` after `key`, or the same state when the key changes nothing. */
function applyKey(state: MultiSelectState, key: Key, choices: readonly Choice<unknown>[], pageSize: number): MultiSelectState {
  if (key.name === 'up') return move(state, -1, pageSize);
  if (key.name === 'down') return move(state, 1, pageSize);
  if (key.name === 'char' && key.char === TOGGLE_CHAR) return toggle(state);
  if (key.name === 'char') return refilter(state, choices, `${state.filter}${key.char}`, pageSize);
  if (key.name === 'backspace' && state.filter !== '') {
    return refilter(state, choices, [...state.filter].slice(0, -1).join(''), pageSize);
  }
  return state;
}

/** The checked choices, in the order of `choices`. */
function checkedChoices<T>(choices: readonly MultiChoice<T>[], checked: ReadonlySet<number>): readonly MultiChoice<T>[] {
  return choices.filter((_choice, index) => checked.has(index));
}

/** Reads keys until one answers; see the module note. */
async function readMultiSelect<T>(options: MultiSelectOptions<T>, keys: AsyncIterable<Key>, terminal: Terminal): Promise<readonly T[] | null> {
  const { message, choices } = options;
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  let state = openingState(choices);
  let drawn = renderMultiSelect(viewOf(state, message, choices, pageSize));
  terminal.write(drawn.join('\n'));
  const finish = (answer: readonly MultiChoice<T>[] | null): readonly T[] | null => {
    const labels = answer === null || answer.length === 0
      ? NONE_CHECKED_TEXT
      : answer.map((choice) => choice.label).join(', ');
    const named = answer === null
      ? `? ${message}`
      : `? ${message} ${labels}`;
    terminal.write(`${eraseFrame(drawn.length)}${named}\n`);
    return answer === null
      ? null
      : answer.map((choice) => choice.value);
  };
  for await (const key of keys) {
    if (key.name === 'ctrl-c') throw new CommandExit(INTERRUPT_EXIT_CODE);
    if (key.name === 'escape') return finish(null);
    if (key.name === 'enter') return finish(checkedChoices(choices, state.checked));
    const next = applyKey(state, key, choices, pageSize);
    if (next === state) continue;
    state = next;
    const frame = renderMultiSelect(viewOf(state, message, choices, pageSize));
    terminal.write(`${eraseFrame(drawn.length)}${frame.join('\n')}`);
    drawn = frame;
  }
  return finish(null);
}

/**
 * Asks for any of `options.choices`; answers the checked values in the
 * order of `choices` — an empty list when none is checked — or `null` on
 * `escape` or when the keys end. Throws a {@link CommandExit} on `ctrl-c`,
 * and refuses when standard input is not a terminal; see the module note.
 */
export async function multiSelect<T>(options: MultiSelectOptions<T>): Promise<readonly T[] | null> {
  const terminal = options.terminal ?? processTerminal();
  const refusal: NoTerminalOptions = options.instead === undefined
    ? {}
    : { instead: options.instead };
  return rawSession(terminal, async () => readMultiSelect(options, options.keys ?? stdinKeys(), terminal), refusal);
}
