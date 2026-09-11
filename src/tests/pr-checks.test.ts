/**
 * Tests for the wrap-up stage's CI gate (tools/ralph/utils/pr.ts).
 *
 * Everything here is driven through injected probes and an injected
 * clock, so no `gh`, no network and no real timers are involved. The
 * JSON fixtures are the shapes `gh pr checks --json name,state,link`
 * actually emitted for this repo, including the plain-text message it
 * writes when a PR has no checks at all.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyState,
  failingRows,
  formatRows,
  parseChecks,
  verdictOf,
  waitForChecks,
} from '../utils/pr.js';

const JOB = 'https://github.com/o/r/actions/runs/1/job/2';

function rowsJson(states: Record<string, string>): string {
  const entries = Object.entries(states);
  const mapped = entries.map(([name, state]) => ({ name, state, link: JOB }));
  return JSON.stringify(mapped);
}

describe('classifyState', () => {
  it('maps GitHub success states to pass', () => {
    expect(classifyState('SUCCESS')).toBe('pass');
    expect(classifyState('SKIPPED')).toBe('pass');
    expect(classifyState('NEUTRAL')).toBe('pass');
  });

  it('maps failure states to fail', () => {
    expect(classifyState('FAILURE')).toBe('fail');
    expect(classifyState('CANCELLED')).toBe('fail');
    expect(classifyState('TIMED_OUT')).toBe('fail');
  });

  it('maps in-flight states to pending', () => {
    expect(classifyState('PENDING')).toBe('pending');
    expect(classifyState('IN_PROGRESS')).toBe('pending');
    expect(classifyState('QUEUED')).toBe('pending');
  });

  it('treats an unknown state as pending, never as pass', () => {
    // A wrong green here lands a plan CI never agreed with; waiting is
    // recoverable because the deadline ends it.
    expect(classifyState('SOMETHING_NEW')).toBe('pending');
    expect(classifyState('')).toBe('pending');
  });

  it('is case-insensitive and tolerates surrounding space', () => {
    expect(classifyState('  success ')).toBe('pass');
  });
});

describe('parseChecks', () => {
  it('parses the three-job shape this repo emits', () => {
    const rows = parseChecks(rowsJson({
      checks: 'SUCCESS',
      test: 'SUCCESS',
      visual: 'FAILURE',
    }));

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['checks', 'test', 'visual']);
    expect(rows.map((r) => r.outcome)).toEqual(['pass', 'pass', 'fail']);
  });

  it('keeps the raw state so an unknown one stays reportable', () => {
    const rows = parseChecks(rowsJson({ checks: 'WEIRD' }));
    expect(rows[0]?.state).toBe('WEIRD');
    expect(rows[0]?.outcome).toBe('pending');
  });

  it('returns no rows for the no-checks-reported message', () => {
    // `gh` writes this as plain text and exits non-zero, which is why the
    // exit code cannot carry the verdict.
    expect(parseChecks('no checks reported on the \'x\' branch')).toEqual([]);
  });

  it('returns no rows for empty or malformed output', () => {
    expect(parseChecks('')).toEqual([]);
    expect(parseChecks('[not json')).toEqual([]);
    expect(parseChecks('{"name":"x"}')).toEqual([]);
  });
});

describe('verdictOf', () => {
  it('reports none when there are no rows', () => {
    expect(verdictOf([])).toBe('none');
  });

  it('reports green when every row passed', () => {
    const rows = parseChecks(rowsJson({ a: 'SUCCESS', b: 'SKIPPED' }));
    expect(verdictOf(rows)).toBe('green');
  });

  it('reports red when any row failed', () => {
    const rows = parseChecks(rowsJson({ a: 'SUCCESS', b: 'FAILURE' }));
    expect(verdictOf(rows)).toBe('red');
  });

  it('lets pending outrank failure on a partial reading', () => {
    // Half a run is not a verdict: a job can be red while another is
    // still going, and calling that red would repair against a moving
    // target.
    const rows = parseChecks(rowsJson({ a: 'FAILURE', b: 'IN_PROGRESS' }));
    expect(verdictOf(rows)).toBe('pending');
  });
});

describe('failingRows and formatRows', () => {
  it('selects only the failing rows', () => {
    const rows = parseChecks(rowsJson({ a: 'SUCCESS', b: 'FAILURE' }));
    expect(failingRows(rows).map((r) => r.name)).toEqual(['b']);
  });

  it('names the check, its raw state and its link', () => {
    const rows = parseChecks(rowsJson({ visual: 'FAILURE' }));
    const text = formatRows(rows);

    expect(text).toContain('visual');
    expect(text).toContain('FAILURE');
    expect(text).toContain(JOB);
  });

  it('says so when there are no checks', () => {
    expect(formatRows([])).toContain('no checks reported');
  });
});

describe('waitForChecks', () => {
  const noSleep = (): Promise<void> => Promise.resolve();

  it('returns green on the first poll when CI already passed', async () => {
    const result = await waitForChecks({
      probe: () => Promise.resolve(rowsJson({ checks: 'SUCCESS' })),
      timeoutMs: 60_000,
      intervalMs: 1_000,
      sleep: noSleep,
    });

    expect(result.verdict).toBe('green');
    expect(result.polls).toBe(1);
  });

  it('keeps polling while checks are in flight', async () => {
    const states = ['PENDING', 'IN_PROGRESS', 'SUCCESS'];
    let call = 0;
    const probe = (): Promise<string> => {
      const state = states[call] ?? 'SUCCESS';
      call += 1;
      return Promise.resolve(rowsJson({ checks: state }));
    };

    const result = await waitForChecks({
      probe,
      timeoutMs: 60_000,
      intervalMs: 1_000,
      sleep: noSleep,
    });

    expect(result.verdict).toBe('green');
    expect(result.polls).toBe(3);
  });

  it('returns none immediately rather than waiting out the clock', async () => {
    // A PR with no checks is conflicting or unmatched by any workflow;
    // neither resolves by waiting, so burning the deadline is wasted.
    const result = await waitForChecks({
      probe: () => Promise.resolve('no checks reported'),
      timeoutMs: 600_000,
      intervalMs: 1_000,
      sleep: noSleep,
    });

    expect(result.verdict).toBe('none');
    expect(result.polls).toBe(1);
  });

  it('gives up at the deadline instead of polling forever', async () => {
    let clock = 0;
    const result = await waitForChecks({
      probe: () => Promise.resolve(rowsJson({ checks: 'IN_PROGRESS' })),
      timeoutMs: 10_000,
      intervalMs: 2_000,
      now: () => {
        clock += 2_000;
        return clock;
      },
      sleep: noSleep,
    });

    expect(result.verdict).toBe('timeout');
    expect(result.rows).toHaveLength(1);
  });

  it('reports every poll to the caller', async () => {
    const seen: string[] = [];
    await waitForChecks({
      probe: () => Promise.resolve(rowsJson({ checks: 'FAILURE' })),
      timeoutMs: 10_000,
      intervalMs: 1_000,
      sleep: noSleep,
      onPoll: (_rows, verdict) => {
        seen.push(verdict);
      },
    });

    expect(seen).toEqual(['red']);
  });
});
