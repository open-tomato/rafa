/**
 * Tests for the effort store's entry: the selection, and the surface
 * the `./store` subpath exposes.
 *
 * Every store sits under a fresh temporary repo root, so the suite
 * touches no `.ralph/` anywhere, and the disk is real rather than
 * mocked.
 *
 * Which backend a selection opened is read off the disk, never off the
 * store it answered. After one row of each kind is appended, the store
 * directory holds `effort.sqlite` alone or the two `.ndjson` files
 * alone. Those names are spelled HERE rather than read off the
 * backends, so a selection that opened the wrong backend fails instead
 * of agreeing with itself.
 *
 * The config cases run through `loadConfig` over a real
 * `.rafa/config.yaml`, so they pin the whole path from the file to the
 * backend rather than the selector's switch alone. The case where the
 * command line outranks the file is the one that tells a selector
 * honouring the resolved value apart from one that reads the file
 * again.
 *
 * Thirteen module mutations were driven against this file and every one
 * reddened at least one case, with the unmutated module green before
 * them and restored byte-identical after: the two openers swapped, the
 * NDJSON name opening SQLite, the name looked up by indexing the record
 * rather than through the `Map` (red on the three `Object.prototype`
 * names and on the list), an unknown name falling back to SQLite, the
 * store memoised per backend across roots, the SQLite opener's
 * re-export dropped, the NDJSON opener re-exported as a wrapper, the
 * refusal not naming the value, the selection creating the repo root,
 * the refusal thrown as a plain `Error`, the SQLite migration function
 * exported as well, the selector reading the config file itself (red on
 * the case where the command line outranks the file, among others), and
 * the config ignored for the default.
 *
 * One compile-time claim was driven red against `check-types`, with
 * copies of the config module and of the entry planted beside them and
 * moved out after. The copies compiled unmutated, which is the control.
 * A third backend name added to the copied config with no opener then
 * failed in the copied entry's opener record (TS2741).
 */
import type { SelectedEffortStore } from './index.js';
import type { CommitEffortRow, SessionEffortRow } from './types.js';
import type { RafaConfig, StoreBackend } from '../../config.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig, resolveConfig, STORE_BACKENDS } from '../../config.js';

import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore } from './sqlite.js';
import { EFFORT_KEY_PROJECTIONS } from './types.js';

import * as entry from './index.js';

const { selectEffortStore } = entry;

/** A session row carrying its key and one counter. The cast is the plant. */
function sessionRow(sessionId: string): SessionEffortRow {
  return { sessionId, assistantRecordCount: 1 } as unknown as SessionEffortRow;
}

/** A commit row carrying its key and one counter. The cast is the plant. */
function commitRow(sha: string): CommitEffortRow {
  return { sha, insertions: 1 } as unknown as CommitEffortRow;
}

const SESSION = sessionRow('aaaa-1111');
const COMMIT = commitRow('deadbeef');

/** The store directory each backend's files are expected in. */
const STORE_DIR = ['.ralph', 'effort'] as const;

/** Where one backend is expected to put each kind, and what it leaves. */
interface Layout {
  sessions: string;
  commits: string;
  /** The store directory once both kinds hold a row, sorted. */
  files: readonly string[];
}

/** Each backend's layout, spelled here rather than read off the module. */
const LAYOUTS: readonly (readonly [StoreBackend, Layout])[] = [
  ['sqlite', {
    sessions: 'effort.sqlite',
    commits: 'effort.sqlite',
    files: ['effort.sqlite'],
  }],
  ['ndjson', {
    sessions: 'sessions.ndjson',
    commits: 'commits.ndjson',
    files: ['commits.ndjson', 'sessions.ndjson'],
  }],
];

/** What the SQLite backend leaves, for the cases that expect it. */
const SQLITE_FILES = ['effort.sqlite'];

/** What the NDJSON backend leaves, for the cases that expect it. */
const NDJSON_FILES = ['commits.ndjson', 'sessions.ndjson'];

/** The accepted backends, in the order a refusal lists them. */
const EXPECTED = 'expected one of: sqlite, ndjson';

/**
 * Values no backend opens, each with the way a refusal quotes it. A
 * list naming a backend is here because indexing an object with one
 * coerces it to that backend's name.
 */
const UNOPENABLE: readonly (readonly [string, unknown, string])[] = [
  ['a backend nothing provides', 'postgres', '"postgres"'],
  ['an empty string', '', '""'],
  ['a backend in another case', 'SQLite', '"SQLite"'],
  ['the name of Object.prototype.constructor', 'constructor', '"constructor"'],
  ['the name of Object.prototype.toString', 'toString', '"toString"'],
  ['the prototype accessor', '__proto__', '"__proto__"'],
  ['undefined', undefined, 'undefined'],
  ['a number', 42, '42'],
  ['a list naming a backend', ['sqlite'], 'an object'],
];

/** The runtime names the entry exposes, sorted as `sort` sorts them. */
const RUNTIME_EXPORTS = [
  'EFFORT_KEY_PROJECTIONS',
  'STORE_BACKENDS',
  'openNdjsonStore',
  'openSqliteStore',
  'selectEffortStore',
];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-store-entry-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** The store directory under a root. */
function storeDir(root: string): string {
  return join(root, ...STORE_DIR);
}

/** What the store directory under a root holds, sorted. */
function storeFiles(root: string): string[] {
  return readdirSync(storeDir(root)).sort();
}

/** Appends one row of each kind through a store. */
function writeOneOfEach(store: SelectedEffortStore): void {
  store.append('sessions', [SESSION]);
  store.append('commits', [COMMIT]);
}

/** Plants `.rafa/config.yaml` under a root. */
function writeConfig(root: string, text: string): void {
  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), text);
}

/** Resolves the config under a root and selects from it. */
function selectFromDisk(
  root: string,
  cli: { store?: string } = {},
): SelectedEffortStore {
  const resolved = loadConfig(root, cli, () => undefined);
  return selectEffortStore(root, resolved.config);
}

describe.each(LAYOUTS)('selectEffortStore for store: %s', (backend, layout) => {
  it('writes each kind where that backend lays it out', () => {
    const root = freshRoot(`${backend}-write`);
    const store = selectEffortStore(root, { store: backend });

    expect(store.append('sessions', [SESSION])).toMatchObject({
      path: join(storeDir(root), layout.sessions),
      appended: 1,
      skipped: 0,
    });
    expect(store.append('commits', [COMMIT])).toMatchObject({
      path: join(storeDir(root), layout.commits),
      appended: 1,
      skipped: 0,
    });
    expect(storeFiles(root)).toEqual([...layout.files]);
  });

  it('answers the path each kind lives at', () => {
    const root = freshRoot(`${backend}-path`);
    const store = selectEffortStore(root, { store: backend });

    expect(store.path('sessions')).toBe(join(storeDir(root), layout.sessions));
    expect(store.path('commits')).toBe(join(storeDir(root), layout.commits));
  });

  it('reads back and keys what it appended', () => {
    const root = freshRoot(`${backend}-read`);
    const store = selectEffortStore(root, { store: backend });
    writeOneOfEach(store);

    expect(store.read('sessions')).toEqual([SESSION]);
    expect(store.read('commits')).toEqual([COMMIT]);
    expect(store.keys('sessions')).toEqual(new Set(['aaaa-1111']));
    expect(store.keys('commits')).toEqual(new Set(['deadbeef']));
  });

  it('touches nothing on disk when it opens', () => {
    const root = freshRoot(`${backend}-open`);
    selectEffortStore(root, { store: backend });

    expect(existsSync(root)).toBe(false);
  });

  it('opens each call under its own root', () => {
    const first = freshRoot(`${backend}-first`);
    const second = freshRoot(`${backend}-second`);
    selectEffortStore(first, { store: backend });
    writeOneOfEach(selectEffortStore(second, { store: backend }));

    expect(existsSync(first)).toBe(false);
    expect(storeFiles(second)).toEqual([...layout.files]);
  });
});

describe('selectEffortStore over a resolved config', () => {
  it('selects SQLite when the repo has no config file', () => {
    const root = freshRoot('no-config');
    writeOneOfEach(selectFromDisk(root));

    expect(storeFiles(root)).toEqual(SQLITE_FILES);
  });

  it('selects the backend the config file names', () => {
    const root = freshRoot('file-ndjson');
    writeConfig(root, 'store: ndjson\n');
    writeOneOfEach(selectFromDisk(root));

    expect(storeFiles(root)).toEqual(NDJSON_FILES);
  });

  it('selects the backend the command line names over the file', () => {
    const root = freshRoot('cli-over-file');
    writeConfig(root, 'store: ndjson\n');
    writeOneOfEach(selectFromDisk(root, { store: 'sqlite' }));

    expect(storeFiles(root)).toEqual(SQLITE_FILES);
  });
});

describe('selectEffortStore refusals', () => {
  it.each(UNOPENABLE)('refuses %s, having opened nothing', (_label, value, quoted) => {
    const root = freshRoot('refused');
    const config = { store: value } as unknown as RafaConfig;
    const attempt = (): SelectedEffortStore => selectEffortStore(root, config);

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`effort store: store is ${quoted}, ${EXPECTED}`);
    expect(existsSync(root)).toBe(false);
  });

  it('refuses a resolution passed in place of its config', () => {
    const root = freshRoot('resolution');
    const resolution = resolveConfig() as unknown as RafaConfig;

    expect(() => selectEffortStore(root, resolution))
      .toThrow(`effort store: store is undefined, ${EXPECTED}`);
    expect(existsSync(root)).toBe(false);
  });
});

describe('the ./store entry', () => {
  it('exports exactly the runtime names it declares', () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it('re-exports the backends and the port value themselves', () => {
    expect(entry.openNdjsonStore).toBe(openNdjsonStore);
    expect(entry.openSqliteStore).toBe(openSqliteStore);
    expect(entry.EFFORT_KEY_PROJECTIONS).toBe(EFFORT_KEY_PROJECTIONS);
    expect(entry.STORE_BACKENDS).toBe(STORE_BACKENDS);
  });

  it.each([...STORE_BACKENDS])('opens %s, a backend the config accepts', (backend) => {
    const store = selectEffortStore(freshRoot(`accepted-${backend}`), {
      store: backend,
    });

    expect(store).toEqual(expect.objectContaining({
      append: expect.any(Function),
      keys: expect.any(Function),
      read: expect.any(Function),
      path: expect.any(Function),
    }));
  });
});
