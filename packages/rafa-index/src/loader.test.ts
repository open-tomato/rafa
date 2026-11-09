/**
 * The extension loader (`loader.ts`), its refusals first: macOS with no
 * library, a throwing or refusing `setCustomSQLite`, a state that opened a
 * database first, an engine with no `loadExtension` and a throwing one,
 * then the same opened-first case read off the module's own process state
 * in a spawned `bun` child. The answers that turn vector search on follow,
 * ending with the real `sqlite-vec` load on Linux.
 *
 * Every in-process case hands a fresh {@link createLoaderState}, so an open
 * another test file made in this process reaches no answer here. Bun's
 * `setCustomSQLite` does nothing on Linux, so the macOS cases hand a
 * stand-in; its thrown message is modelled on the one Bun's macOS build
 * throws after SQLite loads, since a Linux machine cannot measure it.
 */
import type { ExtensionHost, LoaderState } from './loader.js';

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { getLoadablePath } from 'sqlite-vec';

import {
  createLoaderState,
  loadVector,
  openWithVector,
  prepareSqlite,
} from './loader.js';

const LOADER = new URL('./loader.ts', import.meta.url).pathname;

/** A library path no case loads: the stand-ins never open it. */
const LIBRARY = '/opt/fixture/lib/libsqlite3.dylib';

/** The message Bun's macOS build throws once SQLite is loaded, as the stand-in throws it. */
const MACOS_LOADED_ERROR = 'SQLite already loaded\nThis function can only be called before SQLite has been loaded and exactly once.';

/** How long a spawned child may take, start-up included. */
const CHILD_TIMEOUT_MS = 30_000;

/** A `setCustomSQLite` stand-in that records each library and answers as told. */
function standInSetCustomSQLite(answer: () => boolean): { readonly calls: string[]; readonly call: (library: string) => boolean } {
  const calls: string[] = [];
  return {
    call: (library: string) => {
      calls.push(library);
      return answer();
    },
    calls,
  };
}

/** A state that already opened a database, as a process does after its first `new Database()`. */
function openedState(): LoaderState {
  return { ...createLoaderState(), opened: true };
}

describe('prepareSqlite on macOS, refused', () => {
  it('answers vector: false naming the library when none is named, and calls nothing', () => {
    const stand = standInSetCustomSQLite(() => true);
    for (const library of [undefined, null, '']) {
      const answer = prepareSqlite({ library, platform: 'darwin', setCustomSQLite: stand.call, state: createLoaderState() });
      expect(answer.vector).toBe(false);
      expect(answer.why).toContain('no SQLite library is named');
    }
    expect(stand.calls).toEqual([]);
  });

  it('answers vector: false with the thrown message\'s first line when the call throws', () => {
    const state = createLoaderState();
    const stand = standInSetCustomSQLite(() => {
      throw new Error(MACOS_LOADED_ERROR);
    });
    const answer = prepareSqlite({ library: LIBRARY, platform: 'darwin', setCustomSQLite: stand.call, state });
    expect(answer).toEqual({ vector: false, why: `Database.setCustomSQLite(${LIBRARY}) threw: SQLite already loaded` });
    expect(stand.calls).toEqual([LIBRARY]);
    expect(state.library).toBeNull();
  });

  it('answers vector: false when the call answers false, as a Bun with SQLite linked in may', () => {
    const state = createLoaderState();
    const stand = standInSetCustomSQLite(() => false);
    const answer = prepareSqlite({ library: LIBRARY, platform: 'darwin', setCustomSQLite: stand.call, state });
    expect(answer).toEqual({ vector: false, why: `Database.setCustomSQLite(${LIBRARY}) loaded no library` });
    expect(state.library).toBeNull();
  });

  it('answers vector: false without calling when a database was opened first', () => {
    const stand = standInSetCustomSQLite(() => true);
    const answer = prepareSqlite({ library: LIBRARY, platform: 'darwin', setCustomSQLite: stand.call, state: openedState() });
    expect(answer.vector).toBe(false);
    expect(answer.why).toContain('a database was opened in this process before Database.setCustomSQLite');
    expect(stand.calls).toEqual([]);
  });
});

describe('loadVector, refused', () => {
  it('answers vector: false for an engine with no loadExtension', () => {
    const engine: ExtensionHost = {};
    expect(loadVector(engine)).toEqual({ vector: false, why: 'this SQLite engine has no loadExtension' });
  });

  it('answers vector: false with the message when loadExtension throws', () => {
    const engine: ExtensionHost = {
      loadExtension: () => {
        throw new Error('This build of sqlite3 does not support dynamic extension loading');
      },
    };
    expect(loadVector(engine)).toEqual({
      vector: false,
      why: 'loading sqlite-vec threw: This build of sqlite3 does not support dynamic extension loading',
    });
  });
});

interface ChildReading {
  readonly answer: { readonly vector: boolean; readonly why: string | null };
  readonly calls: number;
}

/**
 * Run a fresh `bun` that imports the loader, opens a database through it
 * first when `openFirst` is set, then prepares macOS with a throwing
 * stand-in, reading the module's own process state.
 */
function runChild(openFirst: boolean): ChildReading {
  const script = [
    `import { openDatabase, prepareSqlite } from ${JSON.stringify(LOADER)};`,
    'let calls = 0;',
    `const thrower = () => { calls += 1; throw new Error(${JSON.stringify(MACOS_LOADED_ERROR)}); };`,
    openFirst
      ? 'openDatabase(\':memory:\').close();'
      : '',
    `const answer = prepareSqlite({ platform: 'darwin', library: ${JSON.stringify(LIBRARY)}, setCustomSQLite: thrower });`,
    'process.stdout.write(JSON.stringify({ answer, calls }));',
  ].join('\n');
  const child = Bun.spawnSync([process.execPath, '-e', script], { stderr: 'pipe', stdout: 'pipe' });
  expect({ exitCode: child.exitCode, stderr: child.stderr.toString() }).toEqual({ exitCode: 0, stderr: '' });
  return JSON.parse(child.stdout.toString()) as ChildReading;
}

describe('prepareSqlite in a spawned child, the module\'s own state', () => {
  it('answers vector: false without calling when the child opened a database through the module first', () => {
    const reading = runChild(true);
    expect(reading.answer.vector).toBe(false);
    expect(reading.answer.why).toContain('a database was opened in this process before Database.setCustomSQLite');
    expect(reading.calls).toBe(0);
  }, CHILD_TIMEOUT_MS);

  it('control: a child that opened nothing calls the stand-in, so the answer above is the open\'s', () => {
    const reading = runChild(false);
    expect(reading.answer).toEqual({ vector: false, why: `Database.setCustomSQLite(${LIBRARY}) threw: SQLite already loaded` });
    expect(reading.calls).toBe(1);
  }, CHILD_TIMEOUT_MS);
});

describe('prepareSqlite, vector on', () => {
  it('answers vector: true off macOS and calls nothing, whatever the state', () => {
    const stand = standInSetCustomSQLite(() => true);
    for (const platform of ['linux', 'win32']) {
      expect(prepareSqlite({ platform, setCustomSQLite: stand.call, state: openedState() })).toEqual({ vector: true, why: null });
    }
    expect(stand.calls).toEqual([]);
  });

  it('names the library on macOS before any open, then takes the same library again after one', () => {
    const state = createLoaderState();
    const stand = standInSetCustomSQLite(() => true);
    expect(prepareSqlite({ library: LIBRARY, platform: 'darwin', setCustomSQLite: stand.call, state })).toEqual({ vector: true, why: null });
    expect(state.library).toBe(LIBRARY);
    state.opened = true;
    expect(prepareSqlite({ library: LIBRARY, platform: 'darwin', setCustomSQLite: stand.call, state })).toEqual({ vector: true, why: null });
    expect(prepareSqlite({ library: '/opt/other/libsqlite3.dylib', platform: 'darwin', setCustomSQLite: stand.call, state }).vector).toBe(false);
    expect(stand.calls).toEqual([LIBRARY]);
  });
});

describe('loadVector, vector on', () => {
  it('calls loadExtension with sqlite-vec\'s getLoadablePath()', () => {
    const calls: string[] = [];
    const engine: ExtensionHost = {
      loadExtension: (extension: string) => {
        calls.push(extension);
      },
    };
    expect(loadVector(engine)).toEqual({ vector: true, why: null });
    expect(calls).toEqual([getLoadablePath()]);
  });

  it.skipIf(process.platform !== 'linux')('loads sqlite-vec into a real database on Linux, where vec_version() was missing before', () => {
    const database = new Database(':memory:');
    try {
      expect(() => database.query('SELECT vec_version() AS version').get()).toThrow('no such function: vec_version');
      expect(loadVector(database)).toEqual({ vector: true, why: null });
      expect(database.query('SELECT vec_version() AS version').get()).toEqual({ version: 'v0.1.9' });
    } finally {
      database.close();
    }
  });
});

describe('openWithVector', () => {
  it('opens the database and answers the preparation\'s why when macOS names no library', () => {
    const state = createLoaderState();
    const opened = openWithVector(':memory:', { platform: 'darwin', state });
    try {
      expect(opened.vector).toBe(false);
      expect(opened.why).toContain('no SQLite library is named');
      expect(state.opened).toBe(true);
      expect(opened.database.query('SELECT 1 AS one').get()).toEqual({ one: 1 });
    } finally {
      opened.database.close();
    }
  });

  it.skipIf(process.platform !== 'linux')('opens and loads sqlite-vec on Linux, marking the state it is handed', () => {
    const state = createLoaderState();
    const opened = openWithVector(':memory:', { platform: 'linux', state });
    try {
      expect({ vector: opened.vector, why: opened.why }).toEqual({ vector: true, why: null });
      expect(state.opened).toBe(true);
      expect(opened.database.query('SELECT vec_version() AS version').get()).toEqual({ version: 'v0.1.9' });
    } finally {
      opened.database.close();
    }
  });
});
