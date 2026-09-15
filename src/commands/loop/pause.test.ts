/**
 * Tests for `rafa loop pause` (`pause.ts`).
 *
 * Every case dispatches the command made over seams reading the branch
 * `feat/demo` and every pid alive, unless the case hands others, in a
 * project of its own holding the demo plan and its tracker
 * (`tests/loop-session-fixtures.ts`). What a pause wrote is read back off
 * the record's file, and the tracker's bytes are compared before and
 * after, since a pause marks nothing.
 *
 * The write sits beside its controls: a running record written `paused`
 * beside a paused one left byte-identical, and a record whose state
 * changed between the read and the write refused. That change is made by
 * the pid probe, which runs after the records are read, as a run writing
 * its end at that moment would.
 */
import type { LoopSessionSeams } from './loop-sessions.js';
import type { SessionRecord } from '../../loop/sessions.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { updateSession } from '../../loop/sessions.js';
import { dispatchInProject } from '../../tests/cli-capture.js';
import {
  DEMO_TRACKER_PATH,
  LOOP_SUBJECTS,
  loopSeams,
  plantDemoProject,
  plantSession,
  resultEvent,
  SESSION_ID,
  sessionRecord,
  storedSession,
} from '../../tests/loop-session-fixtures.js';

import { createLoopPauseCommand } from './pause.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-pause-')));

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

/** Dispatches `rafa loop pause <words>` over the command made with `seams` laid over the demo ones. */
function pause(project: Project, words: readonly string[], seams: LoopSessionSeams = {}) {
  return dispatchInProject(['loop', 'pause', ...words], LOOP_SUBJECTS, [createLoopPauseCommand(loopSeams(seams))], project);
}

/** The bytes of the record and the tracker. */
function bytes(project: Project): readonly string[] {
  return [
    readFileSync(join(project.root, '.rafa/runs', `${SESSION_ID}.json`), 'utf8'),
    readFileSync(join(project.root, DEMO_TRACKER_PATH), 'utf8'),
  ];
}

describe('rafa loop pause', () => {
  it('writes paused to the session running on the branch, keeping its task and marking nothing', async () => {
    const project = projectWith(sessionRecord());
    const tracker = bytes(project)[1];

    const run = await pause(project, []);

    expect(storedSession(project.root)).toEqual(sessionRecord({ state: 'paused' }));
    expect(bytes(project)[1]).toBe(tracker);
    expect(run.stdout).toBe([
      'Pausing session session-0500 once its running task ends: line 6, Second task',
      '  Nothing is marked. `rafa loop resume` goes on, and `rafa loop stop` ends the run.',
      '',
    ].join('\n'));
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
  });

  it('says a session running no task holds before its next one', async () => {
    const project = projectWith(sessionRecord({ task: null }));

    const run = await pause(project, []);

    expect(run.stdout.split('\n')[0]).toBe('Paused session session-0500: it holds before its next task.');
    expect(storedSession(project.root).state).toBe('paused');
  });

  it('leaves a paused session byte-identical, exiting 0', async () => {
    const project = projectWith(sessionRecord({ state: 'paused' }));
    const before = bytes(project);

    const run = await pause(project, []);

    expect(bytes(project)).toEqual(before);
    expect(run.stdout).toBe('Session session-0500 is already paused; nothing changed.\n');
    expect(run.exitCode).toBe(0);
  });

  it('gives the record written and whether it changed as the result data in json mode', async () => {
    const project = projectWith(sessionRecord());

    const run = await pause(project, ['--output=json']);

    expect(resultEvent(run.stdout)).toMatchObject({ ok: true, data: { session: sessionRecord({ state: 'paused' }), changed: true } });
  });

  it('refuses a session that reads stopped, as a running record whose pid is gone does, writing nothing', async () => {
    const project = projectWith(sessionRecord());
    const before = bytes(project);

    const run = await pause(project, ['-s', SESSION_ID], { isAlive: () => false });

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe('❌ Session session-0500 reads stopped: no run is left to pause.');
    expect(bytes(project)).toEqual(before);
  });

  it('refuses, writing nothing, a record whose run wrote its end after it was read', async () => {
    const project = projectWith(sessionRecord());

    const run = await pause(project, [], {
      isAlive: () => {
        updateSession(project.root, SESSION_ID, { state: 'done' });
        return true;
      },
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd()).toBe('❌ Session session-0500 now stores done, where it read running; nothing was written.');
    expect(storedSession(project.root).state).toBe('done');
  });
});
