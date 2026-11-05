/**
 * Tests for `rafa ci status` (`status.ts`): one line per workflow on the
 * head commit and the verdict the worst of them, `--workflow` reading one
 * workflow's newest run, the four verdicts and their exit codes, the
 * failed cases of a red line by file and case, the json reading, and the
 * refusals.
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
 * that does send one; the skipped run newer than a failed one is read
 * beside the same runs under `--workflow` of the skipped workflow, which
 * reads green; the refusals read the runner factory's log beside a valid
 * line that does make a runner.
 */
import type { CiStatusSeams } from './status.js';
import type { FakeRun } from '../../ci/runs-fake.js';
import type { CiBranchReading } from '../../ci/status-reading.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { CliEvent } from '@open-tomato/rafa/ports';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeRunsGh, RECORDED_STRETCH_111 } from '../../ci/runs-fake.js';
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
function readingOf(events: readonly CliEvent[]): CiBranchReading {
  const event = events.find((held) => (held as { name?: string }).name === CI_STATUS_EVENT);
  if (event === undefined) throw new Error(`no ${CI_STATUS_EVENT} event among ${JSON.stringify(events)}`);
  return (event as unknown as { data: CiBranchReading }).data;
}

/** The fragment workflow, whose runs a skip makes green. */
const FRAGMENT = 'Release bot fragment';

/** The `90471b00` rows of the recorded `stretch/111`: a skipped fragment run newest, two failed `verify` runs. */
const PLANTED_PAIR = RECORDED_STRETCH_111.filter((run) => run.headSha.startsWith('90471b00'));

/** The `run list` calls `gh` got, as their flags. */
function listCalls(calls: readonly (readonly string[])[]): (readonly string[])[] {
  return calls.filter((call) => call[1] === 'list');
}

describe('rafa ci status over the recorded gh', () => {
  it('exits 0 on a green run, printing the headline, its line and short commit, and reads no log', async () => {
    const gh = caseGh([plantedRun()]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run)).toEqual([
      `✅ ${BRANCH}: green on ${SHORT}, 1 workflow.`,
      `   ✅ ${WORKFLOW} run 37190089292 is success.`,
    ]);
    expect(gh.calls().map((call) => call.slice(0, 2).join(' '))).toEqual(['run list', 'run list']);
  });

  it('reads the head commit through its newest run, then every run of that commit', async () => {
    const gh = caseGh([plantedRun()]);

    await ran(gh.seams, [`--branch=${BRANCH}`]);

    const [newest, head] = listCalls(gh.calls());
    expect(newest).toEqual(['run', 'list', '--branch', BRANCH, '--limit', '1', '--json', 'databaseId,workflowName,status,conclusion,headSha']);
    expect(head).toEqual(['run', 'list', '--branch', BRANCH, '--commit', SHA, '--limit', '100', '--json', 'databaseId,workflowName,status,conclusion,headSha']);
  });

  it('exits 1 on a red run, printing the failed cases by file and case, each once', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(1);
    const lines = linesOf(run);
    expect(lines.slice(0, 3)).toEqual([
      `❌ ${BRANCH}: red on ${SHORT}, 1 workflow.`,
      `   ❌ ${WORKFLOW} run 37190089292 is failure.`,
      `     ${GATE_FILE}`,
    ]);
    expect(lines.slice(3)).toHaveLength(3);
    expect(lines.slice(3).every((line) => line.startsWith('       - rafa loop start over a one-task fixture plan'))).toBe(true);
    expect(gh.calls().at(-1)).toEqual(['run', 'view', '37190089292', '--log-failed']);
  });

  it('exits 1 when a skipped run of one workflow is newer than a failed run of another on the head commit', async () => {
    const gh = caseGh([
      plantedRun({ databaseId: 11, conclusion: 'failure', createdAt: '2026-10-07T01:00:00Z' }),
      plantedRun({ databaseId: 12, workflowName: FRAGMENT, conclusion: 'skipped', createdAt: '2026-10-07T02:00:00Z' }),
    ]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(1);
    expect(linesOf(run).slice(0, 3)).toEqual([
      `❌ ${BRANCH}: red on ${SHORT}, 2 workflows.`,
      `   ✅ ${FRAGMENT} run 12 is skipped.`,
      `   ❌ ${WORKFLOW} run 11 is failure.`,
    ]);
    expect(gh.calls().filter((call) => call[1] === 'view')).toEqual([['run', 'view', '11', '--log-failed']]);
  });

  it('reads each workflow\'s newest run on the head commit, and no run of an older commit', async () => {
    const gh = caseGh(RECORDED_STRETCH_111);

    const run = await ran(gh.seams, ['--branch=stretch/111']);

    expect(run.exitCode).toBe(0);
    expect(linesOf(run)).toEqual([
      '✅ stretch/111: green on af33ef1, 2 workflows.',
      '   ✅ verify run 41462572168 is success.',
      `   ✅ ${FRAGMENT} run 41462566369 is skipped.`,
    ]);
    expect(gh.calls().filter((call) => call[1] === 'view')).toEqual([]);
  });

  it('holds the red verdict and exit 1 on the planted 90471b00 pair, a skipped run newest above two failed ones', async () => {
    const gh = caseGh(PLANTED_PAIR);

    const run = await ran(gh.seams, ['--branch=stretch/111']);
    const control = await ran(caseGh(PLANTED_PAIR).seams, ['--branch=stretch/111', `--workflow=${FRAGMENT}`]);

    expect(run.exitCode).toBe(1);
    expect(linesOf(run).slice(0, 3)).toEqual([
      '❌ stretch/111: red on 90471b0, 2 workflows.',
      `   ✅ ${FRAGMENT} run 41456634201 is skipped.`,
      '   ❌ verify run 41456633215 is failure.',
    ]);
    expect(control.exitCode).toBe(0);
  });

  it('exits 3 while one workflow is running beside a green one, and 1 once another is red beside it', async () => {
    const running = plantedRun({ databaseId: 21, workflowName: FRAGMENT, status: 'in_progress', conclusion: '', createdAt: '2026-10-07T02:00:00Z' });
    const green = plantedRun({ databaseId: 22, createdAt: '2026-10-07T01:00:00Z' });

    const held = await ran(caseGh([running, green]).seams, [`--branch=${BRANCH}`]);
    const red = await ran(caseGh([running, { ...green, conclusion: 'failure' }]).seams, [`--branch=${BRANCH}`]);

    expect([held.exitCode, linesOf(held)[0]]).toEqual([3, `⏳ ${BRANCH}: running on ${SHORT}, 2 workflows.`]);
    expect([red.exitCode, linesOf(red)[0]]).toEqual([1, `❌ ${BRANCH}: red on ${SHORT}, 2 workflows.`]);
  });

  it('exits 2 when the branch has no run, and reads only the runs of the branch it names', async () => {
    const gh = caseGh([plantedRun({ headBranch: 'main' })]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(2);
    expect(linesOf(run)).toEqual([`⚪ No run on ${BRANCH}.`]);
    expect(listCalls(gh.calls())).toHaveLength(1);
  });

  it('exits 3 while the newest run is in progress, though an older run of its workflow on the commit is green', async () => {
    const gh = caseGh([
      plantedRun({ databaseId: 1, createdAt: '2026-10-07T01:00:00Z' }),
      plantedRun({ databaseId: 2, status: 'in_progress', conclusion: '', createdAt: '2026-10-07T02:00:00Z' }),
    ]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(3);
    expect(linesOf(run)).toEqual([
      `⏳ ${BRANCH}: running on ${SHORT}, 1 workflow.`,
      `   ⏳ ${WORKFLOW} run 2 is in_progress.`,
    ]);
  });

  it('reads only the named workflow\'s newest run under --workflow, in one gh run list call naming it', async () => {
    const runs = [
      plantedRun({ databaseId: 31, conclusion: 'failure', createdAt: '2026-10-07T01:00:00Z' }),
      plantedRun({ databaseId: 32, workflowName: FRAGMENT, conclusion: 'skipped', createdAt: '2026-10-07T02:00:00Z' }),
    ];
    const verify = caseGh(runs);
    const fragment = caseGh(runs);

    const red = await ran(verify.seams, [`--branch=${BRANCH}`, `--workflow=${WORKFLOW}`]);
    const green = await ran(fragment.seams, [`--branch=${BRANCH}`, `--workflow=${FRAGMENT}`]);

    expect(red.exitCode).toBe(1);
    expect(linesOf(red).slice(0, 2)).toEqual([
      `❌ ${BRANCH} (${WORKFLOW}): red on ${SHORT}, 1 workflow.`,
      `   ❌ ${WORKFLOW} run 31 is failure.`,
    ]);
    expect(listCalls(verify.calls())).toEqual([
      ['run', 'list', '--branch', BRANCH, '--workflow', WORKFLOW, '--limit', '1', '--json', 'databaseId,workflowName,status,conclusion,headSha'],
    ]);
    expect(green.exitCode).toBe(0);
    expect(linesOf(green)).toEqual([
      `✅ ${BRANCH} (${FRAGMENT}): green on ${SHORT}, 1 workflow.`,
      `   ✅ ${FRAGMENT} run 32 is skipped.`,
    ]);
  });

  it('exits 2 under --workflow when the workflow has no run on the branch', async () => {
    const gh = createFakeRunsGh([plantedRun()], [FRAGMENT]);

    const run = await ran({ gh: () => gh.gh }, [`--branch=${BRANCH}`, `--workflow=${FRAGMENT}`]);

    expect(run.exitCode).toBe(2);
    expect(linesOf(run)).toEqual([`⚪ No run on ${BRANCH} (${FRAGMENT}).`]);
  });

  it('reads a red run whose log GitHub dropped as red, saying the cases cannot be read', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })], { ok: false, stdout: '', stderr: 'log not found\n' });

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(1);
    expect(linesOf(run)[2]).toBe('     The run\'s log is no longer on GitHub, so its failed cases cannot be read.');
  });

  it('reads a red run with no (fail) line as red outside the tests', async () => {
    const gh = caseGh([plantedRun({ conclusion: 'failure' })], { ok: true, stdout: '', stderr: '' });

    const run = await ran(gh.seams, [`--branch=${BRANCH}`]);

    expect(run.exitCode).toBe(1);
    expect(linesOf(run)[2]).toBe('     No bun test case failed: the run went red outside the tests.');
  });
});

describe('json mode', () => {
  it('writes the same reading as a ci-status event on a red run, one line per workflow with its cases by file', async () => {
    const gh = caseGh([
      plantedRun({ conclusion: 'failure', createdAt: '2026-10-07T01:00:00Z' }),
      plantedRun({ databaseId: 42, workflowName: FRAGMENT, conclusion: 'skipped', createdAt: '2026-10-07T02:00:00Z' }),
    ]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`, '--output=json']);

    expect(run.exitCode).toBe(1);
    const reading = readingOf(eventsOf(run.stdout));
    expect(reading).toMatchObject({ branch: BRANCH, workflow: null, commit: SHA, verdict: 'red', exitCode: 1 });
    expect(reading.workflows.map((line) => [line.workflow, line.verdict, line.run.id])).toEqual([
      [FRAGMENT, 'green', 42],
      [WORKFLOW, 'red', 37190089292],
    ]);
    const [fragment, verify] = reading.workflows;
    expect(fragment?.failed).toBeNull();
    expect(verify?.run).toEqual({ id: 37190089292, workflow: WORKFLOW, state: 'completed', conclusion: 'failure', commit: SHA });
    expect(verify?.failed?.map((file) => [file.file, file.cases.length])).toEqual([[GATE_FILE, 3]]);
  });

  it('writes the reading as the event and the terminal result on a green run', async () => {
    const gh = caseGh([plantedRun()]);

    const run = await ran(gh.seams, [`--branch=${BRANCH}`, `--workflow=${WORKFLOW}`, '--output=json']);

    expect(run.exitCode).toBe(0);
    const events = eventsOf(run.stdout);
    const reading = readingOf(events);
    expect(reading).toMatchObject({ workflow: WORKFLOW, verdict: 'green', exitCode: 0 });
    expect(reading.workflows.map((line) => line.failed)).toEqual([null]);
    expect((events.at(-1) as { data?: unknown }).data).toEqual(reading);
  });

  it('writes the none and running readings with their exit codes', async () => {
    const none = await ran(caseGh([]).seams, [`--branch=${BRANCH}`, '--output=json']);
    const running = await ran(
      caseGh([plantedRun({ status: 'queued', conclusion: '' })]).seams,
      [`--branch=${BRANCH}`, '--output=json'],
    );

    expect([none.exitCode, readingOf(eventsOf(none.stdout)).verdict]).toEqual([2, 'none']);
    expect(readingOf(eventsOf(none.stdout))).toMatchObject({ commit: null, workflows: [] });
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
