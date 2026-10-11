/**
 * Tests for the reading of a branch's newest run (`status-reading.ts`):
 * the exit code of each verdict, the failed-log reader over a stand-in
 * `gh`, and the lines text mode prints for a reading built by hand.
 *
 * No case spawns `gh`, reads the disk or dispatches a command: the
 * verdict's own cases and every case that runs `rafa ci status` end to
 * end stay beside the command half (`commands/ci/status.test.ts`).
 *
 * Each reading sits beside its control: a log `gh` dropped beside a log
 * it refused for another reason, and a red reading's case lines beside a
 * reading of another verdict that holds the same cases and prints none.
 */
import type { BranchRun } from './runs.js';
import type { CiStatusReading, CiVerdict } from './status-reading.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import {
  CI_STATUS_EXIT,
  readFailedLog,
  renderCiStatus,
  SHORT_COMMIT_LENGTH,
  verdictOf,
} from './status-reading.js';

/** The commit every run here ran on. */
const SHA = 'c4da2c4c63b2e9d585d3a76ffbda1c49e3ce60d1';

/** A finished run with `fields` over a green one. */
function runWith(fields: Partial<BranchRun> = {}): BranchRun {
  return { id: 41, workflow: 'verify', state: 'completed', conclusion: 'success', commit: SHA, ...fields };
}

/** A reading of `run` on `stretch/9` with `fields` over what its verdict gives. */
function readingOf(run: BranchRun | null, fields: Partial<CiStatusReading> = {}): CiStatusReading {
  const verdict = verdictOf(run);
  return { branch: 'stretch/9', workflow: null, verdict, run, failed: null, exitCode: CI_STATUS_EXIT[verdict], ...fields };
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

describe('renderCiStatus', () => {
  it('prints one line for no run, naming the workflow when the reading holds one', () => {
    expect(renderCiStatus(readingOf(null))).toEqual(['⚪ No run on stretch/9.']);
    expect(renderCiStatus(readingOf(null, { workflow: 'verify' }))).toEqual(['⚪ No run on stretch/9 (verify).']);
  });

  it('prints the conclusion of a finished run and the status of an unfinished one, on the short commit', () => {
    const short = SHA.slice(0, SHORT_COMMIT_LENGTH);

    expect(short).toBe('c4da2c4');
    expect(renderCiStatus(readingOf(runWith()))).toEqual([`✅ stretch/9: verify run 41 is success on ${short}.`]);
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
