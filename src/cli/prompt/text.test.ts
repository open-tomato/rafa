/**
 * Tests for the `text` prompt (`src/cli/prompt/text.ts`), driven by
 * scripted keys over a recording terminal.
 */
import type { Key, Terminal } from './terminal.js';

import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../command.js';

import { INTERRUPT_EXIT_CODE, NO_TERMINAL_TEXT } from './terminal.js';
import { renderText, text } from './text.js';

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

const ENTER: Key = { name: 'enter' };
const BACKSPACE: Key = { name: 'backspace' };

describe('text', () => {
  test('answers the characters typed before enter', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await text({ message: 'Name?', keys: script([...typing('ab'), ENTER]), terminal });
    expect(answer).toBe('ab');
    expect(events).toEqual([
      'raw on',
      renderText('Name?', ''),
      renderText('Name?', 'a'),
      renderText('Name?', 'ab'),
      '\n',
      'raw off',
    ]);
  });

  test('backspace removes the last code point and is a no-op when empty', async () => {
    const keys = [BACKSPACE, ...typing('a😀'), BACKSPACE, ENTER];
    const answer = await text({ message: 'm', keys: script(keys), terminal: recordingTerminal().terminal });
    expect(answer).toBe('a');
  });

  test('starts from the initial answer', async () => {
    const keys = [BACKSPACE, ...typing('z'), ENTER];
    const answer = await text({ message: 'm', initial: 'xy', keys: script(keys), terminal: recordingTerminal().terminal });
    expect(answer).toBe('xz');
  });

  test('up and down change nothing', async () => {
    const { terminal, events } = recordingTerminal();
    const keys: Key[] = [{ name: 'up' }, { name: 'down' }, ENTER];
    expect(await text({ message: 'm', keys: script(keys), terminal })).toBe('');
    expect(events).toEqual(['raw on', renderText('m', ''), '\n', 'raw off']);
  });

  test('escape answers null', async () => {
    const keys: Key[] = [...typing('a'), { name: 'escape' }, ENTER];
    expect(await text({ message: 'm', keys: script(keys), terminal: recordingTerminal().terminal })).toBeNull();
  });

  test('keys ending before enter answer null', async () => {
    const { terminal, events } = recordingTerminal();
    expect(await text({ message: 'm', keys: script(typing('a')), terminal })).toBeNull();
    expect(events.at(-1)).toBe('raw off');
  });

  test('a validation problem is shown and enter keeps reading', async () => {
    const { terminal, events } = recordingTerminal();
    const validate = (value: string): string | null => value.length < 2
      ? 'too short'
      : null;
    const keys = [...typing('a'), ENTER, ...typing('b'), ENTER];
    expect(await text({ message: 'm', validate, keys: script(keys), terminal })).toBe('ab');
    expect(events).toContain(renderText('m', 'a', 'too short'));
  });

  test('ctrl-c throws the interrupt exit and switches raw mode off', async () => {
    const { terminal, events } = recordingTerminal();
    const keys: Key[] = [{ name: 'ctrl-c' }];
    const thrown = await text({ message: 'm', keys: script(keys), terminal }).catch((error: unknown) => error);
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
    const run = text({ message: 'm', keys: keys(), terminal, instead: 'Use --output=json.' });
    const refusal = await run.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(CommandExit);
    expect((refusal as CommandExit).message).toContain(NO_TERMINAL_TEXT);
    expect((refusal as CommandExit).message).toContain('Use --output=json.');
    expect(read).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('renderText', () => {
  test('clears the line, then message, answer and any problem', () => {
    expect(renderText('Q', 'v')).toBe('\r\u001b[2K? Q v');
    expect(renderText('Q', 'v', 'bad')).toBe('\r\u001b[2K? Q v  (bad)');
  });
});
