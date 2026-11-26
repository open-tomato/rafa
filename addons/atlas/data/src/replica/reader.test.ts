/**
 * Tests for `reader.ts`, in a tmpdir: a reader opened before a second
 * build answers the new rows, keeps its open file while nothing changed,
 * and refuses as `ReplicaUnavailable` a missing replica, one stamped with
 * another contract major and one of another replica version.
 */
import type { WriteReplicaOptions, WriteReplicaResult } from './writer.js';
import type { Database } from 'bun:sqlite';

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ReplicaUnavailable } from '../contract/errors.js';
import { ATLAS_CONTRACT_VERSION } from '../contract/version.js';

import { META_KEYS, REPLICA_VERSION } from './ddl.js';
import { openReplica } from './reader.js';
import { writeReplica } from './writer.js';

/** The contract major this reader speaks, plus one. */
const OTHER_MAJOR = `${String(Number(ATLAS_CONTRACT_VERSION.split('.')[0]) + 1)}.0.0`;

let dir = '';
let replicaPath = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-replica-reader-'));
  replicaPath = join(dir, 'atlas', 'atlas.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Build a replica whose `task_facts` holds one task row per session id. */
function buildWithSessions(
  sessionIds: readonly string[],
  options: Partial<WriteReplicaOptions> = {},
): Promise<WriteReplicaResult<number>> {
  return writeReplica({ replicaPath, projectLabel: 'fixture', ...options }, (build) => {
    const insert = build.database.prepare('INSERT INTO task_facts (session_id, kind) VALUES (?, ?)');
    for (const id of sessionIds) insert.run(id, 'task');
    return sessionIds.length;
  });
}

function sessionsIn(database: Database): string[] {
  return database
    .query<{ readonly session_id: string }, []>('SELECT session_id FROM task_facts ORDER BY session_id')
    .all()
    .map((row) => row.session_id);
}

/** The rows a stale handle answers, or the code SQLite refused it with. */
function staleReading(database: Database): string[] | string {
  try {
    return sessionsIn(database);
  } catch (error: unknown) {
    return String((error as Error & { readonly code?: unknown }).code);
  }
}

describe('openReplica over a rebuilt replica', () => {
  it('answers the rows of a second build to a reader opened before it', async () => {
    await buildWithSessions(['s1'], { buildId: 'first' });
    const reader = openReplica(replicaPath);
    const before = reader.current();
    expect(sessionsIn(before.database)).toEqual(['s1']);

    await buildWithSessions(['s1', 's2', 's3'], { buildId: 'second' });
    const after = reader.current();

    expect(sessionsIn(after.database)).toEqual(['s1', 's2', 's3']);
    expect(after.meta.buildId).toBe('second');
    reader.close();
  });

  it('control: the file it held before the rename does not answer the second build', async () => {
    await buildWithSessions(['s1'], { buildId: 'first' });
    const reader = openReplica(replicaPath);
    const held = reader.current().database;

    await buildWithSessions(['s1', 's2'], { buildId: 'second' });

    // A reader that never reopened would read this handle: it answers the
    // first build's rows, or SQLite refuses it as a file moved (macOS), and
    // never the second build's rows, so the test above could have failed.
    expect(staleReading(held)).not.toEqual(['s1', 's2']);
    expect(reader.current().database).not.toBe(held);
    reader.close();
  });

  it('keeps the same open file while the replica has not changed', async () => {
    await buildWithSessions(['s1']);
    const reader = openReplica(replicaPath);

    expect(reader.current().database).toBe(reader.current().database);
    reader.close();
  });

  it('answers the source stamps of the build it holds', async () => {
    await writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
      build.stampSource({ source: 'effort', asOf: null, readAt: '2026-11-20T10:00:00Z', rows: 0, partial: true, reason: 'no sessions' });
    });
    const reader = openReplica(replicaPath);

    expect(reader.current().sources.get('effort')?.reason).toBe('no sessions');
    reader.close();
  });
});

describe('ReplicaReader.read', () => {
  it('answers the rows of one whole build when the replica is renamed over mid-read', async () => {
    await buildWithSessions(['s1']);
    const next = join(dir, 'next.sqlite');
    await writeReplica({ replicaPath: next, projectLabel: 'fixture' }, (build) => {
      build.database.run('INSERT INTO task_facts (session_id, kind) VALUES (?, ?), (?, ?)', ['s1', 'task', 's2', 'task']);
    });
    const reader = openReplica(replicaPath);
    reader.current();
    let runs = 0;

    const rows = reader.read((replica) => {
      runs += 1;
      if (runs === 1) renameSync(next, replicaPath);
      return sessionsIn(replica.database);
    });

    // macOS refuses the first run as a file moved, so the second run reads the
    // new build; elsewhere the first run may finish on the file it opened.
    expect([['s1'], ['s1', 's2']]).toContainEqual(rows);
    expect(runs === 2
      ? ['s1', 's2']
      : ['s1']).toEqual(rows);
    reader.close();
  });

  it('runs once and rethrows any other error', async () => {
    await buildWithSessions(['s1']);
    const reader = openReplica(replicaPath);
    let runs = 0;

    expect(() => reader.read((replica) => {
      runs += 1;
      return replica.database.query('SELECT * FROM no_such_table').all();
    })).toThrow('no such table');
    expect(runs).toBe(1);
    reader.close();
  });
});

describe('openReplica, refused as ReplicaUnavailable', () => {
  it('refuses a path with no replica, when opened', () => {
    expect(() => openReplica(replicaPath)).toThrow(ReplicaUnavailable);
  });

  it('refuses a replica stamped with another contract major', async () => {
    await buildWithSessions(['s1'], { contractVersion: OTHER_MAJOR });

    expect(() => openReplica(replicaPath)).toThrow(ReplicaUnavailable);
    expect(() => openReplica(replicaPath)).toThrow(`speaks contract ${OTHER_MAJOR}`);
  });

  it('control: opens a replica of the same major and another minor', async () => {
    const [major] = ATLAS_CONTRACT_VERSION.split('.');
    await buildWithSessions(['s1'], { contractVersion: `${major ?? ''}.99.7` });
    const reader = openReplica(replicaPath);

    expect(reader.current().meta.contractVersion).toBe(`${major ?? ''}.99.7`);
    reader.close();
  });

  it('refuses on the next call a rebuild of another major under a reader already open', async () => {
    await buildWithSessions(['s1']);
    const reader = openReplica(replicaPath);

    await buildWithSessions(['s1'], { contractVersion: OTHER_MAJOR });

    expect(() => reader.current()).toThrow(ReplicaUnavailable);
    reader.close();
  });

  it('opens again once a good build replaces a refused one', async () => {
    await buildWithSessions(['s1']);
    const reader = openReplica(replicaPath);
    await buildWithSessions(['s1'], { contractVersion: OTHER_MAJOR });
    expect(() => reader.current()).toThrow(ReplicaUnavailable);

    await buildWithSessions(['s1', 's2']);

    expect(sessionsIn(reader.current().database)).toEqual(['s1', 's2']);
    reader.close();
  });

  it('refuses a replica of another replica version', async () => {
    await writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
      build.database.run('UPDATE atlas_meta SET value = ? WHERE key = ?', ['0', META_KEYS.replicaVersion]);
    });

    expect(() => openReplica(replicaPath)).toThrow('tables of version 0');
  });

  it('refuses a replica stamped with version 4, the tables before module line kinds and layers', async () => {
    await writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
      build.database.run('UPDATE atlas_meta SET value = ? WHERE key = ?', ['4', META_KEYS.replicaVersion]);
    });

    expect(REPLICA_VERSION).toBe('5');
    expect(() => openReplica(replicaPath)).toThrow('has tables of version 4, this reader 5; rebuild it');
  });

  it('control: opens a replica stamped with version 5', async () => {
    await buildWithSessions(['s1']);
    const reader = openReplica(replicaPath);

    expect(reader.current().meta.replicaVersion).toBe('5');
    reader.close();
  });

  it('refuses a replica missing a meta stamp', async () => {
    await writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
      build.database.run('DELETE FROM atlas_meta WHERE key = ?', [META_KEYS.builtAt]);
    });

    expect(() => openReplica(replicaPath)).toThrow(`no ${META_KEYS.builtAt} stamp`);
  });

  it('refuses a file that is not a replica', () => {
    mkdirSync(join(dir, 'atlas'), { recursive: true });
    writeFileSync(replicaPath, 'not a database');

    expect(() => openReplica(replicaPath)).toThrow(ReplicaUnavailable);
  });

  it('refuses on the next call a replica removed under an open reader', async () => {
    await buildWithSessions(['s1']);
    const reader = openReplica(replicaPath);

    rmSync(replicaPath);

    expect(() => reader.current()).toThrow(`no replica at ${replicaPath}`);
    reader.close();
  });
});

describe('ReplicaReader.close', () => {
  it('closes the file, and a later call is refused as a closed reader', async () => {
    await buildWithSessions(['s1']);
    const reader = openReplica(replicaPath);
    const database = reader.current().database;

    reader.close();

    expect(() => sessionsIn(database)).toThrow();
    expect(() => reader.current()).toThrow('is closed');
  });
});
