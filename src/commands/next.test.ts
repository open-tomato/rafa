/**
 * Tests for `rafa next` (`next.ts`): the two lines, the `[y/N]`
 * question, the action, the re-read, every way the chain stops, and the
 * line it refuses.
 *
 * The chain cases drive {@link runNextChain} over a SCRIPTED reader and
 * a recording runner: a list of states read in order, and a log of the
 * states whose actions ran. That is what makes "reads the state again"
 * measurable — the reader answers a second state only because it was
 * asked a second time — and it keeps the endings off git, off GitHub and
 * off a real prompt. `src/next/state.test.ts` drives what each state
 * says and `src/next/actions.test.ts` what each action runs; neither is
 * driven again here.
 *
 * The dispatched cases drive the real command through the dispatcher,
 * over a planted project, a git runner answering by argv, the pull
 * request double and a scripted prompter. What only they can see is the
 * WIRING: that the line is read before anything else, that the fast
 * forward of `sync` really is spawned through the git seam, that the
 * report is the data of the one result event in json mode, and that an
 * action giving a result of its own leaves that one intact.
 *
 * ## The controls
 *
 * Five readings here would pass while wrong, and each is paired:
 *
 *  - The yes case, which runs the action, is read beside the no case
 *    over the same states, which must run nothing. A chain that ran
 *    whatever was answered would pass the first alone.
 *  - The re-read is read as a COUNT of reads beside the endings that
 *    must not read again: a chain that read once and stopped would
 *    still print two lines.
 *  - The unasked ceiling is read beside the same state with the action
 *    named in the list, which must run it with no question put.
 *  - The `ready` step is read under a ceiling naming it and under no
 *    ceiling at all, so "never unasked" is held against the step that
 *    does run.
 *  - The dispatched `sync` is read as the argv git was handed beside the
 *    same state under `--dry-run`, which must hand it nothing.
 *
 * ## What passes while wrong
 *
 * Six mutations of `next.ts` were driven on 2026-09-22, one at a time,
 * over `env -u CLAUDECODE bun test src/commands/next.test.ts
 * src/next/`, the module restored from a scratch copy and verified with
 * `shasum -c` each time, against the 179 pass and 0 fail the file and
 * `src/next/` answered together before the last two cases joined it:
 *
 *  - the `repeats` guard dropped, so a state that reads back unchanged
 *    runs its action again: 178 pass and 1 fail, the unchanged case
 *    alone. It does not hang — the chain runs that action
 *    {@link MAX_ACTIONS} times and ends `capped`, which is the second
 *    guard doing what it is for, and what the case reads is which of
 *    the two stopped it.
 *  - the loop-started stop dropped, so the chain reads on after `loop
 *    start`: 178 pass and 1 fail, the loop case alone, which counts the
 *    reads rather than the lines.
 *  - `ALWAYS_ASKED` dropped from {@link allowedUnasked}, so a
 *    `--yes` list naming `ready` marks an issue ready unasked: 177 pass
 *    and 2 fail, the `ready` pair and the reading case beside it.
 *  - the question asked and its answer ignored, every step run: 176
 *    pass and 3 fail, the no case, the dispatched no case and the
 *    problems case, which answers no to end its chain.
 *  - the state line and the proposal line written in the other order:
 *    174 pass and 5 fail, every case that reads the lines as written,
 *    the two dispatched ones included.
 *  - a `CommandExit` an action threw caught and answered as a stop: 178
 *    pass and 1 fail, the failure case alone. Every other case ends
 *    without a throw, and none of them sees it.
 *
 * A seventh was driven the same way once the two json-mode cases below
 * joined the file, against 181 pass and 0 fail either side: an action
 * run over the caller's own output rather than {@link actionOutput}'s,
 * so its payload becomes the invocation's result. 180 pass and 1 fail,
 * the case that counts the result events — and what it reads there is
 * an ending with NO data at all, because the report the chain then gave
 * was the second result the dispatcher refuses.
 */
import type { NextChainOptions, NextChainReport } from './next.js';
import type { RafaCommand } from '../cli/command.js';
import type { NextState } from '../next/state.js';
import type { GitResult, GitRunner, PullRequestDetail, PullRequestSummary } from '../pr/index.js';
import type { Prompter } from '../project/root-choice.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf } from '../tests/cli-capture.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  actionOutput,
  allowedUnasked,
  BARE_YES_ACTIONS,
  createNextCommand,
  DRY_RUN_FLAG,
  MAX_ACTIONS,
  NEXT_USAGE,
  nextQuestion,
  proposalLine,
  readDryRun,
  readYesCeiling,
  runNextChain,
  stateLine,
  YES_FLAG,
} from './next.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-command-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base every case runs against. */
const BASE = 'main';

/** The roadmap issue the dispatched cases read. */
const ROADMAP = 31;

/** The pull request the pull request states name. */
const PR = 41;

/** The issue the roadmap states name. */
const ISSUE = 64;

/** The plan file a plan state names, absolute as a row answers it. */
const PLAN = join('/', 'scratch', '.rafa', 'plans', 'PLAN-rafa-63.md');

/** A state as a row answers one, with the fields a case fills. */
function stateOf(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'pr-green',
    action: 'merge',
    reading: `#${PR} is open on \`feat/rafa-63\`, green and merges into \`${BASE}\``,
    proposal: `merge #${PR} into \`${BASE}\``,
    pullRequest: PR,
    issue: null,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/** The state each case reaches for, one per action it drives. */
const STATES = Object.freeze({
  green: stateOf({}),
  behind: stateOf({
    id: 'base-behind',
    action: 'sync',
    reading: `\`${BASE}\` is 2 commits behind \`origin/${BASE}\``,
    proposal: `fast-forward \`${BASE}\` to \`origin/${BASE}\``,
    pullRequest: null,
  }),
  pending: stateOf({
    id: 'pr-pending',
    action: 'wait',
    reading: `#${PR} is open on \`feat/rafa-63\` and its checks are still running`,
    proposal: `wait for the checks on #${PR}`,
  }),
  planned: stateOf({
    id: 'issue-ready',
    action: 'plan',
    reading: `#${ISSUE} is next on the roadmap and carries \`spec:ready\``,
    proposal: `create the plan for #${ISSUE}`,
    pullRequest: null,
    issue: ISSUE,
  }),
  unstarted: stateOf({
    id: 'plan-unstarted',
    action: 'start',
    reading: '`rafa-63` is planned, with no run and no branch',
    proposal: 'start the loop on `rafa-63`, creating its branch',
    pullRequest: null,
    planStub: 'rafa-63',
    planPath: PLAN,
  }),
  notReady: stateOf({
    id: 'issue-not-ready',
    action: 'ready',
    reading: `#${ISSUE} not ready: it carries no spec:ready label`,
    proposal: `check the spec of #${ISSUE} and mark it ready`,
    pullRequest: null,
    issue: ISSUE,
  }),
  nothing: stateOf({
    id: 'nothing-left',
    action: 'none',
    reading: `the roadmap, issue #${ROADMAP}, has no line left that is not done or taken (12 lines passed)`,
    proposal: 'open the next spec issue and add it to the roadmap',
    pullRequest: null,
  }),
  dirty: stateOf({
    id: 'tree-modified',
    action: 'none',
    reading: 'the working tree has changes to 1 tracked file: `src/next/state.ts`',
    proposal: 'commit or set aside your changes; rafa will not touch them',
    pullRequest: null,
  }),
});

/** What one chain case drove: the report, the lines, the questions and the actions that ran. */
interface Driven {
  readonly report: NextChainReport;
  readonly lines: readonly string[];
  readonly warnings: readonly string[];
  readonly asked: readonly string[];
  readonly ran: readonly string[];
  readonly reads: number;
}

/** What a chain case plants; every part left out is the default beside it. */
interface Script {
  /** The states the reader answers, in order; the last answers every read after it. */
  readonly states: readonly NextState[];
  /** What the question is answered with. */
  readonly answer?: boolean;
  /** The ids that may run unasked. */
  readonly ceiling?: readonly string[] | null;
  readonly dryRun?: boolean;
}

/** Runs the chain over `script`, recording everything it did. */
async function drive(script: Script): Promise<Driven> {
  const lines: string[] = [];
  const warnings: string[] = [];
  const asked: string[] = [];
  const ran: string[] = [];
  let reads = 0;

  const options: NextChainOptions = {
    read: () => {
      const state = script.states[Math.min(reads, script.states.length - 1)];
      reads += 1;
      if (state === undefined) throw new Error('the script answered no state');
      return Promise.resolve(state);
    },
    run: (state: NextState) => {
      ran.push(`${state.id}:${state.action}`);
      return Promise.resolve();
    },
    ask: (question: string) => {
      asked.push(question);
      return Promise.resolve(script.answer ?? true);
    },
    ceiling: script.ceiling ?? null,
    dryRun: script.dryRun ?? false,
    info: (line: string) => lines.push(line),
    warn: (line: string) => warnings.push(line),
  };
  const report = await runNextChain(options);
  return { report, lines, warnings, asked, ran, reads };
}

describe('the two lines and the question', () => {
  it('writes what is true, then what to do about it with the command that does it', () => {
    const lines = [stateLine(STATES.green), proposalLine(STATES.green, {
      action: 'merge',
      command: 'pr merge',
      argv: [String(PR), `--${YES_FLAG}`],
    })];

    expect(lines).toEqual([
      `📍 #${PR} is open on \`feat/rafa-63\`, green and merges into \`${BASE}\`.`,
      `👉 merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --${YES_FLAG}`,
    ]);
  });

  it('writes the proposal alone for an action that runs no command', () => {
    expect(proposalLine(STATES.behind, null))
      .toBe(`👉 fast-forward \`${BASE}\` to \`origin/${BASE}\``);
  });

  it('asks the proposal itself, capitalised and spelled [y/N]', () => {
    const questions = [STATES.green, STATES.behind, STATES.notReady]
      .map((state) => nextQuestion(state));

    expect(questions).toEqual([
      `Merge #${PR} into \`${BASE}\`? [y/N] `,
      `Fast-forward \`${BASE}\` to \`origin/${BASE}\`? [y/N] `,
      `Check the spec of #${ISSUE} and mark it ready? [y/N] `,
    ]);
  });
});

describe('the chain', () => {
  it('runs the action on a yes, reads the state again, and proposes what follows', async () => {
    const driven = await drive({ states: [STATES.green, STATES.nothing] });

    expect(driven.ran).toEqual(['pr-green:merge']);
    expect(driven.reads).toBe(2);
    expect(driven.asked).toEqual([`Merge #${PR} into \`${BASE}\`? [y/N] `]);
    expect(driven.lines).toEqual([
      `📍 #${PR} is open on \`feat/rafa-63\`, green and merges into \`${BASE}\`.`,
      `👉 merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --${YES_FLAG}`,
      `📍 the roadmap, issue #${ROADMAP}, has no line left that is not done or taken (12 lines passed).`,
      '👉 open the next spec issue and add it to the roadmap',
    ]);
    expect(driven.report.stop).toBe('nothing-to-run');
    expect(driven.report.steps.map((step) => [step.state, step.ran])).toEqual([['pr-green', true], ['nothing-left', false]]);
  });

  it('stops on a no, running nothing and reading no further state', async () => {
    const driven = await drive({ states: [STATES.green, STATES.nothing], answer: false });

    expect([driven.ran, driven.reads, driven.report.stop]).toEqual([[], 1, 'declined']);
    expect(driven.asked).toEqual([`Merge #${PR} into \`${BASE}\`? [y/N] `]);
    expect(driven.lines.at(-1)).toBe('⏹ Nothing ran.');
    expect(driven.report.steps.map((step) => [step.asked, step.ran])).toEqual([[true, false]]);
  });

  it('lets a failed action carry its own message and exit code out, reading no further state', async () => {
    const read: string[] = [];
    const asked: string[] = [];
    let thrown: CommandExit | null = null;

    try {
      await runNextChain({
        read: () => {
          read.push(`read ${read.length + 1}`);
          return Promise.resolve(read.length === 1
            ? STATES.pending
            : STATES.nothing);
        },
        run: () => {
          throw new CommandExit(3, '❌ checks still running on #41');
        },
        ask: (question: string) => {
          asked.push(question);
          return Promise.resolve(true);
        },
        ceiling: null,
        dryRun: false,
        info: () => undefined,
        warn: () => undefined,
      });
    } catch (error) {
      thrown = error instanceof CommandExit
        ? error
        : null;
    }

    expect(thrown?.exitCode).toBe(3);
    expect(thrown?.message).toBe('❌ checks still running on #41');
    expect([read, asked.length]).toEqual([['read 1'], 1]);
  });

  it('stops where the state carries no action, asking nothing', async () => {
    const driven = await drive({ states: [STATES.dirty] });

    expect([driven.asked, driven.ran, driven.reads]).toEqual([[], [], 1]);
    expect(driven.report.stop).toBe('nothing-to-run');
    expect(driven.lines).toEqual([
      '📍 the working tree has changes to 1 tracked file: `src/next/state.ts`.',
      '👉 commit or set aside your changes; rafa will not touch them',
    ]);
  });

  it('stops once a loop has started, reading no state after it', async () => {
    const driven = await drive({ states: [STATES.unstarted, STATES.nothing] });

    expect([driven.ran, driven.reads]).toEqual([['plan-unstarted:start'], 1]);
    expect(driven.report.stop).toBe('loop-started');
    expect(driven.lines.at(-1)).toBe('⏹ The loop has run; rafa next reads where it left the project.');
  });

  it('prints the two lines and stops under --dry-run, asking nothing and running nothing', async () => {
    const driven = await drive({ states: [STATES.green, STATES.nothing], dryRun: true });

    expect([driven.asked, driven.ran, driven.reads]).toEqual([[], [], 1]);
    expect(driven.report.stop).toBe('dry-run');
    expect(driven.lines.at(-1)).toBe(`⏹ --${DRY_RUN_FLAG}: nothing ran.`);
    expect(driven.report.steps.map((step) => [step.state, step.command])).toEqual([['pr-green', `pr merge ${PR} --${YES_FLAG}`]]);
  });

  it('runs an action the ceiling names with no question put', async () => {
    const driven = await drive({
      states: [STATES.behind, STATES.nothing],
      ceiling: ['sync', 'plan'],
    });

    expect([driven.asked, driven.ran]).toEqual([[], ['base-behind:sync']]);
    expect(driven.report.steps.map((step) => [step.action, step.asked, step.ran])).toEqual([
      ['sync', false, true],
      ['none', false, false],
    ]);
  });

  it('stops at the first action the ceiling leaves out, with its proposal printed', async () => {
    const driven = await drive({
      states: [STATES.behind, STATES.green],
      ceiling: ['sync'],
    });

    expect([driven.asked, driven.ran, driven.reads]).toEqual([[], ['base-behind:sync'], 2]);
    expect(driven.report.stop).toBe('unasked');
    expect(driven.lines.at(-2)).toBe(`👉 merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --${YES_FLAG}`);
    expect(driven.lines.at(-1)).toBe(`⏹ --${YES_FLAG} allows sync, and this step is merge, so nothing ran;`
      + ` type --${YES_FLAG}=sync,merge to allow it, or drop --${YES_FLAG} to be asked.`);
  });

  it('never runs the ready step unasked, and asks it where nobody named a ceiling', async () => {
    const named = await drive({ states: [STATES.notReady], ceiling: ['ready', 'merge'] });
    const asked = await drive({ states: [STATES.notReady, STATES.nothing] });

    expect([named.asked, named.ran, named.report.stop]).toEqual([[], [], 'unasked']);
    expect([asked.asked.length, asked.ran]).toEqual([1, ['issue-not-ready:ready']]);
  });

  it('stops where the state the action ran for reads back unchanged', async () => {
    const driven = await drive({ states: [STATES.pending] });

    expect([driven.ran, driven.reads]).toEqual([['pr-pending:wait'], 2]);
    expect(driven.report.stop).toBe('unchanged');
    expect(driven.lines.at(-1))
      .toBe('⏹ That last step left the project where it was, so the chain stops rather than repeating it.');
  });

  it('caps one chain at MAX_ACTIONS actions, whatever the states keep proposing', async () => {
    const one = STATES.behind;
    const other = STATES.pending;
    const driven = await drive({
      states: Array.from({ length: MAX_ACTIONS * 2 }, (_unused, index) => (index % 2 === 0
        ? one
        : other)),
      ceiling: ['sync', 'wait'],
    });

    expect(driven.ran.length).toBe(MAX_ACTIONS);
    expect(driven.report.stop).toBe('capped');
    expect(driven.lines.at(-1))
      .toBe(`⏹ ${MAX_ACTIONS} actions have run, which is as many as one chain runs; run rafa next again.`);
  });

  it('warns every reading that failed beside the answer it carried', async () => {
    const carried = stateOf({ problems: ['`origin/main` could not be fetched', 'the plans could not be read'] });
    const driven = await drive({ states: [carried], answer: false });

    expect(driven.warnings).toEqual(['`origin/main` could not be fetched', 'the plans could not be read']);
  });
});

describe('the line', () => {
  it('reads --dry-run bare, negated, written out and left out', () => {
    const read = [{}, { [DRY_RUN_FLAG]: true }, { [DRY_RUN_FLAG]: false }, { [DRY_RUN_FLAG]: 'true' }, { [DRY_RUN_FLAG]: 'false' }]
      .map((flags) => readDryRun(flags));

    expect(read).toEqual([false, true, false, true, false]);
  });

  it('refuses a value --dry-run swallowed, naming the usage', () => {
    let refused: CommandExit | null = null;

    try {
      readDryRun({ [DRY_RUN_FLAG]: 'sync' });
    } catch (error) {
      refused = error instanceof CommandExit
        ? error
        : null;
    }

    expect(refused?.exitCode).toBe(1);
    expect(refused?.message).toBe(`❌ --${DRY_RUN_FLAG} takes no value, and read "sync" as one\nUsage: ${NEXT_USAGE}`);
  });

  it('reads bare --yes as the four that neither merge, nor start a loop, nor push', () => {
    expect(readYesCeiling({ [YES_FLAG]: true })).toEqual(['sync', 'wait', 'unblock', 'plan']);
    expect(BARE_YES_ACTIONS).toEqual(['sync', 'wait', 'unblock', 'plan']);
  });

  it('reads a comma list, dropping the padding and the empty entries, and names nothing without the flag', () => {
    expect(readYesCeiling({ [YES_FLAG]: 'merge, sync ,,plan' })).toEqual(['merge', 'sync', 'plan']);
    expect(readYesCeiling({})).toBeNull();
    expect(readYesCeiling({ [YES_FLAG]: false })).toBeNull();
  });

  it('allows an action a ceiling names, none where no ceiling was given, and never ready', () => {
    expect([
      allowedUnasked('merge', ['merge']),
      allowedUnasked('merge', ['sync']),
      allowedUnasked('merge', null),
      allowedUnasked('ready', ['ready']),
    ]).toEqual([true, false, false, false]);
  });
});

/** How many projects the dispatched cases have planted. */
let planted = 0;

/** A project with `roadmap.issue` set, so the board reads no search. */
function plantProject(): { readonly root: string; readonly home: string } {
  planted += 1;
  const root = join(tempBase, `project-${planted}`);
  const home = join(tempBase, `home-${planted}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(root, '.rafa', 'config.yaml'),
    `pr:\n  base: ${BASE}\nroadmap:\n  issue: ${ROADMAP}\n`,
    'utf8',
  );
  return { root, home };
}

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/**
 * A git runner on `branch`, over a base that is `behind` commits behind
 * its remote and level again once it has merged.
 */
function fakeGit(behind: number, branch: string = BASE): { readonly git: GitRunner; readonly calls: () => readonly string[] } {
  const calls: string[] = [];
  let merged = false;
  return {
    git: (args) => {
      const line = args.join(' ');
      calls.push(line);
      if (line === 'rev-parse --abbrev-ref HEAD') return said(`${branch}\n`);
      if (line === `rev-list --left-right --count ${BASE}...origin/${BASE}`) {
        return said(merged
          ? '0\t0\n'
          : `0\t${behind}\n`);
      }
      if (line === `merge --ff-only origin/${BASE}`) {
        merged = true;
        return said('Updating 1234567..89abcde\nFast-forward\n');
      }
      return said('');
    },
    calls: () => calls,
  };
}

/** A `gh` runner answering a roadmap issue whose body carries no line at all. */
function emptyRoadmapGh(): (args: readonly string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return (args) => {
    if (args.slice(0, 2).join(' ') === 'issue view') {
      return Promise.resolve({
        ok: true,
        stdout: JSON.stringify({
          number: ROADMAP,
          title: 'Roadmap',
          body: '# Roadmap\n\nNothing left.\n',
          state: 'OPEN',
          labels: [],
          author: { login: 'maintainer' },
        }),
        stderr: '',
      });
    }
    return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
  };
}

/** A prompter answering `answer` to every question, recording each one. */
function scriptedPrompter(answer: string, asked: string[]): Prompter {
  return {
    say: () => undefined,
    ask: (question: string) => {
      asked.push(question);
      return Promise.resolve(answer);
    },
    close: () => undefined,
  };
}

/** The branch a pull request state is read on. */
const PLAN_BRANCH = 'feat/rafa-63';

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

/** The detail as `get` answers it: one GitHub has settled as mergeable. */
const DETAIL: PullRequestDetail = Object.freeze({
  ...SUMMARY,
  body: 'Closes #63',
  headRefOid: 'abc1234',
  mergeable: 'mergeable',
  mergeStateStatus: 'CLEAN',
  labels: [],
});

/** A `pr wait` that gives a result of its own, as the real one does in json mode. */
function recordingWait(ran: string[]): RafaCommand {
  return {
    name: 'pr wait',
    subject: 'pr',
    action: 'wait',
    summary: 'records one call',
    description: 'Records one call of pr wait and gives a result of its own.',
    args: [{ name: 'n', description: 'The pull request.', type: 'string' }],
    flags: [],
    examples: [{ cmd: 'rafa pr wait', note: 'records it' }],
    outputs: ['text', 'json'],
    run: (context) => {
      ran.push(`pr wait ${context.args.join(' ')}`);
      context.output.result({ number: PR, verdict: 'pending' });
      return Promise.resolve();
    },
  };
}

describe('the command, dispatched', () => {
  it('fast-forwards the base on a yes through the git seam, then proposes what follows', async () => {
    const git = fakeGit(2);
    const asked: string[] = [];
    const command = createNextCommand({
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGit: () => git.git,
      openGh: () => emptyRoadmapGh(),
      pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
      openPrompter: () => scriptedPrompter('y', asked),
    });

    const run = await dispatchInProject(['next'], [], [command], plantProject());

    expect(asked).toEqual([`Fast-forward \`${BASE}\` to \`origin/${BASE}\`? [y/N] `]);
    expect(git.calls()).toContain(`merge --ff-only origin/${BASE}`);
    expect(run.stdout.split('\n').filter((line) => line.startsWith('📍') || line.startsWith('👉'))).toEqual([
      `📍 \`${BASE}\` is 2 commits behind \`origin/${BASE}\`.`,
      `👉 fast-forward \`${BASE}\` to \`origin/${BASE}\``,
      `📍 the roadmap, issue #${ROADMAP}, has no line left that is not done or taken (0 lines passed).`,
      '👉 open the next spec issue and add it to the roadmap',
    ]);
    expect(run.exitCode).toBe(0);
  });

  it('merges nothing on a no, leaving the base where it was', async () => {
    const git = fakeGit(2);
    const asked: string[] = [];
    const command = createNextCommand({
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGit: () => git.git,
      openGh: () => emptyRoadmapGh(),
      pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
      openPrompter: () => scriptedPrompter('n', asked),
    });

    const run = await dispatchInProject(['next'], [], [command], plantProject());

    expect(asked.length).toBe(1);
    expect(git.calls().filter((line) => line.startsWith('merge'))).toEqual([]);
    expect(run.stdout).toContain('⏹ Nothing ran.');
    expect(run.exitCode).toBe(0);
  });

  it('opens no prompter and spawns no merge under --dry-run', async () => {
    const git = fakeGit(2);
    const command = createNextCommand({
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGit: () => git.git,
      openGh: () => emptyRoadmapGh(),
      pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
      openPrompter: () => {
        throw new Error('the dry run opened a prompter');
      },
    });

    const run = await dispatchInProject(['next', `--${DRY_RUN_FLAG}`], [], [command], plantProject());

    expect(git.calls().filter((line) => line.startsWith('merge'))).toEqual([]);
    expect(run.stdout).toBe([
      `📍 \`${BASE}\` is 2 commits behind \`origin/${BASE}\`.`,
      `👉 fast-forward \`${BASE}\` to \`origin/${BASE}\``,
      `⏹ --${DRY_RUN_FLAG}: nothing ran.`,
      '',
    ].join('\n'));
    expect(run.exitCode).toBe(0);
  });

  it('refuses a line handing it a word, reading no config and spawning nothing', async () => {
    const git = fakeGit(0);
    const command = createNextCommand({
      readRemote: () => {
        throw new Error('the refused line resolved a provider');
      },
      openGit: () => git.git,
      openPrompter: () => {
        throw new Error('the refused line opened a prompter');
      },
    });

    const run = await dispatchInProject(['next', 'merge'], [], [command], plantProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe(`❌ Expected no argument, got 1: merge\nUsage: ${NEXT_USAGE}\n`);
    expect(git.calls()).toEqual([]);
  });

  it('gives the steps and why it stopped as the data of the one result event in json mode', async () => {
    const git = fakeGit(0);
    const command = createNextCommand({
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGit: () => git.git,
      openGh: () => emptyRoadmapGh(),
      pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
      openPrompter: () => {
        throw new Error('a state with nothing to run opened a prompter');
      },
    });

    const run = await dispatchInProject(['next', '--output=json'], [], [command], plantProject());
    const events = eventsOf(run.stdout);
    const results = events.filter((event) => event.type === 'result');

    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'log', 'result']);
    expect(results[0]?.data).toEqual({
      steps: [{ state: 'nothing-left', action: 'none', command: null, asked: false, ran: false }],
      stop: 'nothing-to-run',
    });
    expect(run.exitCode).toBe(0);
  });
  it('gives one result event for a chain whose action gave one of its own', async () => {
    const ran: string[] = [];
    const git = fakeGit(0, PLAN_BRANCH);
    const command = createNextCommand({
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      openGit: () => git.git,
      openGh: () => emptyRoadmapGh(),
      pullRequests: () => createPullRequestsDouble({
        findOpen: () => Promise.resolve(SUMMARY),
        get: () => Promise.resolve(DETAIL),
        checks: () => Promise.resolve({ rows: [], verdict: 'pending' }),
      }).pulls,
      openPrompter: () => {
        throw new Error('a chain under --yes opened a prompter');
      },
    });

    const run = await dispatchInProject(
      ['next', `--${YES_FLAG}=wait`, '--output=json'],
      [{ name: 'pr', summary: 'pull requests' }],
      [command, recordingWait(ran)],
      plantProject(),
    );
    const results = eventsOf(run.stdout).filter((event) => event.type === 'result');

    expect(ran).toEqual([`pr wait ${PR}`]);
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toMatchObject({ stop: 'unchanged' });
    expect(run.exitCode).toBe(0);
  });
});

describe('the output an action writes through', () => {
  it('hands the lines on and takes the payload, so one invocation gives one result', () => {
    const lines: string[] = [];
    const payloads: unknown[] = [];
    const output = actionOutput(sinkOutput({
      info: (line: string) => lines.push(line),
      warn: (line: string) => lines.push(`warn: ${line}`),
      result: (payload: unknown) => payloads.push(payload),
    }));

    output.info('a line the action wrote');
    output.warn('a warning it wrote');
    output.result({ number: PR });

    expect(lines).toEqual(['a line the action wrote', 'warn: a warning it wrote']);
    expect(payloads).toEqual([]);
  });
});

describe('what the command declares', () => {
  it('is top-level, needs a project, and declares the two flags with its examples and outputs', () => {
    const command = createNextCommand();

    expect([command.name, command.subject, command.action]).toEqual(['next', 'next', 'next']);
    expect(command.needsProject).toBeUndefined();
    expect(command.flags.map((flag) => [flag.name, flag.type])).toEqual([[DRY_RUN_FLAG, 'boolean'], [YES_FLAG, 'string']]);
    expect(command.outputs).toEqual(['text', 'json']);
    expect(command.examples.every((example) => example.cmd.startsWith('rafa next'))).toBe(true);
    expect(command.description.length).toBeGreaterThan(command.summary.length);
  });
});
