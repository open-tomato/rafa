/**
 * Tests for the reading of a branch's runs (`status-reading.ts`): the
 * verdict on a run and on a branch, the exit code of each verdict, the
 * newest run of each workflow, the failed-log reader and the per-workflow
 * reader over a stand-in `gh`, and the lines text mode prints for
 * readings built by hand.
 *
 * No case spawns `gh`, reads the disk past this folder's `testdata/` or
 * dispatches a command: every case that runs `rafa ci status` end to end
 * stays beside the command half (`commands/ci/status.test.ts`).
 *
 * The planted case is the `90471b00` rows of the recorded `stretch/111`
 * read (`RECORDED_STRETCH_111`, `./runs-fake.ts`): a skipped fragment run
 * newest, above two failed `verify` runs.
 *
 * Each reading sits beside its control: a passing conclusion beside the
 * failing ones, a log `gh` dropped beside a log it refused for another
 * reason, a red line's failed log read beside a green line's that is not,
 * and a red reading's case lines beside a reading of another verdict that
 * holds the same cases and prints none.
 */
import type { FakeRun } from './runs-fake.js';
import type { BranchRun } from './runs.js';
import type { CiStatusReading, CiVerdict, CiWorkflowReading } from './status-reading.js';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';

import { describe, expect, it } from 'bun:test';

import { RECORDED_STRETCH_111 } from './runs-fake.js';
import {
  branchReading,
  CI_STATUS_EXIT,
  newestPerWorkflow,
  PASSING_CONCLUSIONS,
  readFailedLog,
  readWorkflowReadings,
  renderCiBranch,
  renderCiStatus,
  SHORT_COMMIT_LENGTH,
  verdictOf,
  VERDICTS_WORST_FIRST,
  worstVerdict,
} from './status-reading.js';

/** The commit every hand-built run here ran on. */
const SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';

/** The planted commit of `stretch/111`, and how the text abbreviates it. */
const PLANTED_SHA = '90471b00a1d620a6e81f23c2dd625b3c36ae1511';
const PLANTED_SHORT = '90471b0';

/** The fragment workflow's name, as its runs carry it. */
const FRAGMENT = 'Release bot fragment';

/** The captured failed log of run 37190089292: three cases in one file. */
const THREE_CASES = await Bun.file(new URL('./testdata/three-cases.log-failed.txt', import.meta.url)).text();
const GATE_FILE = 'src/tests/task-gate-spawned.test.ts';

/** Every completed conclusion other than the passing ones, as GitHub documents them. */
const FAILING_CONCLUSIONS = ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'];

/** A finished run with `fields` over a green one. */
function runWith(fields: Partial<BranchRun> = {}): BranchRun {
  return { id: 41, workflow: 'verify', state: 'completed', conclusion: 'success', commit: SHA, ...fields };
}

/** A recorded row as the reader answers it. */
function branchRunOf(row: FakeRun): BranchRun {
  return {
    id: row.databaseId,
    workflow: row.workflowName,
    state: row.status,
    conclusion: row.conclusion === ''
      ? null
      : row.conclusion,
    commit: row.headSha,
  };
}

/** The planted runs, newest first, as `readHeadRuns` answers them. */
const PLANTED: readonly BranchRun[] = RECORDED_STRETCH_111.filter((row) => row.headSha === PLANTED_SHA).map(branchRunOf);

/** A single-run reading of `run` on `stretch/9` with `fields` over what its verdict gives. */
function readingOf(run: BranchRun | null, fields: Partial<CiStatusReading> = {}): CiStatusReading {
  const verdict = verdictOf(run);
  return { branch: 'stretch/9', workflow: null, verdict, run, failed: null, exitCode: CI_STATUS_EXIT[verdict], ...fields };
}

/** A workflow line of `run` with `fields` over what its verdict gives. */
function lineOf(run: BranchRun, fields: Partial<CiWorkflowReading> = {}): CiWorkflowReading {
  return { workflow: run.workflow, verdict: verdictOf(run), run, failed: null, ...fields };
}

/** A runner answering every call with `answer`, and the calls it got. */
function answering(answer: GhResult): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    gh: (args) => {
      calls.push([...args]);
      return Promise.resolve(answer);
    },
    calls,
  };
}

describe('CI_STATUS_EXIT', () => {
  it('gives each verdict an exit code of its own, 0 for green alone', () => {
    const verdicts: readonly CiVerdict[] = ['green', 'red', 'none', 'running'];

    expect(verdicts.map((verdict) => CI_STATUS_EXIT[verdict])).toEqual([0, 1, 2, 3]);
    expect(Object.keys(CI_STATUS_EXIT).sort()).toEqual([...verdicts].sort());
  });
});

describe('verdictOf', () => {
  it('reads success, skipped and neutral as green, and every other conclusion, or none, as red', () => {
    expect(PASSING_CONCLUSIONS).toEqual(['success', 'skipped', 'neutral']);
    expect(PASSING_CONCLUSIONS.map((conclusion) => verdictOf(runWith({ conclusion })))).toEqual(['green', 'green', 'green']);
    expect(FAILING_CONCLUSIONS.map((conclusion) => verdictOf(runWith({ conclusion }))))
      .toEqual(FAILING_CONCLUSIONS.map(() => 'red'));
    expect(verdictOf(runWith({ conclusion: null }))).toBe('red');
    expect(verdictOf(runWith({ conclusion: 'Success' }))).toBe('red');
  });

  it('reads an unfinished run as running, whatever its conclusion, and no run as none', () => {
    for (const state of ['queued', 'in_progress', 'requested', 'waiting', 'pending'] as const) {
      expect(verdictOf(runWith({ state, conclusion: null }))).toBe('running');
      expect(verdictOf(runWith({ state, conclusion: 'failure' }))).toBe('running');
    }
    expect(verdictOf(null)).toBe('none');
  });
});

describe('worstVerdict', () => {
  it('orders the verdicts red, running, green, none, and reads an empty list as none', () => {
    expect(VERDICTS_WORST_FIRST).toEqual(['red', 'running', 'green', 'none']);
    expect(worstVerdict([])).toBe('none');
    expect(worstVerdict(['none'])).toBe('none');
    expect(worstVerdict(['green', 'none'])).toBe('green');
    expect(worstVerdict(['green', 'running', 'green'])).toBe('running');
    expect(worstVerdict(['green', 'running', 'red'])).toBe('red');
  });

  it('reads the same verdict whatever order the list comes in', () => {
    const lists: readonly CiVerdict[][] = [['green', 'red'], ['red', 'green'], ['running', 'red', 'green'], ['green', 'running']];

    expect(lists.map(worstVerdict)).toEqual(['red', 'red', 'red', 'running']);
  });
});

describe('newestPerWorkflow', () => {
  it('keeps the first run of each workflow in the order they come, so the planted fragment skip and the newer verify run', () => {
    expect(PLANTED.map((run) => run.id)).toEqual([41456634201, 41456633215, 41456159309]);
    expect(newestPerWorkflow(PLANTED).map((run) => [run.workflow, run.id]))
      .toEqual([[FRAGMENT, 41456634201], ['verify', 41456633215]]);
  });

  it('answers every run when no workflow repeats, and nothing for no run', () => {
    const runs = [runWith({ id: 3, workflow: 'a' }), runWith({ id: 2, workflow: 'b' }), runWith({ id: 1, workflow: 'c' })];

    expect(newestPerWorkflow(runs)).toEqual(runs);
    expect(newestPerWorkflow([])).toEqual([]);
  });
});

describe('readFailedLog', () => {
  it('asks gh for the failed log of the run it is given and answers its stdout', async () => {
    const stand = answering({ ok: true, stdout: 'the log\n', stderr: '' });

    expect(await readFailedLog(stand.gh, 41)).toBe('the log\n');
    expect(stand.calls).toEqual([['run', 'view', '41', '--log-failed']]);
  });

  it('answers null for a log gh dropped, and throws for a log it refused for another reason', async () => {
    const dropped = answering({ ok: false, stdout: '', stderr: 'log not found\n' });
    const refused = answering({ ok: false, stdout: '', stderr: 'HTTP 502\n' });

    expect(await readFailedLog(dropped.gh, 41)).toBeNull();
    await expect(readFailedLog(refused.gh, 41)).rejects.toThrow('gh run view 41 --log-failed failed: HTTP 502');
  });

  it('names stdout, then a fixed phrase, when a failed gh wrote nothing to stderr', async () => {
    const onStdout = answering({ ok: false, stdout: 'on stdout\n', stderr: '' });
    const silent = answering({ ok: false, stdout: '', stderr: '' });

    await expect(readFailedLog(onStdout.gh, 41)).rejects.toThrow('failed: on stdout');
    await expect(readFailedLog(silent.gh, 41)).rejects.toThrow('failed: it exited non-zero and wrote nothing');
  });
});

describe('readWorkflowReadings', () => {
  it('reads one line per planted workflow, the skip green, and the failed log of the red verify run alone', async () => {
    const stand = answering({ ok: true, stdout: THREE_CASES, stderr: '' });

    const lines = await readWorkflowReadings(stand.gh, PLANTED);

    expect(lines.map((line) => [line.workflow, line.run.id, line.verdict])).toEqual([
      [FRAGMENT, 41456634201, 'green'],
      ['verify', 41456633215, 'red'],
    ]);
    expect(stand.calls).toEqual([['run', 'view', '41456633215', '--log-failed']]);
    expect(lines[0]?.failed).toBeNull();
    expect(lines[1]?.failed?.map((file) => [file.file, file.cases.length])).toEqual([[GATE_FILE, 3]]);
  });

  it('sends nothing for lines that are not red, and reads a dropped log of a red one as null', async () => {
    const quiet = answering({ ok: true, stdout: THREE_CASES, stderr: '' });
    const dropped = answering({ ok: false, stdout: '', stderr: 'log not found\n' });
    const passing = [runWith({ conclusion: 'skipped' }), runWith({ id: 40, workflow: 'lint', state: 'in_progress', conclusion: null })];

    expect((await readWorkflowReadings(quiet.gh, passing)).map((line) => line.verdict)).toEqual(['green', 'running']);
    expect(quiet.calls).toEqual([]);
    expect(await readWorkflowReadings(dropped.gh, [runWith({ conclusion: 'cancelled' })]))
      .toEqual([lineOf(runWith({ conclusion: 'cancelled' }), { failed: null })]);
    expect(dropped.calls).toEqual([['run', 'view', '41', '--log-failed']]);
  });

  it('answers no line for no run, and throws for a log gh refused', async () => {
    const refused = answering({ ok: false, stdout: '', stderr: 'HTTP 502\n' });

    expect(await readWorkflowReadings(refused.gh, [])).toEqual([]);
    await expect(readWorkflowReadings(refused.gh, PLANTED)).rejects.toThrow('gh run view 41456633215 --log-failed failed: HTTP 502');
  });
});

describe('branchReading', () => {
  it('reads the planted pair red, exit code 1, on its commit, though the newest run is a skip', () => {
    const lines = newestPerWorkflow(PLANTED).map((run) => lineOf(run));

    const reading = branchReading('stretch/111', null, lines);

    expect([reading.verdict, reading.exitCode, reading.commit, reading.workflows.length]).toEqual(['red', 1, PLANTED_SHA, 2]);
    expect(branchReading('stretch/111', null, lines.slice(0, 1)).verdict).toBe('green');
  });

  it('reads the worst of its lines, and no line as none with no commit', () => {
    const green = lineOf(runWith({ workflow: 'a' }));
    const running = lineOf(runWith({ workflow: 'b', state: 'queued', conclusion: null }));

    expect(branchReading('stretch/9', null, [green, running])).toMatchObject({ verdict: 'running', exitCode: 3, commit: SHA });
    expect(branchReading('stretch/9', 'verify', [])).toEqual({
      branch: 'stretch/9',
      workflow: 'verify',
      commit: null,
      verdict: 'none',
      workflows: [],
      exitCode: 2,
    });
  });

  it('refuses two lines of one workflow and lines of two commits', () => {
    const first = lineOf(runWith());
    const other = 'a'.repeat(40);

    expect(() => branchReading('stretch/9', null, [first, lineOf(runWith({ id: 40 }))]))
      .toThrow('ci status: two lines of the workflow verify, expected one per workflow');
    expect(() => branchReading('stretch/9', null, [first, lineOf(runWith({ workflow: 'lint', commit: other }))]))
      .toThrow(`ci status: lines of the commits ${SHA}, ${other}, expected one commit`);
  });
});

describe('renderCiBranch', () => {
  it('prints the planted pair as a red headline and one line per workflow, the verify cases under its line', () => {
    const lines = [
      lineOf(PLANTED[0] as BranchRun),
      lineOf(PLANTED[1] as BranchRun, { failed: [{ file: 'src/a.test.ts', cases: ['first'] }] }),
    ];

    expect(renderCiBranch(branchReading('stretch/111', null, lines))).toEqual([
      `❌ stretch/111: red on ${PLANTED_SHORT}, 2 workflows.`,
      `   ✅ ${FRAGMENT} run 41456634201 is skipped.`,
      '   ❌ verify run 41456633215 is failure.',
      '     src/a.test.ts',
      '       - first',
    ]);
  });

  it('prints one line for no run, naming the workflow when the reading holds one', () => {
    expect(renderCiBranch(branchReading('stretch/9', null, []))).toEqual(['⚪ No run on stretch/9.']);
    expect(renderCiBranch(branchReading('stretch/9', 'verify', []))).toEqual(['⚪ No run on stretch/9 (verify).']);
  });

  it('names one workflow in the singular, and prints the status of an unfinished run', () => {
    const short = SHA.slice(0, SHORT_COMMIT_LENGTH);
    const running = lineOf(runWith({ state: 'in_progress', conclusion: null }));

    expect(renderCiBranch(branchReading('stretch/9', 'verify', [running]))).toEqual([
      `⏳ stretch/9 (verify): running on ${short}, 1 workflow.`,
      '   ⏳ verify run 41 is in_progress.',
    ]);
  });

  it('prints a red line\'s gone log and empty case list, and no case line under a line that is not red', () => {
    const gone = lineOf(runWith({ conclusion: 'failure' }), { failed: null });
    const outside = lineOf(runWith({ workflow: 'lint', conclusion: 'timed_out' }), { failed: [] });
    const held = lineOf(runWith({ workflow: 'docs' }), { failed: [{ file: 'src/a.test.ts', cases: ['first'] }] });

    expect(renderCiBranch(branchReading('stretch/9', null, [gone, outside, held])).slice(1)).toEqual([
      '   ❌ verify run 41 is failure.',
      '     The run\'s log is no longer on GitHub, so its failed cases cannot be read.',
      '   ❌ lint run 41 is timed_out.',
      '     No bun test case failed: the run went red outside the tests.',
      '   ✅ docs run 41 is success.',
    ]);
  });
});

describe('renderCiStatus', () => {
  it('prints one line for no run, naming the workflow when the reading holds one', () => {
    expect(renderCiStatus(readingOf(null))).toEqual(['⚪ No run on stretch/9.']);
    expect(renderCiStatus(readingOf(null, { workflow: 'verify' }))).toEqual(['⚪ No run on stretch/9 (verify).']);
  });

  it('prints the conclusion of a finished run and the status of an unfinished one, on the short commit', () => {
    const short = SHA.slice(0, SHORT_COMMIT_LENGTH);

    expect(short).toBe('c4da2c4');
    expect(renderCiStatus(readingOf(runWith()))).toEqual([`✅ stretch/9: verify run 41 is success on ${short}.`]);
    expect(renderCiStatus(readingOf(runWith({ conclusion: 'skipped' })))).toEqual([`✅ stretch/9: verify run 41 is skipped on ${short}.`]);
    expect(renderCiStatus(readingOf(runWith({ state: 'in_progress', conclusion: null }))))
      .toEqual([`⏳ stretch/9: verify run 41 is in_progress on ${short}.`]);
    expect(renderCiStatus(readingOf(runWith({ conclusion: null }))))
      .toEqual([`❌ stretch/9: verify run 41 is completed on ${short}.`, '   The run\'s log is no longer on GitHub, so its failed cases cannot be read.']);
  });

  it('prints a red run\'s failed cases by file, and none of them for a reading that is not red', () => {
    const failed = [
      { file: 'src/a.test.ts', cases: ['first', 'second'] },
      { file: null, cases: ['third'] },
    ];
    const red = readingOf(runWith({ conclusion: 'failure' }), { failed });

    expect(renderCiStatus(red).slice(1)).toEqual([
      '   src/a.test.ts',
      '     - first',
      '     - second',
      '   (no file named)',
      '     - third',
    ]);
    expect(renderCiStatus(readingOf(runWith(), { failed }))).toHaveLength(1);
  });

  it('says a red run with no failed case went red outside the tests', () => {
    const red = readingOf(runWith({ conclusion: 'failure' }), { failed: [] });

    expect(renderCiStatus(red).slice(1)).toEqual(['   No bun test case failed: the run went red outside the tests.']);
  });
});
