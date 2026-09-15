/**
 * Tests for `rafa loop list` (`list.ts`).
 *
 * Every case dispatches the command made over seams whose branch reader
 * fails the case when called, since the list reads no branch, and whose
 * pid probe answers alive for every pid but 9999. Each project is a
 * project of its own holding the demo plan and its tracker
 * (`tests/loop-session-fixtures.ts`).
 *
 * The listed records sit beside the records passed over: one reading
 * `done`, and one stored `running` whose pid is gone. A record of another
 * branch is listed, and one whose plan is gone is listed with no counts.
 */
import type { SessionRecord } from '../../loop/sessions.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatchInProject } from '../../tests/cli-capture.js';
import {
  LOOP_SUBJECTS,
  loopSeams,
  plantDemoProject,
  plantFile,
  plantSession,
  resultEvent,
  sessionRecord,
} from '../../tests/loop-session-fixtures.js';

import { createLoopListCommand } from './list.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The pid the probe answers gone. */
const GONE_PID = 9999;

/** The project every case plants. */
type Project = ReturnType<typeof plantDemoProject>;

/** A project holding the demo plan and each record handed in. */
function projectWith(...records: readonly SessionRecord[]): Project {
  const project = plantDemoProject(tempBase);
  for (const record of records) plantSession(project.root, record);
  return project;
}

/** Dispatches `rafa loop list <words>`. */
function list(project: Project, words: readonly string[] = []) {
  const command = createLoopListCommand(loopSeams({
    readBranch: () => {
      throw new Error('the list read a branch');
    },
    isAlive: (pid) => pid !== GONE_PID,
  }));
  return dispatchInProject(['loop', 'list', ...words], LOOP_SUBJECTS, [command], project);
}

/** The records most cases plant: two listed and two passed over, and one listed with no plan. */
const MIXED = [
  sessionRecord(),
  sessionRecord({ sessionId: 'session-0600', branch: 'feat/other', state: 'paused', startedAt: '2026-09-15T11:00:00.000Z', task: null }),
  sessionRecord({ sessionId: 'session-0400', state: 'done', startedAt: '2026-09-15T10:00:00.000Z', task: null }),
  sessionRecord({ sessionId: 'session-0700', pid: GONE_PID, startedAt: '2026-09-15T10:30:00.000Z' }),
  sessionRecord({ sessionId: 'session-0800', planStub: 'gone', plan: '.plans/PLAN-gone.md', branch: 'feat/gone', startedAt: '2026-09-15T13:00:00.000Z' }),
];

describe('rafa loop list', () => {
  it('lists every running and paused session oldest first, whatever its branch, with the tasks of its plan', async () => {
    const project = projectWith(...MIXED);

    const run = await list(project);

    expect(run.stdout).toBe([
      'Running sessions:',
      '  session-0600: plan `demo` on `feat/other`, paused, pid 7171, started 2026-09-15T11:00:00.000Z; 1/4 done, 1 blocked, 2 open',
      '  session-0500: plan `demo` on `feat/demo`, running, pid 7171, started 2026-09-15T12:00:00.000Z; 1/4 done, 1 blocked, 2 open',
      '  session-0800: plan `gone` on `feat/gone`, running, pid 7171, started 2026-09-15T13:00:00.000Z; no plan or tracker to count',
      '',
    ].join('\n'));
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
  });

  it('says there is none when no record is live, and when there is no record at all', async () => {
    const ended = projectWith(MIXED[2] ?? sessionRecord(), MIXED[3] ?? sessionRecord());
    const empty = plantDemoProject(tempBase);

    const endedRun = await list(ended);
    const emptyRun = await list(empty);

    expect([endedRun.stdout, emptyRun.stdout]).toEqual(['No running sessions.\n', 'No running sessions.\n']);
  });

  it('gives each session and its counts as the result data in json mode', async () => {
    const project = projectWith(...MIXED);

    const run = await list(project, ['--output=json']);

    expect(resultEvent(run.stdout)).toMatchObject({
      ok: true,
      data: {
        sessions: [
          { session: MIXED[1], tasks: { total: 4, done: 1, blocked: 1, open: 2 } },
          { session: MIXED[0], tasks: { total: 4, done: 1, blocked: 1, open: 2 } },
          { session: MIXED[4], tasks: null },
        ],
      },
    });
  });

  it('refuses an argument, and records that cannot be read', async () => {
    const project = projectWith(...MIXED);
    const withArgument = await list(project, ['all']);
    plantFile(project.root, '.rafa/runs/broken.json', 'null');

    const broken = await list(project);

    expect(withArgument.exitCode).toBe(1);
    expect(withArgument.stderr.trimEnd()).toBe('❌ Expected no argument, got 1: all\nUsage: rafa loop list');
    expect(broken.exitCode).toBe(1);
    expect(broken.stderr).toStartWith('❌ The session records under .rafa/runs/ cannot be read.\n   session record ');
  });
});
