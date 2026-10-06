/**
 * `readRunRecords` over records planted in a project of each case's own,
 * with a scripted pid probe, so no case reads this checkout's
 * `.rafa/runs/` or a real process.
 */
import type { PidProbe, SessionRecord } from '../loop/sessions.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { runsDir, sessionFilePath } from '../loop/sessions.js';
import { eventsFilePath } from '../start/loop-events.js';

import { readRunRecords } from './runs.js';

const LIVE_PID = 4100;
const DEAD_PID = 4200;

/** Only {@link LIVE_PID} is alive. */
const isAlive: PidProbe = (pid) => pid === LIVE_PID;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-runs-')));
  roots.push(root);
  return root;
}

function record(sessionId: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId,
    planStub: 'demo',
    plan: '.plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: DEAD_PID,
    startedAt: '2026-09-01T12:00:00.000Z',
    state: 'done',
    task: null,
    ...overrides,
  };
}

/** Writes each record as `loop start` names it, and an events file for the ids in `withEvents`. */
function plant(root: string, records: readonly SessionRecord[], withEvents: readonly string[] = []): void {
  mkdirSync(runsDir(root), { recursive: true });
  for (const entry of records) {
    writeFileSync(sessionFilePath(root, entry.sessionId), `${JSON.stringify(entry, null, 2)}\n`);
  }
  for (const id of withEvents) writeFileSync(eventsFilePath(root, id), '{}\n');
}

function listedIds(root: string): string[] {
  return readRunRecords(root, { isAlive }).runs.map((row) => row.sessionId);
}

describe('readRunRecords', () => {
  it('never lists a running record with a live pid, even an old one', () => {
    const root = project();
    plant(root, [
      record('run-old', { state: 'running', pid: LIVE_PID, startedAt: '2026-09-01T00:00:00.000Z' }),
      record('run-mid', { startedAt: '2026-09-02T00:00:00.000Z' }),
      record('run-new', { startedAt: '2026-09-03T00:00:00.000Z' }),
    ]);

    expect(listedIds(root)).toEqual(['run-mid']);
  });

  it('never lists a paused record with a live pid', () => {
    const root = project();
    plant(root, [
      record('run-old', { state: 'paused', pid: LIVE_PID, startedAt: '2026-09-01T00:00:00.000Z' }),
      record('run-new', { startedAt: '2026-09-03T00:00:00.000Z' }),
    ]);

    expect(listedIds(root)).toEqual([]);
  });

  it('never lists the newest finished record of a plan, though a live one started after it', () => {
    const root = project();
    plant(root, [
      record('run-a', { startedAt: '2026-09-01T00:00:00.000Z' }),
      record('run-b', { state: 'stopped', startedAt: '2026-09-02T00:00:00.000Z' }),
      record('run-live', { state: 'running', pid: LIVE_PID, startedAt: '2026-09-03T00:00:00.000Z' }),
    ]);

    expect(listedIds(root)).toEqual(['run-a']);
  });

  it('lists a running record whose pid is gone when it is older than the newest', () => {
    const root = project();
    plant(root, [
      record('run-dead', { state: 'running', pid: DEAD_PID, startedAt: '2026-09-01T00:00:00.000Z' }),
      record('run-new', { startedAt: '2026-09-02T00:00:00.000Z' }),
    ]);

    expect(listedIds(root)).toEqual(['run-dead']);
  });

  it('keeps a running record whose pid is gone when it is the newest of its plan', () => {
    const root = project();
    plant(root, [
      record('run-old', { startedAt: '2026-09-01T00:00:00.000Z' }),
      record('run-dead', { state: 'running', pid: DEAD_PID, startedAt: '2026-09-02T00:00:00.000Z' }),
    ]);

    expect(listedIds(root)).toEqual(['run-old']);
  });

  it('keeps one newest record for each of two plans, a stubless plan keyed by its path', () => {
    const root = project();
    plant(root, [
      record('demo-1', { startedAt: '2026-09-01T00:00:00.000Z' }),
      record('demo-2', { startedAt: '2026-09-04T00:00:00.000Z' }),
      record('bare-1', { planStub: null, plan: 'PLAN.md', startedAt: '2026-09-02T00:00:00.000Z' }),
      record('bare-2', { planStub: null, plan: 'PLAN.md', startedAt: '2026-09-03T00:00:00.000Z' }),
      record('bare-3', { planStub: null, plan: 'PLAN.md', startedAt: '2026-09-05T00:00:00.000Z' }),
    ]);

    expect(listedIds(root)).toEqual(['demo-1', 'bare-1', 'bare-2']);
  });

  it('carries the record path, its events file when present, the plan and the start, ticked', () => {
    const root = project();
    plant(root, [
      record('run-a', { startedAt: '2026-09-01T00:00:00.000Z' }),
      record('run-b', { planStub: null, plan: 'PLAN.md', startedAt: '2026-09-02T00:00:00.000Z' }),
      record('run-c', { planStub: null, plan: 'PLAN.md', startedAt: '2026-09-03T00:00:00.000Z' }),
      record('run-d', { startedAt: '2026-09-04T00:00:00.000Z' }),
    ], ['run-a']);

    expect(readRunRecords(root, { isAlive })).toEqual({
      runs: [
        {
          sessionId: 'run-a',
          path: sessionFilePath(root, 'run-a'),
          eventsPath: eventsFilePath(root, 'run-a'),
          plan: 'demo',
          startedAt: '2026-09-01T00:00:00.000Z',
          ticked: true,
        },
        {
          sessionId: 'run-b',
          path: sessionFilePath(root, 'run-b'),
          eventsPath: null,
          plan: 'PLAN.md',
          startedAt: '2026-09-02T00:00:00.000Z',
          ticked: true,
        },
      ],
      notes: [],
    });
  });

  it('lists nothing and says nothing when the directory is missing', () => {
    expect(readRunRecords(project(), { isAlive })).toEqual({ runs: [], notes: [] });
  });

  it('answers a note, not a throw, when the directory cannot be listed', () => {
    const root = project();
    mkdirSync(join(root, '.rafa'), { recursive: true });
    writeFileSync(runsDir(root), 'not a directory\n');

    const reading = readRunRecords(root, { isAlive });

    expect(reading.runs).toEqual([]);
    expect(reading.notes).toHaveLength(1);
    expect(reading.notes[0]).toContain(`cannot list ${runsDir(root)}`);
  });

  it('notes a file that holds no record and lists the others by their own plans', () => {
    const root = project();
    plant(root, [
      record('run-a', { startedAt: '2026-09-01T00:00:00.000Z' }),
      record('run-b', { startedAt: '2026-09-02T00:00:00.000Z' }),
    ]);
    writeFileSync(join(runsDir(root), 'broken.json'), '{ not json');

    const reading = readRunRecords(root, { isAlive });

    expect(reading.runs.map((row) => row.sessionId)).toEqual(['run-a']);
    expect(reading.notes).toHaveLength(1);
    expect(reading.notes[0]).toContain('broken.json');
  });
});
