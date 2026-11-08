/**
 * Tests for the CI wait `rafa pr triage --resolve` runs after each
 * attempt (`waitForCi` in `./triage-resolve.ts`), over a pulls double
 * and a fake clock: no provider, no timer.
 *
 * The wait reads the pull request's detail after the attempt and hands
 * the head's committed time to `waitForChecks` (#1487), so the reading
 * that matters is whether a first poll of zero checks is polled again.
 * The two `none` cases come first, since they are the behaviour there
 * was before: a detail with no `headCommittedAt`, and a head older than
 * `FIRST_CHECK_GRACE_MS`. The young head is the case that could not
 * pass before the fix, and the old head is its control: the same double
 * and clock, a different time, a different ending.
 *
 * The clock advances only when the wait sleeps, by the interval it was
 * asked to sleep, so elapsed time reads exactly as the polls spent it.
 * The command's own flow over the recorded `gh` fake is driven in
 * `src/tests/pr-coupled/commands/pr/triage-resolve.test.ts`.
 */
import type { CiWaitRun } from './triage-resolve.js';
import type { CheckRow, PullRequestDetail } from '../../pr/index.js';
import type { Output } from '@open-tomato/rafa/ports';

import { describe, expect, it } from 'bun:test';

import { FIRST_CHECK_GRACE_MS, verdictOf } from '../../pr/index.js';

import { waitForCi } from './triage-resolve.js';

/** The instant the fake clock starts at. */
const NOW_MS = Date.parse('2026-11-08T10:00:00Z');

/** A head committed five seconds before the wait starts, well inside the grace. */
const YOUNG_HEAD = new Date(NOW_MS - 5_000).toISOString();

/** A head committed ten minutes before the wait starts, past the grace. */
const OLD_HEAD = new Date(NOW_MS - 600_000).toISOString();

/** The pull request number every case waits on. */
const NUMBER = 41;

/** A passing check, which the young head's second poll registers. */
const PASSING: CheckRow = { name: 'gates', state: 'SUCCESS', link: 'https://example.test/run/1', outcome: 'pass' };

/** A pull request detail whose head was committed at `headCommittedAt`. */
function detail(headCommittedAt: string | null): PullRequestDetail {
  return {
    number: NUMBER,
    title: 'rafa-1524: a resolve attempt',
    url: `https://github.com/open-tomato/rafa/pull/${String(NUMBER)}`,
    state: 'open',
    headRefName: 'feat/pr-41',
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-11-08T09:00:00Z',
    body: '',
    headRefOid: '1'.repeat(40),
    headCommittedAt,
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    closes: [],
  };
}

/** What a case reads back off the double after the wait. */
interface Waited {
  readonly result: Awaited<ReturnType<typeof waitForCi>>;
  /** Every provider call, in order, as `get` or `checks`. */
  readonly calls: readonly string[];
  /** How many times the wait slept. */
  readonly slept: number;
  /** Every progress line the wait wrote. */
  readonly lines: readonly string[];
}

/**
 * Runs the wait over a double answering `found` for the detail and
 * `polls[i]` for the i-th checks read, the last one repeated.
 */
async function waited(found: PullRequestDetail | null, polls: readonly (readonly CheckRow[])[]): Promise<Waited> {
  const calls: string[] = [];
  const lines: string[] = [];
  let at = NOW_MS;
  let slept = 0;
  const record = (message: string): void => {
    lines.push(message);
  };
  const output: Output = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    emit: () => undefined,
    result: () => undefined,
  };
  const run: CiWaitRun = {
    number: NUMBER,
    output,
    clock: () => at,
    sleep: async (ms) => {
      slept += 1;
      at += ms;
    },
    pulls: {
      get: async (number) => {
        calls.push(`get ${String(number)}`);
        return found;
      },
      checks: async (number) => {
        calls.push(`checks ${String(number)}`);
        const rows = polls[Math.min(calls.filter((call) => call.startsWith('checks')).length, polls.length) - 1] ?? [];
        return { rows, verdict: verdictOf(rows) };
      },
    },
  };
  const result = await waitForCi(run);
  return { result, calls, slept, lines };
}

describe('the CI wait after a resolve attempt', () => {
  it('ends none on the first poll when the detail carries no headCommittedAt, as before', async () => {
    const outcome = await waited(detail(null), [[]]);

    expect(outcome.result.verdict).toBe('none');
    expect(outcome.result.polls).toBe(1);
    expect(outcome.slept).toBe(0);
  });

  it('ends none on the first poll when the pull request is not found, which is no time either', async () => {
    const outcome = await waited(null, [[]]);

    expect(outcome.result.verdict).toBe('none');
    expect(outcome.result.polls).toBe(1);
  });

  it('ends none on the first poll for a head committed longer ago than the grace', async () => {
    const outcome = await waited(detail(OLD_HEAD), [[], [PASSING]]);

    expect(outcome.result.verdict).toBe('none');
    expect(outcome.result.polls).toBe(1);
    expect(outcome.slept).toBe(0);
  });

  it('polls a first empty reading again for a head committed inside the grace', async () => {
    const outcome = await waited(detail(YOUNG_HEAD), [[], [PASSING]]);

    expect(outcome.result.verdict).toBe('green');
    expect(outcome.result.polls).toBe(2);
    expect(outcome.slept).toBe(1);
    expect(outcome.lines[0]).toBe('   Checks are pending after 0s');
  });

  it('reads the detail once, ahead of the first checks poll', async () => {
    const outcome = await waited(detail(YOUNG_HEAD), [[], [PASSING]]);

    expect(outcome.calls).toEqual([`get ${String(NUMBER)}`, `checks ${String(NUMBER)}`, `checks ${String(NUMBER)}`]);
  });

  it('ends none once the grace has passed on a young head no check registers on', async () => {
    const outcome = await waited(detail(YOUNG_HEAD), [[]]);

    expect(outcome.result.verdict).toBe('none');
    expect(outcome.result.polls).toBeGreaterThan(1);
    expect(NOW_MS + outcome.result.elapsedMs - Date.parse(YOUNG_HEAD)).toBeGreaterThanOrEqual(FIRST_CHECK_GRACE_MS);
  });
});
