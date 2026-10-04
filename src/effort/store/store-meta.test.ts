/**
 * `store-meta.ts` through the open every store call takes,
 * `withSqliteStore`: which opens mint the `store_meta` row, which keep
 * it, how every writing open rotates the generation in the row and the
 * side record, and which opens never touch either. Every store is a
 * real file under `tmpdir()`, so a copy, a restore and a rename are the
 * filesystem's own; the host id, the project and each generation are
 * injected, and no case reads this machine's host id or spawns git.
 */
import type { ProjectIdentity } from './store-identity.js';
import type { IdentityOutcome, StoreIdentitySeams, StoreMeta } from './store-meta.js';

import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import { vacuumInto } from './copy.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { swapIn } from './rebuild-aside.js';
import { withSqliteStore } from './sqlite.js';
import { readStoreGeneration, storeGenerationPath, writeStoreGeneration } from './store-generation.js';
import {
  carryStoreIdentity,
  fromStoredInteger,
  readStoreMeta,
  settleStoreIdentity,
  toStoredInteger,
} from './store-meta.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-store-meta-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const PROJECT: ProjectIdentity = { rootCommit: 'a1b2c3d4', remote: 'github.com/open-tomato/rafa' };

const NO_PROJECT: ProjectIdentity = { rootCommit: null, remote: null };

const MINTED_AT = new Date('2026-09-29T10:00:00.000Z');

/** Seams answering `hostId` and `project`, numbering each store id and generation and counting each call. */
function seamsOf(hostId = 'host-a', project: ProjectIdentity = PROJECT): {
  seams: StoreIdentitySeams;
  hostReads: () => number;
  projectReads: () => readonly string[];
} {
  let hostReads = 0;
  let minted = 0;
  let rotated = 0;
  const projectReads: string[] = [];
  const seams: StoreIdentitySeams = {
    readHostId: () => {
      hostReads += 1;
      return hostId;
    },
    readProject: (dir) => {
      projectReads.push(dir);
      return project;
    },
    newStoreId: () => {
      minted += 1;
      return `${hostId}-store-${String(minted)}`;
    },
    newGeneration: () => {
      rotated += 1;
      return `gen-${String(rotated)}`;
    },
    now: () => MINTED_AT,
  };
  return { seams, hostReads: () => hostReads, projectReads: () => projectReads };
}

/** A store path in a fresh directory of its own, not yet created. */
function freshPath(name: string): string {
  return join(realpathSync(mkdtempSync(join(scope, `${name}-`))), 'effort.sqlite');
}

/** Opens `path` with `access` through `withSqliteStore`, answering its `store_meta` row as the open left it. */
function openAs(path: string, access: 'read' | 'write', seams: StoreIdentitySeams, create = false): StoreMeta | null {
  return withSqliteStore(path, access, create, (db) => readStoreMeta(db), seams);
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

/** Settles the identity of the store at `path` for one writing open of `seams` on a connection of its own, answering what it did. */
function settleWrite(path: string, seams: StoreIdentitySeams): IdentityOutcome {
  const db = new Database(path, { readwrite: true });
  try {
    return settleStoreIdentity(db, path, 'write', seams);
  } finally {
    db.close();
  }
}

/** Where a planted row says its store file was and which file it was. */
interface PlantedFile {
  readonly storePath: string;
  readonly fileDev: bigint;
  readonly fileIno: bigint;
}

/**
 * A store `bringForward` left at `store-meta`, before the generation
 * column, holding one row minted on `host-a` for the file `fileOf`
 * answers (device 1 and inode 2 at its own path when absent): what a
 * read-only merge of an older store reads, and what an older runtime
 * left behind.
 */
function storeBeforeGeneration(
  name: string,
  fileOf: (path: string) => PlantedFile = (path) => ({ storePath: path, fileDev: 1n, fileIno: 2n }),
): string {
  const path = freshPath(name);
  const through = SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'store-meta') + 1;
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations: SQLITE_MIGRATIONS.slice(0, through) });
    const file = fileOf(path);
    db.run('INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path,'
      + ' file_dev, file_ino, minted_at) VALUES (1, \'store-old\', \'a1b2\', NULL, \'host-a\', ?, ?, ?, ?)', [
      file.storePath,
      toStoredInteger(file.fileDev),
      toStoredInteger(file.fileIno),
      MINTED_AT.toISOString(),
    ]);
  } finally {
    db.close();
  }
  return path;
}

/** A store minted by one writing open of `seams`, and its row. */
function mintedStore(name: string, seams: StoreIdentitySeams): { path: string; meta: StoreMeta } {
  const path = freshPath(name);
  const meta = openAs(path, 'write', seams, true);
  if (meta === null) throw new Error(`${name}: the first write minted nothing`);
  return { path, meta };
}

describe('a writing open of withSqliteStore', () => {
  it('mints on the first write to a fresh store, recording the store id, project, host, real path, device, inode, time and generation', () => {
    const { seams, projectReads } = seamsOf();
    const path = freshPath('first-write');

    const meta = openAs(path, 'write', seams, true);

    const stats = statSync(path, { bigint: true });
    expect(meta).toEqual({
      storeId: 'host-a-store-1',
      projectRootCommit: 'a1b2c3d4',
      projectRemote: 'github.com/open-tomato/rafa',
      hostId: 'host-a',
      storePath: realpathSync(path),
      fileDev: stats.dev,
      fileIno: stats.ino,
      mintedAt: '2026-09-29T10:00:00.000Z',
      generation: 'gen-1',
    });
    expect(readStoreGeneration(path)).toBe('gen-1');
    expect(projectReads()).toEqual([realpathSync(join(path, '..'))]);
  });

  it('keeps the origin on a second write to the same file, rotating the generation in the row and the side record and asking git nothing', () => {
    const { seams, projectReads } = seamsOf();
    const { path, meta } = mintedStore('second-write', seams);

    const again = openAs(path, 'write', seams);

    expect(meta.generation).toBe('gen-1');
    expect(again).toEqual({ ...meta, generation: 'gen-2' });
    expect(readStoreGeneration(path)).toBe('gen-2');
    expect(projectReads()).toHaveLength(1);
  });

  it('mints a new origin in a copy at another path, and the original keeps its own', () => {
    const { seams } = seamsOf();
    const original = mintedStore('copy-original', seams);
    const copy = freshPath('copy-target');
    copyFileSync(original.path, copy);
    expect(metaOf(copy)?.storeId).toBe(original.meta.storeId);

    const copied = openAs(copy, 'write', seams);
    const kept = openAs(original.path, 'write', seams);

    expect(copied?.storeId).toBe('host-a-store-2');
    expect(copied?.storePath).toBe(realpathSync(copy));
    expect(readStoreGeneration(copy)).toBe(copied?.generation ?? 'none');
    expect(kept?.storeId).toBe(original.meta.storeId);
    expect(readStoreGeneration(original.path)).toBe(kept?.generation ?? 'none');
  });

  it('mints on a .bak renamed back over the store after a write, which has the path and host, a new inode and an older generation', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('bak-restore', seams);
    const backup = `${path}.bak`;
    copyFileSync(path, backup);
    openAs(path, 'write', seams);
    rmSync(path);
    renameSync(backup, path);
    expect(statSync(path, { bigint: true }).ino).not.toBe(meta.fileIno);
    expect([metaOf(path)?.generation, readStoreGeneration(path)]).toEqual(['gen-1', 'gen-2']);

    const restored = settleWrite(path, seams);

    expect(restored).toEqual({ action: 'mint', storeId: 'host-a-store-2', reasons: ['file', 'generation'] });
    expect(metaOf(path)?.storePath).toBe(meta.storePath);
    expect(readStoreGeneration(path)).toBe(metaOf(path)?.generation ?? 'none');
  });

  it('mints when another host opens the store for a write', () => {
    const { path, meta } = mintedStore('other-host', seamsOf('host-a').seams);

    const onHostB = openAs(path, 'write', seamsOf('host-b').seams);

    expect(meta.hostId).toBe('host-a');
    expect(onHostB?.storeId).toBe('host-b-store-1');
    expect(onHostB?.hostId).toBe('host-b');
  });

  it('keeps the origin of a store renamed away and back to its own path', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('rename-in-place', seams);
    const aside = join(scope, 'rename-in-place-aside.sqlite');
    renameSync(path, aside);
    renameSync(aside, path);

    expect(openAs(path, 'write', seams)).toEqual({ ...meta, generation: 'gen-2' });
  });

  it('keeps the id of a store written without a generation on its first write, and holds one in the row and the side record after it', () => {
    const { seams } = seamsOf();
    const path = storeBeforeGeneration('no-generation', (planted) => {
      const stats = statSync(planted, { bigint: true });
      return { storePath: planted, fileDev: stats.dev, fileIno: stats.ino };
    });
    expect(existsSync(storeGenerationPath(path))).toBe(false);

    const first = openAs(path, 'write', seams);
    const second = openAs(path, 'write', seams);

    expect([first?.storeId, first?.generation]).toEqual(['store-old', 'gen-1']);
    expect([second?.storeId, second?.generation]).toEqual(['store-old', 'gen-2']);
    expect(readStoreGeneration(path)).toBe('gen-2');
  });

  it.each([
    ['behind the row, as a side record restored from before the last write leaves it', 'gen-1'],
    ['ahead of the row, as a crash between the side record\'s rename and the row\'s commit leaves it', 'gen-ahead'],
  ] as const)('mints once on a side record one rotation %s, and keeps on the write after', (_title, side) => {
    const { seams } = seamsOf();
    const { path } = mintedStore('one-rotation', seams);
    openAs(path, 'write', seams);
    writeStoreGeneration(path, side);
    expect(metaOf(path)?.generation).toBe('gen-2');

    const outcomes = [settleWrite(path, seams), settleWrite(path, seams)];

    expect(outcomes).toEqual([
      { action: 'mint', storeId: 'host-a-store-2', reasons: ['generation'] },
      { action: 'keep', storeId: 'host-a-store-2' },
    ]);
    expect(readStoreGeneration(path)).toBe(metaOf(path)?.generation ?? 'none');
  });

  it('keeps the project the copy recorded when git in its new directory finds no root commit', () => {
    const original = mintedStore('project-kept', seamsOf().seams);
    const copy = freshPath('project-kept-copy');
    copyFileSync(original.path, copy);

    const copied = openAs(copy, 'write', { ...seamsOf('host-a', NO_PROJECT).seams, newStoreId: () => 'copy-store' });

    expect(copied?.storeId).toBe('copy-store');
    expect(copied?.projectRootCommit).toBe('a1b2c3d4');
    expect(copied?.projectRemote).toBe('github.com/open-tomato/rafa');
  });

  it('writes nothing to a store no project names, and mints on the write that finds one, the control', () => {
    const path = freshPath('no-project');

    const without = openAs(path, 'write', seamsOf('host-a', NO_PROJECT).seams, true);
    const withProject = openAs(path, 'write', seamsOf().seams);

    expect(without).toBeNull();
    expect(withProject?.storeId).toBe('host-a-store-1');
  });
});

describe('a reading open of withSqliteStore', () => {
  it('never writes store_meta: an unminted store keeps its bytes, and a write open over it, the control, changes them', () => {
    const counted = seamsOf();
    const path = freshPath('read-unminted');
    openAs(path, 'read', counted.seams, true);
    const before = readFileSync(path);

    const read = openAs(path, 'read', counted.seams);

    expect(read).toBeNull();
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(counted.hostReads()).toBe(0);
    expect(counted.projectReads()).toEqual([]);

    const written = openAs(path, 'write', counted.seams);
    expect(written?.storeId).toBe('host-a-store-1');
    expect(readFileSync(path).equals(before)).toBe(false);
  });

  it('writes no side record and rotates no generation, while a write open, the control, does both', () => {
    const { seams } = seamsOf();
    const path = freshPath('read-side-record');
    openAs(path, 'read', seams, true);
    const unmintedRead = existsSync(storeGenerationPath(path));
    const written = openAs(path, 'write', seams);

    const read = openAs(path, 'read', seams);

    expect(unmintedRead).toBe(false);
    expect(written?.generation).toBe('gen-1');
    expect(read?.generation).toBe('gen-1');
    expect(readStoreGeneration(path)).toBe('gen-1');
  });

  it('never mints a copy it only reads, while a write open of the same copy does', () => {
    const { seams } = seamsOf();
    const original = mintedStore('read-copy', seams);
    const copy = freshPath('read-copy-target');
    copyFileSync(original.path, copy);
    const before = readFileSync(copy);

    expect(openAs(copy, 'read', seams)).toEqual(original.meta);
    expect(readFileSync(copy).equals(before)).toBe(true);
    expect(openAs(copy, 'write', seams)?.storeId).not.toBe(original.meta.storeId);
  });
});

describe('settleStoreIdentity', () => {
  it('answers what it did: none on a read, mint with its reasons, then keep', () => {
    const { seams } = seamsOf();
    const path = freshPath('outcomes');
    openAs(path, 'read', seams, true);
    const db = new Database(path, { readwrite: true });
    try {
      const outcomes: IdentityOutcome[] = [
        settleStoreIdentity(db, path, 'read', seams),
        settleStoreIdentity(db, path, 'write', seams),
        settleStoreIdentity(db, path, 'write', seams),
      ];

      expect(outcomes).toEqual([
        { action: 'none' },
        { action: 'mint', storeId: 'host-a-store-1', reasons: ['unminted'] },
        { action: 'keep', storeId: 'host-a-store-1' },
      ]);
    } finally {
      db.close();
    }
  });

  it('answers no-project with the reasons it was due, writing nothing', () => {
    const { seams } = seamsOf('host-a', NO_PROJECT);
    const path = freshPath('outcome-no-project');
    openAs(path, 'read', seams, true);
    const before = readFileSync(path);
    const db = new Database(path, { readwrite: true });
    try {
      expect(settleStoreIdentity(db, path, 'write', seams)).toEqual({ action: 'no-project', reasons: ['unminted'] });
    } finally {
      db.close();
    }
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(existsSync(storeGenerationPath(path))).toBe(false);
  });

  it('decides again under the lock, so a store another open minted meanwhile keeps that origin', () => {
    const path = freshPath('race');
    openAs(path, 'read', seamsOf().seams, true);
    const other = seamsOf('host-a').seams;
    const racing: StoreIdentitySeams = {
      ...seamsOf('host-a').seams,
      newStoreId: () => 'loser',
      // Between this open's first decision and its lock, another connection mints the same file.
      readProject: () => {
        const rival = new Database(path, { readwrite: true });
        try {
          settleStoreIdentity(rival, path, 'write', other);
        } finally {
          rival.close();
        }
        return PROJECT;
      },
    };
    const db = new Database(path, { readwrite: true });
    try {
      expect(settleStoreIdentity(db, path, 'write', racing)).toEqual({ action: 'keep', storeId: 'host-a-store-1' });
    } finally {
      db.close();
    }
    expect(metaOf(path)?.storeId).toBe('host-a-store-1');
  });
});

describe('readStoreMeta and the generation column', () => {
  it('answers a null generation for a store whose row predates the column, without throwing', () => {
    const path = storeBeforeGeneration('no-column');

    expect(metaOf(path)).toMatchObject({ storeId: 'store-old', fileDev: 1n, fileIno: 2n, generation: null });
  });

  it('control: the store held before the column has no generation to select', () => {
    const db = new Database(storeBeforeGeneration('no-column-control'), { readonly: true });
    try {
      expect(() => db.query('SELECT generation FROM store_meta').get()).toThrow('no such column: generation');
    } finally {
      db.close();
    }
  });

  it('answers the generation the column holds', () => {
    const { seams } = seamsOf();
    const { path } = mintedStore('filled-column', seams);
    const db = new Database(path, { readwrite: true });
    try {
      db.run('UPDATE store_meta SET generation = \'gen-1\' WHERE id = 1');
    } finally {
      db.close();
    }

    expect(metaOf(path)?.generation).toBe('gen-1');
  });
});

describe('device and inode as SQLite integers', () => {
  it('reads back every unsigned 64-bit value it wrote, those past 2^63 included', () => {
    const db = new Database(':memory:');
    try {
      db.run('CREATE TABLE probe (v INTEGER NOT NULL CHECK (typeof(v) = \'integer\'))');
      const values = [0n, 42n, 2n ** 53n + 1n, 2n ** 63n - 1n, 2n ** 63n, 2n ** 64n - 1n];
      const insert = db.query('INSERT INTO probe (v) VALUES (?)');
      for (const value of values) insert.run(toStoredInteger(value));

      const read = db.query<{ v: string }, []>('SELECT CAST(v AS TEXT) AS v FROM probe ORDER BY rowid').all();

      expect(read.map(({ v }) => fromStoredInteger(v))).toEqual(values);
    } finally {
      db.close();
    }
  });

  it('would read 2^63 back as a negative without the unsigned turn, the control', () => {
    const db = new Database(':memory:');
    try {
      db.run('CREATE TABLE probe (v INTEGER)');
      db.query('INSERT INTO probe (v) VALUES (?)').run(toStoredInteger(2n ** 63n));

      const read = db.query<{ v: string }, []>('SELECT CAST(v AS TEXT) AS v FROM probe').get();

      expect(BigInt(read?.v ?? '0')).toBe(-(2n ** 63n));
    } finally {
      db.close();
    }
  });
});

/** The `VACUUM INTO` copy of the store at `path` beside it, as a rebuild writes its parallel file. */
function parallelOf(path: string): string {
  const parallel = `${path}.parallel`;
  vacuumInto(path, parallel);
  return parallel;
}

/** Renames the store at `path` aside and `parallel` into its place, answering where the store went. */
function swapOver(path: string, parallel: string): string {
  const aside = `${path}.swapped-out`;
  renameSync(path, aside);
  renameSync(parallel, path);
  return aside;
}

/** Runs one `store_meta` update on the file at `path`, on a connection of its own and outside any open. */
function editRow(path: string, sql: string, value: string | bigint): void {
  const db = new Database(path, { readwrite: true });
  try {
    db.query(sql).run(value);
  } finally {
    db.close();
  }
}

describe('carryStoreIdentity', () => {
  it('writes nothing when the live file holds no store_meta table', () => {
    const path = freshPath('carry-no-table');
    const plain = new Database(path, { create: true, readwrite: true });
    try {
      plain.run('CREATE TABLE notes (body TEXT NOT NULL)');
    } finally {
      plain.close();
    }
    const parallel = parallelOf(path);
    const before = readFileSync(parallel);

    expect(carryStoreIdentity(path, parallel, seamsOf().seams)).toEqual({ action: 'no-table', spoiled: null });
    expect(readFileSync(parallel).equals(before)).toBe(true);
  });

  it('writes nothing when the live store_meta holds no row, an unminted store', () => {
    const { seams } = seamsOf('host-a', NO_PROJECT);
    const path = freshPath('carry-no-row');
    expect(openAs(path, 'write', seams, true)).toBeNull();
    const parallel = parallelOf(path);
    const before = readFileSync(parallel);

    expect(carryStoreIdentity(path, parallel, seams)).toEqual({ action: 'no-row', spoiled: null });
    expect(readFileSync(parallel).equals(before)).toBe(true);
    expect(metaOf(parallel)).toBeNull();
  });

  it('records the parallel file\'s own device and inode and a new generation when a live write would keep, answering that generation', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-keep', seams);
    const parallel = parallelOf(path);
    const own = statSync(parallel, { bigint: true });

    const outcome = carryStoreIdentity(path, parallel, seams);

    expect(meta.generation).toBe('gen-1');
    expect(outcome).toEqual({ action: 'carried', storeId: meta.storeId, generation: 'gen-2' });
    expect(metaOf(parallel)).toEqual({ ...meta, fileDev: own.dev, fileIno: own.ino, generation: 'gen-2' });
  });

  it('writes the new generation over the one the parallel row held, and leaves the live row and side record as they were', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-generation-source', seams);
    const parallel = parallelOf(path);
    editRow(parallel, 'UPDATE store_meta SET generation = ? WHERE id = 1', 'gen-parallel');

    carryStoreIdentity(path, parallel, seams);

    expect(metaOf(parallel)?.generation).toBe('gen-2');
    expect(metaOf(path)).toEqual(meta);
    expect(readStoreGeneration(path)).toBe('gen-1');
  });

  it('records device and inode alone onto a parallel file with no generation column, answering a null generation and writing no side record', () => {
    const { seams } = seamsOf();
    const path = storeBeforeGeneration('carry-no-column', (planted) => {
      const stats = statSync(planted, { bigint: true });
      return { storePath: planted, fileDev: stats.dev, fileIno: stats.ino };
    });
    const meta = metaOf(path);
    const parallel = parallelOf(path);
    const own = statSync(parallel, { bigint: true });

    const outcome = carryStoreIdentity(path, parallel, seams);

    expect(outcome).toEqual({ action: 'carried', storeId: 'store-old', generation: null });
    expect(metaOf(parallel)).toEqual({ ...meta, fileDev: own.dev, fileIno: own.ino, generation: null });
    expect(existsSync(storeGenerationPath(path))).toBe(false);
  });

  it('keeps the origin on the first write after the carried generation is written to the side record and the file renamed over the store', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-swap', seams);
    const parallel = parallelOf(path);
    const outcome = carryStoreIdentity(path, parallel, seams);
    if (outcome.action !== 'carried' || outcome.generation === null) throw new Error('carry-swap: nothing carried');
    writeStoreGeneration(path, outcome.generation);
    swapOver(path, parallel);

    expect(settleWrite(path, seams)).toEqual({ action: 'keep', storeId: meta.storeId });
    expect(metaOf(path)?.fileIno).toBe(statSync(path, { bigint: true }).ino);
  });

  it('mints for the generation on the first write after the carried file is renamed over the store with the side record left as it was, the control', () => {
    const { seams } = seamsOf();
    const { path } = mintedStore('carry-swap-no-record', seams);
    const parallel = parallelOf(path);
    carryStoreIdentity(path, parallel, seams);
    swapOver(path, parallel);

    expect(settleWrite(path, seams)).toEqual({ action: 'mint', storeId: 'host-a-store-2', reasons: ['generation'] });
  });

  it('mints for the generation on the first write after the replaced file is renamed back over the swapped-in store', () => {
    const { seams } = seamsOf();
    const { path } = mintedStore('carry-replaced-back', seams);
    const parallel = parallelOf(path);
    const outcome = carryStoreIdentity(path, parallel, seams);
    if (outcome.action !== 'carried' || outcome.generation === null) throw new Error('carry-replaced-back: nothing carried');
    writeStoreGeneration(path, outcome.generation);
    const aside = swapOver(path, parallel);
    renameSync(aside, path);

    expect(settleWrite(path, seams)).toEqual({ action: 'mint', storeId: 'host-a-store-2', reasons: ['generation'] });
  });

  it('mints on the first write after the same swap without the carry, the control', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-swap-control', seams);
    const parallel = parallelOf(path);
    const aside = swapOver(path, parallel);
    const sameFile = statSync(aside, { bigint: true }).ino === statSync(path, { bigint: true }).ino;
    const reasons = sameFile
      ? []
      : ['file'];

    expect(meta.storeId).toBe('host-a-store-1');
    expect(settleWrite(path, seams)).toEqual({ action: 'mint', storeId: 'host-a-store-2', reasons });
  });

  it('mints on the first write after the backup of a swap is renamed back with no write between, with the reasons the inode numbers give', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-backup-renamed-back', seams);
    const parallel = parallelOf(path);
    const backup = `${path}.bak`;
    swapIn(path, parallel, backup);
    renameSync(backup, path);
    const reasons = statSync(path, { bigint: true }).ino === meta.fileIno
      ? []
      : ['file'];

    const outcome = settleWrite(path, seams);

    expect(meta.storeId).toBe('host-a-store-1');
    expect(outcome).toEqual({ action: 'mint', storeId: 'host-a-store-2', reasons });
    expect(metaOf(path)?.storeId).toBe('host-a-store-2');
  });

  it('writes only a fresh generation into the parallel row when the live row names another inode, and the swapped-in file mints', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-other-inode', seams);
    editRow(path, 'UPDATE store_meta SET file_ino = ? WHERE id = 1', toStoredInteger(meta.fileIno + 1n));
    const parallel = parallelOf(path);
    const before = metaOf(parallel);

    expect(carryStoreIdentity(path, parallel, seams)).toEqual({ action: 'mint', reasons: ['file'], spoiled: 'gen-2' });
    expect(metaOf(parallel)).toEqual({ ...before, generation: 'gen-2' });
    expect(readStoreGeneration(path)).toBe('gen-1');

    swapOver(path, parallel);
    expect(settleWrite(path, seams)).toMatchObject({ action: 'mint', storeId: 'host-a-store-2' });
  });

  it('writes only a fresh generation into the parallel row when the live row names another path', () => {
    const { seams } = seamsOf();
    const { path } = mintedStore('carry-other-path', seams);
    editRow(path, 'UPDATE store_meta SET store_path = ? WHERE id = 1', join(scope, 'elsewhere', 'effort.sqlite'));
    const parallel = parallelOf(path);
    const before = metaOf(parallel);

    expect(carryStoreIdentity(path, parallel, seams)).toEqual({ action: 'mint', reasons: ['path'], spoiled: 'gen-2' });
    expect(metaOf(parallel)).toEqual({ ...before, generation: 'gen-2' });
  });

  it('writes only a fresh generation into the parallel row when the live row holds a generation its side record does not', () => {
    const { seams } = seamsOf();
    const { path } = mintedStore('carry-other-generation', seams);
    writeStoreGeneration(path, 'gen-elsewhere');
    const parallel = parallelOf(path);
    const before = metaOf(parallel);

    expect(carryStoreIdentity(path, parallel, seams))
      .toEqual({ action: 'mint', reasons: ['generation'], spoiled: 'gen-2' });
    expect(metaOf(parallel)).toEqual({ ...before, generation: 'gen-2' });
    expect(readStoreGeneration(path)).toBe('gen-elsewhere');
  });

  it('writes only a fresh generation into the parallel row when the live store was minted on another host', () => {
    const { path } = mintedStore('carry-other-host', seamsOf('host-a').seams);
    const parallel = parallelOf(path);
    const before = metaOf(parallel);

    expect(carryStoreIdentity(path, parallel, seamsOf('host-b').seams))
      .toEqual({ action: 'mint', reasons: ['host'], spoiled: 'gen-1' });
    expect(metaOf(parallel)).toEqual({ ...before, generation: 'gen-1' });
  });

  it('writes only a fresh generation into a parallel row of another id, and nothing to the side record', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-other-row', seams);
    const parallel = parallelOf(path);
    editRow(parallel, 'UPDATE store_meta SET store_id = ? WHERE id = 1', 'another-store');
    const before = metaOf(parallel);

    expect(carryStoreIdentity(path, parallel, seams)).toEqual({ action: 'other-row', spoiled: 'gen-2' });
    expect(metaOf(parallel)).toEqual({ ...before, generation: 'gen-2' });
    expect(before?.generation).toBe('gen-1');
    expect(metaOf(path)).toEqual(meta);
    expect(readStoreGeneration(path)).toBe('gen-1');
  });

  it('writes a random UUID, never a null, as the fresh generation when no generation seam is given', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-random-generation', seams);
    editRow(path, 'UPDATE store_meta SET file_ino = ? WHERE id = 1', toStoredInteger(meta.fileIno + 1n));
    const parallel = parallelOf(path);

    const outcome = carryStoreIdentity(path, parallel, { readHostId: () => 'host-a' });
    const written = metaOf(parallel)?.generation;

    expect(outcome).toEqual({ action: 'mint', reasons: ['file'], spoiled: written });
    expect(written).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(written).not.toBe(meta.generation);
  });

  it('mints on the first write after a swap whose parallel row names the file it lands on, when a live write would mint', () => {
    const { seams } = seamsOf();
    const { path } = mintedStore('carry-mint-reuse', seams);
    const parallel = parallelOf(path);
    const landing = statSync(parallel, { bigint: true });
    editRow(path, 'UPDATE store_meta SET file_ino = ? WHERE id = 1', toStoredInteger(landing.ino));
    editRow(parallel, 'UPDATE store_meta SET file_ino = ? WHERE id = 1', toStoredInteger(landing.ino));

    const outcome = carryStoreIdentity(path, parallel, seams);
    swapOver(path, parallel);
    const landed = metaOf(path)?.fileIno;

    expect(settleWrite(path, seams)).toEqual({ action: 'mint', storeId: 'host-a-store-2', reasons: ['generation'] });
    expect(landed).toBe(statSync(path, { bigint: true }).ino);
    expect(outcome).toEqual({ action: 'mint', reasons: ['file'], spoiled: 'gen-2' });
  });

  it('keeps the origin on the first write after the same swap with the spoiled generation put back, the control', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('carry-mint-reuse-control', seams);
    const parallel = parallelOf(path);
    const landing = statSync(parallel, { bigint: true });
    editRow(path, 'UPDATE store_meta SET file_ino = ? WHERE id = 1', toStoredInteger(landing.ino));
    editRow(parallel, 'UPDATE store_meta SET file_ino = ? WHERE id = 1', toStoredInteger(landing.ino));

    carryStoreIdentity(path, parallel, seams);
    editRow(parallel, 'UPDATE store_meta SET generation = ? WHERE id = 1', 'gen-1');
    swapOver(path, parallel);

    expect(readStoreGeneration(path)).toBe('gen-1');
    expect(settleWrite(path, seams)).toEqual({ action: 'keep', storeId: meta.storeId });
  });

  it('writes nothing into a parallel file with no generation column when a live write would mint, answering a null spoiled', () => {
    const { seams } = seamsOf();
    const path = storeBeforeGeneration('carry-mint-no-column');
    const parallel = parallelOf(path);
    const before = readFileSync(parallel);
    let generations = 0;
    const counting: StoreIdentitySeams = {
      ...seams,
      newGeneration: () => {
        generations += 1;
        return 'gen-unused';
      },
    };

    expect(carryStoreIdentity(path, parallel, counting)).toEqual({ action: 'mint', reasons: ['file'], spoiled: null });
    expect(readFileSync(parallel).equals(before)).toBe(true);
    expect(metaOf(parallel)?.generation).toBeNull();
    expect(generations).toBe(0);
    expect(existsSync(storeGenerationPath(path))).toBe(false);
  });

  it('writes nothing into a parallel row of another id with no generation column, answering a null spoiled', () => {
    const { seams } = seamsOf();
    const path = storeBeforeGeneration('carry-other-row-no-column', (planted) => {
      const stats = statSync(planted, { bigint: true });
      return { storePath: planted, fileDev: stats.dev, fileIno: stats.ino };
    });
    const parallel = parallelOf(path);
    editRow(parallel, 'UPDATE store_meta SET store_id = ? WHERE id = 1', 'another-store');
    const before = readFileSync(parallel);

    expect(carryStoreIdentity(path, parallel, seams)).toEqual({ action: 'other-row', spoiled: null });
    expect(readFileSync(parallel).equals(before)).toBe(true);
  });

  it('throws the filesystem\'s error naming a parallel file that is not there', () => {
    const { seams } = seamsOf();
    const { path } = mintedStore('carry-missing', seams);
    const missing = `${path}.parallel`;

    expect(existsSync(missing)).toBe(false);
    expect(() => carryStoreIdentity(path, missing, seams)).toThrow(missing);
  });
});
