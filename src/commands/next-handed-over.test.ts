/**
 * Tests for the one question `rafa next` hands over (`next.ts`): the
 * `merge-unchecked` step runs `pr merge <n> --skip-checks` with no
 * question of the chain's own, closes the chain's prompter first, and
 * under a `--yes` ceiling stops with a line that names no list, since no
 * list may name it.
 *
 * A file of its own because `next.test.ts` is already past 800 lines.
 * The chain cases drive {@link runNextChain} over a scripted reader, as
 * that file does; the dispatched case drives the real command over the
 * pull request double, with a `pr merge` carrying the REAL command's
 * declarations and its `run` alone replaced, so what `--skip-checks` and
 * `--yes` read as is the parser's reading of the words and not a list.
 *
 * ## The controls
 *
 *  - The hand-over case is read beside the green pull request over the
 *    same chain, which must still ask and must not hand over: a chain
 *    that stopped asking about every step would pass the first alone.
 *  - The order of ask, hand-over and run is one log, so a hand-over that
 *    ran AFTER the action — too late to keep the answer from the
 *    chain's prompter — reads as the wrong order rather than passing.
 *  - The stop line under a ceiling is read for `merge-unchecked`, for
 *    `ready` and for `merge`, the last of which must still name the list
 *    that would allow it.
 */
import type { NextChainOptions, NextChainReport } from './next.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { NextCeiling } from '../next/ceiling.js';
import type { NextState } from '../next/state.js';
import type { GitResult, GitRunner, PullRequestDetail, PullRequestSummary } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { YES_FLAG } from '../next/ceiling.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { dispatchInProject } from '../tests/cli-capture.js';

import { createNextCommand, QUESTION_HANDED_OVER, runNextChain } from './next.js';
import prMerge from './pr/merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-handed-over-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base every case runs against. */
const BASE = 'main';

/** The pull request the states name. */
const PR = 41;

/** The branch the pull request is open on. */
const PLAN_BRANCH = 'feat/rafa-63';

/** A state as a row answers one, with the fields a case fills. */
function stateOf(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'pr-green',
    action: 'merge',
    reading: `#${PR} is open on \`${PLAN_BRANCH}\`, green and merges into \`${BASE}\``,
    proposal: `merge #${PR} into \`${BASE}\``,
    pullRequest: PR,
    issue: null,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/** The states the cases reach for. */
const STATES = Object.freeze({
  green: stateOf({}),
  unchecked: stateOf({
    id: 'pr-no-checks',
    action: 'merge-unchecked',
    reading: `#${PR} is open on \`${PLAN_BRANCH}\`, reports no check at all and merges into \`${BASE}\``,
    proposal: `merge #${PR} into \`${BASE}\` with no checks`,
  }),
  behind: stateOf({
    id: 'base-behind',
    action: 'sync',
    reading: `\`${BASE}\` is 2 commits behind \`origin/${BASE}\``,
    proposal: `fast-forward \`${BASE}\` to \`origin/${BASE}\``,
    pullRequest: null,
  }),
  notReady: stateOf({
    id: 'issue-not-ready',
    action: 'ready',
    reading: '#64 not ready: it carries no spec:ready label',
    proposal: 'check the spec of #64 and mark it ready',
    pullRequest: null,
    issue: 64,
  }),
  nothing: stateOf({
    id: 'nothing-left',
    action: 'none',
    reading: 'the roadmap, issue #31, has no line left that is not done or taken (0 lines passed)',
    proposal: 'open the next spec issue and add it to the roadmap',
    pullRequest: null,
  }),
});

/** What one chain case drove: the report, the lines, and ask, hand-over and run in the order they came. */
interface Driven {
  readonly report: NextChainReport;
  readonly lines: readonly string[];
  readonly log: readonly string[];
}

/** Runs the chain over `states`, answering yes to every question, logging each ask, hand-over and run. */
async function drive(states: readonly NextState[], ceiling: NextCeiling = null): Promise<Driven> {
  const lines: string[] = [];
  const log: string[] = [];
  let reads = 0;

  const options: NextChainOptions = {
    read: () => {
      const state = states[Math.min(reads, states.length - 1)];
      reads += 1;
      if (state === undefined) throw new Error('the script answered no state');
      return Promise.resolve(state);
    },
    run: (state: NextState) => {
      log.push(`run ${state.action}`);
      return Promise.resolve();
    },
    ask: (question: string) => {
      log.push(`ask ${question}`);
      return Promise.resolve(true);
    },
    handOver: () => {
      log.push('hand over');
    },
    ceiling,
    dryRun: null,
    info: (line: string) => lines.push(line),
    warn: () => undefined,
  };
  const report = await runNextChain(options);
  return { report, lines, log };
}

describe('the question handed over', () => {
  it('holds merge-unchecked alone', () => {
    expect([...QUESTION_HANDED_OVER]).toEqual(['merge-unchecked']);
  });

  it('runs merge-unchecked with no question of its own, handing its prompter over first', async () => {
    const driven = await drive([STATES.behind, STATES.unchecked, STATES.nothing]);

    expect(driven.log).toEqual([
      `ask Fast-forward \`${BASE}\` to \`origin/${BASE}\`? [y/N] `,
      'run sync',
      'hand over',
      'run merge-unchecked',
    ]);
    expect(driven.lines).toContain(`👉 merge #${PR} into \`${BASE}\` with no checks — rafa pr merge ${PR} --skip-checks`);
    expect(driven.report.steps.map((step) => [step.action, step.asked, step.ran])).toEqual([
      ['sync', true, true],
      ['merge-unchecked', false, true],
      ['none', false, false],
    ]);
    expect(driven.report.stop).toBe('nothing-to-run');
  });

  it('still asks about the green merge and hands nothing over, which is the control beside it', async () => {
    const driven = await drive([STATES.green, STATES.nothing]);

    expect(driven.log).toEqual([`ask Merge #${PR} into \`${BASE}\`? [y/N] `, 'run merge']);
    expect(driven.report.steps[0]?.asked).toBe(true);
  });

  it('stops unchanged where pr merge was answered no and the state reads back the same', async () => {
    const driven = await drive([STATES.unchecked]);

    expect(driven.log).toEqual(['hand over', 'run merge-unchecked']);
    expect(driven.report.stop).toBe('unchanged');
  });

  it('never runs it under a ceiling, even one built in code that names it', async () => {
    const named = await drive([STATES.unchecked], ['merge-unchecked', 'merge']);

    expect(named.log).toEqual([]);
    expect(named.report.stop).toBe('unasked');
  });
});

describe('the unasked stop line', () => {
  it('says to drop --yes for a step no list may name, and names the list for one it may', async () => {
    const unchecked = await drive([STATES.unchecked], ['sync']);
    const ready = await drive([STATES.notReady], ['sync']);
    const merge = await drive([STATES.green], ['sync']);

    expect(unchecked.lines.at(-1)).toBe(`⏹ --${YES_FLAG} allows sync, and this step is merge-unchecked, so nothing ran;`
      + ` no --${YES_FLAG} list allows it, so drop --${YES_FLAG} to be asked.`);
    expect(ready.lines.at(-1)).toBe(`⏹ --${YES_FLAG} allows sync, and this step is ready, so nothing ran;`
      + ` no --${YES_FLAG} list allows it, so drop --${YES_FLAG} to be asked.`);
    expect(merge.lines.at(-1)).toBe(`⏹ --${YES_FLAG} allows sync, and this step is merge, so nothing ran;`
      + ` type --${YES_FLAG}=sync,merge to allow it, or drop --${YES_FLAG} to be asked.`);
  });
});

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A git runner on the plan branch, level with its base and with a clean tree. */
function planBranchGit(): GitRunner {
  return (args) => said(args.join(' ') === 'rev-parse --abbrev-ref HEAD'
    ? `${PLAN_BRANCH}\n`
    : '');
}

/** A summary as `findOpen` answers one for the branch. */
const SUMMARY: PullRequestSummary = Object.freeze({
  number: PR,
  title: 'rafa-63: one command, the next step',
  url: `https://github.com/open-tomato/rafa/pull/${PR}`,
  state: 'open',
  headRefName: PLAN_BRANCH,
  baseRefName: BASE,
  author: { login: 'octo', isBot: false },
  isCrossRepository: false,
  updatedAt: '2026-09-22T11:00:00Z',
});

/** The detail as `get` answers it: mergeable. */
const DETAIL: PullRequestDetail = Object.freeze({
  ...SUMMARY,
  body: 'Closes #63',
  headRefOid: 'abc1234',
  mergeable: 'mergeable',
  mergeStateStatus: 'CLEAN',
  labels: [],
});

/** What one call of the `pr merge` double was handed. */
interface MergeCall {
  readonly args: readonly string[];
  readonly flags: Readonly<Record<string, unknown>>;
}

/** A `pr merge` carrying the real command's declarations, its `run` alone replaced by a recorder. */
function recordingMerge(seen: MergeCall[]): RafaCommand {
  return Object.freeze({
    ...prMerge,
    run: (context: RafaContext) => {
      seen.push({ args: context.args.map((word) => String(word)), flags: { ...context.flags } });
      return Promise.resolve();
    },
  });
}

describe('the command, dispatched', () => {
  it('runs pr merge --skip-checks without --yes on a zero-check pull request, putting no question of its own', async () => {
    const root = join(tempBase, 'project');
    const home = join(tempBase, 'home');
    mkdirSync(join(root, '.rafa'), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(root, '.rafa', 'config.yaml'), `pr:\n  base: ${BASE}\nroadmap:\n  issue: 31\n`, 'utf8');
    const seen: MergeCall[] = [];
    const command = createNextCommand({
      isTerminal: () => true,
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGit: () => planBranchGit(),
      openGh: () => () => Promise.resolve({ ok: true, stdout: '[]', stderr: '' }),
      pullRequests: () => createPullRequestsDouble({
        findOpen: () => Promise.resolve(SUMMARY),
        get: () => Promise.resolve(DETAIL),
        checks: () => Promise.resolve({ rows: [], verdict: 'none' }),
      }).pulls,
      openPrompter: () => {
        throw new Error('rafa next opened a prompter for a question it hands over');
      },
    });

    const run = await dispatchInProject(
      ['next'],
      [{ name: 'pr', summary: 'pull requests' }],
      [command, recordingMerge(seen)],
      { root, home },
    );

    expect(run.stdout).toContain(`👉 merge #${PR} into \`${BASE}\` with no checks — rafa pr merge ${PR} --skip-checks`);
    expect(seen.map((call) => call.args)).toEqual([[String(PR)]]);
    expect(seen[0]?.flags['skip-checks']).toBe(true);
    expect(seen[0]?.flags.yes).not.toBe(true);
    expect(run.exitCode).toBe(0);
  });
});
