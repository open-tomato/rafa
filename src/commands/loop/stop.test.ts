/**
 * Tests for `rafa loop stop` (`stop.ts`).
 *
 * Every case dispatches the command made over seams reading the branch
 * `feat/demo` and every pid alive, in a project of its own holding the
 * demo plan and its tracker (`tests/loop-session-fixtures.ts`). No signal
 * reaches a process: the `interrupt` seam records each pid it is handed
 * and acts as the case's loop would, writing the record's end and the
 * tracker's mark, or nothing. The wait goes through a `sleep` seam that
 * records each wait and waits for nothing.
 *
 * Each ending sits beside a control: a task the loop marked `[BLOCKED]`
 * beside one that had finished and one no loop marked; a record read at
 * its end at once beside one read at its end after two waits, and one
 * never ending within the wait; a refused signal beside a pid already
 * gone. The refusals of the pick are held in `status.test.ts`.
 */
import type { LoopSessionSeams } from './loop-sessions.js';
import type { SessionRecord } from '../../loop/sessions.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { sessionFilePath, updateSession } from '../../loop/sessions.js';
import { dispatchInProject } from '../../tests/cli-capture.js';
import {
  DEMO_TRACKER_PATH,
  LOOP_SUBJECTS,
  loopSeams,
  PID,
  plantDemoProject,
  plantSession,
  resultEvent,
  SESSION_ID,
  sessionRecord,
  storedSession,
} from '../../tests/loop-session-fixtures.js';

import { STOP_POLL_MS } from './loop-sessions.js';
import { createLoopStopCommand } from './stop.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-stop-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The project every case plants. */
type Project = ReturnType<typeof plantDemoProject>;

/** A project holding the demo plan and each record handed in. */
function projectWith(...records: readonly SessionRecord[]): Project {
  const project = plantDemoProject(tempBase);
  for (const record of records) plantSession(project.root, record);
  return project;
}

/** Marks a task line of the tracker `[BLOCKED]`, as the loop does. */
function markBlocked(project: Project, text: string): void {
  const tracker = join(project.root, DEMO_TRACKER_PATH);
  writeFileSync(tracker, readFileSync(tracker, 'utf8').replace(`- [ ] ${text}`, `- [BLOCKED] ${text}`));
}

/** What a case's run did beside what it wrote. */
interface Stopped {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Each pid the interrupt was handed. */
  readonly signalled: readonly number[];
  /** Each wait asked for. */
  readonly waits: readonly number[];
}

/** What a case's loop does when signalled, and during each wait. */
interface LoopActs {
  readonly onSignal?: () => void;
  readonly duringWait?: readonly (() => void)[];
}

/** Dispatches `rafa loop stop <words>` with the loop acting as `acts` says. */
async function stop(project: Project, words: readonly string[], acts: LoopActs = {}, seams: LoopSessionSeams = {}): Promise<Stopped> {
  const signalled: number[] = [];
  const waits: number[] = [];
  const command = createLoopStopCommand(loopSeams({
    interrupt: (pid) => {
      signalled.push(pid);
      acts.onSignal?.();
    },
    sleep: async (ms) => {
      waits.push(ms);
      acts.duringWait?.[waits.length - 1]?.();
    },
    ...seams,
  }));
  const run = await dispatchInProject(['loop', 'stop', ...words], LOOP_SUBJECTS, [command], project);
  return { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, signalled, waits };
}

/** The loop ending its run as a SIGINT has it end: the task marked, then `stopped` written. */
function endsInterrupted(project: Project, text: string): () => void {
  return () => {
    markBlocked(project, text);
    updateSession(project.root, SESSION_ID, { state: 'stopped' });
  };
}

/** An error the system would throw for `code`. */
function systemError(code: string): Error {
  return Object.assign(new Error(`kill ${code}`), { code });
}

describe('rafa loop stop, a run that ends', () => {
  it('signals the pid of the session running on the branch, and names the task the loop marked [BLOCKED]', async () => {
    const project = projectWith(sessionRecord({ task: { line: 7, text: 'Third task' } }));

    const run = await stop(project, [], { onSignal: endsInterrupted(project, 'Third task') });

    expect(run.signalled).toEqual([PID]);
    expect(run.waits).toEqual([]);
    expect(run.stdout).toBe([
      'Session session-0500 ended stopped: plan `demo` on `feat/demo`.',
      '  The task at line 7 is marked [BLOCKED]: Third task',
      '  `rafa loop start --plan=.plans/PLAN-demo.md` runs the plan again, its blocked tasks first.',
      '',
    ].join('\n'));
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
  });

  it('reads the record again after each wait until it ends', async () => {
    const project = projectWith(sessionRecord({ task: { line: 7, text: 'Third task' } }));

    const run = await stop(project, [], { duringWait: [() => undefined, endsInterrupted(project, 'Third task')] });

    expect(run.waits).toEqual([STOP_POLL_MS, STOP_POLL_MS]);
    expect(run.stdout.split('\n')[1]).toBe('  The task at line 7 is marked [BLOCKED]: Third task');
  });

  it('says a task that finished before the signal landed stays [x]', async () => {
    const project = projectWith(sessionRecord({ task: { line: 5, text: 'First task' } }));

    const run = await stop(project, [], { onSignal: () => updateSession(project.root, SESSION_ID, { state: 'stopped' }) });

    expect(run.stdout.split('\n')[1]).toBe('  The task at line 5 finished before the signal landed, and stays [x]: First task');
  });

  it('says no task was marked for a paused run ending with none', async () => {
    const project = projectWith(sessionRecord({ state: 'paused', task: null }));

    const run = await stop(project, [], { onSignal: () => updateSession(project.root, SESSION_ID, { state: 'stopped' }) });

    expect(run.stdout.split('\n')[1]).toBe('  No task was running, so none was marked.');
  });

  it('names no rerun for a run that ended done', async () => {
    const project = projectWith(sessionRecord({ task: null }));

    const run = await stop(project, [], { onSignal: () => updateSession(project.root, SESSION_ID, { state: 'done' }) });

    expect(run.stdout).toBe('Session session-0500 ended done: plan `demo` on `feat/demo`.\n  No task was running, so none was marked.\n');
  });

  it('reads a pid gone before the signal as a run stopped, whose task no loop marked', async () => {
    const project = projectWith(sessionRecord({ task: { line: 7, text: 'Third task' } }));
    let gone = false;

    const run = await stop(project, [], {}, {
      isAlive: () => !gone,
      interrupt: () => {
        gone = true;
        throw systemError('ESRCH');
      },
    });

    expect(run.stdout.split('\n').slice(0, 2)).toEqual([
      'Session session-0500 ended stopped: plan `demo` on `feat/demo`.',
      '  The task at line 7 still reads [ ]: Third task',
    ]);
    expect(run.exitCode).toBe(0);
  });

  it('gives the record it ended with, and the task with its checkbox, as the result data in json mode', async () => {
    const project = projectWith(sessionRecord({ task: { line: 7, text: 'Third task' } }));

    const run = await stop(project, ['--output=json'], { onSignal: endsInterrupted(project, 'Third task') });

    expect(resultEvent(run.stdout)).toMatchObject({
      ok: true,
      data: {
        session: sessionRecord({ state: 'stopped', task: { line: 7, text: 'Third task' } }),
        ended: true,
        task: { line: 7, text: 'Third task', checkbox: 'blocked' },
      },
    });
  });
});

describe('rafa loop stop, a run that has not ended', () => {
  it('warns once the wait runs out, exiting 0, the record as last read', async () => {
    const project = projectWith(sessionRecord());

    const text = await stop(project, [], {}, { stopWaitMs: 600 });
    const json = await stop(project, ['--output=json'], {}, { stopWaitMs: 600 });

    expect(text.waits).toEqual([STOP_POLL_MS, STOP_POLL_MS, STOP_POLL_MS]);
    expect(text.stdout).toBe('warn: SIGINT was sent to session session-0500, pid 7171, and its record still reads running after 0.6s:'
      + ' the run ends once the step it is in returns. `rafa loop status` reads it.\n');
    expect(text.exitCode).toBe(0);
    expect(resultEvent(json.stdout)).toMatchObject({ ok: true, data: { session: sessionRecord(), ended: false, task: null } });
  });
});

describe('rafa loop stop, refusals', () => {
  it('refuses a session that reads done, sending nothing', async () => {
    const project = projectWith(sessionRecord({ state: 'done', task: null }));

    const run = await stop(project, ['-s', SESSION_ID]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe('❌ Session session-0500 reads done: no run is left to stop.');
    expect(run.signalled).toEqual([]);
  });

  it('refuses a signal the system refuses for another reason, waiting on nothing', async () => {
    const project = projectWith(sessionRecord());

    const run = await stop(project, [], {}, {
      interrupt: () => {
        throw systemError('EPERM');
      },
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe('❌ SIGINT could not be sent to session session-0500, pid 7171.\n   kill EPERM');
    expect(run.waits).toEqual([]);
    expect(storedSession(project.root).state).toBe('running');
  });

  it('refuses a record that cannot be read after the signal', async () => {
    const project = projectWith(sessionRecord());

    const run = await stop(project, [], { onSignal: () => rmSync(sessionFilePath(project.root, SESSION_ID)) });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toStartWith('❌ SIGINT was sent to session session-0500, pid 7171, and its record cannot be read again.\n   session record ');
  });
});
