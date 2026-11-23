/**
 * Tests for `writer.ts`, in a tmpdir: a build lands as one file at the
 * replica path with its meta and source stamps, its row counts and no build
 * file beside it, and a failed or refused build leaves the live replica as
 * it was.
 */
import type { WriteReplicaOptions, WriteReplicaResult } from './writer.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ATLAS_CONTRACT_VERSION } from '../contract/version.js';

import { REPLICA_VERSION } from './ddl.js';
import { openReplica } from './reader.js';
import { buildPathOf, writeReplica } from './writer.js';

const BUILT_AT = new Date('2026-11-20T10:00:00.000Z');

let dir = '';
let replicaPath = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-replica-writer-'));
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
  return writeReplica({ replicaPath, projectLabel: 'fixture', now: () => BUILT_AT, ...options }, (build) => {
    const insert = build.database.prepare('INSERT INTO task_facts (session_id, kind) VALUES (?, ?)');
    for (const id of sessionIds) insert.run(id, 'task');
    return sessionIds.length;
  });
}

/** The session ids the replica at the path holds, in order. */
function sessionsAt(path: string): string[] {
  const reader = openReplica(path);
  try {
    return reader.current().database
      .query<{ readonly session_id: string }, []>('SELECT session_id FROM task_facts ORDER BY session_id')
      .all()
      .map((row) => row.session_id);
  } finally {
    reader.close();
  }
}

describe('writeReplica', () => {
  it('creates the folder and lands one replica file, with no build file left beside it', async () => {
    const result = await buildWithSessions(['s1', 's2'], { buildId: 'b1' });

    expect(result.replicaPath).toBe(replicaPath);
    expect(result.value).toBe(2);
    expect(readdirSync(join(dir, 'atlas'))).toEqual(['atlas.sqlite']);
    expect(sessionsAt(replicaPath)).toEqual(['s1', 's2']);
  });

  it('stamps atlas_meta with the contract and replica versions, the build id, time and project label', async () => {
    await buildWithSessions([], { buildId: 'b1', projectLabel: 'demo project' });
    const reader = openReplica(replicaPath);

    expect(reader.current().meta).toEqual({
      contractVersion: ATLAS_CONTRACT_VERSION,
      replicaVersion: REPLICA_VERSION,
      buildId: 'b1',
      builtAt: '2026-11-20T10:00:00.000Z',
      projectLabel: 'demo project',
    });
    reader.close();
  });

  it('defaults the build id to the build time digits and a random suffix', async () => {
    const first = await buildWithSessions([]);
    const second = await buildWithSessions([]);

    expect(first.buildId).toMatch(/^20261120100000000-[0-9a-f]{8}$/);
    expect(second.buildId).not.toBe(first.buildId);
  });

  it('writes each stamped source to atlas_sources, partial as a boolean', async () => {
    await writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
      build.stampSource({ source: 'effort', asOf: '2026-11-19T08:00:00Z', readAt: '2026-11-20T10:00:00Z', rows: 3, partial: false, reason: null });
      build.stampSource({ source: 'plans', asOf: null, readAt: '2026-11-20T10:00:01Z', rows: 0, partial: true, reason: 'sessions lacks row_json' });
    });
    const reader = openReplica(replicaPath);

    expect([...reader.current().sources.values()]).toEqual([
      { source: 'effort', asOf: '2026-11-19T08:00:00Z', readAt: '2026-11-20T10:00:00Z', rows: 3, partial: false, reason: null },
      { source: 'plans', asOf: null, readAt: '2026-11-20T10:00:01Z', rows: 0, partial: true, reason: 'sessions lacks row_json' },
    ]);
    reader.close();
  });

  it('answers the rows each bucket holds', async () => {
    const result = await buildWithSessions(['s1', 's2', 's3']);

    expect(result.tables).toEqual({
      task_facts: 3,
      plan_facts: 0,
      daily_rollup: 0,
      bug_facts: 0,
      finding_facts: 0,
      change_facts: 0,
      ci_facts: 0,
    });
  });

  it('fills a build file beside the replica, which stays the old one until the rename', async () => {
    await buildWithSessions(['old']);
    let seenDuringFill: string[] = [];
    let buildFileDuringFill = false;

    await writeReplica({ replicaPath, projectLabel: 'fixture', buildId: 'b2' }, (build) => {
      build.database.run('INSERT INTO task_facts (session_id, kind) VALUES (?, ?)', ['new', 'task']);
      buildFileDuringFill = build.buildPath === buildPathOf(replicaPath, 'b2') && existsSync(build.buildPath);
      seenDuringFill = sessionsAt(replicaPath);
    });

    expect(buildFileDuringFill).toBe(true);
    expect(seenDuringFill).toEqual(['old']);
    expect(sessionsAt(replicaPath)).toEqual(['new']);
  });

  it('leaves the live replica as it was and removes its build file when fill throws', async () => {
    await buildWithSessions(['old']);

    const failed = writeReplica({ replicaPath, projectLabel: 'fixture', buildId: 'b2' }, (build) => {
      build.database.run('INSERT INTO task_facts (session_id, kind) VALUES (?, ?)', ['new', 'task']);
      throw new Error('the source went away');
    });

    await expect(failed).rejects.toThrow('the source went away');
    expect(readdirSync(join(dir, 'atlas'))).toEqual(['atlas.sqlite']);
    expect(sessionsAt(replicaPath)).toEqual(['old']);
  });

  it('refuses a second stamp of the same source, failing the build', async () => {
    const stamp = { source: 'effort', asOf: null, readAt: '2026-11-20T10:00:00Z', rows: 0, partial: false, reason: null };

    const failed = writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
      build.stampSource(stamp);
      build.stampSource(stamp);
    });

    await expect(failed).rejects.toThrow('UNIQUE constraint failed');
    expect(existsSync(replicaPath)).toBe(false);
  });

  it('refuses a build file already there, from another run, and leaves it alone', async () => {
    mkdirSync(join(dir, 'atlas'), { recursive: true });
    writeFileSync(buildPathOf(replicaPath, 'taken'), 'another run');

    await expect(buildWithSessions(['s1'], { buildId: 'taken' })).rejects.toThrow('already there');
    expect(readdirSync(join(dir, 'atlas'))).toEqual(['atlas.sqlite.build-taken']);
  });

  it.each([
    ['a build id with a slash', { buildId: '../escape' }, 'not one path segment'],
    ['an empty build id', { buildId: '' }, 'not one path segment'],
    ['a contract version off the pattern', { contractVersion: '2' }, 'not major.minor.patch'],
  ])('refuses %s before it writes anything', async (_label, options, message) => {
    await expect(buildWithSessions(['s1'], options)).rejects.toThrow(message);
    expect(existsSync(dir) && readdirSync(dir)).toEqual([]);
  });
});
