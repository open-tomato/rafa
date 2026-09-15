/**
 * Tests for `rafa loop resume` (`resume.ts`).
 *
 * Every case dispatches the command made over seams reading the branch
 * `feat/demo` and every pid alive, unless the case hands others, in a
 * project of its own holding the demo plan and its tracker
 * (`tests/loop-session-fixtures.ts`). What a resume wrote is read back off
 * the record's file.
 *
 * The write sits beside its controls: a paused record written `running`
 * beside a running one left byte-identical, a record that has ended
 * refused, and a record whose state changed between the read and the
 * write refused. That change is made by the pid probe, which runs after
 * the records are read.
 */
import type { LoopSessionSeams } from './loop-sessions.js';
import type { SessionRecord } from '../../loop/sessions.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { sessionFilePath, updateSession } from '../../loop/sessions.js';
import { dispatchInProject } from '../../tests/cli-capture.js';
import {
  LOOP_SUBJECTS,
  loopSeams,
  plantDemoProject,
  plantSession,
  resultEvent,
  SESSION_ID,
  sessionRecord,
  storedSession,
} from '../../tests/loop-session-fixtures.js';

import { createLoopResumeCommand } from './resume.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-resume-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The project every case plants. */
type Project = ReturnType<typeof plantDemoProject>;

/** A project holding the demo plan and the record handed in. */
function projectWith(record: SessionRecord): Project {
  const project = plantDemoProject(tempBase);
  plantSession(project.root, record);
  return project;
}

/** Dispatches `rafa loop resume <words>` over the command made with `seams` laid over the demo ones. */
function resume(project: Project, words: readonly string[], seams: LoopSessionSeams = {}) {
  return dispatchInProject(['loop', 'resume', ...words], LOOP_SUBJECTS, [createLoopResumeCommand(loopSeams(seams))], project);
}

/** The bytes of the record. */
function recordBytes(project: Project): string {
  return readFileSync(sessionFilePath(project.root, SESSION_ID), 'utf8');
}

describe('rafa loop resume', () => {
  it('writes running to a paused session holding before its next task', async () => {
    const project = projectWith(sessionRecord({ state: 'paused', task: null }));

    const run = await resume(project, []);

    expect(storedSession(project.root)).toEqual(sessionRecord({ state: 'running', task: null }));
    expect(run.stdout).toBe('Resumed session session-0500: it goes on with its next task.\n');
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
  });

  it('says a pause that had not taken effect is carried past the running task', async () => {
    const project = projectWith(sessionRecord({ state: 'paused' }));

    const run = await resume(project, []);

    expect(run.stdout).toBe('Resumed session session-0500: it goes on past its running task, line 6, Second task\n');
    expect(storedSession(project.root).state).toBe('running');
  });

  it('leaves a running session byte-identical, exiting 0', async () => {
    const project = projectWith(sessionRecord());
    const before = recordBytes(project);

    const run = await resume(project, []);

    expect(recordBytes(project)).toBe(before);
    expect(run.stdout).toBe('Session session-0500 is running, not paused; nothing changed.\n');
    expect(run.exitCode).toBe(0);
  });

  it('gives the record written and whether it changed as the result data in json mode', async () => {
    const project = projectWith(sessionRecord({ state: 'paused', task: null }));

    const run = await resume(project, ['--output=json']);

    expect(resultEvent(run.stdout)).toMatchObject({ ok: true, data: { session: sessionRecord({ task: null }), changed: true } });
  });

  it('refuses a session that has ended, naming the line that runs its plan again, writing nothing', async () => {
    const project = projectWith(sessionRecord({ state: 'done', task: null }));
    const before = recordBytes(project);

    const run = await resume(project, ['--session-id', SESSION_ID]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe([
      '❌ Session session-0500 reads done: its run has ended, so there is nothing to resume.',
      '   `rafa loop start --plan=.plans/PLAN-demo.md` runs its plan again as a new session, its blocked tasks first.',
    ].join('\n'));
    expect(recordBytes(project)).toBe(before);
  });

  it('refuses, writing nothing, a record whose state changed after it was read', async () => {
    const project = projectWith(sessionRecord({ state: 'paused' }));

    const run = await resume(project, [], {
      isAlive: () => {
        updateSession(project.root, SESSION_ID, { state: 'stopped' });
        return true;
      },
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe('❌ Session session-0500 now stores stopped, where it read paused; nothing was written.');
    expect(storedSession(project.root).state).toBe('stopped');
  });
});
