/**
 * The build-aside steps over files in a temp directory. The store here is
 * mostly any SQLite file: the steps read no schema of their own, so a
 * one-table file is enough to tell a swap, a dry run and a removal apart.
 * A dry run, a refusal and a failed swap leave the store's bytes as they
 * were; a swap's backup is a `VACUUM INTO` snapshot, so it is compared
 * by rows (`storeRows`), never by bytes.
 *
 * The identity cases mint a real store through `withSqliteStore`, with
 * the project injected, since a store under the temp directory outside a
 * repository with commits is never minted, and write to it once after
 * the swap: a read never mints, so only a write can show whether the
 * swapped-in file keeps the origin. Most pass the host id too, and hand
 * `swapIn` a carry that reads it through the same seams. The cases that
 * run `rebuildAside` as the callers do leave the host id to this
 * machine's, since the carry it wires in reads that one.
 *
 * No case asserts what the filesystem does with inode numbers. Where a
 * case expects a mint, it reads the inodes to compute the reasons it
 * expects, and asserts the mint either way.
 *
 * Each failure point of the swap is failed through `swapIn`'s steps, and
 * the backup, the carry and the rename are failed for real as well. The
 * side record step runs only after a carry onto a minted store, so its
 * case mints one first.
 */
import type { SwapStep, SwapSteps } from './rebuild-aside.js';
import type { MintReason } from './store-identity.js';
import type { IdentityOutcome, StoreIdentitySeams, StoreMeta } from './store-meta.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
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
  SwapFailure,
  swapIn,
} from './rebuild-aside.js';
import { withSqliteStore } from './sqlite.js';
import { readStoreGeneration, writeStoreGeneration } from './store-generation.js';
import { carryStoreIdentity, readStoreMeta, settleStoreIdentity } from './store-meta.js';
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

/** What `act` threw, or null when it threw nothing. */
function thrownBy(act: () => unknown): unknown {
  try {
    act();
  } catch (error) {
    return error;
  }
  return null;
}

/** Identity seams naming a project with a root commit and counting ids and generations; `host`, when given, is the host id. */
function identitySeams(label: string, host?: string): StoreIdentitySeams {
  let minted = 0;
  let rotated = 0;
  return {
    ...(host === undefined
      ? {}
      : { readHostId: () => host }),
    readProject: () => ({ rootCommit: 'root-commit-1', remote: null }),
    newStoreId: () => `${label}-store-${String(++minted)}`,
    newGeneration: () => `${label}-generation-${String(++rotated)}`,
  };
}

/** Opens the store at `path` once to write, answering its `store_meta` row as the open left it. */
function writeOnce(path: string, seams: StoreIdentitySeams, create = false): StoreMeta {
  const meta = withSqliteStore(path, 'write', create, (db) => readStoreMeta(db), seams);
  if (meta === null) throw new Error(`the writing open of ${path} left no store_meta row`);
  return meta;
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

/** The `store_meta` row of the file at `path`, throwing when it holds none. */
function requiredMeta(path: string): StoreMeta {
  const meta = metaOf(path);
  if (meta === null) throw new Error(`${path} holds no store_meta row`);
  return meta;
}

/** Settles the identity of the store at `path` for one write, answering what the write decided. */
function settleOnce(path: string, seams: StoreIdentitySeams): IdentityOutcome {
  const db = new Database(path, { readwrite: true });
  try {
    return settleStoreIdentity(db, path, 'write', seams);
  } finally {
    db.close();
  }
}

/**
 * The reasons a write to the store at `path` mints for, given the row it
 * holds and the generation its side record holds: read off the file, so
 * the case asserts no inode number of its own.
 */
function expectedReasons(path: string, row: StoreMeta): MintReason[] {
  const stats = statSync(path, { bigint: true });
  const reasons: MintReason[] = [];
  if (stats.dev !== row.fileDev || stats.ino !== row.fileIno) reasons.push('file');
  if (row.generation !== null && row.generation !== readStoreGeneration(path)) reasons.push('generation');
  return reasons;
}

/** Adds one session row to the store at `path`, under a writing open. */
function addSession(path: string, seams: StoreIdentitySeams): void {
  withSqliteStore(path, 'write', false, (db) => db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)', [
    'after-swap',
    '{"sessionId":"after-swap"}',
  ]), seams);
}

describe('rebuildAside', () => {
  it('swaps the built file in over the store, and keeps every row of the original in the backup', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    plantFile(path, 2);
    const original = storeRows(path);

    const result = rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: (aside) => plantFile(aside, 5) });

    expect(result.backupPath).toBe(backupPath);
    expect(storeRows(backupPath)).toEqual(original);
    expect(original.tables.notes).toHaveLength(2);
    expect(storeRows(path)).not.toEqual(original);
    expect(storeRows(path).tables.notes).toHaveLength(5);
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

describe('swapIn and the store\'s identity', () => {
  it('keeps the store\'s origin on the first write after a swap', () => {
    const { path, parallelPath, backupPath } = casePaths();
    const seams = identitySeams('kept', 'host-a');
    const minted = writeOnce(path, seams, true);
    vacuumInto(path, parallelPath);

    swapIn(path, parallelPath, backupPath, { carry: (live, aside) => carryStoreIdentity(live, aside, seams) });
    const written = writeOnce(path, seams);

    expect(minted.storeId).toBe('kept-store-1');
    expect(written.storeId).toBe(minted.storeId);
    expect(written.mintedAt).toBe(minted.mintedAt);
    expect(written.generation).toBe('kept-generation-3');
    expect(readStoreGeneration(path)).toBe('kept-generation-3');
  });

  it('mints on the first write after the same swap with the carry left out, the control', () => {
    const { path, parallelPath, backupPath } = casePaths();
    const seams = identitySeams('uncarried', 'host-a');
    writeOnce(path, seams, true);
    vacuumInto(path, parallelPath);

    swapIn(path, parallelPath, backupPath, { carry: () => ({ action: 'no-row', spoiled: null }) });
    const reasons = expectedReasons(path, requiredMeta(path));
    const outcome = settleOnce(path, seams);

    expect(outcome).toEqual({ action: 'mint', storeId: 'uncarried-store-2', reasons });
  });

  it('keeps the origin through rebuildAside\'s own carry, which reads this machine\'s host id', () => {
    const { path, parallelPath, backupPath } = casePaths();
    const seams = identitySeams('default');
    const minted = writeOnce(path, seams, true);

    rebuildAside({ path, parallelPath, backupPath, dryRun: false, build: (aside) => vacuumInto(path, aside) });
    const written = writeOnce(path, seams);

    expect(written.storeId).toBe(minted.storeId);
    expect(written.storeId).toBe('default-store-1');
  });

  it('leaves a backup with an inode of its own, which the swapped-in store\'s writes never reach and which mints when renamed back', () => {
    const { path, parallelPath, backupPath } = casePaths();
    const seams = identitySeams('backup', 'host-a');
    const minted = writeOnce(path, seams, true);
    vacuumInto(path, parallelPath);
    const original = storeRows(path);

    swapIn(path, parallelPath, backupPath, { carry: (live, aside) => carryStoreIdentity(live, aside, seams) });
    addSession(path, seams);
    const backupRow = metaOf(backupPath);

    expect(storeRows(backupPath)).toEqual(original);
    expect(storeRows(path).tables.sessions).toHaveLength(1);
    expect(backupRow).toEqual(minted);

    renameSync(backupPath, path);
    const reasons = expectedReasons(path, requiredMeta(path));
    const outcome = settleOnce(path, seams);

    expect(reasons).toContain('generation');
    expect(outcome).toEqual({ action: 'mint', storeId: 'backup-store-2', reasons });
  });
});

describe('swapIn failure points', () => {
  /** A case with the store and a built parallel file planted, and what each holds. */
  function planted(): ReturnType<typeof casePaths> & { before: Buffer; built: ReturnType<typeof storeRows> } {
    const paths = casePaths();
    plantFile(paths.path, 2);
    plantFile(paths.parallelPath, 5);
    return { ...paths, before: readFileSync(paths.path), built: storeRows(paths.parallelPath) };
  }

  it('swaps with no step failing, the control: the store replaced and the backup kept', () => {
    const { dir, path, parallelPath, backupPath, before, built } = planted();

    swapIn(path, parallelPath, backupPath);

    expect(readFileSync(path).equals(before)).toBe(false);
    expect(storeRows(path)).toEqual(built);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.before-1.bak']);
  });

  /** A step that records it ran, then throws. */
  function failing(ran: SwapStep[], step: SwapStep): () => never {
    return () => {
      ran.push(step);
      throw new Error('planted failure');
    };
  }

  /** Steps that record each one run, the one named `failed` throwing. */
  function stepsFailing(failed: SwapStep, ran: SwapStep[]): Partial<SwapSteps> {
    const recorded: SwapSteps = {
      backup: (path, backupPath) => {
        ran.push('backup');
        vacuumInto(path, backupPath);
      },
      carry: (path, parallelPath) => {
        ran.push('carry');
        return carryStoreIdentity(path, parallelPath);
      },
      record: (path, generation) => {
        ran.push('record');
        writeStoreGeneration(path, generation);
      },
      rename: (parallelPath, path) => {
        ran.push('rename');
        renameSync(parallelPath, path);
      },
    };
    return { ...recorded, [failed]: failing(ran, failed) };
  }

  const failures: readonly [SwapStep, readonly SwapStep[]][] = [
    ['backup', ['backup']],
    ['carry', ['backup', 'carry']],
    ['rename', ['backup', 'carry', 'rename']],
  ];

  it.each(failures)('throws a SwapFailure naming both files when the %s step fails, keeping them and the store as they are', (
    step,
    expectedRan,
  ) => {
    const { dir, path, parallelPath, backupPath, before, built } = planted();
    const original = storeRows(path);
    const ran: SwapStep[] = [];

    const thrown = thrownBy(() => swapIn(path, parallelPath, backupPath, stepsFailing(step, ran)));

    expect(thrown).toBeInstanceOf(SwapFailure);
    expect(thrown).toBeInstanceOf(RebuildRefusal);
    const failure = thrown as SwapFailure;
    expect(failure.step).toBe(step);
    expect(failure.message).toContain('planted failure');
    expect(failure.message).toContain(`${path} was not replaced and is unchanged`);
    expect(failure.message).toContain(`The rebuilt store is left at ${parallelPath}`);
    expect(failure.message).toContain(backupPath);
    expect({ parallelPath: failure.parallelPath, backupPath: failure.backupPath }).toEqual({ parallelPath, backupPath });
    expect(ran).toEqual(expectedRan);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(storeRows(parallelPath)).toEqual(built);
    if (step === 'backup') {
      expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.aside-1']);
    } else {
      expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.aside-1', 'effort.sqlite.before-1.bak']);
      expect(storeRows(backupPath)).toEqual(original);
    }
  });

  it('throws a SwapFailure naming both files when the side record step fails after a carry, keeping them, the store and its side record as they are', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    const seams = identitySeams('record', 'host-a');
    const minted = writeOnce(path, seams, true);
    vacuumInto(path, parallelPath);
    const before = readFileSync(path);
    const ran: SwapStep[] = [];

    const thrown = thrownBy(() => swapIn(path, parallelPath, backupPath, {
      ...stepsFailing('record', ran),
      carry: (live, aside) => {
        ran.push('carry');
        return carryStoreIdentity(live, aside, seams);
      },
    }));
    const unchanged = readFileSync(path).equals(before);
    const recordGeneration = readStoreGeneration(path);
    const kept = writeOnce(path, seams);

    expect(thrown).toBeInstanceOf(SwapFailure);
    const failure = thrown as SwapFailure;
    expect(failure.step).toBe('record');
    expect(failure.message).toContain(`to the side record of ${path} failed (planted failure)`);
    expect(failure.message).toContain(`${path} was not replaced and is unchanged`);
    expect(failure.message).toContain(`The rebuilt store is left at ${parallelPath}`);
    expect(ran).toEqual(['backup', 'carry', 'record']);
    expect(requiredMeta(parallelPath).generation).toBe('record-generation-2');
    expect(unchanged).toBe(true);
    expect(recordGeneration).toBe(minted.generation);
    expect(kept.storeId).toBe(minted.storeId);
    expect(readdirSync(dir).sort()).toEqual([
      'effort.sqlite',
      'effort.sqlite.aside-1',
      'effort.sqlite.before-1.bak',
      'effort.sqlite.generation',
    ]);
  });

  it('mints on the first write after an interrupted rename, keeps that id on the second, and leaves the side record on a generation the live row lacks', () => {
    const { path, parallelPath, backupPath } = casePaths();
    const seams = identitySeams('interrupted', 'host-a');
    const minted = writeOnce(path, seams, true);
    vacuumInto(path, parallelPath);
    const interruptedRename = (): never => {
      throw new Error('planted failure');
    };

    const thrown = thrownBy(() => swapIn(path, parallelPath, backupPath, {
      carry: (live, aside) => carryStoreIdentity(live, aside, seams),
      rename: interruptedRename,
    }));
    const rowGeneration = requiredMeta(path).generation;
    const recordGeneration = readStoreGeneration(path);
    const first = writeOnce(path, seams);
    const second = writeOnce(path, seams);

    expect((thrown as SwapFailure).step).toBe('rename');
    expect(recordGeneration).not.toBeNull();
    expect(recordGeneration).not.toBe(rowGeneration);
    expect(first.storeId).not.toBe(minted.storeId);
    expect(second.storeId).toBe(first.storeId);
  });

  it('fails at the backup for real when its directory is missing, the store untouched and the built file kept', () => {
    const { dir, path, parallelPath } = casePaths();
    plantFile(path, 2);
    const before = readFileSync(path);
    const backupPath = join(dir, 'missing', 'effort.sqlite.bak');

    const thrown = thrownBy(() => rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: false,
      build: (aside) => plantFile(aside, 5),
    }));

    expect(thrown).toBeInstanceOf(SwapFailure);
    expect((thrown as SwapFailure).step).toBe('backup');
    expect((thrown as SwapFailure).message).toContain('unable to open database');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.aside-1']);
  });

  it('fails at the carry for real when the built file is no database, the store untouched and the whole backup kept', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    writeOnce(path, identitySeams('carried'), true);
    const before = readFileSync(path);
    const original = storeRows(path);

    const thrown = thrownBy(() => rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: false,
      build: (aside) => writeFileSync(aside, 'not a store at all, only text\n'.repeat(80)),
    }));

    expect(thrown).toBeInstanceOf(SwapFailure);
    expect((thrown as SwapFailure).step).toBe('carry');
    expect((thrown as SwapFailure).message).toContain('file is not a database');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(storeRows(backupPath)).toEqual(original);
    expect(readdirSync(dir).sort()).toEqual([
      'effort.sqlite',
      'effort.sqlite.aside-1',
      'effort.sqlite.before-1.bak',
      'effort.sqlite.generation',
    ]);
  });

  it('fails at the carry for real when the built path is a directory, which the carry opens on every answer, the store untouched and the whole backup kept', () => {
    const { dir, path, parallelPath, backupPath } = casePaths();
    plantFile(path, 2);
    const before = readFileSync(path);
    const original = storeRows(path);

    const thrown = thrownBy(() => rebuildAside({
      path,
      parallelPath,
      backupPath,
      dryRun: false,
      build: (aside) => mkdirSync(aside),
    }));

    expect(thrown).toBeInstanceOf(SwapFailure);
    expect((thrown as SwapFailure).step).toBe('carry');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(storeRows(backupPath)).toEqual(original);
    expect(existsSync(parallelPath)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', 'effort.sqlite.aside-1', 'effort.sqlite.before-1.bak']);
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
