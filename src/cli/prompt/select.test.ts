/**
 * Tests for the `select` prompt (`src/cli/prompt/select.ts`), driven by
 * scripted keys over a recording terminal.
 */
import type { Choice, SelectView } from './select.js';
import type { Key, Terminal } from './terminal.js';

import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../command.js';

import { matchChoices, NO_MATCHES_TEXT, renderSelect, select } from './select.js';
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
function choicesOf(...labels: string[]): Choice<string>[] {
  return labels.map((label) => ({ label, value: label }));
}

/** The text of the frame showing `view`, as the prompt writes it after the erase. */
function frame(view: SelectView): string {
  return renderSelect(view).join('\n');
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

const UP: Key = { name: 'up' };
const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };
const BACKSPACE: Key = { name: 'backspace' };
const FRUIT = choicesOf('apple', 'banana', 'cherry');

describe('select', () => {
  test('enter answers the first choice, then the frame is replaced by the answer line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await select({ message: 'Fruit?', choices: FRUIT, keys: script([ENTER]), terminal });
    expect(answer).toBe('apple');
    expect(events).toEqual([
      'raw on',
      frame({ message: 'Fruit?', filter: '', rows: ['apple', 'banana', 'cherry'], highlight: 0 }),
      '\u001b[3A\r\u001b[J? Fruit? apple\n',
      'raw off',
    ]);
  });

  test('down and up move the highlight and wrap at both ends', async () => {
    const run = async (keys: Key[]): Promise<string | null> => select({ message: 'm', choices: FRUIT, keys: script([...keys, ENTER]), terminal: recordingTerminal().terminal });
    expect(await run([DOWN])).toBe('banana');
    expect(await run([DOWN, DOWN, DOWN])).toBe('apple');
    expect(await run([UP])).toBe('cherry');
    expect(await run([DOWN, DOWN, UP])).toBe('banana');
  });

  test('answers the value, not the label', async () => {
    const choices: Choice<number>[] = [{ label: 'one', value: 1 }, { label: 'two', value: 2 }];
    const answer = await select({ message: 'm', choices, keys: script([DOWN, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toBe(2);
  });

  test('opens on the initial choice, and on the first when initial is out of range', async () => {
    const opened = async (initial: number): Promise<string | null> => select({ message: 'm', choices: FRUIT, initial, keys: script([ENTER]), terminal: recordingTerminal().terminal });
    expect(await opened(2)).toBe('cherry');
    expect(await opened(7)).toBe('apple');
    expect(await opened(-1)).toBe('apple');
  });

  test('typing narrows the rows to labels holding the filter, ignoring case', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await select({ message: 'm', choices: FRUIT, keys: script([...typing('AN'), ENTER]), terminal });
    expect(answer).toBe('banana');
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: 'AN', rows: ['banana'], highlight: 0 }));
  });

  test('the highlight stays on its choice while it still matches, else goes to the first match', async () => {
    const choices = choicesOf('alpha', 'beta', 'gamma', 'delta');
    const kept = await select({ message: 'm', choices, keys: script([DOWN, DOWN, ...typing('a'), ENTER]), terminal: recordingTerminal().terminal });
    expect(kept).toBe('gamma');
    const moved = await select({ message: 'm', choices, keys: script([DOWN, ...typing('lt'), ENTER]), terminal: recordingTerminal().terminal });
    expect(moved).toBe('delta');
  });

  test('backspace widens the filter again, keeping the highlight, and is a no-op when it is empty', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [BACKSPACE, ...typing('ch'), BACKSPACE, BACKSPACE, DOWN, ENTER];
    const answer = await select({ message: 'm', choices: FRUIT, keys: script(keys), terminal });
    expect(answer).toBe('apple');
    const redraws = events.filter((event) => event.includes('\u001b[J'));
    expect(redraws.length).toBe(6);
  });

  test('with no match the frame says so and enter does nothing', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [...typing('zz'), ENTER, DOWN, BACKSPACE, BACKSPACE, ENTER];
    const answer = await select({ message: 'm', choices: FRUIT, keys: script(keys), terminal });
    expect(answer).toBe('apple');
    const empty = frame({ message: 'm', filter: 'zz', rows: [], highlight: -1 });
    expect(empty).toBe(`? m zz\n  ${NO_MATCHES_TEXT}`);
    expect(events).toContain(`\u001b[1A\r\u001b[J${empty}`);
  });

  test('the window scrolls only as far as it must to keep the highlight in view', async () => {
    const { terminal, events } = recordingTerminal();
    const choices = choicesOf('a1', 'a2', 'a3', 'a4', 'a5');
    const keys = [DOWN, DOWN, DOWN, UP, UP, ENTER];
    const answer = await select({ message: 'm', choices, pageSize: 2, keys: script(keys), terminal });
    expect(answer).toBe('a2');
    const frames = events.slice(1, -2).map(withoutErase);
    expect(frames).toEqual([
      frame({ message: 'm', filter: '', rows: ['a1', 'a2'], highlight: 0 }),
      frame({ message: 'm', filter: '', rows: ['a1', 'a2'], highlight: 1 }),
      frame({ message: 'm', filter: '', rows: ['a2', 'a3'], highlight: 1 }),
      frame({ message: 'm', filter: '', rows: ['a3', 'a4'], highlight: 1 }),
      frame({ message: 'm', filter: '', rows: ['a3', 'a4'], highlight: 0 }),
      frame({ message: 'm', filter: '', rows: ['a2', 'a3'], highlight: 0 }),
    ]);
  });

  test('wrapping to the top from the last row brings the window back to the top', async () => {
    const { terminal, events } = recordingTerminal();
    const choices = choicesOf('a1', 'a2', 'a3');
    const answer = await select({ message: 'm', choices, pageSize: 2, keys: script([UP, DOWN, ENTER]), terminal });
    expect(answer).toBe('a1');
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: '', rows: ['a1', 'a2'], highlight: 0 }));
  });

  test('escape answers null and leaves the question on its line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await select({ message: 'm', choices: FRUIT, keys: script([DOWN, ESCAPE, ENTER]), terminal });
    expect(answer).toBeNull();
    expect(events.at(-2)).toBe('\u001b[3A\r\u001b[J? m\n');
    expect(events.at(-1)).toBe('raw off');
  });

  test('keys ending before enter answer null', async () => {
    const { terminal, events } = recordingTerminal();
    expect(await select({ message: 'm', choices: FRUIT, keys: script([DOWN]), terminal })).toBeNull();
    expect(events.at(-1)).toBe('raw off');
  });

  test('an empty list answers null on escape and ignores enter and arrows', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await select({ message: 'm', choices: [], keys: script([ENTER, DOWN, UP, ESCAPE]), terminal });
    expect(answer).toBeNull();
    expect(events).toEqual([
      'raw on',
      frame({ message: 'm', filter: '', rows: [], highlight: -1 }),
      '\u001b[1A\r\u001b[J? m\n',
      'raw off',
    ]);
  });

  test('ctrl-c throws the interrupt exit and switches raw mode off', async () => {
    const { terminal, events } = recordingTerminal();
    const thrown = await select({ message: 'm', choices: FRUIT, keys: script([{ name: 'ctrl-c' }]), terminal })
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
    const run = select({ message: 'm', choices: FRUIT, keys: keys(), terminal, instead: 'Use --output=json.' });
    const refusal = await run.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(CommandExit);
    expect((refusal as CommandExit).message).toContain(NO_TERMINAL_TEXT);
    expect((refusal as CommandExit).message).toContain('Use --output=json.');
    expect(read).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('renderSelect', () => {
  test('marks the highlighted row and indents the rest', () => {
    expect(renderSelect({ message: 'Q', filter: 'f', rows: ['x', 'y'], highlight: 1 })).toEqual(['? Q f', '  x', '❯ y']);
  });
});

describe('matchChoices', () => {
  test('answers the indexes of labels holding the filter, all for an empty filter', () => {
    expect(matchChoices(FRUIT, 'E')).toEqual([0, 2]);
    expect(matchChoices(FRUIT, '')).toEqual([0, 1, 2]);
    expect(matchChoices(FRUIT, 'q')).toEqual([]);
  });
});
