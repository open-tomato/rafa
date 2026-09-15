/**
 * Tests for `rafa loop status` (`status.ts`), and through it for the pick
 * and the refusals every session action shares (`loop-sessions.ts`).
 *
 * Every case dispatches the command made over seams reading the branch
 * `feat/demo` and every pid alive, unless the case hands others, in a
 * project of its own under this file's temporary directory holding the
 * demo plan and its tracker (`tests/loop-session-fixtures.ts`). So no git
 * runs and no process is probed. Records are planted as `loop start`
 * writes them, and store rows through the loop's own writer with the
 * clock handed in.
 *
 * The pick sits beside its controls: the running record of the branch
 * picked over an older done one; with none running, the newest record of
 * the branch picked, and a record of another branch never; and
 * `--session-id` picking a record the branch does not name, with the
 * branch reader throwing to show it is never read then.
 */
import type { LoopSessionSeams } from './loop-sessions.js';
import type { SessionRecord } from '../../loop/sessions.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { writeTaskReport } from '../../effort/store/reports.js';
import { SQLITE_SCHEMA_VERSION, sqliteStorePath } from '../../effort/store/sqlite.js';
import { dispatchInProject } from '../../tests/cli-capture.js';
import {
  DEMO_TRACKER_PATH,
  LOOP_SUBJECTS,
  loopSeams,
  plantDemoProject,
  plantFile,
  plantSession,
  resultEvent,
  sessionRecord,
} from '../../tests/loop-session-fixtures.js';

import { createLoopStatusCommand } from './status.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-status-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The first line of the demo session, running. */
const RUNNING_LINE = 'Session session-0500: plan `demo` on `feat/demo`, running, pid 7171, started 2026-09-15T12:00:00.000Z';

/** The usage line a line refusal names. */
const USAGE = 'Usage: rafa loop status [-s|--session-id=<id>]';

/** A project holding the demo plan and each record handed in. */
function projectWith(...records: readonly SessionRecord[]): ReturnType<typeof plantDemoProject> {
  const project = plantDemoProject(tempBase);
  for (const record of records) plantSession(project.root, record);
  return project;
}

/** Dispatches `rafa loop <words>` over the command made with `seams` laid over the demo ones. */
function status(project: ReturnType<typeof plantDemoProject>, words: readonly string[], seams: LoopSessionSeams = {}) {
  return dispatchInProject(['loop', 'status', ...words], LOOP_SUBJECTS, [createLoopStatusCommand(loopSeams(seams))], project);
}

/** A done task report of `planStub` collected at `at`, written under `root` as the loop writes one. */
function finish(root: string, at: string, outcome: 'done' | 'blocked' = 'done', planStub = 'demo'): void {
  writeTaskReport(root, {
    dispatch: { sessionId: `task-${at}`, planStub, taskLine: '- [ ] A task' },
    outcome,
    report: { status: 'done' },
  }, { now: () => new Date(at), newId: () => `row-${at}` });
}

/** A seam that fails the case when it is called. */
function neverCalled(what: string): () => never {
  return () => {
    throw new Error(`${what} was called`);
  };
}

describe('rafa loop status, the session a line picks', () => {
  it('shows the session running on the branch over an older one that is done, its tracker counted and no ETA before a finish', async () => {
    const project = projectWith(
      sessionRecord({ sessionId: 'session-0400', startedAt: '2026-09-15T11:00:00.000Z', state: 'done', task: null }),
      sessionRecord(),
    );

    const run = await status(project, []);

    expect(run.stdout).toBe([
      RUNNING_LINE,
      '  Tasks: 1/4 done, 1 blocked, 2 open',
      '  Task: line 6, Second task',
      '  ETA: none until the session finishes a task',
      '',
    ].join('\n'));
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
  });

  it('shows the newest session of the branch when none is live, never one of another branch, and gives it no ETA', async () => {
    const project = projectWith(
      sessionRecord({ sessionId: 'session-0400', startedAt: '2026-09-15T11:00:00.000Z', state: 'done', task: null }),
      sessionRecord({ sessionId: 'session-0450', startedAt: '2026-09-15T11:30:00.000Z', state: 'stopped' }),
      sessionRecord({ sessionId: 'session-0900', startedAt: '2026-09-15T13:00:00.000Z', branch: 'feat/other' }),
    );

    const run = await status(project, []);

    expect(run.stdout).toBe([
      'Session session-0450: plan `demo` on `feat/demo`, stopped, pid 7171, started 2026-09-15T11:30:00.000Z',
      '  Tasks: 1/4 done, 1 blocked, 2 open',
      '  Task: line 6, Second task',
      '',
    ].join('\n'));
  });

  it('reads a running record whose pid is gone as stopped, with no ETA', async () => {
    const project = projectWith(sessionRecord());

    const run = await status(project, [], { isAlive: () => false });

    expect(run.stdout.split('\n')[0]).toBe(RUNNING_LINE.replace('running', 'stopped'));
    expect(run.stdout).not.toContain('ETA');
  });

  it('picks the record --session-id names, whatever branch it ran on, without reading the branch', async () => {
    const project = projectWith(sessionRecord(), sessionRecord({ sessionId: 'session-0600', branch: 'feat/other', task: null }));

    const long = await status(project, ['--session-id=session-0600'], { readBranch: neverCalled('the branch reader') });
    const short = await status(project, ['-s', 'session-0600'], { readBranch: neverCalled('the branch reader') });

    expect(long.stdout.split('\n')[0]).toBe('Session session-0600: plan `demo` on `feat/other`, running, pid 7171, started 2026-09-15T12:00:00.000Z');
    expect(short.stdout).toBe(long.stdout);
    expect([long.exitCode, short.exitCode]).toEqual([0, 0]);
  });
});

describe('rafa loop status, what it shows', () => {
  it('gives the ETA the store holds: the done finishes of the plan from the start on, per task, times the open and blocked left', async () => {
    const project = projectWith(sessionRecord());
    finish(project.root, '2026-09-15T12:10:00.000Z');
    finish(project.root, '2026-09-15T12:20:00.000Z');
    finish(project.root, '2026-09-15T12:25:00.000Z', 'blocked');
    finish(project.root, '2026-09-15T12:30:00.000Z', 'done', 'other');
    finish(project.root, '2026-09-15T11:50:00.000Z');

    const run = await status(project, []);

    expect(run.stdout.split('\n')[3]).toBe('  ETA: about 30m for 3 tasks left, at 10m per task over the 2 tasks this session finished');
  });

  it('says a pause that has not taken effect holds once its task ends, and still gives the ETA', async () => {
    const project = projectWith(sessionRecord({ state: 'paused' }));

    const run = await status(project, []);

    expect(run.stdout.split('\n').slice(2)).toEqual([
      '  Task: line 6, Second task (the run holds once it ends)',
      '  ETA: none until the session finishes a task',
      '',
    ]);
  });

  it('counts the plan before its tracker exists, and says so when neither is there', async () => {
    const project = projectWith(sessionRecord(), sessionRecord({ sessionId: 'session-0600', planStub: 'gone', plan: '.plans/PLAN-gone.md', task: null }));
    rmSync(join(project.root, DEMO_TRACKER_PATH));

    const fromPlan = await status(project, ['-s', 'session-0500']);
    const neither = await status(project, ['-s', 'session-0600']);

    expect(fromPlan.stdout.split('\n')[1]).toBe('  Tasks: 0/4 done, 0 blocked, 4 open');
    expect(neither.stdout.split('\n').slice(1)).toEqual(['  Tasks: neither `.plans/PLAN-gone.md` nor its tracker is there to count', '']);
  });

  it('warns and gives no ETA when the store cannot be read, still exiting 0', async () => {
    const project = projectWith(sessionRecord());
    const path = sqliteStorePath(project.root);
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { create: true });
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();

    const run = await status(project, []);

    expect(run.stdout).toContain('warn: The effort store cannot be read, so the status has no ETA: ');
    expect(run.stdout.split('\n').filter((line) => line.startsWith('  ETA: '))).toEqual([]);
    expect(run.exitCode).toBe(0);
  });

  it('gives the record, the checklist, the counts and the ETA as the result data in json mode', async () => {
    const project = projectWith(sessionRecord());

    const run = await status(project, ['--output=json']);

    expect(resultEvent(run.stdout)).toMatchObject({
      ok: true,
      data: {
        session: sessionRecord(),
        checklist: join(project.root, DEMO_TRACKER_PATH),
        tasks: { total: 4, done: 1, blocked: 1, open: 2 },
        eta: { finished: 0, left: 3, secondsPerTask: null, seconds: null },
      },
    });
    expect(run.stdout).not.toContain('Session session-0500');
  });
});

describe('rafa loop status, the refusals every session action shares', () => {
  it('refuses a branch no session is running on, when no record names it', async () => {
    const project = projectWith(sessionRecord({ branch: 'feat/other' }));

    const run = await status(project, []);

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe('❌ No session is running on `feat/demo`.\n   `rafa loop list` lists the running sessions, and --session-id names one.');
    expect(run.stdout).toBe('');
  });

  it('refuses two sessions running on the branch, naming both', async () => {
    const project = projectWith(sessionRecord(), sessionRecord({ sessionId: 'session-0600', planStub: 'second', plan: '.plans/PLAN-second.md' }));

    const run = await status(project, []);

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe([
      '❌ 2 sessions are running on `feat/demo`; name one with --session-id:',
      '   session-0500: plan `demo` on `feat/demo`, running, pid 7171, started 2026-09-15T12:00:00.000Z',
      '   session-0600: plan `second` on `feat/demo`, running, pid 7171, started 2026-09-15T12:00:00.000Z',
    ].join('\n'));
  });

  it('refuses a branch that cannot be read, with the first line of why', async () => {
    const project = projectWith(sessionRecord());

    const run = await status(project, [], {
      readBranch: () => {
        throw new Error('Command failed: git rev-parse\nfatal: not a git repository');
      },
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe([
      '❌ The branch checked out at the project root cannot be read, so no session is paired with it.',
      '   Command failed: git rev-parse',
      '   Name the session with --session-id; `rafa loop list` lists the running ones.',
    ].join('\n'));
  });

  it('refuses an id no record is named with', async () => {
    const project = projectWith(sessionRecord());

    const run = await status(project, ['-s', 'session-0404']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe('❌ No session record under .rafa/runs/ is named session-0404.\n   `rafa loop list` lists the running sessions.');
  });

  it('refuses a --session-id with no value or naming no file, and an argument, before reading the branch or a record', async () => {
    const project = projectWith(sessionRecord());
    plantFile(project.root, '.rafa/runs/broken.json', '{');
    const seams = { readBranch: neverCalled('the branch reader') };

    const bare = await status(project, ['--session-id'], seams);
    const unusable = await status(project, ['--session-id=../escape'], seams);
    const argument = await status(project, ['extra'], seams);

    expect(bare.stderr.trimEnd()).toBe(`❌ --session-id needs a value: --session-id=<id>\n${USAGE}`);
    expect(unusable.stderr.trimEnd()).toBe(`❌ --session-id is "../escape", which no session record is named with\n${USAGE}`);
    expect(argument.stderr.trimEnd()).toBe(`❌ Expected no argument, got 1: extra\n${USAGE}`);
    expect([bare.exitCode, unusable.exitCode, argument.exitCode]).toEqual([1, 1, 1]);
  });

  it('refuses records that cannot be read, naming the file', async () => {
    const project = projectWith(sessionRecord());
    const broken = plantFile(project.root, '.rafa/runs/broken.json', '{');

    const run = await status(project, []);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toStartWith(`❌ The session records under .rafa/runs/ cannot be read.\n   session record ${broken}: holds no JSON: `);
  });
});
