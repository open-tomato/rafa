/**
 * Tests for the settle step of `rafa next` (`next.ts` over
 * `src/next/settle-step.ts`): once a merge action has run, while
 * fragments wait on the base and fold into a version, one more turn
 * proposes `rafa release settle`, asked like `merge` and run unasked
 * only under a `--yes` list naming `settle`.
 *
 * A file of its own because `next.test.ts` is already past 800 lines.
 * The chain cases drive {@link runNextChain} over a scripted reader and
 * a scripted `afterMerge`, as `next-handed-over.test.ts` does; the
 * dispatched cases drive the real command over a planted repository
 * whose `origin/main` holds the fragments, the pull request double, and
 * a `pr merge` and a `release settle` carrying the real commands'
 * declarations with their `run` alone replaced, so the settle reading is
 * the composed one and what the settle action is handed is the parser's
 * reading of its words.
 *
 * ## The controls
 *
 *  - Each case that proposes settle sits beside one that must not: an
 *    `afterMerge` answering null, an action that is no merge, and, in
 *    the dispatched pair, a base holding only a `level: none` fragment.
 *  - The ceiling is read three ways over the same states: a list
 *    naming `merge` alone must stop at settle, one naming both must run
 *    both unasked, and bare `--yes` never reaches the merge at all.
 *  - The `unchanged` case reads a merge that moved nothing; a chain that
 *    compared the next state with the settle's rather than the merge's
 *    would merge again and fail it.
 */
import type { NextChainOptions, NextChainReport } from './next.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { NextCeiling } from '../next/ceiling.js';
import type { NextState } from '../next/state.js';
import type { PullRequestDetail, PullRequestSummary } from '../pr/index.js';
import type { Fragment } from '../release/fragment.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BARE_YES_ACTIONS, YES_FLAG } from '../next/ceiling.js';
import { settleState } from '../next/settle-step.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { serializeFragment } from '../release/fragment.js';
import { dispatchInProject } from '../tests/cli-capture.js';

import { createNextCommand, runNextChain } from './next.js';
import prMerge from './pr/merge.js';
import releaseSettle from './release/settle.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-settle-')));

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
    reading: `\`${BASE}\` is 1 commit behind \`origin/${BASE}\``,
    proposal: `fast-forward \`${BASE}\` to \`origin/${BASE}\``,
    pullRequest: null,
  }),
  nothing: stateOf({
    id: 'nothing-left',
    action: 'none',
    reading: 'the roadmap, issue #31, has no line left that is not done or taken (0 lines passed)',
    proposal: 'open the next spec issue and add it to the roadmap',
    pullRequest: null,
  }),
  settle: settleState({ base: BASE, fragments: 1, version: '1.2.4' }),
});

/** The question the settle state is asked over. */
const SETTLE_QUESTION = `Settle the fragments on \`${BASE}\` into 1.2.4? [y/N] `;

/** What one chain case drove: the report, the lines, and every ask, run and settle read in order. */
interface Driven {
  readonly report: NextChainReport;
  readonly lines: readonly string[];
  readonly log: readonly string[];
}

/** How a chain case is driven beside its states. */
interface DriveOptions {
  /** What `afterMerge` answers; the settle state when left out. */
  readonly settle?: NextState | null;
  /** The ceiling; every step asked when left out. */
  readonly ceiling?: NextCeiling;
  /** The answer to each question in turn; yes once they run out. */
  readonly answers?: readonly boolean[];
}

/** Runs the chain over `states`, logging each ask, run and settle read. */
async function drive(states: readonly NextState[], options: DriveOptions = {}): Promise<Driven> {
  const lines: string[] = [];
  const log: string[] = [];
  const answers = [...options.answers ?? []];
  let reads = 0;

  const chain: NextChainOptions = {
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
      return Promise.resolve(answers.shift() ?? true);
    },
    afterMerge: () => {
      log.push('read settle');
      return options.settle === undefined
        ? STATES.settle
        : options.settle;
    },
    ceiling: options.ceiling ?? null,
    dryRun: null,
    info: (line: string) => lines.push(line),
    warn: () => undefined,
  };
  const report = await runNextChain(chain);
  return { report, lines, log };
}

describe('the settle step after a merge', () => {
  it('asks to settle once the merge has run, runs it on a yes and reads the state again', async () => {
    const driven = await drive([STATES.green, STATES.nothing]);

    expect(driven.log).toEqual([
      `ask Merge #${PR} into \`${BASE}\`? [y/N] `,
      'run merge',
      'read settle',
      `ask ${SETTLE_QUESTION}`,
      'run settle',
    ]);
    expect(driven.lines).toContain('📍 1 fragment waits on `main` and folds into 1.2.4.');
    expect(driven.lines).toContain('👉 settle the fragments on `main` into 1.2.4 — rafa release settle');
    expect(driven.report.steps).toEqual([
      { state: 'pr-green', action: 'merge', command: `pr merge ${PR} --yes`, asked: true, ran: true },
      { state: 'fragments-waiting', action: 'settle', command: 'release settle', asked: true, ran: true },
      { state: 'nothing-left', action: 'none', command: null, asked: false, ran: false },
    ]);
    expect(driven.report.stop).toBe('nothing-to-run');
  });

  it('puts no step where nothing folds, which is the control beside it', async () => {
    const driven = await drive([STATES.green, STATES.nothing], { settle: null });

    expect(driven.log).toEqual([`ask Merge #${PR} into \`${BASE}\`? [y/N] `, 'run merge', 'read settle']);
    expect(driven.report.steps.map((step) => step.action)).toEqual(['merge', 'none']);
  });

  it('reads no settle after an action that is no merge', async () => {
    const driven = await drive([STATES.behind, STATES.nothing]);

    expect(driven.log).toEqual([`ask Fast-forward \`${BASE}\` to \`origin/${BASE}\`? [y/N] `, 'run sync']);
  });

  it('follows merge-unchecked too, whose own question pr merge puts', async () => {
    const driven = await drive([STATES.unchecked, STATES.nothing]);

    expect(driven.log).toEqual(['run merge-unchecked', 'read settle', `ask ${SETTLE_QUESTION}`, 'run settle']);
    expect(driven.report.steps.map((step) => [step.action, step.asked, step.ran])).toEqual([
      ['merge-unchecked', false, true],
      ['settle', true, true],
      ['none', false, false],
    ]);
  });

  it('stops declined on a no, the merge run and nothing settled', async () => {
    const driven = await drive([STATES.green, STATES.nothing], { answers: [true, false] });

    expect(driven.log.filter((entry) => entry.startsWith('run'))).toEqual(['run merge']);
    expect(driven.report.stop).toBe('declined');
    expect(driven.report.steps.at(-1)).toEqual({
      state: 'fragments-waiting',
      action: 'settle',
      command: 'release settle',
      asked: true,
      ran: false,
    });
    expect(driven.lines.at(-1)).toBe('⏹ Nothing ran.');
  });

  it('stops unchanged where the merge moved nothing, rather than merging again after the settle', async () => {
    const driven = await drive([STATES.green, STATES.green]);

    expect(driven.log.filter((entry) => entry.startsWith('run'))).toEqual(['run merge', 'run settle']);
    expect(driven.report.stop).toBe('unchanged');
  });
});

describe('the settle step under --yes', () => {
  it('stops unasked at settle under a list naming merge alone, naming the list that would allow it', async () => {
    const driven = await drive([STATES.green, STATES.nothing], { ceiling: ['merge'] });

    expect(driven.log).toEqual(['run merge', 'read settle']);
    expect(driven.report.stop).toBe('unasked');
    expect(driven.lines.at(-1)).toBe(`⏹ --${YES_FLAG} allows merge, and this step is settle, so nothing ran;`
      + ` type --${YES_FLAG}=merge,settle to allow it, or drop --${YES_FLAG} to be asked.`);
  });

  it('runs both unasked under a list naming merge and settle', async () => {
    const driven = await drive([STATES.green, STATES.nothing], { ceiling: ['merge', 'settle'] });

    expect(driven.log).toEqual(['run merge', 'read settle', 'run settle']);
    expect(driven.report.steps.map((step) => [step.action, step.asked, step.ran])).toEqual([
      ['merge', false, true],
      ['settle', false, true],
      ['none', false, false],
    ]);
  });

  it('never settles under bare --yes, which stops at the merge before any settle is read', async () => {
    const driven = await drive([STATES.green], { ceiling: BARE_YES_ACTIONS });

    expect(driven.log).toEqual([]);
    expect(driven.report.stop).toBe('unasked');
    expect(driven.report.steps.map((step) => step.action)).toEqual(['merge']);
  });
});

/** Runs git in `cwd` under a fixed identity and no system config. */
function runGit(cwd: string, ...args: readonly string[]): void {
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1',
      LC_ALL: 'C',
    },
  });
}

/** Where a dispatched case runs: the project root and the home beside it. */
interface Planted {
  readonly root: string;
  readonly home: string;
}

/**
 * A project whose one commit on `main` holds a `package.json` at 1.2.3,
 * a changelog, the config and one fragment at `level`, with
 * `origin/main` at that commit and the plan branch checked out, clean.
 */
function plantProject(name: string, level: Fragment['level']): Planted {
  const root = join(tempBase, name, 'project');
  const home = join(tempBase, name, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(join(root, '.changes'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), `pr:\n  base: ${BASE}\nroadmap:\n  issue: 31\n`, 'utf8');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'other', version: '1.2.3' }));
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n');
  const fragment = { plan: 'rafa-63', title: 'One command, the next step', level, notes: ['- next: a change'] };
  writeFileSync(join(root, '.changes', 'rafa-63.md'), serializeFragment(fragment));
  runGit(root, 'init', '--quiet', `--initial-branch=${BASE}`);
  runGit(root, 'add', '-A');
  runGit(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'base');
  runGit(root, 'update-ref', `refs/remotes/origin/${BASE}`, 'HEAD');
  runGit(root, 'checkout', '--quiet', '-b', PLAN_BRANCH);
  return { root, home };
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
  closes: [],
});

/** What one call of a recording command was handed. */
interface Call {
  readonly spelling: string;
  readonly argv: readonly string[];
  readonly flags: Readonly<Record<string, unknown>>;
}

/** `command` with its real declarations and its `run` alone replaced by a recorder. */
function recording(command: RafaCommand, seen: Call[]): RafaCommand {
  return Object.freeze({
    ...command,
    run: (context: RafaContext) => {
      seen.push({ spelling: `${command.subject} ${command.action}`, argv: [...context.argv], flags: { ...context.flags } });
      return Promise.resolve();
    },
  });
}

/** A prompter answering each question in turn, recording the questions. */
function scriptedPrompter(answers: readonly string[], asked: string[]): Prompter {
  const left = [...answers];
  return {
    say: () => undefined,
    ask: (question: string) => {
      asked.push(question);
      return Promise.resolve(left.shift() ?? null);
    },
    close: () => undefined,
  };
}

/** What a dispatched run came to: the capture, what ran, and what was asked. */
interface Dispatched {
  readonly stdout: string;
  readonly exitCode: number;
  readonly seen: readonly Call[];
  readonly asked: readonly string[];
}

/** Dispatches `rafa next` over `planted`, a green pull request, and the two recording commands. */
async function dispatchNext(planted: Planted, answers: readonly string[]): Promise<Dispatched> {
  const seen: Call[] = [];
  const asked: string[] = [];
  const command = createNextCommand({
    isTerminal: () => true,
    readRemote: () => 'git@github.com:open-tomato/rafa.git',
    openGh: () => () => Promise.resolve({ ok: true, stdout: '[]', stderr: '' }),
    pullRequests: () => createPullRequestsDouble({
      findOpen: () => Promise.resolve(SUMMARY),
      get: () => Promise.resolve(DETAIL),
      checks: () => Promise.resolve({ rows: [], verdict: 'green' }),
    }).pulls,
    openPrompter: () => scriptedPrompter(answers, asked),
  });

  const run = await dispatchInProject(
    ['next'],
    [{ name: 'pr', summary: 'pull requests' }, { name: 'release', summary: 'releases' }],
    [command, recording(prMerge, seen), recording(releaseSettle, seen)],
    planted,
  );
  return { stdout: run.stdout, exitCode: run.exitCode, seen, asked };
}

describe('the command, dispatched', () => {
  it('proposes release settle after the merge while a shipping fragment waits on origin/main, and runs it on a yes', async () => {
    const planted = plantProject('patch', 'patch');

    const run = await dispatchNext(planted, ['y', 'y', 'n']);

    expect(run.stdout).toContain('📍 1 fragment waits on `main` and folds into 1.2.4.');
    expect(run.stdout).toContain('👉 settle the fragments on `main` into 1.2.4 — rafa release settle');
    expect(run.asked).toEqual([`Merge #${PR} into \`${BASE}\`? [y/N] `, SETTLE_QUESTION]);
    expect(run.seen.map((call) => [call.spelling, call.argv])).toEqual([
      ['pr merge', [String(PR), '--yes']],
      ['release settle', []],
    ]);
    expect(run.seen[1]?.flags['dry-run']).not.toBe(true);
    expect(run.exitCode).toBe(0);
  });

  it('proposes no settle where only a level none fragment waits, over the same project otherwise', async () => {
    const planted = plantProject('none', 'none');

    const run = await dispatchNext(planted, ['y', 'n']);

    expect(run.stdout).not.toContain('rafa release settle');
    expect(run.asked).toEqual([`Merge #${PR} into \`${BASE}\`? [y/N] `]);
    expect(run.seen.map((call) => call.spelling)).toEqual(['pr merge']);
    expect(run.exitCode).toBe(0);
  });
});
