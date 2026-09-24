/**
 * The `multiSelect` prompt: any number of choices out of a list, checked
 * in raw mode with the space bar and narrowed by typing — or, grouped, out
 * of titled groups, with `a` checking a whole group and no filter.
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
 *
 * Given `groups` in place of `choices`, the prompt runs grouped. Each
 * group with at least one choice shows its title as a heading line, with
 * its choices under it; a group with no choice is not shown. The keys
 * differ from the flat prompt's as follows:
 *
 *   - `up` and `down` move the highlight among every choice of every
 *     group, wrapping, and never onto a heading. A disabled choice (one
 *     carrying a `disabled` reason) can be highlighted, so its reason can
 *     be read beside it;
 *   - a space checks or unchecks the highlighted choice, and does nothing
 *     on a disabled one. A disabled choice is never checked, even when it
 *     is marked `checked`, and so never answered;
 *   - `a` checks every tickable (not disabled) choice of the highlighted
 *     choice's group, or unchecks them all when every one is already
 *     checked, leaving other groups alone. It does nothing in a group
 *     whose choices are all disabled;
 *   - there is no filter: every other character and `backspace` are
 *     ignored, so the first line's filter stays empty;
 *   - `enter` answers the checked values in the order of the groups and
 *     of the choices within each, and `escape`, `ctrl-c` and keys that end
 *     answer as the flat prompt's do.
 *
 * A heading line is the title after two spaces, under the column of the
 * marks; a disabled row carries {@link DISABLED_MARK} and its reason in
 * brackets after the label. The window counts heading lines as rows, and
 * shows the heading directly above the highlight whenever the page has
 * room for both. With no choice in any group the frame shows
 * {@link NO_CHOICES_TEXT}.
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

/** The mark before a disabled label, which is never checked. */
export const DISABLED_MARK = '⊘';

/** The row shown by a grouped prompt when no group has a choice. */
export const NO_CHOICES_TEXT = '(nothing to choose)';

/** The character that checks and unchecks the highlighted choice. */
const TOGGLE_CHAR = ' ';

/** The character that checks or unchecks every tickable choice of the highlighted choice's group. */
const GROUP_TOGGLE_CHAR = 'a';

/** Carriage return and erase from there to the end of the screen. */
const CLEAR_DOWN = '\r\u001b[J';

/** One choice in a {@link multiSelect} list. */
export interface MultiChoice<T> extends Choice<T> {
  /** Whether the choice is checked when the prompt opens; unchecked by default. */
  readonly checked?: boolean;
}

/** One choice in a group of a grouped {@link multiSelect} list. */
export interface GroupedChoice<T> extends MultiChoice<T> {
  /** Why the choice cannot be checked, shown beside it; the choice is tickable when absent. */
  readonly disabled?: string;
}

/** One titled group of a grouped {@link multiSelect} list. */
export interface MultiGroup<T> {
  /** The heading shown above the group's choices; never highlighted or checked. */
  readonly title: string;
  /** The group's choices, in the order shown and answered. */
  readonly choices: readonly GroupedChoice<T>[];
}

/** What every {@link multiSelect} prompt takes, flat or grouped. */
interface MultiSelectCommonOptions extends NoTerminalOptions {
  /** The question, shown before the count and the filter. */
  readonly message: string;
  /** The most rows shown at once, heading lines included; {@link DEFAULT_PAGE_SIZE} by default, at least 1. */
  readonly pageSize?: number;
  /** The key source; {@link stdinKeys} by default. */
  readonly keys?: AsyncIterable<Key>;
  /** The terminal seam; {@link processTerminal} by default. */
  readonly terminal?: Terminal;
}

/** How a flat {@link multiSelect} prompt asks, and where it reads and writes. */
export interface MultiSelectOptions<T> extends MultiSelectCommonOptions {
  /** The choices, in the order shown and answered. */
  readonly choices: readonly MultiChoice<T>[];
  /** Absent: a flat prompt has no groups. */
  readonly groups?: never;
}

/** How a grouped {@link multiSelect} prompt asks, and where it reads and writes; see the module note. */
export interface GroupedMultiSelectOptions<T> extends MultiSelectCommonOptions {
  /** The groups, in the order shown and answered. */
  readonly groups: readonly MultiGroup<T>[];
  /** Absent: a grouped prompt's choices live in its groups. */
  readonly choices?: never;
}

/** One row of a {@link MultiSelectView}. */
export interface MultiSelectRow {
  /** The choice's label, or the group's title on a heading row. */
  readonly label: string;
  /** Whether the choice is checked; false on a heading row. */
  readonly checked: boolean;
  /** Whether the row is a group's heading rather than a choice. */
  readonly heading?: boolean;
  /** Why the choice cannot be checked, when it cannot. */
  readonly disabled?: string;
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
  /** Whether the prompt is grouped, which names an empty list {@link NO_CHOICES_TEXT}. */
  readonly grouped?: boolean;
}

/** The prompt's state: the checked choices' indexes, and the filter, matches, highlight and window top as {@link select} keeps them. */
interface MultiSelectState {
  readonly checked: ReadonlySet<number>;
  readonly filter: string;
  readonly matches: readonly number[];
  readonly cursor: number;
  readonly top: number;
}

/** One row's line; `highlighted` puts the pointer before it. */
function renderRow(row: MultiSelectRow, highlighted: boolean): string {
  if (row.heading === true) return `  ${row.label}`;
  const pointer = highlighted
    ? '❯'
    : ' ';
  if (row.disabled !== undefined) return `${pointer} ${DISABLED_MARK} ${row.label} (${row.disabled})`;
  const mark = row.checked
    ? CHECKED_MARK
    : UNCHECKED_MARK;
  return `${pointer} ${mark} ${row.label}`;
}

/** The frame's lines, first line first; see the module note. */
export function renderMultiSelect(view: MultiSelectView): readonly string[] {
  const empty = view.grouped === true
    ? NO_CHOICES_TEXT
    : NO_MATCHES_TEXT;
  const rows = view.rows.length === 0
    ? [`  ${empty}`]
    : view.rows.map((row, at) => renderRow(row, at === view.highlight));
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

/** How one kind of prompt, flat or grouped, keeps its state `S` and draws and answers it. */
interface MultiSelectMode<S, T> {
  /** The state the prompt opens in. */
  readonly opening: S;
  /** The state after a key other than `enter`, `escape` and `ctrl-c`; the same state when it changes nothing. */
  readonly apply: (state: S, key: Key) => S;
  /** The frame the state shows. */
  readonly view: (state: S) => MultiSelectView;
  /** The checked choices, in the order answered. */
  readonly answer: (state: S) => readonly MultiChoice<T>[];
}

/** The flat prompt over `choices`. */
function flatMode<T>(message: string, choices: readonly MultiChoice<T>[], pageSize: number): MultiSelectMode<MultiSelectState, T> {
  return {
    opening: openingState(choices),
    apply: (state, key) => applyKey(state, key, choices, pageSize),
    view: (state) => viewOf(state, message, choices, pageSize),
    answer: (state) => checkedChoices(choices, state.checked),
  };
}

/** One line of a grouped list: a group's heading, or the choice at `index` of the flattened choices. */
type GroupedLine =
  | { readonly heading: string }
  | { readonly index: number };

/** A grouped list flattened: its choices in order, each one's group and line, and the lines shown. */
interface GroupedLayout<T> {
  readonly choices: readonly GroupedChoice<T>[];
  readonly groupOf: readonly number[];
  readonly lineOf: readonly number[];
  readonly lines: readonly GroupedLine[];
}

/** The grouped prompt's state: the checked choices' indexes, the highlighted choice's index, and the window's top line. */
interface GroupedState {
  readonly checked: ReadonlySet<number>;
  readonly cursor: number;
  readonly top: number;
}

/** `groups` flattened; a group with no choice gets no heading. */
function layoutOf<T>(groups: readonly MultiGroup<T>[]): GroupedLayout<T> {
  const choices: GroupedChoice<T>[] = [];
  const groupOf: number[] = [];
  const lineOf: number[] = [];
  const lines: GroupedLine[] = [];
  groups.forEach((group, groupIndex) => {
    if (group.choices.length === 0) return;
    lines.push({ heading: group.title });
    for (const choice of group.choices) {
      lineOf.push(lines.length);
      lines.push({ index: choices.length });
      groupOf.push(groupIndex);
      choices.push(choice);
    }
  });
  return { choices, groupOf, lineOf, lines };
}

/** Whether `choice` can be checked. */
function tickable(choice: GroupedChoice<unknown> | undefined): boolean {
  return choice !== undefined && choice.disabled === undefined;
}

/** `top` moved as little as it must to keep the highlighted choice in view, and the heading directly above it when the page has room. */
function scrollGrouped<T>(layout: GroupedLayout<T>, top: number, cursor: number, pageSize: number): number {
  const line = layout.lineOf[cursor] ?? 0;
  const above = layout.lines[line - 1];
  const first = above !== undefined && 'heading' in above
    ? line - 1
    : line;
  const raised = Math.min(top, first);
  return line >= raised + pageSize
    ? line - pageSize + 1
    : raised;
}

/** `state` with the highlight moved `step` choices, wrapping. */
function moveGrouped<T>(layout: GroupedLayout<T>, state: GroupedState, step: number, pageSize: number): GroupedState {
  const count = layout.choices.length;
  if (count === 0) return state;
  const cursor = (state.cursor + step + count) % count;
  return { ...state, cursor, top: scrollGrouped(layout, state.top, cursor, pageSize) };
}

/** `state` with the highlighted choice checked or unchecked, unless it is disabled. */
function toggleGrouped<T>(layout: GroupedLayout<T>, state: GroupedState): GroupedState {
  if (!tickable(layout.choices[state.cursor])) return state;
  const checked = new Set(state.checked);
  if (checked.has(state.cursor)) checked.delete(state.cursor);
  else checked.add(state.cursor);
  return { ...state, checked };
}

/** `state` with every tickable choice of the highlighted choice's group checked, or unchecked when all of them are. */
function toggleGroup<T>(layout: GroupedLayout<T>, state: GroupedState): GroupedState {
  const group = layout.groupOf[state.cursor];
  if (group === undefined) return state;
  const members = layout.choices
    .map((choice, index) => ({ choice, index }))
    .filter(({ choice, index }) => layout.groupOf[index] === group && tickable(choice))
    .map(({ index }) => index);
  if (members.length === 0) return state;
  const checked = new Set(state.checked);
  const every = members.every((index) => checked.has(index));
  for (const index of members) {
    if (every) checked.delete(index);
    else checked.add(index);
  }
  return { ...state, checked };
}

/** `state` after `key` in a grouped prompt; there is no filter, so other characters change nothing. */
function applyGroupedKey<T>(layout: GroupedLayout<T>, state: GroupedState, key: Key, pageSize: number): GroupedState {
  if (key.name === 'up') return moveGrouped(layout, state, -1, pageSize);
  if (key.name === 'down') return moveGrouped(layout, state, 1, pageSize);
  if (key.name === 'char' && key.char === TOGGLE_CHAR) return toggleGrouped(layout, state);
  if (key.name === 'char' && key.char === GROUP_TOGGLE_CHAR) return toggleGroup(layout, state);
  return state;
}

/** The row `line` shows. */
function groupedRow<T>(layout: GroupedLayout<T>, state: GroupedState, line: GroupedLine): MultiSelectRow {
  if ('heading' in line) return { label: line.heading, checked: false, heading: true };
  const choice = layout.choices[line.index];
  const row = { label: choice?.label ?? '', checked: state.checked.has(line.index) };
  return choice?.disabled === undefined
    ? row
    : { ...row, disabled: choice.disabled };
}

/** The frame a grouped `state` shows. */
function groupedView<T>(layout: GroupedLayout<T>, state: GroupedState, message: string, pageSize: number): MultiSelectView {
  const shown = layout.lines.slice(state.top, state.top + pageSize);
  const rows = shown.map((line) => groupedRow(layout, state, line));
  const highlight = layout.choices.length === 0
    ? -1
    : (layout.lineOf[state.cursor] ?? 0) - state.top;
  return { message, filter: '', checkedCount: state.checked.size, rows, highlight, grouped: true };
}

/** The grouped prompt over `groups`; see the module note. */
function groupedMode<T>(message: string, groups: readonly MultiGroup<T>[], pageSize: number): MultiSelectMode<GroupedState, T> {
  const layout = layoutOf(groups);
  const checked = new Set<number>();
  layout.choices.forEach((choice, index) => {
    if (choice.checked === true && tickable(choice)) checked.add(index);
  });
  return {
    opening: { checked, cursor: 0, top: 0 },
    apply: (state, key) => applyGroupedKey(layout, state, key, pageSize),
    view: (state) => groupedView(layout, state, message, pageSize),
    answer: (state) => layout.choices.filter((_choice, index) => state.checked.has(index)),
  };
}

/** Reads keys until one answers; see the module note. */
async function readMultiSelect<S, T>(message: string, mode: MultiSelectMode<S, T>, keys: AsyncIterable<Key>, terminal: Terminal): Promise<readonly T[] | null> {
  let state = mode.opening;
  let drawn = renderMultiSelect(mode.view(state));
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
    if (key.name === 'enter') return finish(mode.answer(state));
    const next = mode.apply(state, key);
    if (next === state) continue;
    state = next;
    const frame = renderMultiSelect(mode.view(state));
    terminal.write(`${eraseFrame(drawn.length)}${frame.join('\n')}`);
    drawn = frame;
  }
  return finish(null);
}

/** Runs the prompt `options` asks for, flat or grouped. */
async function runMultiSelect<T>(options: MultiSelectOptions<T> | GroupedMultiSelectOptions<T>, keys: AsyncIterable<Key>, terminal: Terminal): Promise<readonly T[] | null> {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  if (options.groups !== undefined) return readMultiSelect(options.message, groupedMode(options.message, options.groups, pageSize), keys, terminal);
  return readMultiSelect(options.message, flatMode(options.message, options.choices, pageSize), keys, terminal);
}

/**
 * Asks for any of `options.choices`, or of the choices in `options.groups`;
 * answers the checked values in the order shown — an empty list when none
 * is checked — or `null` on `escape` or when the keys end. Throws a
 * {@link CommandExit} on `ctrl-c`, and refuses when standard input is not
 * a terminal; see the module note.
 */
export async function multiSelect<T>(options: MultiSelectOptions<T> | GroupedMultiSelectOptions<T>): Promise<readonly T[] | null> {
  const terminal = options.terminal ?? processTerminal();
  const refusal: NoTerminalOptions = options.instead === undefined
    ? {}
    : { instead: options.instead };
  return rawSession(terminal, async () => runMultiSelect(options, options.keys ?? stdinKeys(), terminal), refusal);
}
