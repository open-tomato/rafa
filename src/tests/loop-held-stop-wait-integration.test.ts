/**
 * A held stop read end to end: `rafa loop start` spawned over a scratch
 * repository (`./loop-scratch.ts`) holding a one-task plan, whose
 * stand-in `claude` exits 0 having written no report and changed no file,
 * and then `rafa loop wait` spawned over the same repository.
 *
 * The run's events file ends on the task's `task-blocked` and then one
 * `halt` naming the held task, and the wait, left on its default reasons,
 * answers that `halt`: it prints the reason on one line and exits with
 * the held code, the `halt` row's of the reasons table. A run that wrote
 * no `halt` would end the wait on `exit` instead, its record having
 * ended, so neither case can leave the wait polling.
 */
import type { Scratch } from './loop-scratch.js';
import type { EventLine } from '@open-tomato/rafa-run/loop/events-file';

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { EVENT_PREFIX } from '@open-tomato/rafa/adapters/output/events';
import { readSessions } from '@open-tomato/rafa/core/loop';
import { eventsFileOf, readEventsFrom } from '@open-tomato/rafa-run/loop/events-file';
import { TASK_HELD_NOTHING_LEFT } from '@open-tomato/rafa-run/start/commit';

import { waitExitCode } from '../loop/wait-reasons.js';

import { expectExit, runRafa } from './cli-capture.js';
import { PLAN_OPEN, runLoopStart, scratchPlanter, SESSION_FLAGS, STUB, TASK } from './loop-scratch.js';

/** The reason the run's `halt` carries, and the wait prints. */
const HELD_REASON = `${TASK_HELD_NOTHING_LEFT}: ${TASK}`;

/** The exit code `loop wait` ends with on a held stop. */
const HELD_EXIT = 11;

/** How long the case may take: two spawned runs, each killed by its own helper before this. */
const CASE_TIMEOUT_MS = 90_000;

const planter = scratchPlanter('rafa-loop-held-wait-');
afterAll(() => {
  planter.remove();
});

/** The one run the scratch repository holds: its session id and the events it wrote, in file order. */
function onlyRunOf(scratch: Scratch): { readonly sessionId: string; readonly events: readonly EventLine[] } {
  const records = readSessions(scratch.repo);
  expect(records).toHaveLength(1);
  const [record] = records;
  if (record === undefined) throw new Error('the scratch repository holds no run');
  const read = readEventsFrom(eventsFileOf(scratch.repo, record), 0);
  if (read.kind !== 'read') throw new Error(`run ${record.sessionId} left no events file`);
  return { sessionId: record.sessionId, events: read.events };
}

/** How many times `part` is in `text`. */
function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('a held stop, from loop start to loop wait', () => {
  it('ends the events file on task-blocked then one halt naming the task, which the wait prints once and exits 11 on', () => {
    // Arrange: the default stand-in writes nothing and changes no file.
    const scratch = planter.plant({ branch: `feat/${STUB}`, plan: PLAN_OPEN });

    // Act
    const started = runLoopStart(scratch, 'text', SESSION_FLAGS);

    // Assert: one session, held, and the two events the run ends on.
    expectExit(started, 0, { ...scratch });
    expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');
    const { sessionId, events } = onlyRunOf(scratch);
    expect(events.map((event) => event.name)).toEqual(['task-start', 'task-blocked', 'halt']);
    const halt = events[events.length - 1];
    expect(halt?.data).toEqual({ reason: HELD_REASON });

    // Act
    const waited = runRafa(
      { ...scratch, bin: dirname(scratch.claude) },
      scratch.repo,
      ['loop', 'wait', `--session-id=${sessionId}`],
    );

    // Assert: one line, the halt's, and the held code.
    expectExit(waited, HELD_EXIT, { ...scratch });
    expect(waitExitCode('halt')).toBe(HELD_EXIT);
    const printed = `${waited.stdout}${waited.stderr}`;
    expect(occurrences(printed, HELD_REASON)).toBe(1);
    expect(printed.split('\n').filter((line) => line.startsWith(EVENT_PREFIX))).toEqual([`${EVENT_PREFIX}${halt?.summary}`]);
  }, CASE_TIMEOUT_MS);
});
