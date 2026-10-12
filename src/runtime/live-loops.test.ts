import type { SessionRecord, SessionState } from '../loop/sessions.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SessionRecordError } from '../loop/sessions.js';

import { liveLoopsOf } from './live-loops.js';

/**
 * `liveLoopsOf` over session records planted under a temporary root of
 * the case's own, as `loop start` would write them. A pid is judged by
 * the case's own probe, except in the one case reading the default
 * probe, whose record names this test process's own pid.
 *
 * Each case that reads a loop as not live plants a live one beside it,
 * so an empty answer is never the only reading the case makes.
 */

/** The pids {@link probe} reads as alive. */
const LIVE_PID = 4242;
const LIVE_PID_TOO = 4343;
const GONE_PID = 4444;

/** A probe reading {@link LIVE_PID} and {@link LIVE_PID_TOO} alive and every other pid gone. */
const probe = (pid: number): boolean => pid === LIVE_PID || pid === LIVE_PID_TOO;

let root = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-live-loops-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a session record under `at`'s `.rafa/runs/`. */
function plantLoop(
  at: string,
  sessionId: string,
  pid: number,
  state: SessionState = 'running',
  startedAt = '2026-10-12T10:00:00.000Z',
): void {
  const record: SessionRecord = {
    sessionId,
    planStub: `stub-${sessionId}`,
    plan: `.rafa/plans/PLAN-${sessionId}.md`,
    branch: `feat/${sessionId}`,
    pid,
    startedAt,
    state,
    task: null,
  };
  mkdirSync(join(at, '.rafa', 'runs'), { recursive: true });
  writeFileSync(join(at, '.rafa', 'runs', `${sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

/** The session ids of the loops read as live under `at`, in the order answered. */
function liveIds(at: string): string[] {
  return liveLoopsOf(at, probe).map((loop) => loop.sessionId);
}

describe('liveLoopsOf', () => {
  it('answers no loop for a root with no runs directory', () => {
    expect(liveLoopsOf(root, probe)).toEqual([]);
  });

  it('answers the running and the paused records whose pid is alive, oldest first', () => {
    plantLoop(root, 'later', LIVE_PID_TOO, 'paused', '2026-10-12T11:00:00.000Z');
    plantLoop(root, 'earlier', LIVE_PID);

    const loops = liveLoopsOf(root, probe);

    expect(loops.map((loop) => [loop.sessionId, loop.branch, loop.pid, loop.state])).toEqual([
      ['earlier', 'feat/earlier', LIVE_PID, 'running'],
      ['later', 'feat/later', LIVE_PID_TOO, 'paused'],
    ]);
  });

  it('leaves out a record whose pid is gone, and one that is done or stopped whatever its pid', () => {
    plantLoop(root, 'killed', GONE_PID);
    plantLoop(root, 'finished', LIVE_PID, 'done');
    plantLoop(root, 'halted', LIVE_PID, 'stopped');
    plantLoop(root, 'paused-gone', GONE_PID, 'paused');
    // The control: one live record among them is answered, so the four are left out and not unread.
    plantLoop(root, 'live', LIVE_PID);

    expect(liveIds(root)).toEqual(['live']);
  });

  it('reads the records under the root it is handed, and no other root', () => {
    const other = join(root, 'other');
    plantLoop(other, 'elsewhere', LIVE_PID);

    expect(liveIds(root)).toEqual([]);
    // The control: the same record is live under the root that holds it.
    expect(liveIds(other)).toEqual(['elsewhere']);
  });

  it('judges a pid with isPidAlive when handed no probe, this process reading as alive', () => {
    plantLoop(root, 'this-process', process.pid);
    plantLoop(root, 'finished', process.pid, 'done');

    expect(liveLoopsOf(root).map((loop) => loop.sessionId)).toEqual(['this-process']);
  });

  it('throws SessionRecordError naming a record it cannot read', () => {
    plantLoop(root, 'live', LIVE_PID);
    writeFileSync(join(root, '.rafa', 'runs', 'broken.json'), 'not json\n');

    expect(() => liveLoopsOf(root, probe)).toThrow(SessionRecordError);
    expect(() => liveLoopsOf(root, probe)).toThrow('broken.json');
  });
});
