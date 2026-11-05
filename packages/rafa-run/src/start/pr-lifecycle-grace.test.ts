/**
 * Tests for the first-check grace in the run's CI gate
 * (`packages/rafa-run/src/start/pr-lifecycle.ts`).
 *
 * The gate reads the pull request before polling and hands its head
 * commit's time to `waitForChecks`. Every case plants the clock through
 * the `now` and `sleep` seams, so no timer, network or `gh` is reached:
 * `sleep` advances the planted clock and records itself.
 */
import type { PrLifecycleSeams } from './pr-lifecycle.js';
import type { ClaudeSettingSource } from '@open-tomato/rafa/core/config/sections';
import type { PrProviderReading, PullRequestDetail, PullRequestSummary } from '@open-tomato/rafa-pr/pr/index';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { FIRST_CHECK_GRACE_MS, parseChecks, verdictOf } from '@open-tomato/rafa-pr/pr/index';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { CI_POLL_INTERVAL_MS, verifyPullRequest } from './pr-lifecycle.js';

const BRANCH = 'feat/grace';
const PR = 77;
const SOURCES: readonly ClaudeSettingSource[] = ['local'];
const LONG_TIMEOUT_MS = 20 * 60_000;
/** The planted clock's start, in ms. */
const START_MS = Date.parse('2026-11-05T12:00:00Z');

const GH_READING: PrProviderReading = {
  provider: 'gh',
  source: 'config',
  remote: 'git@github.com:o/r.git',
  host: 'github.com',
};

const SUMMARY: PullRequestSummary = {
  number: PR,
  title: 'grace',
  url: `https://github.com/o/r/pull/${PR}`,
  state: 'open',
  headRefName: BRANCH,
  baseRefName: 'main',
  author: { login: 'octo', isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-11-05T12:00:00Z',
};

function detail(headCommittedAt: string | null): PullRequestDetail {
  return {
    ...SUMMARY,
    body: '',
    headRefOid: 'deadbeef',
    headCommittedAt,
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    closes: [],
  };
}

const NONE = 'no checks reported on the feat/grace branch';
const GREEN = JSON.stringify([{ name: 'test', state: 'SUCCESS', link: 'https://x/1' }]);

interface Run {
  readonly calls: string[];
  readonly seams: PrLifecycleSeams;
}

/**
 * `headCommittedAt` answers the first read of the PR (the head read) and
 * every later one (the merge-state read) alike. `probes` repeats its
 * last entry, so a run of empty polls needs one entry only.
 */
function plant(headCommittedAt: string | null, probes: readonly string[]): Run {
  const calls: string[] = [];
  let clock = START_MS;
  let polled = 0;
  const { pulls } = createPullRequestsDouble({
    findOpen: () => Promise.resolve(SUMMARY),
    get: () => {
      calls.push('pr get');
      return Promise.resolve(detail(headCommittedAt));
    },
    checks: () => {
      calls.push('pr checks');
      const raw = probes[Math.min(polled, probes.length - 1)] as string;
      polled += 1;
      const rows = parseChecks(raw);
      return Promise.resolve({ rows, verdict: verdictOf(rows) });
    },
  });
  const seams: PrLifecycleSeams = {
    currentBranch: () => BRANCH,
    readProvider: () => GH_READING,
    pushBranch: () => Promise.reject(new Error('unplanned push')),
    readRefusedPush: () => {
      throw new Error('unplanned claim read');
    },
    isGhUsable: () => Promise.resolve(true),
    pulls,
    runClaude: () => {
      calls.push('repair');
      return Promise.resolve(0);
    },
    now: () => clock,
    sleep: (ms) => {
      calls.push('sleep');
      clock += ms;
      return Promise.resolve();
    },
  };
  return { calls, seams };
}

const count = (calls: readonly string[], what: string): number => calls.filter((c) => c === what).length;

let logs: string[] = [];
let warnings: string[] = [];

beforeEach(() => {
  logs = [];
  warnings = [];
  setActiveOutput(sinkOutput({
    info: (m) => {
      logs.push(m);
    },
    warn: (m) => {
      warnings.push(m);
    },
    error: () => undefined,
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

describe('verifyPullRequest, first-check grace', () => {
  it('ends on the first empty poll when the provider answers no head time', async () => {
    const run = plant(null, [NONE]);

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, 'main', run.seams);

    expect(count(run.calls, 'pr checks')).toBe(1);
    expect(count(run.calls, 'sleep')).toBe(0);
    expect(count(run.calls, 'repair')).toBe(0);
    expect(warnings.some((w) => w.includes('reports no checks and is not conflicting'))).toBe(true);
    expect(warnings.some((w) => w.includes('Nothing to repair'))).toBe(true);
  });

  it('polls empty past FIRST_CHECK_GRACE_MS on a fresh head, then ends with nothing to repair', async () => {
    const committed = new Date(START_MS - 1000).toISOString();
    const run = plant(committed, [NONE]);

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, 'main', run.seams);

    const polls = count(run.calls, 'pr checks');
    expect(polls).toBeGreaterThan(1);
    expect(polls).toBe(Math.ceil(FIRST_CHECK_GRACE_MS / CI_POLL_INTERVAL_MS) + 1);
    expect(count(run.calls, 'sleep')).toBe(polls - 1);
    expect(count(run.calls, 'repair')).toBe(0);
    expect(warnings.some((w) => w.includes('Nothing to repair'))).toBe(true);
  });

  it('polls again after an empty first poll on a head committed seconds ago, and reads green with no repair', async () => {
    const committed = new Date(START_MS - 5000).toISOString();
    const run = plant(committed, [NONE, GREEN]);

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, 'main', run.seams);

    expect(count(run.calls, 'pr checks')).toBe(2);
    expect(count(run.calls, 'sleep')).toBe(1);
    expect(count(run.calls, 'repair')).toBe(0);
    expect(warnings).toEqual([]);
    expect(logs.some((l) => l.includes('CI green'))).toBe(true);
  });
});
