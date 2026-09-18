/**
 * Tests for the run's CI gate (`src/start/pr-lifecycle.ts`).
 *
 * Every case drives {@link verifyPullRequest} through a complete stub of
 * its seams, so no `gh`, no git, no Claude session and no timer is
 * reached. The stub's provider is a whole {@link PullRequests}: the four
 * members the gate reads answer from a script, and the seven it must
 * never reach throw, so a gate that started listing or merging fails the
 * case rather than passing on an unread call. A poll, merge read or
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
 * Every repair session records the setting sources it was handed beside
 * its prompt. The sources the cases hand over are not the default, so a
 * gate that bound the default in their place reddens.
 *
 * Bun runs every test file in one process and the plan stub is module
 * state, so the one case that sets a stub is followed by a reset to null.
 */
import type { PrLifecycleSeams } from './pr-lifecycle.js';
import type { ClaudeSettingSource } from '../config.js';
import type {
  ChecksReading,
  PrProviderReading,
  PullRequestDetail,
  PullRequestSummary,
  PullRequests,
  PushOutcome,
} from '../pr/index.js';

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { classifyPromptContent } from '../effort/classify.js';
import { parseChecks, verdictOf } from '../pr/index.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { runClaude } from '../utils/claude.js';
import { getCurrentBranch } from '../utils/git.js';
import { planStubFromPrompt } from '../utils/plan-stamp.js';

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

/**
 * A port member the gate must never reach: a gate that started listing
 * or merging throws here and fails the case that let it.
 */
function unreached(member: string): never {
  throw new Error(`unplanned ${member}`);
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

  const pulls: PullRequests = {
    kind: 'gh',
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
    list: () => unreached('list'),
    browse: () => unreached('browse'),
    merge: () => unreached('merge'),
    comments: () => unreached('comments'),
    comment: () => unreached('comment'),
    editComment: () => unreached('editComment'),
    failedLog: () => unreached('failedLog'),
  };

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

    expect(run.calls).toEqual(['read provider', `git push ${BRANCH}`]);
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
