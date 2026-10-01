/**
 * Tests for the run's CI gate (`src/start/pr-lifecycle.ts`).
 *
 * Every case drives {@link verifyPullRequest} through a complete stub of
 * its seams, so no `gh`, no git, no Claude session and no timer is
 * reached. The stub's provider is built on {@link createPullRequestsDouble}:
 * the four members the gate reads answer from a script, and the seven it
 * must never reach refuse, so a gate that started listing or merging fails
 * the case rather than passing on an unread call. A poll, merge read or
 * repair session the script did not plan throws the same way. The check
 * rows go in as the `gh pr checks --json name,state,link` stdout
 * `src/pr/checks.test.ts` parses, read through `parseChecks` as the `gh`
 * adapter reads them.
 *
 * There is one case per verdict branch, and each pins the whole sequence
 * of effects rather than one printed line. A branch that falls through
 * to its neighbour prints its own line first, so a presence check alone
 * passes a gate that repairs a green PR, or polls again after a repair
 * session failed; the sequence does not.
 *
 * Fifteen mutations of `pr-lifecycle.ts` were driven against this file
 * alone BEFORE the gate was moved onto the port, and every one reddened
 * at least one case, with the module restored byte-identical and green
 * either side: the `gh` check never refusing, a merged PR not
 * recognised, the conflict test inverted, an unreadable merge state read
 * as clean, a failed CI-repair or conflict-repair session ignored, the
 * last-attempt check dropped, a timeout not read as settled, the attempt
 * loop one short, a default seam replaced by a stub, the repair prompt
 * left unstamped, the repair handed every row, a 10 s poll, the merge
 * state read before the last-attempt check, and the wait seam not passed
 * on. That last one reddens only through the runner's 5 s case timeout,
 * the real 20 s wait outlasting it, and not through any assertion. Leg
 * counts are not recorded; they drift with every case added here.
 *
 * Four more were driven on 2026-09-18, over the rewritten module, one
 * run each with 20 pass either side and the module restored
 * sha256-identical after every one. The PR number taken from a constant
 * instead of from the PR `findOpen` answered: 12 cases. A merged PR read
 * with GitHub's own `MERGED` rather than the port's `merged`: the merged
 * case alone. The provider's throw rethrown instead of reported: the
 * unreachable-provider case alone. The poll answering no rows while
 * still asking the provider: 10 cases.
 *
 * Once the gate wrote through the active output, three level mutations
 * were driven on 2026-09-15, each restored sha256-identical. The deadline
 * warning at `info` reddened the deadline case. A failed CI-repair session
 * at `warn` reddened the case stopping after one. The poll line at `warn`
 * reddened the green case and both zero-attempt cases.
 *
 * The `none`-provider cases are the gate's other path, and each pins
 * the whole call sequence for the same reason: `['read provider',
 * 'git push <branch>']` and nothing more says that no `gh auth status`,
 * no PR lookup, no poll and no repair session happened, where a check
 * for the printed compare URL alone would pass a gate that pushed and
 * then fell through to the `gh` path. Four mutations of the module were
 * driven against this file on 2026-09-18, one run each, the module
 * restored sha256-identical after every one and 26 pass either side:
 * the provider read AFTER `isGhUsable` rather than before, 19 cases;
 * the `none` branch falling through with no `return`, 4; the
 * `source === 'config'` reading inverted so the wording swaps, 2; and
 * the failed-push `return` dropped so a compare URL is printed for a
 * branch that never left the machine, 1.
 *
 * A failed push reads the claim through the stub's `readRefusedPush`,
 * which records `read claim <branch>` among the calls, so a gate that
 * read it after a push that worked, or not at all, reddens on the
 * sequence. The `refusedPushReaderIn` cases run over a real bare remote
 * and two clones, one of which took the other's claim over, and one of
 * them drives the whole gate with the real branch reading and the real
 * push. Four mutations of `pr-lifecycle.ts` were driven against this
 * file on 2026-09-30, one run each, with 39 pass either side and the
 * module restored sha256-identical: the halt dropped, 2 cases; the store
 * id ignored so every reading names no claimant, 1; a store id read
 * that throws read as no id rather than `unknown`, 1; and the `unknown`
 * warning given to `not-lost` instead, 2.
 *
 * Every repair session records the setting sources it was handed beside
 * its prompt. The sources the cases hand over are not the default, so a
 * gate that bound the default in their place reddens.
 *
 * Bun runs every test file in one process and the plan stub is module
 * state, so the one case that sets a stub is followed by a reset to null.
 */
import type { PrLifecyclePhases, PrLifecycleSeams } from './pr-lifecycle.js';
import type { DeviceStoreId } from '../claims/device.js';
import type { RefusedPushReading } from '../claims/lost.js';
import type { ClaudeSettingSource } from '../config.js';
import type {
  ChecksReading,
  PrProviderReading,
  PullRequestDetail,
  PullRequestSummary,
  GitRunner,
  PushOutcome,
} from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { fetchClaimBranches, makeOwnershipCommit, pushNewClaimBranch, pushOwnershipCommit } from '../claims/git.js';
import { CommandExit } from '../cli/command.js';
import { classifyPromptContent } from '../effort/classify.js';
import { createGitRunner, parseChecks, verdictOf } from '../pr/index.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { runClaude } from '../utils/claude.js';
import { getCurrentBranch } from '../utils/git.js';
import { planStubFromPrompt } from '../utils/plan-stamp.js';

import {
  CI_POLL_INTERVAL_MS,
  DEFAULT_CI_ATTEMPTS,
  DEFAULT_CI_TIMEOUT_MIN,
  NO_PHASES,
  PR_LIFECYCLE_SEAMS,
  prLifecycleSeamsIn,
  refusedPushReaderIn,
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

/** The remote the readings below carry, and the URL it compares at. */
const REMOTE = 'git@github.com:o/r.git';
const COMPARE = `https://github.com/o/r/compare/${BRANCH}?expand=1`;

/** The reading every `gh`-provider case runs under. */
const GH_READING: PrProviderReading = {
  provider: 'gh',
  source: 'config',
  remote: REMOTE,
  host: 'github.com',
};

/** `pr.provider: none` in the config, over a GitHub origin. */
const NONE_BY_CONFIG: PrProviderReading = { ...GH_READING, provider: 'none' };

/** No config, and an origin that is not GitHub, so the remote decided. */
const NONE_BY_REMOTE: PrProviderReading = {
  provider: 'none',
  source: 'remote',
  remote: 'git@gitlab.com:o/r.git',
  host: 'gitlab.com',
};

/** A repository with no origin at all: nothing to build a URL from. */
const NONE_NO_REMOTE: PrProviderReading = {
  provider: 'none',
  source: 'remote',
  remote: null,
  host: null,
};

/** A push that worked, and one git refused. */
const PUSHED: PushOutcome = { ok: true, output: `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.` };
const REFUSED: PushOutcome = { ok: false, output: 'error: failed to push some refs' };

/** A refusal that is not about the claim: the reading every refused-push case gets by default. */
const NOT_LOST: RefusedPushReading = {
  outcome: 'not-lost',
  branch: BRANCH,
  cause: 'not-a-claim-branch',
  reason: `${BRANCH} is not a claim branch, so it carries no claim to lose`,
};

/** The claim branch the claim-lost cases push, and where its commits are kept. */
const CLAIM_BRANCH = 'feat/rafa-7-claim-lost';
const LOST_BRANCH = 'lost/rafa-7-claim-lost';

/** Another store took the claim over; this device's commits are kept. */
const LOST: RefusedPushReading = {
  outcome: 'lost',
  issue: 7,
  branch: CLAIM_BRANCH,
  owner: 'store-b',
  pending: null,
  storeId: 'store-a',
  remoteTip: 'b'.repeat(40),
  kept: { state: 'created', name: LOST_BRANCH, sha: 'a'.repeat(40) },
};

/** The fetch that would say who owns the claim failed. */
const UNKNOWN: RefusedPushReading = {
  outcome: 'unknown',
  issue: 7,
  branch: CLAIM_BRANCH,
  reason: 'fatal: unable to access origin',
};

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

/** The PR the cases plant, as `PullRequests.findOpen` answers it. */
const SUMMARY: PullRequestSummary = {
  number: PR,
  title: 'rafa-20: pull request commands',
  url: `https://github.com/o/r/pull/${PR}`,
  state: 'open',
  headRefName: BRANCH,
  baseRefName: 'main',
  author: { login: 'octo', isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-18T12:00:00Z',
};

/** One full read of that PR, in the state the case is about. */
function detail(
  state: PullRequestDetail['state'],
  mergeable: PullRequestDetail['mergeable'],
  mergeStateStatus: string,
): PullRequestDetail {
  return {
    ...SUMMARY,
    state,
    body: 'Closes #20',
    headRefOid: 'deadbeef',
    mergeable,
    mergeStateStatus,
    labels: [],
  };
}

type MergeState = PullRequestDetail | null;

const MERGED: MergeState = detail('merged', 'unknown', 'UNKNOWN');
const CLEAN: MergeState = detail('open', 'mergeable', 'CLEAN');
const DIRTY: MergeState = detail('open', 'conflicting', 'DIRTY');

/** What a case plans for the stubbed effects to answer, in order. */
interface Script {
  /** The provider reading, or the default `gh`-from-config one. */
  readonly provider?: PrProviderReading;
  /** How the push a `none` provider makes ends. Absent, it succeeds. */
  readonly push?: PushOutcome;
  /** What a failed push reads about the claim. Absent, {@link NOT_LOST}. */
  readonly claim?: RefusedPushReading;
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

  const { pulls } = createPullRequestsDouble({
    findOpen: (branch: string): Promise<PullRequestSummary | null> => {
      calls.push(`pr list ${branch}`);
      const number = script.prNumber === undefined
        ? PR
        : script.prNumber;
      return Promise.resolve(number === null
        ? null
        : { ...SUMMARY, number, headRefName: branch });
    },
    get: (prNumber: number): Promise<PullRequestDetail | null> => {
      calls.push(`pr view ${prNumber}`);
      return Promise.resolve(nextMerge());
    },
    checks: (prNumber: number): Promise<ChecksReading> => {
      calls.push(`pr checks ${prNumber}`);
      const rows = parseChecks(nextProbe());
      return Promise.resolve({ rows, verdict: verdictOf(rows) });
    },
  });

  const seams: PrLifecycleSeams = {
    currentBranch: () => BRANCH,
    readProvider: () => {
      calls.push('read provider');
      return script.provider ?? GH_READING;
    },
    pushBranch: (branch) => {
      calls.push(`git push ${branch}`);
      return Promise.resolve(script.push ?? PUSHED);
    },
    readRefusedPush: (branch) => {
      calls.push(`read claim ${branch}`);
      return script.claim ?? NOT_LOST;
    },
    isGhUsable: () => {
      calls.push('gh auth status');
      return Promise.resolve(script.ghUsable ?? true);
    },
    pulls,
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

/** The effects every `gh`-provider case opens with, before its first poll. */
const OPENING = ['read provider', 'gh auth status'];

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

    expect(run.calls).toEqual([...OPENING]);
    expect(warnings.join('\n')).toContain('`gh` is not available or not authenticated');
    expect(errors).toEqual([]);
  });

  it('stops when the branch has no open PR, polling nothing', async () => {
    const run = stub({ prNumber: null });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([...OPENING, `pr list ${BRANCH}`]);
    expect(warnings.join('\n')).toContain(`No open PR found for ${BRANCH}. Nothing to verify.`);
    expect(errors).toEqual([]);
  });

  it('reports a provider that could not be asked rather than throwing', async () => {
    // The port throws where the helpers it replaced answered nothing, and
    // this is the run's last gate: a throw reaching `start()` would end
    // the run on a PR that was pushed. The escalation line is NOT here,
    // which is what separates reporting from falling through the loop.
    const run = stub({});
    const failing: PrLifecycleSeams = {
      ...run.seams,
      pulls: {
        ...run.seams.pulls,
        findOpen: () => Promise.reject(new Error('gh pr list exited non-zero: could not resolve host')),
      },
    };

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, failing);

    expect(errors).toEqual([
      `\n❌ Could not read the PR for ${BRANCH}: gh pr list exited non-zero: could not resolve host`,
      '   The PR has been pushed but nothing here confirms CI agreed with it.',
    ]);
    expect(run.prompts).toEqual([]);
  });
});

describe('verifyPullRequest, on a settled poll', () => {
  it('reports green and spends no repair', async () => {
    const run = stub({ probes: [GREEN] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([...OPENING, ...POLL]);
    expect(logs.join('\n')).toContain(`CI green on PR #${PR}:`);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('gives up at the deadline while checks still run, waiting 20 s between polls', async () => {
    const run = stub({ probes: [PENDING, PENDING, PENDING] });

    await verifyPullRequest(60_000, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([
      ...OPENING,
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

    expect(run.calls).toEqual([...OPENING, ...POLL, `pr view ${PR}`]);
    expect(logs.join('\n')).toContain(`PR #${PR} is already merged.`);
    expect(errors).toEqual([]);
  });

  it('leaves a PR that is not conflicting alone, repairing nothing', async () => {
    const run = stub({ probes: [NONE], merges: [CLEAN] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([...OPENING, ...POLL, `pr view ${PR}`]);
    const warned = warnings.join('\n');
    expect(warned).toContain(`PR #${PR} reports no checks and is not conflicting`);
    expect(warned).toContain('(GitHub says it is mergeable, merge state CLEAN).');
    expect(errors).toEqual([]);
  });

  it('sends a conflicting PR to repair, then polls it again', async () => {
    const run = stub({ probes: [NONE, GREEN], merges: [DIRTY], exits: [0] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([...OPENING, ...POLL, `pr view ${PR}`, 'repair', ...POLL]);
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

    expect(run.calls).toEqual([...OPENING, ...POLL, `pr view ${PR}`, 'repair', ...POLL]);
    expect(run.prompts[0]).toContain('it conflicts with the base branch');
    expect(errors).toEqual([]);
  });

  it('stops after a conflict-repair session that exits nonzero', async () => {
    const run = stub({ probes: [NONE], merges: [DIRTY], exits: [4] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([...OPENING, ...POLL, `pr view ${PR}`, 'repair']);
    expect(errors).toEqual(['\n❌ Conflict-repair session failed (exit 4).']);
  });
});

describe('verifyPullRequest, on a red PR', () => {
  it('sends it to repair with its failing checks only, then polls it again', async () => {
    const run = stub({ probes: [RED, GREEN], merges: [CLEAN], exits: [0] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual([...OPENING, ...POLL, `pr view ${PR}`, 'repair', ...POLL]);
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

    expect(run.calls).toEqual([...OPENING, ...POLL, `pr view ${PR}`, 'repair']);
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
      ...OPENING,
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

    expect(run.calls).toEqual([...OPENING, ...POLL]);
    expect(logs.join('\n')).toContain('[0s] red — 2 check(s)');
    expect(warnings).toEqual([]);
    expect(errors[0]).toBe(`\n❌ CI still not green after 0 repair attempt(s) on ${BRANCH}.`);
  });

  it('reports no checks and escalates without reading the merge state', async () => {
    const run = stub({ probes: [NONE] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 0, SOURCES, run.seams);

    expect(run.calls).toEqual([...OPENING, ...POLL]);
    expect(logs.join('\n')).toContain('[0s] none — 0 check(s)');
    expect(errors[0]).toBe(`\n❌ CI still not green after 0 repair attempt(s) on ${BRANCH}.`);
  });
});

/**
 * The phases a gate writes, recorded into `calls` as `phase <name>`
 * beside the effects, so a case pins where in the sequence each one
 * was written.
 */
function phasesInto(calls: string[]): PrLifecyclePhases {
  return {
    ciStarted: () => {
      calls.push('phase ci');
    },
    repairStarted: () => {
      calls.push('phase repair');
    },
  };
}

describe('verifyPullRequest, writing the phase to the run record', () => {
  it('writes ci before each poll and repair before each repair session', async () => {
    const run = stub({ probes: [RED, GREEN], merges: [CLEAN], exits: [0] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams, phasesInto(run.calls));

    expect(run.calls).toEqual([
      ...OPENING,
      `pr list ${BRANCH}`,
      'phase ci',
      `pr checks ${PR}`,
      `pr view ${PR}`,
      'phase repair',
      'repair',
      `pr list ${BRANCH}`,
      'phase ci',
      `pr checks ${PR}`,
    ]);
  });

  it('writes repair before a conflict-repair session too', async () => {
    const run = stub({ probes: [NONE], merges: [DIRTY], exits: [4] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams, phasesInto(run.calls));

    expect(run.calls).toEqual([...OPENING, `pr list ${BRANCH}`, 'phase ci', `pr checks ${PR}`, `pr view ${PR}`, 'phase repair', 'repair']);
  });

  it('writes ci once for a poll that waits between its probes', async () => {
    const run = stub({ probes: [PENDING, GREEN] });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams, phasesInto(run.calls));

    expect(run.calls.filter((call) => call.startsWith('phase '))).toEqual(['phase ci']);
  });

  it('writes no phase when it skips itself, finds no PR or takes the none path', async () => {
    const skipped = stub({ ghUsable: false });
    const missing = stub({ prNumber: null });
    const pushed = stub({ provider: NONE_BY_CONFIG });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, skipped.seams, phasesInto(skipped.calls));
    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, missing.seams, phasesInto(missing.calls));
    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, pushed.seams, phasesInto(pushed.calls));

    expect(skipped.calls).toEqual([...OPENING]);
    expect(missing.calls).toEqual([...OPENING, `pr list ${BRANCH}`]);
    expect(pushed.calls).toEqual(['read provider', `git push ${BRANCH}`]);
  });

  it('writes nothing through the default phases, and they cannot be changed', () => {
    expect(NO_PHASES.ciStarted()).toBeUndefined();
    expect(NO_PHASES.repairStarted()).toBeUndefined();
    expect(Object.isFrozen(NO_PHASES)).toBe(true);
  });
});

describe('verifyPullRequest, under a none provider', () => {
  it('pushes the branch, prints the compare URL and asks gh nothing', async () => {
    const run = stub({ provider: NONE_BY_CONFIG });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    // The whole of the gate: the reading, the push, and nothing else.
    // No `gh auth status`, no PR looked for, no check polled and no
    // repair session, so a gate that fell through to the `gh` path
    // after pushing fails here rather than on a printed line.
    expect(run.calls).toEqual(['read provider', `git push ${BRANCH}`]);
    expect(run.prompts).toEqual([]);
    expect(logs.join('\n')).toContain('pr.provider is none');
    expect(logs.join('\n')).toContain(`Pushed ${BRANCH} to origin.`);
    expect(logs.join('\n')).toContain(`Open the pull request: ${COMPARE}`);
    expect(errors).toEqual([]);
  });

  it('says the CI wait was skipped, and why, at warn', async () => {
    const run = stub({ provider: NONE_BY_CONFIG });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    // The skip is a warning and the push is not: the first is something
    // the operator has to act on and the second is the loop working.
    expect(warnings.join('\n')).toContain('CI check skipped');
    expect(warnings.join('\n')).toContain('nothing here confirms CI agreed');
    expect(warnings.join('\n')).not.toContain('`gh` is not available');
  });

  it('names the origin rather than the config when the remote decided', async () => {
    const run = stub({ provider: NONE_BY_REMOTE });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['read provider', `git push ${BRANCH}`]);
    expect(logs.join('\n')).toContain('origin is not a GitHub remote');
    expect(logs.join('\n')).toContain(`https://gitlab.com/o/r/compare/${BRANCH}?expand=1`);
  });

  it('pushes and says there is no compare URL when origin names no host', async () => {
    const run = stub({ provider: NONE_NO_REMOTE });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    expect(run.calls).toEqual(['read provider', `git push ${BRANCH}`]);
    expect(logs.join('\n')).toContain(`Pushed ${BRANCH} to origin.`);
    expect(logs.join('\n')).not.toContain('Open the pull request:');
    expect(warnings.join('\n')).toContain('no web host');
  });

  it('reports a refused push with git\'s words and prints no URL', async () => {
    const run = stub({ provider: NONE_BY_CONFIG, push: REFUSED });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    // The claim is read, and says the refusal was not about it.
    expect(run.calls).toEqual(['read provider', `git push ${BRANCH}`, `read claim ${BRANCH}`]);
    expect(errors).toEqual([
      `\n❌ Could not push ${BRANCH}.`,
      REFUSED.output,
      '   The work is committed locally. Push it yourself and open the PR by hand.',
    ]);
    // Nothing to compare against: the branch never left the machine.
    expect(logs.join('\n')).not.toContain(COMPARE);
    expect(warnings).toEqual([]);
  });

  it('reads the provider before asking gh anything, under a gh provider too', async () => {
    const run = stub({ ghUsable: false });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    // The control on the order: an unusable `gh` still gets the `gh`
    // wording, and the reading came first.
    expect(run.calls).toEqual(['read provider', 'gh auth status']);
    expect(warnings.join('\n')).toContain('`gh` is not available');
    expect(warnings.join('\n')).not.toContain('CI check skipped');
  });
});

describe('verifyPullRequest, on a refused push of a claim branch', () => {
  it('halts with the claim lost report, opening no pull request, when another store owns the claim', async () => {
    const run = stub({ provider: NONE_BY_CONFIG, push: REFUSED, claim: LOST });
    const seams = { ...run.seams, currentBranch: () => CLAIM_BRANCH };

    const halted = await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, seams).then(
      () => null,
      (error: unknown) => error,
    );

    expect(halted).toBeInstanceOf(CommandExit);
    const exit = halted as CommandExit;
    expect(exit.exitCode).toBe(1);
    expect(exit.message).toContain('❌ Claim lost: #7 is claimed by store store-b on feat/rafa-7-claim-lost');
    expect(exit.message).toContain(`kept on the local branch ${LOST_BRANCH}`);
    expect(exit.message).toContain(`no pull request is opened for ${CLAIM_BRANCH}`);
    // The push, the reading, and nothing after: no gh, no poll, no repair.
    expect(run.calls).toEqual(['read provider', `git push ${CLAIM_BRANCH}`, `read claim ${CLAIM_BRANCH}`]);
    // No compare URL, no "push it yourself", no CI-skip line: the halt is the whole report.
    expect(logs.join('\n')).not.toContain('Open the pull request');
    expect(logs.join('\n')).not.toContain('Pushed');
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reports the failed push and warns when who holds the claim could not be read', async () => {
    const run = stub({ provider: NONE_BY_CONFIG, push: REFUSED, claim: UNKNOWN });
    const seams = { ...run.seams, currentBranch: () => CLAIM_BRANCH };

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, seams);

    expect(run.calls).toEqual(['read provider', `git push ${CLAIM_BRANCH}`, `read claim ${CLAIM_BRANCH}`]);
    expect(errors).toEqual([
      `\n❌ Could not push ${CLAIM_BRANCH}.`,
      REFUSED.output,
      '   The work is committed locally. Push it yourself and open the PR by hand.',
    ]);
    expect(warnings).toEqual([
      '\n⚠️  Could not tell who holds the claim on #7: fatal: unable to access origin.',
      `   Check with rafa status before pushing ${CLAIM_BRANCH} by hand.`,
    ]);
  });

  it('reads no claim when the push worked', async () => {
    const run = stub({ provider: NONE_BY_CONFIG, claim: LOST });

    await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, run.seams);

    // The control on the halt: the same `lost` reading, never asked for.
    expect(run.calls).toEqual(['read provider', `git push ${BRANCH}`]);
    expect(logs.join('\n')).toContain(`Open the pull request: ${COMPARE}`);
  });
});

describe('refusedPushReaderIn, over a bare remote and two clones', () => {
  const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-lifecycle-lost-')));
  const STORE_A: DeviceStoreId = { ok: true, storeId: 'store-a' };

  afterAll(() => {
    rmSync(scope, { recursive: true, force: true });
  });

  /** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
  const must = (git: GitRunner, args: readonly string[]): string => {
    const result = git(args);
    if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };

  const cloneInto = (originPath: string, dir: string, name: string): GitRunner => {
    must(createGitRunner(scope), ['clone', '--quiet', originPath, dir]);
    const git = createGitRunner(dir);
    must(git, ['config', 'user.name', name]);
    must(git, ['config', 'user.email', `${name}@example.invalid`]);
    must(git, ['config', 'commit.gpgsign', 'false']);
    return git;
  };

  /**
   * A bare remote, clone `a` checked out on the claim branch it claimed
   * as store-a with one work commit on top, and clone `b` having taken
   * the claim over as store-b on the remote. Answers `a`'s directory,
   * both runners on the remote side, `a`'s work commit and the remote tip.
   */
  const plantTakenClaim = (name: string) => {
    const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
    const originPath = join(root, 'origin.git');
    must(createGitRunner(scope), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
    const seed = cloneInto(originPath, join(root, 'seed'), 'seed');
    writeFileSync(join(root, 'seed', 'kept.txt'), 'kept\n', 'utf8');
    must(seed, ['add', '--all']);
    must(seed, ['commit', '--quiet', '-m', 'root']);
    must(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

    const aDir = join(root, 'a');
    const a = cloneInto(originPath, aDir, 'device-a');
    const b = cloneInto(originPath, join(root, 'b'), 'device-b');
    const claim = makeOwnershipCommit(a, 'main', { action: 'claim', issue: 7, store: 'store-a' });
    if (!claim.ok) throw new Error(claim.reason);
    if (pushNewClaimBranch(a, claim.sha, CLAIM_BRANCH).outcome !== 'pushed') throw new Error('claim push');
    must(a, ['switch', '--quiet', '-C', CLAIM_BRANCH, claim.sha]);
    writeFileSync(join(aDir, 'work.txt'), 'work of device a\n', 'utf8');
    must(a, ['add', '--all']);
    must(a, ['commit', '--quiet', '-m', 'feat: work of device a']);
    const work = must(a, ['rev-parse', 'HEAD']);

    if (!fetchClaimBranches(b).ok) throw new Error('b could not fetch');
    const lease = must(b, ['rev-parse', `refs/remotes/origin/${CLAIM_BRANCH}`]);
    const take = makeOwnershipCommit(b, lease, { action: 'take', issue: 7, store: 'store-b' });
    if (!take.ok) throw new Error(take.reason);
    if (pushOwnershipCommit(b, take.sha, CLAIM_BRANCH, lease).outcome !== 'pushed') throw new Error('take push');

    return { aDir, a, origin: createGitRunner(originPath), work, remoteTip: take.sha };
  };

  it('halts the real gate on a refused push: lost branch at the work, the new owner\'s tip unchanged', async () => {
    const planted = plantTakenClaim('halt');
    const seams: PrLifecycleSeams = {
      ...prLifecycleSeamsIn(planted.aDir),
      readProvider: () => NONE_BY_CONFIG,
      readRefusedPush: refusedPushReaderIn(planted.aDir, () => STORE_A),
    };

    // The real branch reading, the real push and the real claim reading.
    const halted = await verifyPullRequest(LONG_TIMEOUT_MS, 2, SOURCES, seams).then(
      () => null,
      (error: unknown) => error,
    );

    expect(halted).toBeInstanceOf(CommandExit);
    expect((halted as CommandExit).message).toContain('claimed by store store-b');
    expect(errors).toEqual([]);
    expect(must(planted.a, ['rev-parse', `refs/heads/${LOST_BRANCH}`])).toBe(planted.work);
    // Read from the bare remote itself: nothing moved store-b's branch.
    expect(must(planted.origin, ['rev-parse', `refs/heads/${CLAIM_BRANCH}`])).toBe(planted.remoteTip);
    // The checkout is left on its branch, at its work.
    expect(must(planted.a, ['rev-parse', 'HEAD'])).toBe(planted.work);
  });

  it('reads a store that names no id as no claimant, and keeps the commits', () => {
    const planted = plantTakenClaim('no-id');

    const reading = refusedPushReaderIn(planted.aDir, () => ({ ok: false, cause: 'ndjson', reason: 'ndjson' }))(CLAIM_BRANCH);

    expect(reading.outcome).toBe('lost');
    expect(reading.outcome === 'lost' && reading.storeId).toBeNull();
    expect(must(planted.a, ['rev-parse', `refs/heads/${LOST_BRANCH}`])).toBe(planted.work);
  });

  it('answers unknown, keeping nothing, when the store id read throws', () => {
    const planted = plantTakenClaim('throws');

    const reading = refusedPushReaderIn(planted.aDir, () => {
      throw new Error('database is locked');
    })(CLAIM_BRANCH);

    expect(reading).toEqual({
      outcome: 'unknown',
      issue: 7,
      branch: CLAIM_BRANCH,
      reason: 'this device\'s store id could not be read: database is locked',
    });
    expect(planted.a(['rev-parse', '--verify', '--quiet', `refs/heads/${LOST_BRANCH}`]).ok).toBe(false);
  });

  it('reads this store\'s own claim as not lost', () => {
    const planted = plantTakenClaim('owned');

    const reading = refusedPushReaderIn(planted.aDir, () => ({ ok: true, storeId: 'store-b' }))(CLAIM_BRANCH);

    // The control on the store id: the same branch, read as its owner.
    expect(reading.outcome === 'not-lost' && reading.cause).toBe('owned');
    expect(planted.a(['rev-parse', '--verify', '--quiet', `refs/heads/${LOST_BRANCH}`]).ok).toBe(false);
  });

  it('reads no store for a branch that is no claim branch', () => {
    let asked = 0;

    const reading = refusedPushReaderIn(scope, () => {
      asked += 1;
      return STORE_A;
    })(BRANCH);

    expect(reading.outcome === 'not-lost' && reading.cause).toBe('not-a-claim-branch');
    expect(asked).toBe(0);
  });
});

describe('PR_LIFECYCLE_SEAMS', () => {
  it('holds the real helpers and leaves the clock to waitForChecks', () => {
    expect(PR_LIFECYCLE_SEAMS.currentBranch).toBe(getCurrentBranch);
    // The provider is the real `gh` adapter, and nothing here calls a
    // member of it: every one would spawn `gh` in this checkout.
    expect(PR_LIFECYCLE_SEAMS.pulls.kind).toBe('gh');
    expect(typeof PR_LIFECYCLE_SEAMS.isGhUsable).toBe('function');
    // Neither is called here: `readProvider` would spawn
    // `git remote get-url origin` in this checkout and `pushBranch`
    // would push it.
    expect(typeof PR_LIFECYCLE_SEAMS.readProvider).toBe('function');
    expect(typeof PR_LIFECYCLE_SEAMS.pushBranch).toBe('function');
    expect(typeof PR_LIFECYCLE_SEAMS.readRefusedPush).toBe('function');
    expect(PR_LIFECYCLE_SEAMS.runClaude).toBe(runClaude);
    expect(PR_LIFECYCLE_SEAMS.now).toBeUndefined();
    expect(PR_LIFECYCLE_SEAMS.sleep).toBeUndefined();
  });
});

describe('prLifecycleSeamsIn', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-lifecycle-seams-')));
  const git = (args: readonly string[]): void => {
    const run = spawnSync('git', [...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  };
  git(['init', '-q', '-b', 'feat/seams-in-a-directory']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the branch checked out in the directory it was made for', () => {
    // This checkout is on another branch, so a reading of the process's
    // own directory would answer that one.
    expect(prLifecycleSeamsIn(dir).currentBranch()).toBe('feat/seams-in-a-directory');
    expect(getCurrentBranch()).not.toBe('feat/seams-in-a-directory');
  });

  it('spawns each repair session in that directory, under the sources it is handed', async () => {
    const spawned: { readonly args: readonly string[]; readonly cwd: string | undefined }[] = [];
    const seams = prLifecycleSeamsIn(dir, (args, _prompt, options) => {
      spawned.push({ args, cwd: options?.cwd });
      return Promise.resolve(0);
    });

    expect(await seams.runClaude('repair the PR', SOURCES)).toBe(0);

    expect(spawned).toEqual([{ args: ['-p', '--dangerously-skip-permissions', '--setting-sources', 'local,user'], cwd: dir }]);
  });

  it('holds the `gh` provider and leaves the clock to waitForChecks', () => {
    const seams = prLifecycleSeamsIn(dir);

    expect(seams.pulls.kind).toBe('gh');
    expect(seams.now).toBeUndefined();
    expect(seams.sleep).toBeUndefined();
  });
});

describe('the gate as start() calls it, through runWrapUp', () => {
  /** `start/wrap-up-run.ts`, where the loop's one call to the gate sits. */
  const wrapUpRun = (): string => readFileSync(new URL('./wrap-up-run.ts', import.meta.url), 'utf8');

  /** The gate's call as the module writes it, up to its closing `);`. */
  const gateCall = (source: string): string => {
    const opening = 'await verifyPullRequest(';
    return source.slice(source.indexOf(opening), source.indexOf(');', source.indexOf(opening)));
  };

  it('hands it the setting sources the run resolved', () => {
    const start = readFileSync(new URL('../start.ts', import.meta.url), 'utf8');
    const source = wrapUpRun();

    // One call, handed the value the run config resolved, which is the
    // only reading of that argument: every `rafa start` the suite runs
    // passes `--no-ci-wait`, and the cases above call the gate directly.
    expect(source.split('await verifyPullRequest(').length - 1).toBe(1);
    expect(start.split('await verifyPullRequest(').length - 1).toBe(0);
    expect(gateCall(source)).toContain('settingSources,');
    expect(start).toContain('const { inject: injectMode, settingSources } = runConfig.config;');
    expect(start).toContain('await runWrapUp({');
  });

  it('hands it the seams of the run\'s checkout, and reads the provider there', () => {
    const source = wrapUpRun();
    const call = gateCall(source);
    // The provider reading is made once, over the checkout, and handed to
    // both the pull request's delivery and the gate.
    const reading = source.slice(source.indexOf('const readProvider = () =>'), source.indexOf('const finish = await finishRelease('));

    expect(call).toContain('...prLifecycleSeamsIn(checkout),');
    expect(call).toContain('readProvider,');
    expect(reading).toContain('dir: checkout,');
    expect(reading).not.toContain('dir: repoRoot');
    expect(call).not.toContain('dir: repoRoot');
  });

  it('reads a refused push in the checkout, and the store id at the project root under the run\'s store', () => {
    const start = readFileSync(new URL('../start.ts', import.meta.url), 'utf8');

    expect(gateCall(wrapUpRun())).toContain('readRefusedPush: refusedPushReaderIn(checkout, () => readDeviceStoreId(repoRoot, settings)),');
    // The `settings` read there is the run's own config, as `start()` hands it over.
    expect(start).toContain('settings: runConfig.config,');
  });
});

describe('the CI constants', () => {
  it('keep the defaults the start usage documents, and a 20 s poll', () => {
    expect(DEFAULT_CI_TIMEOUT_MIN).toBe(20);
    expect(DEFAULT_CI_ATTEMPTS).toBe(2);
    expect(CI_POLL_INTERVAL_MS).toBe(20_000);
  });
});
