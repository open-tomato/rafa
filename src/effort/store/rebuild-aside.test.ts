/**
 * The build-aside steps over files in a temp directory. The store here is
 * mostly any SQLite file: the steps read no schema of their own, so a
 * one-table file is enough to tell a swap, a dry run and a removal apart.
 * A dry run and a refusal leave the store's bytes as they were; a swap's
 * backup is a `VACUUM INTO` snapshot, so it is compared by rows, and its
 * inode is compared to the original's.
 *
 * The identity cases mint a real store through `withSqliteStore`, with
 * the host and the project injected, since a store under the temp
 * directory outside a repository with commits is never minted, and write
 * to it once after the swap: a read never mints, so only a write can
 * show whether the swapped-in file keeps the origin. Each failure point
 * of the swap is failed through `swapIn`'s steps, and the backup and the
 * carry are failed for real as well.
 */
import type { SwapSteps } from './rebuild-aside.js';
import type { StoreIdentitySeams, StoreMeta } from './store-meta.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { vacuumInto } from './copy.js';
import {
  checkedCounts,
  quoted,
  rebuildAside,
  RebuildRefusal,
  refuseCorrupt,
  refuseInFlight,
  swapIn,
} from './rebuild-aside.js';
import { withSqliteStore } from './sqlite.js';
import { readStoreMeta } from './store-meta.js';
import { storeRows } from './testdata/store-rows.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-rebuild-aside-')));
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

/** The inode of the file at `path`. */
function inodeOf(path: string): bigint {
  return statSync(path, { bigint: true }).ino;
}

/** Identity seams naming one host and a project with a root commit, numbering each store id. */
function mintingSeams(): StoreIdentitySeams {
  let minted = 0;
  return {
    readHostId: () => 'host-a',
    readProject: () => ({ rootCommit: 'root-commit-1', remote: null }),
    newStoreId: () => {
      minted += 1;
      return `store-${String(minted)}`;
    },
  };
}

/** Opens the store at `path` once to write, answering its `store_meta` row as the open left it. */
function writeOnce(path: string, seams: StoreIdentitySeams, create = false): StoreMeta | null {
  return withSqliteStore(path, 'write', create, (db) => readStoreMeta(db), seams);
}

/** The `store_meta` row of the file at `path`, read on a connection of its own. */
function metaOf(path: string): StoreMeta | null {
  const db = new Database(path, { readonly: true });
  try {
    return readStoreMeta(db);
  } finally {
    db.close();
  }
}

describe('rebuildAside', () => {
  it('swaps the built file in over the store, and keeps every row of the original in a backup of its own', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    plantFile(path, 2);
    const original = storeRows(path);
    const originalInode = inodeOf(path);
    let builtInode = 0n;

    const result = rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: false,
      build: (aside) => {
        plantFile(aside, 5);
        builtInode = inodeOf(aside);
      },
    });

    expect(result.backupPath).toBe(backupPath);
    expect(storeRows(backupPath)).toEqual(original);
    expect(original.tables.notes).toHaveLength(2);
    expect(storeRows(path).tables.notes).toHaveLength(5);
    expect(inodeOf(backupPath)).not.toBe(originalInode);
    expect(inodeOf(path)).toBe(builtInode);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.before-1.bak']);
  });

  it('keeps the store\'s origin on the first write after a swap, its backup keeping the row that names the original\'s inode', () => {
    const { path, parallelPath, backupPath } = casePaths();
    const seams = mintingSeams();
    const minted = writeOnce(path, seams, true);
    if (minted === null) throw new Error('the first write minted nothing');
    expect(minted.storeId).toBe('store-1');
    expect(minted.fileIno).toBe(inodeOf(path));

    rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: (aside) => vacuumInto(path, aside) });

    const written = writeOnce(path, seams);
    expect(written).toEqual({ ...minted, fileDev: statSync(path, { bigint: true }).dev, fileIno: inodeOf(path) });
    expect(written?.fileIno).not.toBe(minted.fileIno);
    expect(metaOf(backupPath)).toEqual(minted);
    expect(inodeOf(backupPath)).not.toBe(minted.fileIno);
  });

  it('mints on the first write after the same swap with the carry left out, the control', () => {
    const { path, parallelPath, backupPath } = casePaths();
    const seams = mintingSeams();
    expect(writeOnce(path, seams, true)?.storeId).toBe('store-1');
    vacuumInto(path, parallelPath);

    swapIn(path, parallelPath, backupPath, { carry: () => 'skipped' });

    expect(writeOnce(path, seams)?.storeId).toBe('store-2');
  });

  it('removes the built file and the backup when writing the backup fails for real, leaving the store untouched', () => {
    const { dir, path, parallelPath } = casePaths();
    plantFile(path, 2);
    const before = readFileSync(path);
    const backupPath = join(dir, 'missing', 'effort.sqlite.bak');

    expect(() => rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: (aside) => plantFile(aside, 5) }))
      .toThrow('unable to open database');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('removes the built file and the backup it wrote when the carry fails for real, leaving the store untouched', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    plantFile(path, 2);
    const before = readFileSync(path);

    expect(() => rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: false,
      build: (aside) => writeFileSync(aside, 'not a store at all, only text\n'.repeat(80)),
    })).toThrow('file is not a database');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
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

describe('swapIn failure points', () => {
  /** A case with the store and a built parallel file planted, and the store's bytes. */
  function planted(): ReturnType<typeof casePaths> & { before: Buffer } {
    const paths = casePaths();
    plantFile(paths.path, 2);
    plantFile(paths.parallelPath, 5);
    return { ...paths, before: readFileSync(paths.path) };
  }

  it('swaps with no step failing, the control: the store replaced and the backup kept', () => {
    const { dir, path, parallelPath, backupPath, before } = planted();

    swapIn(path, parallelPath, backupPath);

    expect(readFileSync(path).equals(before)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.before-1.bak']);
  });

  /** A step that throws, recording whether the backup was there when it ran. */
  function failingStep(seen: boolean[], backupPath: string): () => never {
    return () => {
      seen.push(existsSync(backupPath));
      throw new Error('planted failure');
    };
  }

  const failures: readonly [string, boolean, (seen: boolean[], backupPath: string) => Partial<SwapSteps>][] = [
    ['the backup, written in part,', false, (seen, backupPath) => ({
      backup: () => {
        seen.push(existsSync(backupPath));
        writeFileSync(backupPath, 'partial');
        throw new Error('planted failure');
      },
    })],
    ['the carry', true, (seen, backupPath) => ({ carry: failingStep(seen, backupPath) })],
    ['the rename', true, (seen, backupPath) => ({ replace: failingStep(seen, backupPath) })],
  ];

  it.each(failures)('removes the backup and the built file when %s fails, rethrowing and leaving the store untouched', (
    _step,
    backupWritten,
    steps,
  ) => {
    const { dir, path, parallelPath, backupPath, before } = planted();
    const seen: boolean[] = [];

    expect(() => swapIn(path, parallelPath, backupPath, steps(seen, backupPath))).toThrow('planted failure');

    expect(seen).toEqual([backupWritten]);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
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
