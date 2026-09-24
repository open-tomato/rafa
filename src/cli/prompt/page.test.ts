/**
 * Tests for the `page` pager view (`src/cli/prompt/page.ts`), driven by
 * scripted keys over a recording terminal.
 */
import type { PageView } from './page.js';
import type { Key, Terminal } from './terminal.js';

import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../command.js';

import { CUT_MARK, DEFAULT_PAGE_HEIGHT, EMPTY_PAGE_TEXT, PAGE_KEYS_TEXT, page, pageLines, renderPage } from './page.js';
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

/** A key source yielding `keys` and then ending. */
async function* script(keys: readonly Key[]): AsyncGenerator<Key, void, undefined> {
  for (const key of keys) yield key;
}

/** The key for typing `char`. */
function char(typed: string): Key {
  return { name: 'char', char: typed };
}

/** The text of the frame showing `view`, as the view writes it after the erase. */
function frame(view: PageView): string {
  return renderPage(view).join('\n');
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

/** Every frame drawn, erases stripped: the writes between `raw on` and the closing erase. */
function frames(events: readonly string[]): string[] {
  return events.slice(1, -2).map(withoutErase);
}

/** A text of `count` lines, `l1` to `l<count>`. */
function numbered(count: number): string {
  return Array.from({ length: count }, (_, at) => `l${at + 1}`).join('\n');
}

/** The view of lines `from` to `to` (from 1) of {@link numbered}(`total`). */
function windowOf(from: number, to: number, total: number): PageView {
  const lines = Array.from({ length: to - from + 1 }, (_, at) => `l${from + at}`);
  return { lines, top: from - 1, total };
}

const UP: Key = { name: 'up' };
const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };
const SPACE = char(' ');
const PAGE_UP = char('b');

describe('page', () => {
  test('draws the first window, and escape erases it and switches raw mode off', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: numbered(5), height: 3, keys: script([ESCAPE]), terminal });
    expect(events).toEqual([
      'raw on',
      frame(windowOf(1, 3, 5)),
      `\u001b[3A${CLEAR_DOWN}`,
      'raw off',
    ]);
  });

  test('down and up scroll one line and redraw', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: numbered(5), height: 3, keys: script([DOWN, DOWN, UP, ESCAPE]), terminal });
    expect(frames(events)).toEqual([
      frame(windowOf(1, 3, 5)),
      frame(windowOf(2, 4, 5)),
      frame(windowOf(3, 5, 5)),
      frame(windowOf(2, 4, 5)),
    ]);
    expect(events[2]?.startsWith(`\u001b[3A${CLEAR_DOWN}`)).toBe(true);
  });

  test('scrolling stops at both ends without wrapping, and a key that moves nothing draws nothing', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [UP, DOWN, DOWN, DOWN, DOWN, UP, ESCAPE];
    await page({ text: numbered(4), height: 2, keys: script(keys), terminal });
    expect(frames(events)).toEqual([
      frame(windowOf(1, 2, 4)),
      frame(windowOf(2, 3, 4)),
      frame(windowOf(3, 4, 4)),
      frame(windowOf(2, 3, 4)),
    ]);
  });

  test('space scrolls a window down and b a window up, stopping at the ends', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [SPACE, SPACE, SPACE, PAGE_UP, PAGE_UP, PAGE_UP, ESCAPE];
    await page({ text: numbered(7), height: 3, keys: script(keys), terminal });
    expect(frames(events)).toEqual([
      frame(windowOf(1, 3, 7)),
      frame(windowOf(4, 6, 7)),
      frame(windowOf(5, 7, 7)),
      frame(windowOf(2, 4, 7)),
      frame(windowOf(1, 3, 7)),
    ]);
  });

  test('a text shorter than the window shows whole and does not scroll', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: 'one\ntwo\n', height: 5, keys: script([DOWN, SPACE, ESCAPE]), terminal });
    expect(events).toEqual([
      'raw on',
      frame({ lines: ['one', 'two'], top: 0, total: 2 }),
      `\u001b[2A${CLEAR_DOWN}`,
      'raw off',
    ]);
  });

  test('enter, q and other characters do nothing, and only escape leaves', async () => {
    const { terminal, events } = recordingTerminal();
    let after = 0;
    async function* keys(): AsyncGenerator<Key, void, undefined> {
      yield ENTER;
      yield char('q');
      yield char('x');
      yield { name: 'backspace' };
      yield ESCAPE;
      after += 1;
      yield DOWN;
    }
    await page({ text: numbered(5), height: 2, keys: keys(), terminal });
    expect(after).toBe(0);
    expect(frames(events)).toEqual([frame(windowOf(1, 2, 5))]);
  });

  test('keys ending leave the view as escape does', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: numbered(5), height: 2, keys: script([DOWN]), terminal });
    expect(events.at(-2)).toBe(`\u001b[2A${CLEAR_DOWN}`);
    expect(events.at(-1)).toBe('raw off');
  });

  test('a title opens the frame and is erased with it', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: numbered(3), title: 'reviewer (project)', height: 2, keys: script([DOWN, ESCAPE]), terminal });
    expect(frames(events)).toEqual([
      frame({ ...windowOf(1, 2, 3), title: 'reviewer (project)' }),
      frame({ ...windowOf(2, 3, 3), title: 'reviewer (project)' }),
    ]);
    expect(events.at(-2)).toBe(`\u001b[3A${CLEAR_DOWN}`);
  });

  test('an empty text says so and scrolls nowhere', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: '', keys: script([DOWN, SPACE, ESCAPE]), terminal });
    expect(events).toEqual([
      'raw on',
      `${EMPTY_PAGE_TEXT}\n  ${PAGE_KEYS_TEXT}`,
      `\u001b[1A${CLEAR_DOWN}`,
      'raw off',
    ]);
  });

  test('shows the default height of lines when none is named', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: numbered(DEFAULT_PAGE_HEIGHT + 5), keys: script([ESCAPE]), terminal });
    expect(events[1]).toBe(frame(windowOf(1, DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_HEIGHT + 5)));
  });

  test('cuts lines longer than the width', async () => {
    const { terminal, events } = recordingTerminal();
    await page({ text: 'abcdefgh\nabc', width: 4, keys: script([ESCAPE]), terminal });
    expect(events[1]).toBe(frame({ lines: [`abc${CUT_MARK}`, 'abc'], top: 0, total: 2 }));
  });

  test('ctrl-c throws the interrupt exit and switches raw mode off', async () => {
    const { terminal, events } = recordingTerminal();
    const thrown = await page({ text: numbered(3), keys: script([{ name: 'ctrl-c' }]), terminal })
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
      yield ESCAPE;
    }
    const run = page({ text: numbered(3), keys: keys(), terminal, instead: 'Use --output=json.' });
    const refusal = await run.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(CommandExit);
    expect((refusal as CommandExit).message).toContain(NO_TERMINAL_TEXT);
    expect((refusal as CommandExit).message).toContain('Use --output=json.');
    expect(read).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('renderPage', () => {
  test('puts the title first and a status line naming the lines shown and the keys last', () => {
    expect(renderPage({ title: 'T', lines: ['b', 'c'], top: 1, total: 4 })).toEqual([
      'T',
      'b',
      'c',
      `  lines 2–3 of 4 · ${PAGE_KEYS_TEXT}`,
    ]);
  });
});

describe('pageLines', () => {
  test('splits at LF and CR LF and drops the empty line after a final break', () => {
    expect(pageLines('a\r\nb\nc\n')).toEqual(['a', 'b', 'c']);
    expect(pageLines('a\n\nb')).toEqual(['a', '', 'b']);
    expect(pageLines('')).toEqual([]);
    expect(pageLines('\n')).toEqual(['']);
  });

  test('expands tabs to the next stop of eight columns and drops other control characters', () => {
    expect(pageLines('\tx')).toEqual(['        x']);
    expect(pageLines('ab\tx')).toEqual(['ab      x']);
    expect(pageLines('a\u001b[31mb\u0007c\u007f')).toEqual(['a[31mbc']);
  });

  test('cuts by code point, marking the cut, and leaves a line of exactly the width whole', () => {
    expect(pageLines('abcd', 4)).toEqual(['abcd']);
    expect(pageLines('abcde', 4)).toEqual([`abc${CUT_MARK}`]);
    expect(pageLines('😀😀😀', 2)).toEqual([`😀${CUT_MARK}`]);
    expect(pageLines('abc', 0)).toEqual([CUT_MARK]);
  });
});
