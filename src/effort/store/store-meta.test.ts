/**
 * `store-meta.ts` through the open every store call takes,
 * `withSqliteStore`: which opens write the `store_meta` row, which keep
 * it and which never touch it. Every store is a real file under
 * `tmpdir()`, so a copy, a restore and a rename are the filesystem's
 * own; the host id and the project are injected, and no case reads
 * this machine's host id or spawns git.
 */
import type { ProjectIdentity } from './store-identity.js';
import type { IdentityOutcome, StoreIdentitySeams, StoreMeta } from './store-meta.js';

import { copyFileSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { withSqliteStore } from './sqlite.js';
import {
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

/** Seams answering `hostId` and `project`, numbering each store id and counting each call. */
function seamsOf(hostId = 'host-a', project: ProjectIdentity = PROJECT): {
  seams: StoreIdentitySeams;
  hostReads: () => number;
  projectReads: () => readonly string[];
} {
  let hostReads = 0;
  let minted = 0;
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

/** A store minted by one writing open of `seams`, and its row. */
function mintedStore(name: string, seams: StoreIdentitySeams): { path: string; meta: StoreMeta } {
  const path = freshPath(name);
  const meta = openAs(path, 'write', seams, true);
  if (meta === null) throw new Error(`${name}: the first write minted nothing`);
  return { path, meta };
}

describe('a writing open of withSqliteStore', () => {
  it('mints on the first write to a fresh store, recording the store id, project, host, real path, device, inode and time', () => {
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
    });
    expect(projectReads()).toEqual([realpathSync(join(path, '..'))]);
  });

  it('keeps the origin on a second write to the same file, writing no byte and asking git nothing', () => {
    const { seams, projectReads } = seamsOf();
    const { path, meta } = mintedStore('second-write', seams);
    const before = readFileSync(path);

    const again = openAs(path, 'write', seams);

    expect(again).toEqual(meta);
    expect(readFileSync(path).equals(before)).toBe(true);
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
    expect(kept).toEqual(original.meta);
  });

  it('mints on a .bak renamed back over the store, which has the path and host and a new inode', () => {
    const { seams } = seamsOf();
    const { path, meta } = mintedStore('bak-restore', seams);
    const backup = `${path}.bak`;
    copyFileSync(path, backup);
    rmSync(path);
    renameSync(backup, path);
    expect(statSync(path, { bigint: true }).ino).not.toBe(meta.fileIno);

    const restored = openAs(path, 'write', seams);

    expect(restored?.storeId).toBe('host-a-store-2');
    expect(restored?.storePath).toBe(meta.storePath);
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

    expect(openAs(path, 'write', seams)).toEqual(meta);
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
