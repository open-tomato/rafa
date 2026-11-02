/**
 * The two waits before the merge of `rafa stretch item`
 * (`./item-checks.ts`), over a `gh` stand-in that answers `pr view` and
 * `pr checks` from one list per command, read by read, the last answer
 * kept for every read past it, and a clock that moves only when the wait
 * sleeps, so a bound is reached in sleeps counted against the constants.
 *
 * Zero rows is answered as `gh` 2.102.0 reports it, a failure whose
 * stderr reads `no checks reported on the '<branch>' branch`.
 *
 * Controls: a word that is neither `UNKNOWN` nor `CONFLICTING` is
 * answered with no sleep beside the `UNKNOWN` cases that sleep, and zero
 * rows read again and then green inside the grace beside zero rows that
 * outlast it, so the grace is seen to hold the wait open as well as end
 * it.
 */
import type { WaitSeams } from './item-checks.js';
import type { GhResult, GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';

import { describe, expect, it } from 'bun:test';

import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { FIRST_CHECK_GRACE_MS } from '@open-tomato/rafa-pr/pr/checks';

import {
  awaitChecks,
  awaitMergeability,
  CHECKS_POLL_MS,
  CHECKS_WAIT_MS,
  MERGEABILITY_POLL_MS,
  MERGEABILITY_WAIT_MS,
} from './item-checks.js';

const PR = 901;
const ISSUE = 812;
const TARGET = { issue: ISSUE, number: PR };
const RESUME = `rafa stretch item ${String(ISSUE)} --resume`;
const START = Date.parse('2026-11-02T09:00:00.000Z');

/** One read of `pr checks`: its rows, zero rows as `gh` reports them, or a failed read. */
type ChecksAnswer = readonly Readonly<Record<string, string>>[] | 'none' | 'fails';

const PENDING: ChecksAnswer = [{ name: 'fragment', state: 'IN_PROGRESS', link: '' }];
const PASSED: ChecksAnswer = [{ name: 'fragment', state: 'SKIPPED', link: '' }];
const FAILED: ChecksAnswer = [{ name: 'verify', state: 'FAILURE', link: 'https://example.test/runs/1' }];

/** What the stand-in answers, read by read. */
interface Answers {
  readonly mergeable?: readonly string[];
  readonly checks?: readonly ChecksAnswer[];
}

interface Case {
  readonly gh: GhRunner;
  readonly seams: WaitSeams;
  readonly context: { readonly output: ReturnType<typeof sinkOutput> };
  readonly lines: string[];
  readonly sleeps: number[];
  readonly reads: { view: number; checks: number };
}

/** The answer of read `index`, the last one kept past the list's end. */
function answerAt<T>(list: readonly T[] | undefined, index: number, command: string): T {
  const answer = list?.[Math.min(index, list.length - 1)];
  if (answer === undefined) throw new Error(`no ${command} answer planted`);
  return answer;
}

function ok(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

function plant(answers: Answers): Case {
  const lines: string[] = [];
  const sleeps: number[] = [];
  const reads = { view: 0, checks: 0 };
  let clock = START;
  const gh: GhRunner = async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      const mergeable = answerAt(answers.mergeable, reads.view, 'pr view');
      reads.view += 1;
      return Promise.resolve(ok(JSON.stringify({
        number: PR, state: 'OPEN', baseRefName: 'stretch/111', headRefName: 'feat/rafa-812-x', body: '', mergeCommit: null, mergeable,
      })));
    }
    if (args[0] === 'pr' && args[1] === 'checks') {
      const rows = answerAt(answers.checks, reads.checks, 'pr checks');
      reads.checks += 1;
      if (rows === 'fails') return Promise.resolve({ ok: false, stdout: '', stderr: 'HTTP 502: Bad Gateway\n' });
      return Promise.resolve(rows === 'none'
        ? { ok: false, stdout: '', stderr: 'no checks reported on the \'feat/rafa-812-x\' branch\n' }
        : ok(JSON.stringify(rows)));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `unplanted: gh ${args.join(' ')}` });
  };
  const seams: WaitSeams = {
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => new Date(clock),
  };
  return { gh, seams, context: { output: sinkOutput({ info: (line) => lines.push(line) }) }, lines, sleeps, reads };
}

/** `count` sleeps of `ms`. */
function sleepsOf(count: number, ms: number): number[] {
  return Array.from({ length: count }, () => ms);
}

describe('the bounds', () => {
  it('reads the mergeability every five seconds for two minutes, and the checks as rafa pr wait does by default', () => {
    expect([MERGEABILITY_POLL_MS, MERGEABILITY_WAIT_MS]).toEqual([5_000, 120_000]);
    expect([CHECKS_POLL_MS, CHECKS_WAIT_MS]).toEqual([20_000, 20 * 60_000]);
  });
});

describe('awaitMergeability', () => {
  it('reads an UNKNOWN pull request again until it reads MERGEABLE', async () => {
    const world = plant({ mergeable: ['UNKNOWN', 'MERGEABLE'] });

    const pull = await awaitMergeability(world.context, world.gh, TARGET, world.seams);

    expect(pull.mergeable).toBe('MERGEABLE');
    expect(world.reads.view).toBe(2);
    expect(world.sleeps).toEqual([MERGEABILITY_POLL_MS]);
    expect(world.lines).toEqual(['#901 mergeability: UNKNOWN', '#901 mergeability: MERGEABLE']);
  });

  it('refuses with exit 1 a pull request still UNKNOWN at the bound, naming it and --resume', async () => {
    const world = plant({ mergeable: ['UNKNOWN'] });

    const waited = awaitMergeability(world.context, world.gh, TARGET, world.seams);

    await expect(waited).rejects.toMatchObject({ exitCode: 1 });
    await expect(waited).rejects.toThrow('still reads UNKNOWN mergeability after 2 minutes');
    await expect(waited).rejects.toThrow(RESUME);
    expect(world.sleeps).toEqual(sleepsOf(MERGEABILITY_WAIT_MS / MERGEABILITY_POLL_MS, MERGEABILITY_POLL_MS));
    expect(world.reads.view).toBe(world.sleeps.length + 1);
    expect(world.lines).toHaveLength(world.reads.view);
  });

  it('refuses with exit 1 a CONFLICTING pull request at once, naming the word, rafa pr show and --resume', async () => {
    const world = plant({ mergeable: ['CONFLICTING', 'MERGEABLE'] });

    const waited = awaitMergeability(world.context, world.gh, TARGET, world.seams);

    await expect(waited).rejects.toMatchObject({ exitCode: 1 });
    await expect(waited).rejects.toThrow('#901 reads CONFLICTING');
    await expect(waited).rejects.toThrow('rafa pr show 901');
    await expect(waited).rejects.toThrow(RESUME);
    expect(world.sleeps).toEqual([]);
    expect(world.reads.view).toBe(1);
  });

  it('answers another word on the first read, leaving the refusal to rafa pr merge', async () => {
    const world = plant({ mergeable: ['BLOCKED', 'UNKNOWN'] });

    const pull = await awaitMergeability(world.context, world.gh, TARGET, world.seams);

    expect(pull.mergeable).toBe('BLOCKED');
    expect(world.sleeps).toEqual([]);
  });
});

describe('awaitChecks', () => {
  it('polls pending checks again until they are green', async () => {
    const world = plant({ checks: [PENDING, PASSED] });

    await awaitChecks(world.context, world.gh, TARGET, world.seams);

    expect(world.reads.checks).toBe(2);
    expect(world.sleeps).toEqual([CHECKS_POLL_MS]);
    expect(world.lines).toEqual([
      'waiting for the checks of #901, up to 20 minutes',
      'checks of #901 after 0s: pending\n   pending fragment — IN_PROGRESS',
      'checks of #901 after 20s: green\n   pass    fragment — SKIPPED',
    ]);
  });

  it('refuses with exit 1 checks still pending at the bound, naming it and --resume', async () => {
    const world = plant({ checks: [PENDING] });

    const waited = awaitChecks(world.context, world.gh, TARGET, world.seams);

    await expect(waited).rejects.toMatchObject({ exitCode: 1 });
    await expect(waited).rejects.toThrow('the checks of #901 had not ended after 20 minutes');
    await expect(waited).rejects.toThrow(RESUME);
    // The poll that would end at or past the bound is not slept.
    expect(world.sleeps).toEqual(sleepsOf(CHECKS_WAIT_MS / CHECKS_POLL_MS - 1, CHECKS_POLL_MS));
    expect(world.reads.checks).toBe(world.sleeps.length + 1);
  });

  it('refuses with exit 1 a failed check, naming rafa pr triage and --resume', async () => {
    const world = plant({ checks: [FAILED, PASSED] });

    const waited = awaitChecks(world.context, world.gh, TARGET, world.seams);

    await expect(waited).rejects.toMatchObject({ exitCode: 1 });
    await expect(waited).rejects.toThrow('rafa pr triage 901');
    await expect(waited).rejects.toThrow(RESUME);
    expect(world.sleeps).toEqual([]);
  });

  it('polls zero rows again inside the grace, and goes on when the checks turn green', async () => {
    const world = plant({ checks: ['none', PASSED] });

    await awaitChecks(world.context, world.gh, TARGET, world.seams);

    expect(world.reads.checks).toBe(2);
    expect(world.sleeps).toEqual([CHECKS_POLL_MS]);
    expect(world.lines[1]).toBe('checks of #901 after 0s: pending\n   (no checks reported)');
  });

  it('refuses with exit 1 zero rows past the grace, naming the merge by hand with --skip-checks and --resume', async () => {
    const world = plant({ checks: ['none'] });

    const waited = awaitChecks(world.context, world.gh, TARGET, world.seams);

    await expect(waited).rejects.toMatchObject({ exitCode: 1 });
    await expect(waited).rejects.toThrow('rafa pr merge 901 --skip-checks --yes');
    await expect(waited).rejects.toThrow(RESUME);
    expect(world.sleeps).toEqual(sleepsOf(FIRST_CHECK_GRACE_MS / CHECKS_POLL_MS, CHECKS_POLL_MS));
    expect(world.lines.at(-1)).toBe('checks of #901 after 120s: none\n   (no checks reported)');
  });

  it('fails with exit 2 when the checks cannot be read', async () => {
    const world = plant({ checks: ['fails'] });

    const waited = awaitChecks(world.context, world.gh, TARGET, world.seams);

    await expect(waited).rejects.toMatchObject({ exitCode: 2 });
    await expect(waited).rejects.toThrow('the checks of #901 could not be read');
    await expect(waited).rejects.toThrow('HTTP 502: Bad Gateway');
  });
});
