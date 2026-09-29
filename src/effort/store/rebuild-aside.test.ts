/**
 * The build-aside steps over files in a temp directory. The store here is
 * any SQLite file: the steps read no schema of their own, so a one-table
 * file is enough to tell a swap, a dry run and a removal apart by bytes.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import {
  checkedCounts,
  quoted,
  rebuildAside,
  RebuildRefusal,
  refuseCorrupt,
  refuseInFlight,
} from './rebuild-aside.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-rebuild-aside-'));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let made = 0;

/** A fresh directory for one case. */
function caseDir(): string {
  made += 1;
  const dir = join(tempRoot, `case-${String(made)}`);
  mkdirSync(dir);
  return dir;
}

/** Writes a SQLite file at `path` holding `rows` rows in `notes`. */
function plantFile(path: string, rows: number): void {
  const db = new Database(path, { create: true, readwrite: true });
  try {
    db.run('CREATE TABLE notes (seq INTEGER PRIMARY KEY, body TEXT)');
    for (let row = 0; row < rows; row += 1) db.run('INSERT INTO notes (body) VALUES (?)', [`note ${String(row)}`]);
  } finally {
    db.close();
  }
}

/** The paths one case works with. */
function casePaths(): { dir: string; path: string; parallelPath: string; backupPath: string } {
  const dir = caseDir();
  const path = join(dir, 'effort.sqlite');
  return { dir, path, parallelPath: `${path}.aside-1`, backupPath: `${path}.before-1.bak` };
}

describe('rebuildAside', () => {
  it('swaps the built file in and keeps the original whole as the backup', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    plantFile(path, 2);
    const original = readFileSync(path);

    const result = rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: (aside) => plantFile(aside, 5) });

    expect(result.backupPath).toBe(backupPath);
    expect(readFileSync(backupPath).equals(original)).toBe(true);
    expect(readFileSync(path).equals(original)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.before-1.bak']);
  });

  it('answers what the build answered', () => {
    const { path, parallelPath, backupPath } = casePaths();
    plantFile(path, 1);

    const result = rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: true,
      build: (aside) => {
        plantFile(aside, 1);
        return aside;
      },
    });

    expect(result.built).toBe(parallelPath);
  });

  it('deletes the built file under a dry run, leaving the directory byte-identical', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    plantFile(path, 2);
    const before = readFileSync(path);
    let built = false;

    const result = rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: true,
      build: (aside) => {
        plantFile(aside, 2);
        built = existsSync(aside);
      },
    });

    expect(built).toBe(true);
    expect(result.backupPath).toBeNull();
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('removes the built file and its journal when the build throws, rethrowing and leaving the store untouched', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    plantFile(path, 2);
    const before = readFileSync(path);

    expect(() => rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: false,
      build: (aside) => {
        plantFile(aside, 1);
        writeFileSync(`${aside}-journal`, 'left');
        throw new RebuildRefusal('planted failure');
      },
    })).toThrow('planted failure');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('refuses when the parallel file is already there, never building', () => {
    const { path, parallelPath, backupPath } = casePaths();
    plantFile(path, 1);
    writeFileSync(parallelPath, 'earlier run');
    let built = false;

    expect(() => rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: () => (built = true) }))
      .toThrow(RebuildRefusal);
    expect(built).toBe(false);
    expect(readFileSync(parallelPath, 'utf8')).toBe('earlier run');
  });

  it('refuses when the backup is already there, never building', () => {
    const { path, parallelPath, backupPath } = casePaths();
    plantFile(path, 1);
    writeFileSync(backupPath, 'earlier backup');

    expect(() => rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: () => plantFile(parallelPath, 1) }))
      .toThrow(/before-1\.bak is already there/);
    expect(existsSync(parallelPath)).toBe(false);
    expect(readFileSync(backupPath, 'utf8')).toBe('earlier backup');
  });

  it('refuses while a journal sits beside the store, never building', () => {
    const { path, parallelPath, backupPath } = casePaths();
    plantFile(path, 1);
    writeFileSync(`${path}-journal`, 'hot');

    expect(() => rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: () => plantFile(parallelPath, 1) }))
      .toThrow(/-journal is there/);
    expect(existsSync(parallelPath)).toBe(false);
  });
});

describe('refuseInFlight', () => {
  it('passes a store with neither a journal nor a log beside it', () => {
    const { path } = casePaths();
    plantFile(path, 1);

    expect(() => refuseInFlight(path)).not.toThrow();
  });

  it.each(['-journal', '-wal'])('refuses a store with %s beside it', (suffix) => {
    const { path } = casePaths();
    plantFile(path, 1);
    writeFileSync(`${path}${suffix}`, 'hot');

    expect(() => refuseInFlight(path)).toThrow(RebuildRefusal);
    expect(() => refuseInFlight(path)).toThrow(`${suffix} is there`);
  });
});

describe('checkedCounts', () => {
  /** A handle on a built file of `builtRows` rows with an original of `originalRows` attached. */
  function attached(builtRows: number, originalRows: number): Database {
    const { path, parallelPath } = casePaths();
    plantFile(path, originalRows);
    plantFile(parallelPath, builtRows);
    const db = new Database(parallelPath, { readwrite: true });
    db.run('ATTACH DATABASE ? AS original', [path]);
    return db;
  }

  it('answers every table with its rows when the counts agree', () => {
    const db = attached(3, 3);
    try {
      expect(checkedCounts(db, ['notes'], 'original')).toEqual([{ table: 'notes', rows: 3 }]);
    } finally {
      db.close();
    }
  });

  it('refuses a table whose count differs from the original', () => {
    const db = attached(2, 3);
    try {
      expect(() => checkedCounts(db, ['notes'], 'original')).toThrow('the rebuilt notes holds 2 rows, the store 3');
    } finally {
      db.close();
    }
  });

  it('answers a table holding the original count plus the rows the caller added', () => {
    const db = attached(5, 3);
    try {
      expect(checkedCounts(db, ['notes'], 'original', { notes: 2 })).toEqual([{ table: 'notes', rows: 5 }]);
    } finally {
      db.close();
    }
  });

  it('refuses a table short of the original count plus the rows the caller added, and one holding them uncounted', () => {
    const db = attached(4, 3);
    try {
      expect(() => checkedCounts(db, ['notes'], 'original', { notes: 2 }))
        .toThrow('the rebuilt notes holds 4 rows, the store 3 plus 2 added');
      expect(() => checkedCounts(db, ['notes'], 'original', { other: 1 })).toThrow('the rebuilt notes holds 4 rows, the store 3');
    } finally {
      db.close();
    }
  });
});

describe('refuseCorrupt', () => {
  it('passes a file integrity_check answers ok for', () => {
    const { path } = casePaths();
    plantFile(path, 2);
    const db = new Database(path, { readonly: true });
    try {
      expect(() => refuseCorrupt(db)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('refuses a file integrity_check answers anything else for, naming the answer', () => {
    const answer = 'row 1 missing from index notes_by_body';
    const failing = { query: () => ({ get: () => ({ integrity_check: answer }) }) } as unknown as Database;

    expect(() => refuseCorrupt(failing)).toThrow(`the rebuilt store failed integrity_check: ${answer}`);
  });
});

describe('quoted', () => {
  it('doubles an embedded quote', () => {
    expect(quoted('a"b')).toBe('"a""b"');
  });
});
