/**
 * Tests for where the effort store lives (`location.ts`): the store
 * directory both backends resolve, `RAFA_EFFORT_DIR` moving it, and the
 * test guard.
 *
 * Every store here is built under a fresh temporary root. The cases
 * that read `process.env` set `RAFA_EFFORT_DIR` or `TMPDIR` themselves
 * and put the value they found back after each case, since bun runs
 * every test file in one process.
 *
 * The guard's "makes nothing" cases never aim an open at a path outside
 * the real temporary directory, where a guard that failed to fire would
 * write a live store. They point `TMPDIR` at one fresh directory under
 * it and open a store in a sibling of that directory instead: outside
 * the temporary directory the process now reads, and still a path this
 * suite owns and removes. A store opened inside the narrowed directory
 * is the control that shows the narrowing alone does not refuse.
 */
import type { SessionEffortRow } from './types.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { plantScratchRepo, runRafa } from '../../tests/cli-capture.js';
import { EFFORT_STORE_DIR } from '../store.js';

import { fixStoreSchema } from './fix-schema.js';
import {
  EFFORT_DIR_VARIABLE,
  effortStoreDir,
  guardTestProcess,
  isTestProcess,
  isUnderTempDir,
} from './location.js';
import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore, sqliteStorePath, withSqliteStore } from './sqlite.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-store-location-'));
let planted = 0;

/** The environment values a case may change, as the case found them. */
const saved = { effortDir: process.env[EFFORT_DIR_VARIABLE], tmp: process.env.TMPDIR };

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Puts one environment variable back as it was found. */
function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore(EFFORT_DIR_VARIABLE, saved.effortDir);
  restore('TMPDIR', saved.tmp);
});

/** A fresh directory under this suite's temporary root. */
function freshDir(name: string): string {
  planted += 1;
  const dir = join(tempRoot, `${String(planted)}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** One session row, as an append takes it. */
function sessionRow(sessionId: string): SessionEffortRow {
  return { sessionId, assistantRecordCount: 1 } as unknown as SessionEffortRow;
}

/** Every entry under `dir`, recursively, or `[]` when it does not exist. */
function entriesUnder(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir, { recursive: true }).map(String)
    : [];
}

describe('effortStoreDir', () => {
  beforeEach(() => {
    delete process.env[EFFORT_DIR_VARIABLE];
  });

  it('answers the project\'s own .rafa/effort when RAFA_EFFORT_DIR is unset or empty', () => {
    const root = freshDir('unset');

    expect(effortStoreDir(root, {})).toBe(join(root, EFFORT_STORE_DIR));
    expect(effortStoreDir(root, { [EFFORT_DIR_VARIABLE]: '' })).toBe(join(root, EFFORT_STORE_DIR));
  });

  it('answers RAFA_EFFORT_DIR when it names an absolute directory elsewhere', () => {
    const root = freshDir('elsewhere');
    const copy = join(freshDir('copy'), 'effort');

    expect(effortStoreDir(root, { [EFFORT_DIR_VARIABLE]: copy })).toBe(copy);
  });

  it('refuses a relative RAFA_EFFORT_DIR, naming the value and the way out', () => {
    const root = freshDir('relative');

    for (const value of ['relative', './copy', '../copy', 'copy/effort']) {
      expect(() => effortStoreDir(root, { [EFFORT_DIR_VARIABLE]: value }))
        .toThrow(`effort store: RAFA_EFFORT_DIR is not an absolute path (${value});`);
    }
  });

  it('refuses a relative RAFA_EFFORT_DIR at the store open, before any file is made', () => {
    const root = freshDir('relative-open');
    process.env[EFFORT_DIR_VARIABLE] = 'relative';

    expect(() => openSqliteStore(root).append('sessions', [sessionRow('s-1')]))
      .toThrow('is not an absolute path');
    expect(() => openNdjsonStore(root).append('sessions', [sessionRow('s-1')]))
      .toThrow('is not an absolute path');
    expect(entriesUnder(root)).toEqual([]);
  });

  it('refuses the project\'s own store however it is spelled', () => {
    const root = freshDir('own');
    const own = join(root, EFFORT_STORE_DIR);
    mkdirSync(own, { recursive: true });
    const link = join(freshDir('link'), 'to-own');
    symlinkSync(own, link);

    for (const value of [own, `${own}/`, join(root, '.rafa', '.', 'effort'), join(root, 'x', '..', EFFORT_STORE_DIR), link]) {
      expect(() => effortStoreDir(root, { [EFFORT_DIR_VARIABLE]: value }))
        .toThrow(`effort store: RAFA_EFFORT_DIR names this project's own store (${value});`);
    }
  });

  it('accepts a near miss of the project\'s own store: a sibling or a directory inside it', () => {
    const root = freshDir('near-miss');
    const own = join(root, EFFORT_STORE_DIR);

    for (const value of [`${own}-copy`, join(root, '.rafa', 'scratch', 'effort'), join(own, 'copy')]) {
      expect(effortStoreDir(root, { [EFFORT_DIR_VARIABLE]: value })).toBe(value);
    }
  });
});

describe('RAFA_EFFORT_DIR moves both backends together', () => {
  it('puts the SQLite file and the NDJSON files in the one directory it names, and nothing under the root', () => {
    const root = freshDir('moved-root');
    const copy = join(freshDir('moved-copy'), 'effort');
    process.env[EFFORT_DIR_VARIABLE] = copy;

    const sqlite = openSqliteStore(root);
    const ndjson = openNdjsonStore(root);
    sqlite.append('sessions', [sessionRow('s-1')]);
    ndjson.append('sessions', [sessionRow('s-1')]);

    expect(sqlite.path('sessions')).toBe(join(copy, 'effort.sqlite'));
    expect(ndjson.path('sessions')).toBe(join(copy, 'sessions.ndjson'));
    expect(ndjson.path('commits')).toBe(join(copy, 'commits.ndjson'));
    expect(sqliteStorePath(root)).toBe(join(copy, 'effort.sqlite'));
    expect(readdirSync(copy).sort()).toEqual(['effort.sqlite', 'sessions.ndjson']);
    expect(sqlite.read('sessions').map((row) => row.sessionId)).toEqual(['s-1']);
    expect(ndjson.read('sessions').map((row) => row.sessionId)).toEqual(['s-1']);
    expect(entriesUnder(root)).toEqual([]);
  });

  it('control: with it unset, the same appends land under the root\'s .rafa/effort', () => {
    const root = freshDir('unmoved-root');
    delete process.env[EFFORT_DIR_VARIABLE];

    openSqliteStore(root).append('sessions', [sessionRow('s-1')]);
    openNdjsonStore(root).append('sessions', [sessionRow('s-1')]);

    expect(readdirSync(join(root, EFFORT_STORE_DIR)).sort()).toEqual(['effort.sqlite', 'sessions.ndjson']);
  });
});

describe('isTestProcess', () => {
  it('answers true for an entry ending in .test.ts, or for RAFA_TEST=1', () => {
    expect(isTestProcess('/repo/src/a.test.ts', {})).toBe(true);
    expect(isTestProcess('/repo/src/rafa.ts', { RAFA_TEST: '1' })).toBe(true);
  });

  it('answers false for any other entry, whatever else RAFA_TEST holds', () => {
    expect(isTestProcess('/repo/src/rafa.ts', {})).toBe(false);
    expect(isTestProcess('/repo/src/rafa.ts', { RAFA_TEST: '0' })).toBe(false);
    expect(isTestProcess('/repo/src/rafa.ts', { RAFA_TEST: 'true' })).toBe(false);
    expect(isTestProcess('/repo/src/a.test.tsx', {})).toBe(false);
    expect(isTestProcess('/repo/src/a.test.ts.bak', {})).toBe(false);
  });

  it('answers true in this suite, the process the guard runs in', () => {
    expect(Bun.main.endsWith('.test.ts')).toBe(true);
    expect(isTestProcess()).toBe(true);
  });
});

describe('isUnderTempDir', () => {
  it('answers true for the temporary directory and anything under it', () => {
    expect(isUnderTempDir('/tmp', '/tmp')).toBe(true);
    expect(isUnderTempDir('/tmp/a/.rafa/effort/effort.sqlite', '/tmp')).toBe(true);
    expect(isUnderTempDir('/tmp/a/../b/effort.sqlite', '/tmp')).toBe(true);
  });

  it('answers true for an entry under it whose name starts with two dots', () => {
    expect(isUnderTempDir('/tmp/..hidden/effort.sqlite', '/tmp')).toBe(true);
  });

  it('answers false for a sibling sharing its prefix, a parent, or a path climbing out', () => {
    expect(isUnderTempDir('/tmpx/effort.sqlite', '/tmp')).toBe(false);
    expect(isUnderTempDir('/', '/tmp')).toBe(false);
    expect(isUnderTempDir('/tmp/../home/effort.sqlite', '/tmp')).toBe(false);
    expect(isUnderTempDir('/home/u/repo/.rafa/effort/effort.sqlite', '/tmp')).toBe(false);
  });

  it('answers true for a path under the real path of a symlinked temporary directory', () => {
    const real = freshDir('real-tmp');
    const link = join(freshDir('linked'), 'tmp-link');
    symlinkSync(real, link);

    expect(isUnderTempDir(join(real, 'a', 'effort.sqlite'), link)).toBe(true);
    expect(isUnderTempDir(join(link, 'a', 'effort.sqlite'), link)).toBe(true);
  });

  it('answers true for a path not made yet, spelled through a symlinked temporary root', () => {
    // macOS's shape: `/var` links to `/private/var`, the temporary directory is read as its real path,
    // and a store path is spelled from `/var`.
    const root = freshDir('symlinked-root');
    const realRoot = join(root, 'private-var');
    const linkRoot = join(root, 'var');
    mkdirSync(join(realRoot, 'T'), { recursive: true });
    symlinkSync(realRoot, linkRoot);
    const path = join(linkRoot, 'T', 'a', '.rafa', 'effort', 'effort.sqlite');

    expect(existsSync(join(linkRoot, 'T', 'a'))).toBe(false);
    expect(isUnderTempDir(path, join(realRoot, 'T'))).toBe(true);
    expect(isUnderTempDir(path, join(linkRoot, 'T'))).toBe(true);
  });

  it('control: answers false for a path not made yet, spelled through the symlinked root but outside the temporary directory', () => {
    const root = freshDir('symlinked-root-control');
    const realRoot = join(root, 'private-var');
    const linkRoot = join(root, 'var');
    mkdirSync(join(realRoot, 'T'), { recursive: true });
    symlinkSync(realRoot, linkRoot);

    expect(isUnderTempDir(join(linkRoot, 'other', 'effort.sqlite'), join(realRoot, 'T'))).toBe(false);
    expect(isUnderTempDir(join(linkRoot, 'T', '..', 'other', 'effort.sqlite'), join(realRoot, 'T'))).toBe(false);
  });
});

describe('guardTestProcess', () => {
  it('throws the test-guard text for a test process opening a path outside the temporary directory', () => {
    const path = '/home/u/repo/.rafa/effort/effort.sqlite';

    expect(() => guardTestProcess(path, { main: '/r/a.test.ts', env: {}, tempDir: '/tmp' }))
      .toThrow(`effort store: a test opened ${path}, outside the temp directory /tmp; a test opens stores under tmpdir() only`);
  });

  it('control: passes the same path for a process that is not a test, and a test path under the temporary directory', () => {
    const outside = '/home/u/repo/.rafa/effort/effort.sqlite';

    expect(() => guardTestProcess(outside, { main: '/r/rafa.ts', env: {}, tempDir: '/tmp' })).not.toThrow();
    expect(() => guardTestProcess('/tmp/x/effort.sqlite', { main: '/r/a.test.ts', env: {}, tempDir: '/tmp' }))
      .not.toThrow();
  });
});

describe('the guard at every store open', () => {
  /** Narrows this process's temporary directory to a fresh one, and answers it and a sibling outside it. */
  function narrowedTemp(name: string): { inside: string; outside: string } {
    const inside = freshDir(`${name}-inside`);
    const outside = freshDir(`${name}-outside`);
    process.env.TMPDIR = inside;
    expect(tmpdir()).toBe(inside);
    return { inside, outside };
  }

  it('refuses a SQLite append outside the temporary directory, making no file and no directory', () => {
    const { outside } = narrowedTemp('sqlite');
    const root = join(outside, 'repo');

    expect(() => openSqliteStore(root).append('sessions', [sessionRow('s-1')]))
      .toThrow(`effort store: a test opened ${sqliteStorePath(root)}, outside the temp directory`);
    expect(() => withSqliteStore(sqliteStorePath(root), 'write', true, () => undefined))
      .toThrow('a test opens stores under tmpdir() only');
    expect(entriesUnder(outside)).toEqual([]);
  });

  it('refuses a read of a SQLite store that exists outside the temporary directory', () => {
    const root = join(freshDir('sqlite-read'), 'repo');
    openSqliteStore(root).append('sessions', [sessionRow('s-1')]);
    process.env.TMPDIR = freshDir('sqlite-read-narrow');

    expect(() => openSqliteStore(root).read('sessions')).toThrow('a test opens stores under tmpdir() only');
    expect(() => openSqliteStore(root).keys('sessions')).toThrow('a test opens stores under tmpdir() only');
  });

  it('refuses an NDJSON append, read and keys outside the temporary directory, making nothing', () => {
    const { outside } = narrowedTemp('ndjson');
    const store = openNdjsonStore(join(outside, 'repo'));

    expect(() => store.append('sessions', [sessionRow('s-1')])).toThrow('a test opens stores under tmpdir() only');
    expect(() => store.read('commits')).toThrow('a test opens stores under tmpdir() only');
    expect(() => store.keys('sessions')).toThrow('a test opens stores under tmpdir() only');
    expect(() => store.readRows('sessions')).toThrow('a test opens stores under tmpdir() only');
    expect(entriesUnder(outside)).toEqual([]);
  });

  it('refuses fix-schema\'s open outside the temporary directory', () => {
    const root = join(freshDir('fix-schema'), 'repo');
    openSqliteStore(root).append('sessions', [sessionRow('s-1')]);
    process.env.TMPDIR = freshDir('fix-schema-narrow');

    expect(() => fixStoreSchema({ path: sqliteStorePath(root), dryRun: true, stamp: 'x' }))
      .toThrow('a test opens stores under tmpdir() only');
  });

  it('control: opens both backends inside the narrowed temporary directory', () => {
    const { inside } = narrowedTemp('control');
    const root = join(inside, 'repo');

    openSqliteStore(root).append('sessions', [sessionRow('s-1')]);
    openNdjsonStore(root).append('sessions', [sessionRow('s-1')]);

    expect(readdirSync(join(root, EFFORT_STORE_DIR)).sort()).toEqual(['effort.sqlite', 'sessions.ndjson']);
  });
});

describe('runRafa marks its child as a test process', () => {
  /**
   * A scratch project holding a current SQLite store with no rows, which
   * `effort report` reads, and a directory outside it for the child's
   * TMPDIR. No rows, since the report reads fields a bare row lacks.
   */
  function scratchWithStore(): { repo: string; scratch: ReturnType<typeof plantScratchRepo>; elsewhere: string } {
    const scratch = plantScratchRepo(freshDir('spawned'));
    withSqliteStore(sqliteStorePath(scratch.repo), 'write', true, () => undefined);
    return { repo: scratch.repo, scratch, elsewhere: freshDir('spawned-elsewhere') };
  }

  it('the child refuses a store outside its temporary directory, since runRafa sets RAFA_TEST=1', () => {
    const { repo, scratch, elsewhere } = scratchWithStore();

    const run = runRafa(scratch, repo, ['effort', 'report'], { TMPDIR: elsewhere });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain(`effort store: a test opened ${sqliteStorePath(repo)}, outside the temp directory ${elsewhere}`);
  });

  it('control: the same child reads the store with RAFA_TEST overridden, or with its TMPDIR left as the suite\'s', () => {
    const { repo, scratch, elsewhere } = scratchWithStore();

    const overridden = runRafa(scratch, repo, ['effort', 'report'], { TMPDIR: elsewhere, RAFA_TEST: '0' });
    const inherited = runRafa(scratch, repo, ['effort', 'report']);

    expect(overridden.stderr).not.toContain('a test opens stores under tmpdir() only');
    expect(overridden.exitCode).toBe(0);
    expect(inherited.stderr).not.toContain('a test opens stores under tmpdir() only');
    expect(inherited.exitCode).toBe(0);
  });
});
