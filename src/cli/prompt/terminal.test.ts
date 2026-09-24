/**
 * Tests for the prompt kit's terminal (`src/cli/prompt/terminal.ts`): the
 * key decoder, the key source over a stream, the process terminal, the
 * raw-mode session's restore in `finally` and on `SIGINT`, and the
 * no-terminal refusal.
 */
import type { Key, Terminal } from './terminal.js';

import { PassThrough } from 'node:stream';

import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../command.js';

import {
  decodeKeys,
  INTERRUPT_EXIT_CODE,
  NO_TERMINAL_TEXT,
  noTerminalRefusal,
  processTerminal,
  rawSession,
  readKeys,
  refuseWithoutTerminal,
} from './terminal.js';

const ESC = '\u001b';

/** A printable character's key. */
function char(text: string): Key {
  return { name: 'char', char: text };
}

/** A terminal recording each thing done to it, and the `SIGINT` handler it was given. */
function recordingTerminal(isTTY = true): {
  readonly terminal: Terminal;
  readonly events: string[];
  readonly interrupt: () => void;
} {
  const events: string[] = [];
  let heard: (() => void) | null = null;
  const terminal: Terminal = {
    isTTY,
    setRawMode: (on) => {
      events.push(on
        ? 'raw on'
        : 'raw off');
    },
    write: (text) => {
      events.push(`write ${JSON.stringify(text)}`);
    },
    onInterrupt: (handler) => {
      heard = handler;
      events.push('hear');
      return () => {
        heard = null;
        events.push('stop hearing');
      };
    },
    exit: (code) => {
      events.push(`exit ${String(code)}`);
    },
  };
  return {
    terminal,
    events,
    interrupt: () => {
      if (heard === null) throw new Error('no SIGINT handler is registered');
      heard();
    },
  };
}

/** The refusal `run` throws, failing when it throws none or something else. */
async function refusalOf(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and nothing was thrown');
}

/** Every key `keys` yields, until it ends. */
async function collect(keys: AsyncIterable<Key>): Promise<readonly Key[]> {
  const read: Key[] = [];
  for await (const key of keys) read.push(key);
  return read;
}

describe('decodeKeys', () => {
  test('reads nothing from an empty read', () => {
    expect(decodeKeys('')).toEqual([]);
  });

  test('reads both arrow spellings, CSI and SS3, as up and down', () => {
    expect(decodeKeys(`${ESC}[A${ESC}[B${ESC}OA${ESC}OB`)).toEqual([
      { name: 'up' },
      { name: 'down' },
      { name: 'up' },
      { name: 'down' },
    ]);
  });

  test('reads an arrow carrying a modifier as the arrow', () => {
    expect(decodeKeys(`${ESC}[1;2A${ESC}[1;5B`)).toEqual([{ name: 'up' }, { name: 'down' }]);
  });

  test('drops the other control sequences, and keeps what follows them', () => {
    const rightLeftHomeF5 = `${ESC}[C${ESC}[D${ESC}[H${ESC}[15~${ESC}OP`;

    expect(decodeKeys(`${rightLeftHomeF5}x`)).toEqual([char('x')]);
  });

  test('drops a sequence the read ends inside', () => {
    expect(decodeKeys(`a${ESC}[1;`)).toEqual([char('a')]);
    expect(decodeKeys(`a${ESC}O`)).toEqual([char('a')]);
  });

  test('reads a lone escape, and two in a row, as escape keys', () => {
    expect(decodeKeys(ESC)).toEqual([{ name: 'escape' }]);
    expect(decodeKeys(`${ESC}${ESC}`)).toEqual([{ name: 'escape' }, { name: 'escape' }]);
  });

  test('reads Alt with a letter as escape and then the letter', () => {
    expect(decodeKeys(`${ESC}q`)).toEqual([{ name: 'escape' }, char('q')]);
  });

  test('reads CR, LF and CR LF as one enter each', () => {
    expect(decodeKeys('\r')).toEqual([{ name: 'enter' }]);
    expect(decodeKeys('\n')).toEqual([{ name: 'enter' }]);
    expect(decodeKeys('\r\n')).toEqual([{ name: 'enter' }]);
    expect(decodeKeys('\r\r')).toEqual([{ name: 'enter' }, { name: 'enter' }]);
  });

  test('reads DEL and BS as backspace, and ETX as ctrl-c', () => {
    expect(decodeKeys('\u007f\b\u0003')).toEqual([
      { name: 'backspace' },
      { name: 'backspace' },
      { name: 'ctrl-c' },
    ]);
  });

  test('drops every other control character, Tab included', () => {
    expect(decodeKeys('\t\u0001\u0004\u001fz')).toEqual([char('z')]);
  });

  test('reads pasted text as one key per character, an emoji as one key', () => {
    expect(decodeKeys('ab é🍅')).toEqual([char('a'), char('b'), char(' '), char('é'), char('🍅')]);
  });
});

describe('readKeys', () => {
  test('yields the keys of every read until the input ends', async () => {
    const input = new PassThrough();
    const keys = collect(readKeys(input));

    input.write(`${ESC}[B`);
    input.write('x\r');
    input.end();

    expect(await keys).toEqual([{ name: 'down' }, char('x'), { name: 'enter' }]);
  });

  test('keeps a character whose bytes are split across two reads whole', async () => {
    const input = new PassThrough();
    const keys = collect(readKeys(input));
    const bytes = Buffer.from('é', 'utf8');

    input.write(bytes.subarray(0, 1));
    input.write(bytes.subarray(1));
    input.end();

    expect(await keys).toEqual([char('é')]);
  });

  test('leaving early stops listening and pauses the input, and leaves it open for the next reader', async () => {
    const input = new PassThrough();
    input.write('ab');

    for await (const key of readKeys(input)) {
      expect(key).toEqual(char('a'));
      break;
    }

    expect(input.destroyed).toBe(false);
    expect(input.isPaused()).toBe(true);
    expect(input.listenerCount('data')).toBe(0);
    const next = collect(readKeys(input));
    input.end('c');
    expect(await next).toEqual([char('c')]);
  });

  test('throws the input\'s error', async () => {
    const input = new PassThrough();
    const keys = collect(readKeys(input));

    input.destroy(new Error('the input broke'));

    let thrown: unknown = null;
    try {
      await keys;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('the input broke');
  });
});

describe('processTerminal', () => {
  test('is a terminal only when the input is one and can switch raw mode', () => {
    const write = (): boolean => true;

    expect(processTerminal({ input: { isTTY: true, setRawMode: () => {} }, output: { write } }).isTTY).toBe(true);
    expect(processTerminal({ input: { isTTY: true }, output: { write } }).isTTY).toBe(false);
    expect(processTerminal({ input: { setRawMode: () => {} }, output: { write } }).isTTY).toBe(false);
  });

  test('switches raw mode on the input and writes to the output', () => {
    const modes: boolean[] = [];
    const written: string[] = [];
    const terminal = processTerminal({
      input: {
        isTTY: true,
        setRawMode: (on) => {
          modes.push(on);
        },
      },
      output: {
        write: (chunk) => {
          written.push(chunk);
        },
      },
    });

    terminal.setRawMode(true);
    terminal.setRawMode(false);
    terminal.write('> ');

    expect(modes).toEqual([true, false]);
    expect(written).toEqual(['> ']);
  });

  test('hears SIGINT on the process until told to stop', () => {
    const terminal = processTerminal({ input: {}, output: { write: () => true } });
    const before = process.listenerCount('SIGINT');

    const stop = terminal.onInterrupt(() => {});
    const during = process.listenerCount('SIGINT');
    stop();

    expect(during).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  test('defaults to this process\'s standard input', () => {
    const stdinCanSwitch = process.stdin.isTTY === true && typeof process.stdin.setRawMode === 'function';

    expect(processTerminal().isTTY).toBe(stdinCanSwitch);
  });
});

describe('the no-terminal refusal', () => {
  test('exits 1 with the text alone', () => {
    const refusal = noTerminalRefusal();

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toBe(`❌ ${NO_TERMINAL_TEXT}`);
  });

  test('says the caller\'s instead line after the text', () => {
    const refusal = noTerminalRefusal({ instead: 'Run it with --output=json to read the list without one.' });

    expect(refusal.message).toBe(
      `❌ ${NO_TERMINAL_TEXT}\n   Run it with --output=json to read the list without one.`,
    );
  });

  test('refuseWithoutTerminal throws it without a terminal, and nothing with one', () => {
    const refused = recordingTerminal(false);
    const allowed = recordingTerminal(true);

    expect(() => {
      refuseWithoutTerminal(refused.terminal, { instead: 'Use --output=json.' });
    }).toThrow(`❌ ${NO_TERMINAL_TEXT}\n   Use --output=json.`);
    expect(() => {
      refuseWithoutTerminal(allowed.terminal);
    }).not.toThrow();
  });
});

describe('rawSession', () => {
  test('refuses without a terminal before switching or hearing anything, and runs no prompt', async () => {
    const { terminal, events } = recordingTerminal(false);
    let ran = false;

    const refusal = await refusalOf(() => rawSession(terminal, async () => {
      ran = true;
    }, { instead: 'Use --output=json.' }));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toBe(`❌ ${NO_TERMINAL_TEXT}\n   Use --output=json.`);
    expect(ran).toBe(false);
    expect(events).toEqual([]);
  });

  test('holds raw mode while the prompt runs, answers its answer, and switches it off after', async () => {
    const { terminal, events } = recordingTerminal();
    let during: readonly string[] = [];

    const answer = await rawSession(terminal, async () => {
      during = [...events];
      return 'picked';
    });

    expect(answer).toBe('picked');
    expect(during).toEqual(['hear', 'raw on']);
    expect(events).toEqual(['hear', 'raw on', 'stop hearing', 'raw off']);
  });

  test('switches raw mode off and stops hearing SIGINT when the prompt throws, and throws on', async () => {
    const { terminal, events } = recordingTerminal();

    let thrown: unknown = null;
    try {
      await rawSession(terminal, async () => {
        throw new Error('the prompt broke');
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).toBe('the prompt broke');
    expect(events).toEqual(['hear', 'raw on', 'stop hearing', 'raw off']);
  });

  test('on SIGINT mid-prompt switches raw mode off, ends the line, and exits 130', async () => {
    const { terminal, events, interrupt } = recordingTerminal();
    let atSignal: readonly string[] = [];

    await rawSession(terminal, async () => {
      interrupt();
      atSignal = [...events];
    });

    expect(INTERRUPT_EXIT_CODE).toBe(130);
    expect(atSignal).toEqual(['hear', 'raw on', 'raw off', 'write "\\n"', 'exit 130']);
  });

  test('reads keys from a key source inside the session', async () => {
    const { terminal, events } = recordingTerminal();
    const input = new PassThrough();
    input.write(`${ESC}[Bq`);

    const first = await rawSession(terminal, async () => {
      for await (const key of readKeys(input)) return key;
      return null;
    });

    expect(first).toEqual({ name: 'down' });
    expect(events).toEqual(['hear', 'raw on', 'stop hearing', 'raw off']);
    expect(input.destroyed).toBe(false);
  });
});
