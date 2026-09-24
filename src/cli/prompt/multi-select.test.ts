/**
 * Tests for the `multiSelect` prompt (`src/cli/prompt/multi-select.ts`),
 * driven by scripted keys over a recording terminal.
 */
import type { MultiChoice, MultiSelectView } from './multi-select.js';
import type { Key, Terminal } from './terminal.js';

import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../command.js';

import { multiSelect, NONE_CHECKED_TEXT, renderMultiSelect } from './multi-select.js';
import { NO_MATCHES_TEXT } from './select.js';
import { INTERRUPT_EXIT_CODE, NO_TERMINAL_TEXT } from './terminal.js';

/** A terminal recording raw-mode switches and writes. */
function recordingTerminal(isTTY = true): { readonly terminal: Terminal; readonly events: string[] } {
  const events: string[] = [];
  const terminal: Terminal = {
    isTTY,
    setRawMode: (on) => {
      events.push(on
        ? 'raw on'
        : 'raw off');
    },
    write: (written) => {
      events.push(written);
    },
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
  return { terminal, events };
}

/** The keys for typing `typed`, one per code point. */
function typing(typed: string): Key[] {
  return [...typed].map((char) => ({ name: 'char', char }));
}

/** A key source yielding `keys` and then ending. */
async function* script(keys: readonly Key[]): AsyncGenerator<Key, void, undefined> {
  for (const key of keys) yield key;
}

/** Choices whose values are their labels. */
function choicesOf(...labels: string[]): MultiChoice<string>[] {
  return labels.map((label) => ({ label, value: label }));
}

/** The text of the frame showing `view`, as the prompt writes it after the erase. */
function frame(view: MultiSelectView): string {
  return renderMultiSelect(view).join('\n');
}

/** Where a redraw's erase ends: carriage return and erase down. */
const CLEAR_DOWN = '\r\u001b[J';

/** `written` without the erase a redraw opens with. */
function withoutErase(written: string): string {
  const at = written.indexOf(CLEAR_DOWN);
  return at === -1
    ? written
    : written.slice(at + CLEAR_DOWN.length);
}

/** The last frame drawn before the answer line: the write before the final one, erase stripped. */
function lastFrame(events: readonly string[]): string {
  const writes = events.filter((event) => event !== 'raw on' && event !== 'raw off');
  return withoutErase(writes.at(-2) ?? '');
}

/** Rows of `labels`, the ones in `checked` checked. */
function rowsOf(labels: readonly string[], checked: readonly string[] = []): MultiSelectView['rows'] {
  return labels.map((label) => ({ label, checked: checked.includes(label) }));
}

const UP: Key = { name: 'up' };
const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };
const BACKSPACE: Key = { name: 'backspace' };
const SPACE: Key = { name: 'char', char: ' ' };
const FRUIT = choicesOf('apple', 'banana', 'cherry');

describe('multiSelect', () => {
  test('enter with nothing checked answers an empty list and names none on the answer line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'Fruit?', choices: FRUIT, keys: script([ENTER]), terminal });
    expect(answer).toEqual([]);
    expect(events).toEqual([
      'raw on',
      frame({ message: 'Fruit?', filter: '', checkedCount: 0, rows: rowsOf(['apple', 'banana', 'cherry']), highlight: 0 }),
      `\u001b[3A\r\u001b[J? Fruit? ${NONE_CHECKED_TEXT}\n`,
      'raw off',
    ]);
  });

  test('space checks the highlighted choice and enter answers the checked labels on the answer line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, DOWN, DOWN, SPACE, ENTER]), terminal });
    expect(answer).toEqual(['apple', 'cherry']);
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: '', checkedCount: 2, rows: rowsOf(['apple', 'banana', 'cherry'], ['apple', 'cherry']), highlight: 2 }));
    expect(events.at(-2)).toBe('\u001b[3A\r\u001b[J? m apple, cherry\n');
  });

  test('a second space unchecks the choice', async () => {
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, DOWN, SPACE, UP, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual(['banana']);
  });

  test('answers in the order of the choices, not the order they were checked in', async () => {
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([UP, SPACE, UP, SPACE, UP, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual(['apple', 'banana', 'cherry']);
  });

  test('answers the values, not the labels', async () => {
    const choices: MultiChoice<number>[] = [{ label: 'one', value: 1 }, { label: 'two', value: 2 }];
    const answer = await multiSelect({ message: 'm', choices, keys: script([DOWN, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual([2]);
  });

  test('choices marked checked open checked and can be unchecked', async () => {
    const { terminal, events } = recordingTerminal();
    const choices: MultiChoice<string>[] = [{ label: 'a', value: 'a', checked: true }, { label: 'b', value: 'b' }, { label: 'c', value: 'c', checked: true }];
    const kept = await multiSelect({ message: 'm', choices, keys: script([ENTER]), terminal });
    expect(kept).toEqual(['a', 'c']);
    expect(events[1]).toBe(frame({ message: 'm', filter: '', checkedCount: 2, rows: rowsOf(['a', 'b', 'c'], ['a', 'c']), highlight: 0 }));
    const dropped = await multiSelect({ message: 'm', choices, keys: script([SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(dropped).toEqual(['c']);
  });

  test('typing narrows the rows, and a space toggles rather than joining the filter', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([...typing('AN'), SPACE, ENTER]), terminal });
    expect(answer).toEqual(['banana']);
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: 'AN', checkedCount: 1, rows: rowsOf(['banana'], ['banana']), highlight: 0 }));
  });

  test('a checked choice the filter hides stays checked, counted and answered', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, ...typing('ch'), SPACE, ENTER]), terminal });
    expect(answer).toEqual(['apple', 'cherry']);
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: 'ch', checkedCount: 2, rows: rowsOf(['cherry'], ['cherry']), highlight: 0 }));
  });

  test('backspace widens the filter keeping the highlight, and is a no-op when it is empty', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [BACKSPACE, ...typing('ch'), BACKSPACE, BACKSPACE, SPACE, ENTER];
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script(keys), terminal });
    expect(answer).toEqual(['cherry']);
    const redraws = events.filter((event) => event.includes('\u001b[J'));
    expect(redraws.length).toBe(6);
  });

  test('with no match the frame says so, space does nothing and enter still answers', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [SPACE, ...typing('zz'), SPACE, DOWN, ENTER];
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script(keys), terminal });
    expect(answer).toEqual(['apple']);
    const empty = frame({ message: 'm', filter: 'zz', checkedCount: 1, rows: [], highlight: -1 });
    expect(empty).toBe(`? m (1 checked) zz\n  ${NO_MATCHES_TEXT}`);
    expect(lastFrame(events)).toBe(empty);
    expect(events.at(-2)).toBe('\u001b[1A\r\u001b[J? m apple\n');
  });

  test('the window scrolls only as far as it must to keep the highlight in view', async () => {
    const { terminal, events } = recordingTerminal();
    const choices = choicesOf('a1', 'a2', 'a3', 'a4');
    const keys = [DOWN, DOWN, SPACE, UP, UP, ENTER];
    const answer = await multiSelect({ message: 'm', choices, pageSize: 2, keys: script(keys), terminal });
    expect(answer).toEqual(['a3']);
    const frames = events.slice(1, -2).map(withoutErase);
    expect(frames).toEqual([
      frame({ message: 'm', filter: '', checkedCount: 0, rows: rowsOf(['a1', 'a2']), highlight: 0 }),
      frame({ message: 'm', filter: '', checkedCount: 0, rows: rowsOf(['a1', 'a2']), highlight: 1 }),
      frame({ message: 'm', filter: '', checkedCount: 0, rows: rowsOf(['a2', 'a3']), highlight: 1 }),
      frame({ message: 'm', filter: '', checkedCount: 1, rows: rowsOf(['a2', 'a3'], ['a3']), highlight: 1 }),
      frame({ message: 'm', filter: '', checkedCount: 1, rows: rowsOf(['a2', 'a3'], ['a3']), highlight: 0 }),
      frame({ message: 'm', filter: '', checkedCount: 1, rows: rowsOf(['a1', 'a2']), highlight: 0 }),
    ]);
  });

  test('escape answers null even with choices checked, leaving the question on its line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, ESCAPE, ENTER]), terminal });
    expect(answer).toBeNull();
    expect(events.at(-2)).toBe('\u001b[3A\r\u001b[J? m\n');
    expect(events.at(-1)).toBe('raw off');
  });

  test('keys ending before enter answer null, not an empty list', async () => {
    const { terminal, events } = recordingTerminal();
    expect(await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE]), terminal })).toBeNull();
    expect(events.at(-1)).toBe('raw off');
  });

  test('an empty list ignores arrows and space and answers an empty list on enter', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: [], keys: script([DOWN, UP, SPACE, ENTER]), terminal });
    expect(answer).toEqual([]);
    expect(events).toEqual([
      'raw on',
      frame({ message: 'm', filter: '', checkedCount: 0, rows: [], highlight: -1 }),
      `\u001b[1A\r\u001b[J? m ${NONE_CHECKED_TEXT}\n`,
      'raw off',
    ]);
  });

  test('ctrl-c throws the interrupt exit and switches raw mode off', async () => {
    const { terminal, events } = recordingTerminal();
    const thrown = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, { name: 'ctrl-c' }]), terminal })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(INTERRUPT_EXIT_CODE);
    expect(events.at(-1)).toBe('raw off');
  });

  test('refuses with no terminal before reading a key, naming instead', async () => {
    const { terminal, events } = recordingTerminal(false);
    let read = false;
    async function* keys(): AsyncGenerator<Key, void, undefined> {
      read = true;
      yield ENTER;
    }
    const run = multiSelect({ message: 'm', choices: FRUIT, keys: keys(), terminal, instead: 'Use --output=json.' });
    const refusal = await run.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(CommandExit);
    expect((refusal as CommandExit).message).toContain(NO_TERMINAL_TEXT);
    expect((refusal as CommandExit).message).toContain('Use --output=json.');
    expect(read).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('renderMultiSelect', () => {
  test('marks the highlighted row and each row\'s check, with the count on the first line', () => {
    const lines = renderMultiSelect({ message: 'Q', filter: 'f', checkedCount: 3, rows: rowsOf(['x', 'y'], ['y']), highlight: 1 });
    expect(lines).toEqual(['? Q (3 checked) f', '  ◯ x', '❯ ◉ y']);
  });
});
