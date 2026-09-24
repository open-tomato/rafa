/**
 * Tests for the browse view (`src/inventory/browse.ts`): the transition
 * table on its own, then whole browses driven by scripted keys over a
 * recording terminal and hand-built records whose files are handed in
 * through the `read` seam.
 */
import type { BrowseEvent, BrowseState } from './browse.js';
import type { InventoryRecord } from './record.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';

import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { INTERRUPT_EXIT_CODE, NO_TERMINAL_TEXT } from '../cli/prompt/terminal.js';

import {
  browse,
  browseLabels,
  fullTitle,
  LIST_KEYS_TEXT,
  listIntercept,
  OPENING_STATE,
  showTitle,
  transition,
  viewKeys,
} from './browse.js';

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

/**
 * A key source yielding `keys` then ending, counting the keys pulled and
 * whether it was opened and closed. Like an async generator it is its
 * own one iterator: iterating it again continues where it was, and once
 * closed it yields nothing more, as `stdinKeys` does.
 */
function script(keys: readonly Key[]): {
  readonly source: AsyncIterable<Key>;
  readonly probe: { pulled: number; opened: number; closed: boolean };
} {
  const probe = { pulled: 0, opened: 0, closed: false };
  let at = 0;
  const iterator: AsyncIterator<Key> = {
    next: async () => {
      const key = keys[at];
      if (probe.closed || key === undefined) return { done: true, value: undefined };
      at += 1;
      probe.pulled += 1;
      return { done: false, value: key };
    },
    return: async () => {
      probe.closed = true;
      return { done: true, value: undefined };
    },
  };
  const source: AsyncIterable<Key> = {
    [Symbol.asyncIterator]() {
      probe.opened += 1;
      return iterator;
    },
  };
  return { source, probe };
}

/** The key for typing `typed`. */
function char(typed: string): Key {
  return { name: 'char', char: typed };
}

const UP: Key = { name: 'up' };
const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };
const BACKSPACE: Key = { name: 'backspace' };
const CTRL_C: Key = { name: 'ctrl-c' };

/** A record with filler fields, `overrides` applied. */
function record(overrides: Partial<InventoryRecord>): InventoryRecord {
  return {
    kind: 'skill',
    name: 'gate-order',
    source: 'project',
    path: '/project/.claude/skills/gate-order/SKILL.md',
    summary: 'Runs the gates in order',
    whenToUse: null,
    prevents: null,
    stack: [],
    tags: [],
    check: 'pass',
    state: 'enabled',
    visibleToLoop: true,
    ...overrides,
  };
}

const alpha = record({ name: 'alpha', path: '/p/alpha/SKILL.md' });
const beta = record({ name: 'beta', path: '/p/beta/SKILL.md' });
const gamma = record({ name: 'gamma', path: '/p/gamma/SKILL.md', summary: 'The third skill' });
const squid = record({ name: 'squid', path: '/p/squid/SKILL.md' });
const gammaUser = record({
  name: 'gamma',
  source: 'user',
  path: '/home/gamma/SKILL.md',
  state: 'shadowed-by:project',
  visibleToLoop: false,
});

const ROWS: readonly InventoryRecord[] = [alpha, beta, gamma];

/** The file each row's path holds: frontmatter, a heading, and a body line only the full context shows. */
function fileOf(path: string): string {
  const name = path.split('/').at(-2) ?? '';
  return `---\nname: ${name}\ndescription: about ${name}\n---\n# ${name} heading\n\nbody line of ${name}\n`;
}

/** Browses `rows` over `keys` with a recording terminal; answers the trail, the writes and the key probe. */
async function browseWith(
  keys: readonly Key[],
  rows: readonly InventoryRecord[] = ROWS,
  records: readonly InventoryRecord[] = rows,
): Promise<{
  readonly trail: readonly BrowseState[];
  readonly events: readonly string[];
  readonly probe: { pulled: number; opened: number; closed: boolean };
}> {
  const { terminal, events } = recordingTerminal();
  const { source, probe } = script(keys);
  const trail = await browse({ message: 'Skills', rows, records, keys: source, terminal, read: fileOf });
  return { trail, events, probe };
}

/** Every write joined, raw-mode switches left out. */
function screen(events: readonly string[]): string {
  return events.filter((event) => event !== 'raw on' && event !== 'raw off').join('');
}

describe('transition', () => {
  const cases: ReadonlyArray<readonly [string, BrowseState, BrowseEvent, BrowseState]> = [
    ['list, enter opens the row', { view: 'list', at: 0 }, { name: 'open', at: 2 }, { view: 'show', at: 2 }],
    ['list, escape quits', { view: 'list', at: 1 }, { name: 'back' }, { view: 'quit' }],
    ['list, q quits', { view: 'list', at: 1 }, { name: 'quit' }, { view: 'quit' }],
    ['list, f does nothing', { view: 'list', at: 1 }, { name: 'full' }, { view: 'list', at: 1 }],
    ['show, f opens the full context', { view: 'show', at: 2 }, { name: 'full' }, { view: 'full', at: 2 }],
    ['show, escape goes back to the list on its row', { view: 'show', at: 2 }, { name: 'back' }, { view: 'list', at: 2 }],
    ['show, q quits', { view: 'show', at: 2 }, { name: 'quit' }, { view: 'quit' }],
    ['full, escape goes back to the show view', { view: 'full', at: 2 }, { name: 'back' }, { view: 'show', at: 2 }],
    ['full, q quits', { view: 'full', at: 2 }, { name: 'quit' }, { view: 'quit' }],
    ['full, f does nothing', { view: 'full', at: 2 }, { name: 'full' }, { view: 'full', at: 2 }],
    ['quit stays quit', { view: 'quit' }, { name: 'open', at: 0 }, { view: 'quit' }],
  ];
  for (const [title, from, event, to] of cases) {
    test(title, () => {
      expect(transition(from, event)).toEqual(to);
    });
  }

  test('opens on the list at the first row', () => {
    expect(OPENING_STATE).toEqual({ view: 'list', at: 0 });
  });
});

describe('listIntercept', () => {
  test('q quits on an empty filter', () => {
    expect(listIntercept()(char('q'))).toEqual({ name: 'quit' });
  });

  test('q is a filter character once the filter holds one', () => {
    const intercept = listIntercept();
    expect(intercept(char('s'))).toBeNull();
    expect(intercept(char('q'))).toBeNull();
  });

  test('q quits again once backspace has emptied the filter', () => {
    const intercept = listIntercept();
    intercept(char('s'));
    intercept(BACKSPACE);
    expect(intercept(char('q'))).toEqual({ name: 'quit' });
  });

  test('backspace on an empty filter leaves it empty, as select does', () => {
    const intercept = listIntercept();
    intercept(BACKSPACE);
    expect(intercept(char('q'))).toEqual({ name: 'quit' });
  });

  test('f and the named keys are never intercepted', () => {
    const intercept = listIntercept();
    expect([char('f'), UP, DOWN, ENTER, ESCAPE].map(intercept)).toEqual([null, null, null, null, null]);
  });
});

describe('viewKeys', () => {
  test('closing one view\'s keys leaves the source open for the next view', async () => {
    const keys = [DOWN, UP, ENTER];
    let at = 0;
    const feed = { next: async () => keys[at++] ?? null };
    const read = async (): Promise<Key | undefined> => {
      for await (const key of viewKeys(feed, () => null, () => undefined)) return key;
      return undefined;
    };
    expect([await read(), await read(), await read(), await read()]).toEqual([DOWN, UP, ENTER, undefined]);
  });

  test('an intercepted key is recorded and handed on as escape, and ends the view\'s keys', async () => {
    const recorded: BrowseEvent[] = [];
    const keys = [DOWN, char('q'), DOWN];
    let at = 0;
    const feed = { next: async () => keys[at++] ?? null };
    const seen: Key[] = [];
    for await (const key of viewKeys(feed, (key) => key.name === 'char'
      ? { name: 'quit' }
      : null, (event) => recorded.push(event))) seen.push(key);
    expect(seen).toEqual([DOWN, ESCAPE]);
    expect(recorded).toEqual([{ name: 'quit' }]);
    expect(at).toBe(2);
  });
});

describe('browseLabels', () => {
  test('pads the name and source columns to their widest cells', () => {
    expect(browseLabels([alpha, gammaUser])).toEqual([
      'alpha  project  enabled',
      'gamma  user     shadowed-by:project',
    ]);
  });

  test('answers no label for no row', () => {
    expect(browseLabels([])).toEqual([]);
  });
});

describe('browse', () => {
  test('down, down, enter, f, escape, q walks list, show, full context, show, then quits', async () => {
    const { trail, events, probe } = await browseWith([DOWN, DOWN, ENTER, char('f'), ESCAPE, char('q')]);

    expect(trail).toEqual([
      { view: 'list', at: 0 },
      { view: 'show', at: 2 },
      { view: 'full', at: 2 },
      { view: 'show', at: 2 },
      { view: 'quit' },
    ]);
    const shown = screen(events);
    expect(shown).toContain(`? Skills (${LIST_KEYS_TEXT})`);
    expect(shown).toContain('❯ gamma  project  enabled');
    expect(shown).toContain(showTitle(gamma));
    expect(shown).toContain('skill gamma (project)');
    expect(shown).toContain('# gamma heading  (line 5)');
    expect(shown).toContain(fullTitle(gamma));
    expect(shown).toContain('body line of gamma');
    expect(probe).toEqual({ pulled: 6, opened: 1, closed: true });
  });

  test('the show view carries no body line and the full context does', async () => {
    const showOnly = screen((await browseWith([ENTER, char('q')])).events);
    const withFull = screen((await browseWith([ENTER, char('f'), char('q')])).events);

    expect(showOnly).toContain(showTitle(alpha));
    expect(showOnly).not.toContain('body line of alpha');
    expect(withFull).toContain('body line of alpha');
  });

  test('escape from the show view reopens the list on the row that was shown', async () => {
    const { trail, events } = await browseWith([DOWN, ENTER, ESCAPE, ENTER, char('q')]);

    expect(trail).toEqual([
      { view: 'list', at: 0 },
      { view: 'show', at: 1 },
      { view: 'list', at: 1 },
      { view: 'show', at: 1 },
      { view: 'quit' },
    ]);
    expect(screen(events).split(showTitle(beta))).toHaveLength(3);
  });

  test('q on an empty filter quits from the list', async () => {
    const { trail, probe } = await browseWith([char('q'), ENTER]);

    expect(trail).toEqual([{ view: 'list', at: 0 }, { view: 'quit' }]);
    expect(probe.pulled).toBe(1);
  });

  test('escape in the list quits', async () => {
    const { trail } = await browseWith([ESCAPE, ENTER]);

    expect(trail).toEqual([{ view: 'list', at: 0 }, { view: 'quit' }]);
  });

  test('q after a typed character filters rather than quits', async () => {
    const rows = [alpha, squid];
    const { trail, events } = await browseWith([char('s'), char('q'), ENTER, char('q')], rows);

    expect(trail).toEqual([{ view: 'list', at: 0 }, { view: 'show', at: 1 }, { view: 'quit' }]);
    expect(screen(events)).toContain(`? Skills (${LIST_KEYS_TEXT}) sq`);
    expect(screen(events)).toContain(showTitle(squid));
  });

  test('f in the list is a filter character, not the full context', async () => {
    const { trail, events } = await browseWith([char('f'), ESCAPE]);

    expect(trail).toEqual([{ view: 'list', at: 0 }, { view: 'quit' }]);
    expect(screen(events)).toContain(`? Skills (${LIST_KEYS_TEXT}) f`);
    expect(screen(events)).not.toContain('[full context]');
  });

  test('q in the full context quits without passing back through show', async () => {
    const { trail } = await browseWith([ENTER, char('f'), char('q')]);

    expect(trail).toEqual([
      { view: 'list', at: 0 },
      { view: 'show', at: 0 },
      { view: 'full', at: 0 },
      { view: 'quit' },
    ]);
  });

  test('keys that end in the show view quit rather than fall back to the list', async () => {
    const { trail, events, probe } = await browseWith([ENTER]);

    expect(trail).toEqual([{ view: 'list', at: 0 }, { view: 'show', at: 0 }, { view: 'quit' }]);
    expect(events.filter((event) => event === 'raw on')).toHaveLength(2);
    expect(probe.closed).toBe(true);
  });

  test('keys that end in the list quit', async () => {
    const { trail } = await browseWith([DOWN]);

    expect(trail).toEqual([{ view: 'list', at: 0 }, { view: 'quit' }]);
  });

  test('each view is one raw-mode session, switched off before the next opens', async () => {
    const { events } = await browseWith([ENTER, char('f'), ESCAPE, ESCAPE, char('q')]);
    const switches = events.filter((event) => event === 'raw on' || event === 'raw off');

    expect(switches).toEqual(Array.from({ length: 5 }, () => ['raw on', 'raw off']).flat());
  });

  test('a shadowed row shows itself, and names the holder that shadows it', async () => {
    const records = [gamma, gammaUser];
    const shown = screen((await browseWith([DOWN, ENTER, char('q')], [gamma, gammaUser], records)).events);

    expect(shown).toContain(showTitle(gammaUser));
    expect(shown).toContain('/home/gamma/SKILL.md');
    expect(shown).toContain('Other holders of skill gamma:');
    expect(shown).toContain('/p/gamma/SKILL.md');
  });

  test('a file that does not read is shown as such, and browsing goes on', async () => {
    const { terminal, events } = recordingTerminal();
    const { source } = script([ENTER, ESCAPE, char('q')]);
    const trail = await browse({
      message: 'Skills',
      rows: ROWS,
      records: ROWS,
      keys: source,
      terminal,
      read: () => {
        throw new Error('gone');
      },
    });

    expect(trail.at(-1)).toEqual({ view: 'quit' });
    expect(screen(events)).toContain('The file could not be read: gone');
  });

  test('uses the caller\'s labels', async () => {
    const { terminal, events } = recordingTerminal();
    const { source } = script([ESCAPE]);
    await browse({
      message: 'Skills',
      rows: ROWS,
      records: ROWS,
      labels: (rows) => rows.map((row) => `row ${row.name}`),
      keys: source,
      terminal,
    });

    expect(screen(events)).toContain('❯ row alpha');
  });

  test('refuses labels that do not match the rows, before reading a key', async () => {
    const { terminal } = recordingTerminal();
    const { source, probe } = script([ESCAPE]);
    const run = browse({ message: 'Skills', rows: ROWS, records: ROWS, labels: () => ['one'], keys: source, terminal });

    await expect(run).rejects.toThrow('browse: 1 label(s) for 3 row(s)');
    expect(probe.opened).toBe(0);
  });

  test('ctrl-c in a view is exit 130, with raw mode off and the key source closed', async () => {
    const { terminal, events } = recordingTerminal();
    const { source, probe } = script([ENTER, CTRL_C]);
    let thrown: unknown = null;
    try {
      await browse({ message: 'Skills', rows: ROWS, records: ROWS, keys: source, terminal, read: fileOf });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(INTERRUPT_EXIT_CODE);
    expect(events.at(-1)).toBe('raw off');
    expect(probe.closed).toBe(true);
  });

  test('without a terminal it refuses naming the caller\'s alternative and reads no key', async () => {
    const { terminal, events } = recordingTerminal(false);
    const { source, probe } = script([ESCAPE]);
    let thrown: unknown = null;
    try {
      await browse({
        message: 'Skills',
        rows: ROWS,
        records: ROWS,
        keys: source,
        terminal,
        instead: 'Run `rafa skill list --output=json` instead.',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(1);
    expect((thrown as CommandExit).message).toContain(NO_TERMINAL_TEXT);
    expect((thrown as CommandExit).message).toContain('--output=json');
    expect(probe.opened).toBe(0);
    expect(events).toEqual([]);
  });

  test('with a terminal the same call does read its keys, so the refusal above is the terminal\'s doing', async () => {
    const { terminal } = recordingTerminal(true);
    const { source, probe } = script([ESCAPE]);
    await browse({ message: 'Skills', rows: ROWS, records: ROWS, keys: source, terminal, instead: 'unused' });

    expect(probe.opened).toBe(1);
    expect(probe.pulled).toBe(1);
  });
});
