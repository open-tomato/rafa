/**
 * Tests for the run's CI gate (`src/start/pr-lifecycle.ts`).
 *
 * Every case drives {@link verifyPullRequest} through a complete stub of
 * its seams, so no `gh`, no git, no Claude session and no timer is
 * reached. The stub answers from a script, and a poll, merge read or
 * repair session the script did not plan throws, failing the case
 * rather than reaching for the real helper. The check rows are the
 * `gh pr checks --json name,state,link` shape `src/pr/checks.test.ts`
 * parses.
 *
 * There is one case per verdict branch, and each pins the whole sequence
 * of effects rather than one printed line. A branch that falls through
 * to its neighbour prints its own line first, so a presence check alone
 * passes a gate that repairs a green PR, or polls again after a repair
 * session failed; the sequence does not.
 *
 * Fifteen mutations of `pr-lifecycle.ts` were driven against this file
 * alone, and every one reddened at least one case, with the module
 * restored byte-identical and green either side: the `gh` check never
 * refusing, a merged PR not recognised, the conflict test inverted, an
 * unreadable merge state read as clean, a failed CI-repair or
 * conflict-repair session ignored, the last-attempt check dropped, a
 * timeout not read as settled, the attempt loop one short, a default
 * seam replaced by a stub, the repair prompt left unstamped, the repair
 * handed every row, a 10 s poll, the merge state read before the
 * last-attempt check, and the wait seam not passed on. That last one
 * reddens only through the runner's 5 s case timeout, the real 20 s
 * wait outlasting it, and not through any assertion. Leg counts are not
 * recorded; they drift with every case added here.
 *
 * Once the gate wrote through the active output, three level mutations
 * were driven on 2026-09-15, each restored sha256-identical. The deadline
 * warning at `info` reddened the deadline case. A failed CI-repair session
 * at `warn` reddened the case stopping after one. The poll line at `warn`
 * reddened the green case and both zero-attempt cases.
 *
 * Every repair session records the setting sources it was handed beside
 * its prompt. The sources the cases hand over are not the default, so a
 * gate that bound the default in their place reddens.
 *
 * Bun runs every test file in one process and the plan stub is module
 * state, so the one case that sets a stub is followed by a reset to null.
 */
import type { PrLifecycleSeams } from './pr-lifecycle.js';
import type { ClaudeSettingSource } from '../config.js';

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { classifyPromptContent } from '../effort/classify.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { runClaude } from '../utils/claude.js';
import { getCurrentBranch } from '../utils/git.js';
import { planStubFromPrompt } from '../utils/plan-stamp.js';
import {
  findOpenPullRequest,
  isGhUsable,
  probeChecks,
  readMergeState,
} from '../utils/pr.js';

import {
  CI_POLL_INTERVAL_MS,
  DEFAULT_CI_ATTEMPTS,
  DEFAULT_CI_TIMEOUT_MIN,
  PR_LIFECYCLE_SEAMS,
  verifyPullRequest,
} from './pr-lifecycle.js';
import { setActivePlanStub } from './stamp.js';

const BRANCH = 'feat/ci-gate';
const PR = 61;
const JOB = 'https://github.com/o/r/actions/runs/1/job/2';

/**
 * The setting sources the cases hand the gate: not the default, so a
 * gate that bound the default in their place reddens.
 */
const SOURCES: readonly ClaudeSettingSource[] = ['local', 'user'];

/** A timeout the first poll cannot reach, so only a verdict ends it. */
const LONG_TIMEOUT_MS = 20 * 60_000;

/** `gh pr checks --json name,state,link` stdout for the given states. */
function checks(states: Record<string, string>): string {
  const entries = Object.entries(states);
  return JSON.stringify(entries.map(([name, state]) => ({ name, state, link: JOB })));
}

const GREEN = checks({ lint: 'SUCCESS', test: 'SUCCESS' });
const RED = checks({ lint: 'SUCCESS', test: 'FAILURE' });
const PENDING = checks({ lint: 'SUCCESS', test: 'IN_PROGRESS' });

/** What `gh pr checks` writes for a PR with no checks: not JSON at all. */
const NONE = 'no checks reported on the feat/ci-gate branch';

type MergeState = ReturnType<PrLifecycleSeams['readMergeState']>;

const MERGED: MergeState = {
  mergeable: 'UNKNOWN',
  mergeStateStatus: 'UNKNOWN',
  state: 'MERGED',
};
const CLEAN: MergeState = {
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  state: 'OPEN',
};
const DIRTY: MergeState = {
  mergeable: 'CONFLICTING',
  mergeStateStatus: 'DIRTY',
  state: 'OPEN',
};

/** What a case plans for the stubbed effects to answer, in order. */
interface Script {
  readonly ghUsable?: boolean;
  readonly prNumber?: number | null;
  readonly probes?: readonly string[];
  readonly merges?: readonly MergeState[];
  readonly exits?: readonly number[];
}

/** A complete seam object, and what was done through it. */
interface Stubbed {
  readonly seams: PrLifecycleSeams;
  /** Every effect, in the order it was reached. */
  readonly calls: string[];
  /** Every prompt a repair session was handed. */
  readonly prompts: string[];
  /** The setting sources each repair session was handed, in order. */
  readonly sources: (readonly ClaudeSettingSource[])[];
}

/** Answers a planned queue one entry per call, and throws past its end. */
function answer<T>(queue: readonly T[], what: string): () => T {
  let taken = 0;
  return () => {
    if (taken >= queue.length) throw new Error(`unplanned ${what}`);
    const value = queue[taken] as T;
    taken += 1;
    return value;
  };
}

function stub(script: Script): Stubbed {
  const calls: string[] = [];
  const prompts: string[] = [];
  const sources: (readonly ClaudeSettingSource[])[] = [];
  const nextProbe = answer(script.probes ?? [], 'poll');
  const nextMerge = answer(script.merges ?? [], 'merge-state read');
  const nextExit = answer(script.exits ?? [], 'repair session');
  let clock = 0;

  const seams: PrLifecycleSeams = {
    currentBranch: () => BRANCH,
    isGhUsable: () => {
      calls.push('gh auth status');
      return script.ghUsable ?? true;
    },
    findOpenPullRequest: (branch) => {
      calls.push(`pr list ${branch}`);
      return script.prNumber === undefined
        ? PR
        : script.prNumber;
    },
    probeChecks: (prNumber) => {
      calls.push(`pr checks ${prNumber}`);
      return nextProbe();
    },
    readMergeState: (prNumber) => {
      calls.push(`pr view ${prNumber}`);
      return nextMerge();
    },
    runClaude: (prompt, settingSources) => {
      calls.push('repair');
      prompts.push(prompt);
      sources.push(settingSources);
      return Promise.resolve(nextExit());
    },
    now: () => clock,
    sleep: (ms) => {
      calls.push(`sleep ${ms}`);
      clock += ms;
      return Promise.resolve();
    },
  };
  return { seams, calls, prompts, sources };
}

/** The effects every attempt that finds the PR starts with. */
const POLL = [`pr list ${BRANCH}`, `pr checks ${PR}`];

let logs: string[] = [];
let warnings: string[] = [];
let errors: string[] = [];

/**
 * Captures what the gate told the operator, one array per level, through
 * a `sinkOutput` set as the active output for each case. A line written
 * at another level lands in another array, so each `toEqual([])` below
 * is a reading of the level as well as of the line.
 */
beforeEach(() => {
  logs = [];
  warnings = [];
  errors = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      logs.push(message);
    },
    warn: (message) => {
      warnings.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
  setActivePlanStub(null);
});

describe('verifyPullRequest, before any poll', () => {
  it('skips the check when gh is unusable, looking for no PR', async () => {
    const run = stub({ ghUsable: false });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status']);
    expect(warnings.join('\n')).toContain('`gh` is not available or not authenticated');
    expect(errors).toEqual([]);
  });

  it('stops when the branch has no open PR, polling nothing', async () => {
    const run = stub({ prNumber: null });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', `pr list ${BRANCH}`]);
    expect(warnings.join('\n')).toContain(`No open PR found for ${BRANCH}. Nothing to verify.`);
    expect(errors).toEqual([]);
  });
});

describe('verifyPullRequest, on a settled poll', () => {
  it('reports green and spends no repair', async () => {
    const run = stub({ probes: [GREEN] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL]);
    expect(logs.join('\n')).toContain(`CI green on PR #${PR}:`);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('gives up at the deadline while checks still run, waiting 20 s between polls', async () => {
    const run = stub({ probes: [PENDING, PENDING, PENDING] });

    await verifyPullRequest(60_000, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([
      'gh auth status',
      ...POLL,
      'sleep 20000',
      `pr checks ${PR}`,
      'sleep 20000',
      `pr checks ${PR}`,
    ]);
    const warned = warnings.join('\n');
    expect(warned).toContain('CI still running after 40s. Not waiting further.');
    expect(warned).toContain(`Check it yourself: gh pr checks ${PR}`);
    expect(run.prompts).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('verifyPullRequest, on a PR with no checks', () => {
  it('reports a merged PR as merged, repairing nothing', async () => {
    const run = stub({ probes: [NONE], merges: [MERGED] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL, `pr view ${PR}`]);
    expect(logs.join('\n')).toContain(`PR #${PR} is already merged.`);
    expect(errors).toEqual([]);
  });

  it('leaves a PR that is not conflicting alone, repairing nothing', async () => {
    const run = stub({ probes: [NONE], merges: [CLEAN] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL, `pr view ${PR}`]);
    const warned = warnings.join('\n');
    expect(warned).toContain(`PR #${PR} reports no checks and is not conflicting`);
    expect(warned).toContain('(mergeable=MERGEABLE state=CLEAN).');
    expect(errors).toEqual([]);
  });

  it('sends a conflicting PR to repair, then polls it again', async () => {
    const run = stub({ probes: [NONE, GREEN], merges: [DIRTY], exits: [0] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL, `pr view ${PR}`, 'repair', ...POLL]);
    expect(run.prompts).toHaveLength(1);
    expect(run.sources).toEqual([SOURCES]);
    const prompt = run.prompts[0] ?? '';
    expect(prompt.split('\n')[0]).toBe(`The pull request for branch \`${BRANCH}\` (#${PR}) is not mergeable: it conflicts with the base branch, so GitHub scheduled no CI run at all.`);
    expect(prompt).toContain('Merge `origin/main` into this branch and resolve the conflicts');
    expect(classifyPromptContent(prompt)).toBe('ci-repair');
    expect(warnings.join('\n')).toContain(`PR #${PR} has no checks — it does not merge cleanly`);
    expect(logs.join('\n')).toContain(`CI green on PR #${PR}:`);
    expect(errors).toEqual([]);
  });

  it('sends a PR whose merge state cannot be read to repair as a conflict', async () => {
    const run = stub({ probes: [NONE, GREEN], merges: [null], exits: [0] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL, `pr view ${PR}`, 'repair', ...POLL]);
    expect(run.prompts[0]).toContain('it conflicts with the base branch');
    expect(errors).toEqual([]);
  });

  it('stops after a conflict-repair session that exits nonzero', async () => {
    const run = stub({ probes: [NONE], merges: [DIRTY], exits: [4] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL, `pr view ${PR}`, 'repair']);
    expect(errors).toEqual(['\n❌ Conflict-repair session failed (exit 4).']);
  });
});

describe('verifyPullRequest, on a red PR', () => {
  it('sends it to repair with its failing checks only, then polls it again', async () => {
    const run = stub({ probes: [RED, GREEN], merges: [CLEAN], exits: [0] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL, `pr view ${PR}`, 'repair', ...POLL]);
    const prompt = run.prompts[0] ?? '';
    expect(prompt.split('\n')[0]).toBe(`The pull request for branch \`${BRANCH}\` (#${PR}) is not mergeable: its CI checks failed.`);
    expect(prompt).toContain(`The failing checks are:\n   fail    test — FAILURE (${JOB})`);
    expect(prompt).not.toContain('lint — SUCCESS');
    expect(classifyPromptContent(prompt)).toBe('ci-repair');
    expect(warnings.join('\n')).toContain(`CI red on PR #${PR}:`);
    expect(errors).toEqual([]);
  });

  it('stops after a CI-repair session that exits nonzero', async () => {
    const run = stub({ probes: [RED], merges: [CLEAN], exits: [3] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL, `pr view ${PR}`, 'repair']);
    expect(errors).toEqual(['\n❌ CI-repair session failed (exit 3).']);
  });

  it('escalates once every repair attempt is spent', async () => {
    const run = stub({
      probes: [RED, RED, RED],
      merges: [CLEAN, CLEAN],
      exits: [0, 0],
    });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([
      'gh auth status',
      ...POLL,
      `pr view ${PR}`,
      'repair',
      ...POLL,
      `pr view ${PR}`,
      'repair',
      ...POLL,
    ]);
    expect(run.prompts).toHaveLength(2);
    expect(run.sources).toEqual([SOURCES, SOURCES]);
    expect(errors).toEqual([
      `\n❌ CI still not green after 2 repair attempt(s) on ${BRANCH}.`,
      '   Stopping rather than looping. Read the failing jobs and decide.',
    ]);
  });

  it('spawns every repair session under the setting sources it was handed', async () => {
    const red = stub({ probes: [RED, RED, RED], merges: [CLEAN, CLEAN], exits: [0, 0] });
    const conflicting = stub({ probes: [NONE], merges: [DIRTY], exits: [4] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, red.seams);
    await verifyPullRequest(LONG_TIMEOUT_MS, 2, ['project'], conflicting.seams);

    expect(red.sources).toEqual([SOURCES, SOURCES]);
    expect(conflicting.sources).toEqual([['project']]);
  });

  it('stamps the repair prompt with the active plan', async () => {
    setActivePlanStub('phase-0b-cutover-readiness');
    const run = stub({ probes: [RED], merges: [CLEAN], exits: [3] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(planStubFromPrompt(run.prompts[0] ?? '')).toBe('phase-0b-cutover-readiness');
    expect(classifyPromptContent(run.prompts[0])).toBe('ci-repair');
  });
});

describe('verifyPullRequest, with zero attempts', () => {
  it('reports a red verdict and escalates with no repair', async () => {
    const run = stub({ probes: [RED] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 0, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL]);
    expect(logs.join('\n')).toContain('[0s] red — 2 check(s)');
    expect(warnings).toEqual([]);
    expect(errors[0]).toBe(`\n❌ CI still not green after 0 repair attempt(s) on ${BRANCH}.`);
  });

  it('reports no checks and escalates without reading the merge state', async () => {
    const run = stub({ probes: [NONE] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 0, SOURCES, run.seams);

    expect(run.calls).toEqual(['gh auth status', ...POLL]);
    expect(logs.join('\n')).toContain('[0s] none — 0 check(s)');
    expect(errors[0]).toBe(`\n❌ CI still not green after 0 repair attempt(s) on ${BRANCH}.`);
  });
});

describe('PR_LIFECYCLE_SEAMS', () => {
  it('holds the real helpers and leaves the clock to waitForChecks', () => {
    expect(PR_LIFECYCLE_SEAMS.currentBranch).toBe(getCurrentBranch);
    expect(PR_LIFECYCLE_SEAMS.isGhUsable).toBe(isGhUsable);
    expect(PR_LIFECYCLE_SEAMS.findOpenPullRequest).toBe(findOpenPullRequest);
    expect(PR_LIFECYCLE_SEAMS.probeChecks).toBe(probeChecks);
    expect(PR_LIFECYCLE_SEAMS.readMergeState).toBe(readMergeState);
    expect(PR_LIFECYCLE_SEAMS.runClaude).toBe(runClaude);
    expect(PR_LIFECYCLE_SEAMS.now).toBeUndefined();
    expect(PR_LIFECYCLE_SEAMS.sleep).toBeUndefined();
  });
});

describe('the gate as start() calls it', () => {
  it('hands it the setting sources the run resolved', () => {
    const start = readFileSync(new URL('../start.ts', import.meta.url), 'utf8');
    const opening = 'await verifyPullRequest(';
    const call = start.slice(start.indexOf(opening), start.indexOf(');', start.indexOf(opening)));

    // One call, handed the value the run config resolved, which is the
    // only reading of that argument: every `rafa start` the suite runs
    // passes `--no-ci-wait`, and the cases above call the gate directly.
    expect(start.split(opening).length - 1).toBe(1);
    expect(call).toContain('settingSources,');
    expect(start).toContain('const { inject: injectMode, settingSources } = runConfig.config;');
  });
});

describe('the CI constants', () => {
  it('keep the defaults the start usage documents, and a 20 s poll', () => {
    expect(DEFAULT_CI_TIMEOUT_MIN).toBe(20);
    expect(DEFAULT_CI_ATTEMPTS).toBe(2);
    expect(CI_POLL_INTERVAL_MS).toBe(20_000);
  });
});
