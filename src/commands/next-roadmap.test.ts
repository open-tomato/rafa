/**
 * Tests for `rafa next --roadmap` in the chain (`next.ts`): the words the
 * `plan`, `start` and `resume` steps run with, the `home` step put after
 * a loop while a hop is away, the report's `hops`, and the stop lines
 * naming `hop` and `home`.
 *
 * A file of its own because `next.test.ts` is already past 800 lines.
 * The cases drive {@link runNextChain} over a scripted reader, as that
 * file does, with {@link NextChainOptions.roadmap} set or left out.
 *
 * ## The controls
 *
 *  - Every case under the option is read beside the same script without
 *    it: the words, the report's keys and the stop line must be what they
 *    were, so a chain that always added `--roadmap`, or always carried
 *    `hops`, fails the control rather than passing the case.
 *  - The home step's order is one log of runs and the lines in the order
 *    they were written, so a home step run AFTER the loop-started line,
 *    or not run at all, reads as the wrong order.
 *  - `afterLoop` counts its calls, so a chain asking it after a step that
 *    started no loop, or without the option, fails on the count.
 *  - The dispatched cases run the real command over stand-ins for `gh`,
 *    git and the provider, once with `--roadmap` and once without, and
 *    the two stdouts must differ in the one word the flag adds and in
 *    nothing else.
 */
import type { NextChainOptions, NextChainReport } from './next.js';
import type { GhResult } from '../adapters/tracker/github.js';
import type { NextCeiling } from '../next/ceiling.js';
import type { HopHome, HopOut } from '../next/hop-rows.js';
import type { NextState } from '../next/state.js';
import type { GitResult } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf } from '../tests/cli-capture.js';

import { createNextCommand, runNextChain } from './next.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-roadmap-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The plan file the loop steps run on. */
const PLAN_PATH = '/work/project/.rafa/plans/PLAN-rafa-70.md';

/** Home: epic #20 on board #10. */
const HOME = Object.freeze({ board: 10, epic: 20 });

/** The hop to C, #71, in epic #40 on board #11. */
const HOP_STEP: HopOut = Object.freeze({
  action: 'hop',
  opening: Object.freeze({
    kind: 'blocker',
    home: HOME,
    from: HOME,
    blocked: 61,
    target: 71,
    targetEpic: 40,
    targetBoard: 11,
  }),
});

/** Coming home with C's pull request #77 open. */
const HOME_STEP: HopHome = Object.freeze({ action: 'home', home: HOME, closing: 'waiting', pullRequest: 77 });

/** A state as a row answers one, with the fields a case fills. */
function stateOf(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'issue-ready',
    action: 'plan',
    reading: '#71 is next on the roadmap and carries `spec:ready`',
    proposal: 'plan #71',
    pullRequest: null,
    issue: 71,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/** The states the cases reach for. */
const STATES = Object.freeze({
  hop: stateOf({
    id: 'hop-blocked',
    action: 'hop',
    reading: 'hop from epic #20: #61 blocked by #71, in epic #40',
    proposal: 'hop to epic #40 on board #11 and work #71, keeping home',
    hop: HOP_STEP,
  }),
  plan: stateOf({}),
  start: stateOf({
    id: 'plan-unstarted',
    action: 'start',
    reading: 'the plan `rafa-70` has not started',
    proposal: 'start the loop on `rafa-70`',
    planStub: 'rafa-70',
    planPath: PLAN_PATH,
  }),
  resume: stateOf({
    id: 'tracker-open',
    action: 'resume',
    reading: 'the plan `rafa-70` has tasks left',
    proposal: 'resume the loop on `rafa-70`',
    planStub: 'rafa-70',
    planPath: PLAN_PATH,
  }),
  home: stateOf({
    id: 'away-ended',
    action: 'home',
    reading: '#71, the hop\'s target in epic #40, has pull request #77 open',
    proposal: 'go back home to epic #20 on board #10',
    pullRequest: 77,
    hop: HOME_STEP,
  }),
});

/** What one chain case drove. */
interface Driven {
  readonly report: NextChainReport;
  /** Every line written, the runs among them as `run <action>`, in order. */
  readonly log: readonly string[];
  /** How many times `afterLoop` was asked. */
  readonly afterLoops: number;
}

/** How a case drives the chain. */
interface DriveOptions {
  /** The `--yes` ceiling; every step asked about when null. */
  readonly ceiling?: NextCeiling;
  /** Set the roadmap option, with `afterLoop` answering this state. Left out, the option is left out. */
  readonly afterLoop?: NextState | null;
  /** The answer to every question; yes when left out. */
  readonly answer?: (question: string) => boolean;
}

/** Runs the chain over `states`, the last repeated, logging lines and runs in one order. */
async function drive(states: readonly NextState[], options: DriveOptions = {}): Promise<Driven> {
  const log: string[] = [];
  let reads = 0;
  let afterLoops = 0;
  const { afterLoop } = options;

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
    ask: (question: string) => Promise.resolve(options.answer?.(question) ?? true),
    ceiling: options.ceiling ?? null,
    dryRun: null,
    info: (line: string) => log.push(line),
    warn: () => undefined,
    ...afterLoop === undefined
      ? {}
      : {
        roadmap: {
          afterLoop: () => {
            afterLoops += 1;
            return Promise.resolve(afterLoop);
          },
        },
      },
  };
  const report = await runNextChain(chain);
  return { report, log, afterLoops };
}

describe('the words the loop steps run with under --roadmap', () => {
  it('adds --roadmap to plan and start, and to nothing without the option', async () => {
    const plain = await drive([STATES.plan, STATES.start], { ceiling: ['plan', 'start'] });
    const roadmap = await drive([STATES.plan, STATES.start], { ceiling: ['plan', 'start'], afterLoop: null });

    expect(plain.report.steps.map((step) => step.command)).toEqual([
      'plan create --next',
      `loop start --plan=${PLAN_PATH} --create-branch`,
    ]);
    expect(roadmap.report.steps.map((step) => step.command)).toEqual([
      'plan create --next --roadmap',
      `loop start --plan=${PLAN_PATH} --create-branch --roadmap`,
    ]);
    expect(roadmap.log).toContain(`👉 start the loop on \`rafa-70\` — rafa loop start --plan=${PLAN_PATH} --create-branch --roadmap`);
  });

  it('adds --roadmap to resume, and leaves the hop step with no command', async () => {
    const driven = await drive([STATES.hop, STATES.resume], { ceiling: ['hop', 'resume'], afterLoop: null });

    expect(driven.report.steps.map((step) => [step.action, step.command])).toEqual([
      ['hop', null],
      ['resume', `loop start --plan=${PLAN_PATH} --roadmap`],
    ]);
  });
});

describe('the report under --roadmap', () => {
  it('carries hops only under the option, left out rather than undefined without it', async () => {
    const plain = await drive([STATES.plan, STATES.start], { ceiling: ['plan', 'start'] });
    const roadmap = await drive([STATES.plan, STATES.start], { ceiling: ['plan', 'start'], afterLoop: null });

    expect(Object.keys(plain.report)).toEqual(['steps', 'stop']);
    expect(Object.keys(roadmap.report)).toEqual(['steps', 'stop', 'hops']);
    expect(roadmap.report.hops).toEqual([]);
  });

  it('records what each hop and home step that ran wrote, in order', async () => {
    const driven = await drive([STATES.hop, STATES.plan, STATES.start], { ceiling: ['hop', 'plan', 'start', 'home'], afterLoop: STATES.home });

    expect(driven.report.hops).toEqual([HOP_STEP, HOME_STEP]);
  });

  it('records no hop that did not run', async () => {
    const driven = await drive([STATES.hop], { ceiling: ['plan'], afterLoop: null });

    expect(driven.report.stop).toBe('unasked');
    expect(driven.report.hops).toEqual([]);
  });
});

describe('the home step after a loop', () => {
  it('runs home after the loop and before the loop-started line', async () => {
    const driven = await drive([STATES.hop, STATES.plan, STATES.start], { ceiling: ['hop', 'plan', 'start', 'home'], afterLoop: STATES.home });

    expect(driven.log.filter((line) => line.startsWith('run '))).toEqual(['run hop', 'run plan', 'run start', 'run home']);
    expect(driven.log.slice(-4)).toEqual([
      '📍 #71, the hop\'s target in epic #40, has pull request #77 open.',
      '👉 go back home to epic #20 on board #10',
      'run home',
      '⏹ The loop has run; rafa next reads where it left the project.',
    ]);
    expect(driven.report.stop).toBe('loop-started');
    expect(driven.report.steps.map((step) => [step.state, step.action, step.ran])).toEqual([
      ['hop-blocked', 'hop', true],
      ['issue-ready', 'plan', true],
      ['plan-unstarted', 'start', true],
      ['away-ended', 'home', true],
    ]);
    expect(driven.afterLoops).toBe(1);
  });

  it('stops loop-started with no home step while no hop is away, and asks afterLoop only after a loop', async () => {
    const driven = await drive([STATES.plan, STATES.start], { ceiling: ['plan', 'start'], afterLoop: null });

    expect(driven.report.stop).toBe('loop-started');
    expect(driven.report.steps.map((step) => step.action)).toEqual(['plan', 'start']);
    expect(driven.afterLoops).toBe(1);
  });

  it('asks about home like any step, and a no stops the chain declined with the hop still away', async () => {
    const asked: string[] = [];
    const driven = await drive([STATES.start], {
      afterLoop: STATES.home,
      answer: (question) => {
        asked.push(question);
        return !question.startsWith('Go back home');
      },
    });

    expect(asked).toEqual([
      'Start the loop on `rafa-70`? [y/N] ',
      'Go back home to epic #20 on board #10? [y/N] ',
    ]);
    expect(driven.report.stop).toBe('declined');
    expect(driven.report.steps.at(-1)).toEqual({ state: 'away-ended', action: 'home', command: null, asked: true, ran: false });
    expect(driven.report.hops).toEqual([]);
    expect(driven.log.at(-1)).toBe('⏹ Nothing ran.');
  });

  it('stops unasked at home when the list leaves it out, naming the list with home in it', async () => {
    const driven = await drive([STATES.start], { ceiling: ['start'], afterLoop: STATES.home });

    expect(driven.report.stop).toBe('unasked');
    expect(driven.log.at(-1)).toBe('⏹ --yes allows start, and this step is home, so nothing ran; type --yes=start,home to allow it,'
      + ' or drop --yes to be asked.');
  });

  it('asks afterLoop never without the option', async () => {
    const driven = await drive([STATES.start], { ceiling: ['start'] });

    expect(driven.report.stop).toBe('loop-started');
    expect(driven.afterLoops).toBe(0);
  });
});

describe('the stop lines under --roadmap', () => {
  it('names hop and home in the list a stop line prints, and leaves them out without the option', async () => {
    const roadmap = await drive([STATES.hop, STATES.start], { ceiling: ['hop'], afterLoop: null });
    const plain = await drive([STATES.hop, STATES.start], { ceiling: ['hop'] });

    expect(roadmap.log.at(-1)).toBe('⏹ --yes allows hop, and this step is start, so nothing ran; type --yes=hop,start to allow it,'
      + ' or drop --yes to be asked.');
    expect(plain.log.at(-1)).toBe('⏹ --yes allows no action, and this step is start, so nothing ran; type --yes=start to allow it,'
      + ' or drop --yes to be asked.');
  });
});

/** The roadmap issue the planted config names, and its one line, which carries `spec:ready`. */
const ROADMAP = 31;
const LINE = 5;

/** How many projects the dispatched cases have planted. */
let planted = 0;

/** A project of its own whose config names the base and the roadmap. */
function plantProject(): { readonly root: string; readonly home: string } {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  const home = join(tempBase, `home-${String(planted)}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), `pr:\n  base: main\nroadmap:\n  issue: ${String(ROADMAP)}\n`, 'utf8');
  return { root, home };
}

/** A `gh` answering the roadmap and its ready line, and an empty list for every listing. */
function readyLineGh(): (args: readonly string[]) => Promise<GhResult> {
  return (args) => {
    if (args.slice(0, 2).join(' ') !== 'issue view') return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
    const number = Number(args[2]);
    return Promise.resolve({
      ok: true,
      stdout: JSON.stringify({
        number,
        title: `Issue ${String(number)}`,
        body: number === ROADMAP
          ? `- [ ] #${String(LINE)} the line\n`
          : 'The spec.\n',
        state: 'OPEN',
        labels: number === ROADMAP
          ? []
          : [{ name: 'spec:ready' }],
        author: { login: 'maintainer' },
      }),
      stderr: '',
    });
  };
}

/** git on `main`, level with `origin/main`, with a clean tree. */
function onBase(args: readonly string[]): GitResult {
  const line = args.join(' ');
  const stdout = line === 'rev-parse --abbrev-ref HEAD'
    ? 'main\n'
    : line.startsWith('rev-list --left-right --count')
      ? '0\t0\n'
      : '';
  return { ok: true, stdout, stderr: '' };
}

/** Runs the real command with `words` after `next` over the stand-ins. */
async function dispatchNext(words: readonly string[]): Promise<Awaited<ReturnType<typeof dispatchInProject>>> {
  const command = createNextCommand({
    isTerminal: () => true,
    readRemote: () => 'git@github.com:open-tomato/rafa.git',
    openGit: () => onBase,
    openGh: () => readyLineGh(),
    pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
    openPrompter: () => {
      throw new Error('a dry run opened a prompter');
    },
  });
  return dispatchInProject(['next', ...words], [], [command], plantProject());
}

describe('rafa next --roadmap, dispatched', () => {
  it('proposes the plan with --roadmap, the rest of stdout byte for byte the plain run\'s', async () => {
    const roadmap = await dispatchNext(['--roadmap', '--dry-run']);
    const plain = await dispatchNext(['--dry-run']);

    expect(roadmap.stdout).toContain(`👉 create the plan for #${String(LINE)} — rafa plan create --next --roadmap\n`);
    expect(plain.stdout).toContain(`👉 create the plan for #${String(LINE)} — rafa plan create --next\n`);
    expect(roadmap.stdout.replace(' --roadmap', '')).toBe(plain.stdout);
    expect([roadmap.exitCode, plain.exitCode]).toEqual([0, 0]);
  });

  it('carries hops in the json result under --roadmap and leaves the key out without it', async () => {
    const resultOf = async (words: readonly string[]): Promise<Record<string, unknown>> => {
      const run = await dispatchNext([...words, '--dry-run', '--output=json']);
      const result = eventsOf(run.stdout).find((event) => event.type === 'result');
      return (result as { data: Record<string, unknown> } | undefined)?.data ?? {};
    };

    const roadmap = await resultOf(['--roadmap']);
    const plain = await resultOf([]);

    expect(Object.keys(roadmap)).toEqual(['steps', 'stop', 'hops']);
    expect(roadmap.hops).toEqual([]);
    expect(Object.keys(plain)).toEqual(['steps', 'stop']);
  });

  it('refuses a value --roadmap swallowed with exit 1, naming the usage', async () => {
    const run = await dispatchNext(['--roadmap', 'sync']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe('❌ --roadmap takes no value, and read "sync" as one\nUsage: rafa next [--dry-run] [--roadmap] [--yes[=<action ids>]]\n');
  });
});
