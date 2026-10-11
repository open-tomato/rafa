/**
 * Tests for `rafa ci status` (`status.ts`): the four verdicts and their
 * exit codes, the failed cases of a red run by file and case, the json
 * reading, and the refusals.
 *
 * Every dispatching case runs the real command from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so no case reads the real home. No case
 * spawns `gh`: `run list` is answered by the recorded fake
 * (`src/ci/runs-fake.ts`), and `run view --log-failed` by a stand-in in
 * this file handing back the captured log under `src/ci/testdata/`.
 *
 * Controls: the green case reads the call log beside the red case, so
 * the absence of a `run view` call on a green run is read against a run
 * that does send one; the refusals read the runner factory's log beside
 * a valid line that does make a runner.
 */
import type { CiStatusSeams } from './status.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { FakeRun } from '../../ci/runs-fake.js';
import type { CiStatusReading } from '../../ci/status-reading.js';
import type { CliEvent } from '../../ports/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeRunsGh } from '../../ci/runs-fake.js';
import { verdictOf } from '../../ci/status-reading.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { CI_STATUS_EVENT, CI_STATUS_USAGE, createCiStatusCommand } from './status.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-ci-status-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'ci', summary: 'continuous integration' }];

/** The branch every case reads, and the workflow its runs belong to. */
const BRANCH = 'stretch/9';
const WORKFLOW = 'verify';

/** The commit every planted run ran on, and how the text abbreviates it. */
const SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';
const SHORT = 'c4da2c4';

/** The captured failed log of run 37190089292: three cases in one file. */
const THREE_CASES = await Bun.file(new URL('../../ci/testdata/three-cases.log-failed.txt', import.meta.url)).text();
const GATE_FILE = 'src/tests/task-gate-spawned.test.ts';

/** A run on {@link BRANCH} with `fields` over a finished, green one. */
function plantedRun(fields: Partial<FakeRun> = {}): FakeRun {
  return {
    databaseId: 37190089292,
    workflowName: WORKFLOW,
    headBranch: BRANCH,
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-10-07T03:00:00Z',
    ...fields,
  };
}

/** What `run view <id> --log-failed` answers in a case: the log, or a failure. */
type LogAnswer = GhResult;

/** A runner over the recorded `run list` fake, answering `run view` with `log`, and every call it got. */
function caseGh(runs: readonly FakeRun[], log: LogAnswer = { ok: true, stdout: THREE_CASES, stderr: '' }): {
  seams: CiStatusSeams;
  calls: () => readonly (readonly string[])[];
  made: () => readonly string[];
} {
  const fake = createFakeRunsGh(runs);
  const calls: (readonly string[])[] = [];
  const roots: string[] = [];
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'run' && args[1] === 'view') return Promise.resolve(log);
    return fake.gh(args);
  };
  return {
    seams: {
      gh: (root) => {
        roots.push(root);
        return gh;
      },
    },
    calls: () => [...calls],
    made: () => [...roots],
  };
}

/** A project of this case's own. */
function freshProject(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')));
}

/** Dispatches `rafa ci status` over `seams`, with `words` after the action. */
async function ran(seams: CiStatusSeams, words: readonly string[], project = freshProject()): Promise<CapturedRun> {
  return dispatchInProject(['ci', 'status', ...words], SUBJECTS, [createCiStatusCommand(seams)], project);
}

/** The lines a run wrote to stdout, blank ones left out. */
function linesOf(run: CapturedRun): string[] {
  return run.stdout.split('\n').filter((line) => line !== '');
}

/** The data of the named `ci-status` event a json run wrote. */
function readingOf(events: readonly CliEvent[]): CiStatusReading {
  const event = events.find((held) => (held as { name?: string }).name === CI_STATUS_EVENT);
  if (event === undefined) throw new Error(`no ${CI_STATUS_EVENT} event among ${JSON.stringify(events)}`);
  return (event as unknown as { data: CiStatusReading }).data;
}

describe('the verdict on a run', () => {
  it('reads success as green, any other conclusion as red, an unfinished run as running and no run as none', () => {
    expect(verdictOf(null)).toBe('none');
    expect(verdictOf({ id: 1, workflow: WORKFLOW, state: 'completed', conclusion: 'success', commit: SHA })).toBe('green');
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out']) {
      expect(verdictOf({ id: 1, workflow: WORKFLOW, state: 'completed', conclusion, commit: SHA })).toBe('red');
    }
    for (const state of ['queued', 'in_progress', 'requested', 'waiting', 'pending'] as const) {
      expect(verdictOf({ id: 1, workflow: WORKFLOW, state, conclusion: null, commit: SHA })).toBe('running');
    }
  });
});

describe('rafa ci status over the recorded gh', () => {
  it('exits 0 on a green run, printing its state and short commit, and reads no log', async () => {
    const gh = caseGh([plantedRun()]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run)).toEqual([`✅ ${BRANCH}: ${WORKFLOW} run 37190089292 is success on ${SHORT}.`]);
    expect(gh.calls().map((call) => call.slice(0, 2).join(' '))).toEqual(['run list']);
  });

  it('exits 1 on a red run, printing the failed cases by file and case, each once', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(1);
    const lines = linesOf(run);
    expect(lines[0]).toBe(`❌ ${BRANCH}: ${WORKFLOW} run 37190089292 is failure on ${SHORT}.`);
    expect(lines[1]).toBe(`   ${GATE_FILE}`);
    expect(lines.slice(2)).toHaveLength(3);
    expect(lines.slice(2).every((line) => line.startsWith('     - rafa loop start over a one-task fixture plan'))).toBe(true);
    expect(gh.calls().at(-1)).toEqual(['run', 'view', '37190089292', '--log-failed']);
  });

  it('exits 2 when the branch has no run, and reads only the newest run of the branch it names', async () => {
    const gh = caseGh([plantedRun({ headBranch: 'main' })]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(2);
    expect(linesOf(run)).toEqual([`⚪ No run on ${BRANCH}.`]);
  });

  it('exits 3 while the newest run is in progress, though an older run on the branch is green', async () => {
    const gh = caseGh([
      plantedRun({ databaseId: 1, createdAt: '2026-10-07T01:00:00Z' }),
      plantedRun({ databaseId: 2, status: 'in_progress', conclusion: '', createdAt: '2026-10-07T02:00:00Z' }),
    ]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(3);
    expect(linesOf(run)).toEqual([`⏳ ${BRANCH}: ${WORKFLOW} run 2 is in_progress on ${SHORT}.`]);
  });

  it('passes --workflow to gh run list and names it in the line', async () => {
    const gh = caseGh([plantedRun()]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`, `--workflow=${WORKFLOW}`]);

    expect(run.exitCode).toBe(0);
    expect(gh.calls()[0]).toContain('--workflow');
    expect(gh.calls()[0]).toContain(WORKFLOW);
    expect(linesOf(run)[0]).toStartWith(`✅ ${BRANCH} (${WORKFLOW}):`);
  });

  it('reads a red run whose log GitHub dropped as red, saying the cases cannot be read', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })], { ok: false, stdout: '', stderr: 'log not found\n' });

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(1);
    expect(linesOf(run)[1]).toBe('   The run\'s log is no longer on GitHub, so its failed cases cannot be read.');
  });

  it('reads a red run with no (fail) line as red outside the tests', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })], { ok: true, stdout: '', stderr: '' });

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(1);
    expect(linesOf(run)[1]).toBe('   No bun test case failed: the run went red outside the tests.');
  });
});

describe('json mode', () => {
  it('writes the same reading as a ci-status event on a red run, its cases by file', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`, '--output=json']);

    expect(run.exitCode).toBe(1);
    const reading = readingOf(eventsOf(run.stdout));
    expect(reading).toMatchObject({ branch: BRANCH, workflow: null, verdict: 'red', exitCode: 1 });
    expect(reading.run).toEqual({ id: 37190089292, workflow: WORKFLOW, state: 'completed', conclusion: 'failure', commit: SHA });
    expect(reading.failed?.map((file) => [file.file, file.cases.length])).toEqual([[GATE_FILE, 3]]);
  });

  it('writes the reading as the event and the terminal result on a green run', async () => {
    const gh = caseGh([plantedRun()]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`, '--output=json']);

    expect(run.exitCode).toBe(0);
    const events = eventsOf(run.stdout);
    const reading = readingOf(events);
    expect(reading).toMatchObject({ verdict: 'green', failed: null, exitCode: 0 });
    expect((events.at(-1) as { data?: unknown }).data).toEqual(reading);
  });

  it('writes the none and running readings with their exit codes', async () => {
    const none = await ran(caseGh([]).seams, [`--branch=${BRANCH}`, '--output=json']);
    const running = await ran(
      caseGh([plantedRun({ status: 'queued', conclusion: '' })]).seams,
      [`--branch=${BRANCH}`, '--output=json'],
    );

    expect([none.exitCode, readingOf(eventsOf(none.stdout)).verdict]).toEqual([2, 'none']);
    expect(readingOf(eventsOf(none.stdout)).run).toBeNull();
    expect([running.exitCode, readingOf(eventsOf(running.stdout)).verdict]).toEqual([3, 'running']);
  });
});

describe('the failures, apart from every verdict with exit code 4', () => {
  it('makes a runner for a valid line, the control the refusals below are read against', async () => {
    const gh = caseGh([plantedRun()]);
    const project = freshProject();

    const run = await ran(gh.seams, [`--branch=${BRANCH}`], project);

    expect(run.exitCode).toBe(0);
    expect(gh.made()).toEqual([project.root]);
  });

  it('refuses a stray word and a branch or workflow left out or blank, making no runner', async () => {
    const gh = caseGh([plantedRun()]);
    const lines: readonly (readonly [readonly string[], string])[] = [
      [['main', `--branch=${BRANCH}`], 'expected no argument, got 1: main'],
      [[], '--branch is required: --branch=<value>'],
      [['--branch= '], '--branch cannot be blank: --branch=<value>'],
      [[`--branch=${BRANCH}`, '--workflow= '], '--workflow cannot be blank: --workflow=<value>'],
    ];

    for (const [words, problem] of lines) {
      const run = await ran(gh.seams, words);
      expect([run.exitCode, run.stderr]).toEqual([4, expect.stringContaining(problem)]);
      expect(run.stderr).toContain(`Usage: ${CI_STATUS_USAGE}`);
    }
    expect(gh.made()).toEqual([]);
  });

  it('exits 4 naming gh for a workflow gh does not know, not 2 as a branch with no run would', async () => {
    const gh = caseGh([plantedRun()]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`, '--workflow=nightly']);

    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('could not find any workflows named nightly');
  });

  it('exits 4, not 1, when the log of a red run cannot be read for another reason', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })], { ok: false, stdout: '', stderr: 'HTTP 502\n' });

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('gh run view 37190089292 --log-failed failed: HTTP 502');
  });
});
