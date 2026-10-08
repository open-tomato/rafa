/**
 * Tests for `start/continue-run.ts`: where a `--continue` run decides,
 * how one decision session is spawned and read, and what each strategy
 * does to the tracker, the pass-over list, the run's retries and its
 * events.
 *
 * Each case plants a tracker under a temp directory, a spawner standing
 * in for `claude` that answers a `rafa:decision` block and records every
 * call, retries and a session record standing in for the run's, and a
 * `sinkOutput` as the active output, so the events and the lines are
 * read as the loop writes them. A stop with no decision asked spawns
 * nothing, and the call count is read to show it; the same stop with
 * the decision asked is its control.
 */
import type { DecisionStop, RunDecisionsOptions } from './continue-run.js';
import type { PassOverList } from './pass-over.js';
import type { RetryRefusal } from './retry-budget.js';
import type { CliEvent } from '../ports/index.js';
import type { TaskInfo } from '../utils/tracker.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import { CONTINUE_OFF } from './continue-args.js';
import { DECISION_STOP_EXIT, LoopEnd, PASSED_OVER_EXIT } from './continue-exits.js';
import { createRunDecisions } from './continue-run.js';
import { UNREADABLE_PREFIX } from './decision-parse.js';

/** A fence, kept out of the block literals below. */
const FENCE = '```';

/** A tracker of four tasks: a gate on line 3 (index 2), its user, and two more. */
const TRACKER = [
  '# Plan: continue',
  '',
  '- [BLOCKED] Check the env file a person writes',
  '- [ ] Use the env file',
  '- [ ] Write the helper',
  '- [ ] Wire the helper',
  '',
].join('\n');

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-continue-run-'));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Every event emitted, as name and data. */
let events: (readonly [string, unknown])[] = [];

/** Every line written at warn or info level. */
let lines: string[] = [];

beforeEach(() => {
  events = [];
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.push(message);
    },
    warn: (message) => {
      lines.push(message);
    },
    event: (event: CliEvent) => {
      if (event.type === 'event') events.push([event.name, event.data]);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

/** A `rafa:decision` block holding `body`, after a line of reasoning. */
function decisionOutput(...body: readonly string[]): string {
  return ['I read the task and its blocker.', '', `${FENCE}rafa:decision`, ...body, FENCE, ''].join('\n');
}

/** What one planted run holds: its tracker, the calls the stand-in got, and what the stand-ins recorded. */
interface Planted {
  readonly trackerPath: string;
  readonly calls: { args: readonly string[]; prompt: string }[];
  readonly saved: PassOverList[];
  readonly retried: string[];
  /** The retries left; a granted retry takes one. */
  left: number;
  refusal: RetryRefusal | null;
  interrupted: boolean;
}

/** A run over {@link TRACKER} whose stand-in answers `answers` in turn, `exitCode` each. */
function plant(answers: readonly string[], exitCode = 0, seed: PassOverList = []): Planted & { readonly options: RunDecisionsOptions } {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const trackerPath = join(root, 'PLAN_TRACKER-continue.md');
  writeFileSync(trackerPath, TRACKER, 'utf8');
  const planted: Planted = { trackerPath, calls: [], saved: [], retried: [], left: 1, refusal: null, interrupted: false };
  const options: RunDecisionsOptions = {
    continueArgs: { on: true, directive: null, forceWrapUp: false },
    repoRoot: root,
    checkout: root,
    trackerPath,
    planPath: join(root, 'PLAN-continue.md'),
    settings: { loopContinueCriteria: '.rafa/continue-criteria.md', loopContinueCriteriaMode: 'extend' },
    settingSources: ['project', 'local'],
    session: {
      decisionsChanged: (list) => {
        planted.saved.push(list);
      },
    },
    retries: {
      retry: (reason) => {
        if (planted.left === 0) return false;
        planted.left -= 1;
        planted.retried.push(reason);
        return true;
      },
      left: () => planted.left,
      lastRefusal: () => planted.refusal,
    },
    isInterrupted: () => planted.interrupted,
    seed,
    spawn: (args, prompt) => {
      planted.calls.push({ args, prompt });
      return Promise.resolve({ exitCode, stdout: answers[planted.calls.length - 1] ?? '' });
    },
  };
  return Object.assign(planted, { options });
}

/** The open task on `lineNum` of the planted tracker, as `findNextTask` would answer it. */
function taskAt(trackerPath: string, lineNum: number): TaskInfo {
  const lines = readFileSync(trackerPath, 'utf8').split('\n');
  const found = findNextTask(lines.map((line, index) => index === lineNum
    ? line
    : line.replace(/^- \[(?: |BLOCKED)\] /, '- [x] ')).join('\n'));
  if (found?.lineNum !== lineNum) throw new Error(`no open task on line ${lineNum}`);
  return found;
}

/** A clean exit its report held, on the gate on line index 2. */
function heldReport(trackerPath: string): DecisionStop {
  const taskInfo = taskAt(trackerPath, 2);
  return {
    kind: 'clean-exit',
    taskInfo,
    finished: { attempt: { outcome: 'committed', subject: 's', sha: 'abc', failedStep: null, exitCode: 0, message: '' }, holds: ['status: blocked'] },
    stopEvent: { kind: 'task-blocked', position: { index: 1, total: 4 }, reason: 'status: blocked' },
  };
}

/** What `read` threw, as a `LoopEnd`. Fails when it threw none. */
async function endOf(read: () => Promise<unknown>): Promise<LoopEnd> {
  try {
    await read();
  } catch (error) {
    if (error instanceof LoopEnd) return error;
    throw error;
  }
  throw new Error('expected a LoopEnd, and nothing was thrown');
}

describe('a run without --continue', () => {
  it('skips no line, decides no stop and spawns nothing', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "x"')]);
    const decisions = createRunDecisions({ ...run.options, continueArgs: CONTINUE_OFF });

    expect(decisions.skipLines(TRACKER).size).toBe(0);
    expect(await decisions.atStop(heldReport(run.trackerPath))).toBe(false);
    expect(() => decisions.atPlanEnd(TRACKER)).not.toThrow();
    expect(run.calls).toHaveLength(0);
    expect(run.saved).toHaveLength(0);
  });
});

describe('where a --continue run decides', () => {
  it('decides a report that holds its task at once, in one read-only session handed the task, its line and the open tasks', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "A person writes the env file."')]);
    const decisions = createRunDecisions(run.options);

    expect(await decisions.atStop(heldReport(run.trackerPath))).toBe(true);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]?.args.slice(-2)).toEqual(['--tools', 'Read,Grep,Glob']);
    expect(run.calls[0]?.prompt).toContain('The task stopped at tracker line 3.');
    expect(run.calls[0]?.prompt).toContain('line 4: Use the env file');
    expect(run.calls[0]?.prompt).toContain('status: blocked');
  });

  it('decides no refused commit, spawning nothing', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "x"')]);
    const decisions = createRunDecisions(run.options);
    const stop = heldReport(run.trackerPath);
    const refused: DecisionStop = stop.kind === 'clean-exit'
      ? { ...stop, finished: { ...stop.finished, attempt: { ...stop.finished.attempt, outcome: 'failed' } } }
      : stop;

    expect(await decisions.atStop(refused)).toBe(false);
    expect(run.calls).toHaveLength(0);
  });

  it('decides a retry-safe stop only once its retries refused for being spent', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "x"')]);
    const decisions = createRunDecisions(run.options);
    const stop: DecisionStop = {
      kind: 'session-exit',
      taskInfo: taskAt(run.trackerPath, 2),
      exitCode: 1,
      stopEvent: { kind: 'task-blocked', position: { index: 1, total: 4 }, reason: 'session exited 1' },
    };

    for (const refusal of ['interrupted', 'checkout moved', null] as const) {
      run.refusal = refusal;
      expect(await decisions.atStop(stop)).toBe(false);
    }
    expect(run.calls).toHaveLength(0);

    // The control: the same stop once the budget is spent.
    run.refusal = 'spent';
    expect(await decisions.atStop(stop)).toBe(true);
    expect(run.calls[0]?.prompt).toContain('session exited 1');
  });

  it('decides a red suite step on the line it blocked, handed that line\'s blocker', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "x"')]);
    writeFileSync(run.trackerPath, TRACKER.replace(
      '- [BLOCKED] Check the env file a person writes',
      '- [BLOCKED] Check the env file a person writes  <!-- blocked: The runner\'s task step found failures -->',
    ), 'utf8');
    run.refusal = 'spent';
    const decisions = createRunDecisions(run.options);

    expect(await decisions.atStop({ kind: 'suite-red' })).toBe(true);
    expect(run.calls[0]?.prompt).toContain('The runner\'s task step found failures');
    expect(events[0]).toEqual(['decision', { strategy: 'jump', line: 3, reason: 'x' }]);
  });

  it('decides nothing once the run is interrupted', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "x"')]);
    run.interrupted = true;

    expect(await createRunDecisions(run.options).atStop(heldReport(run.trackerPath))).toBe(false);
    expect(run.calls).toHaveLength(0);
  });
});

describe('what each decision does', () => {
  it('jump: passes the line over, saves the list and emits the decision', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "A person writes the env file."')]);
    const decisions = createRunDecisions(run.options);

    await decisions.atStop(heldReport(run.trackerPath));

    expect([...decisions.skipLines(readFileSync(run.trackerPath, 'utf8'))]).toEqual([2]);
    expect(findNextTask(TRACKER, { skipLines: decisions.skipLines(TRACKER) })?.lineNum).toBe(3);
    expect(run.saved.at(-1)?.map((entry) => [entry.task.task, entry.strategy])).toEqual([['Check the env file a person writes', 'jump']]);
    expect(events).toEqual([['decision', { strategy: 'jump', line: 3, reason: 'A person writes the env file.' }]]);
  });

  it('defer: passes the line over until the task at after is done, then releases it', async () => {
    const run = plant([decisionOutput('strategy: defer', 'reason: "Line 5 writes what it needs."', 'after: 5')]);
    const decisions = createRunDecisions(run.options);

    await decisions.atStop(heldReport(run.trackerPath));
    expect(decisions.skipLines(TRACKER).has(2)).toBe(true);

    decisions.taskDone(taskAt(run.trackerPath, 4));
    const ticked = TRACKER.replace('- [ ] Write the helper', '- [x] Write the helper');
    expect(decisions.skipLines(ticked).has(2)).toBe(false);
    expect(run.saved.at(-1)).toEqual([]);
  });

  it('stop: emits the decision, then the stop\'s own event, and ends the run with exit code 20', async () => {
    const run = plant([decisionOutput('strategy: stop', 'reason: "The task text is wrong."')]);
    const decisions = createRunDecisions(run.options);

    const end = await endOf(() => decisions.atStop(heldReport(run.trackerPath)));

    expect(end.exitCode).toBe(DECISION_STOP_EXIT);
    expect(end.message).toContain('The task text is wrong.');
    expect(events.map(([name]) => name)).toEqual(['decision', 'task-blocked']);
  });

  it('retry: writes the approach as the line\'s blocker and spends one retry', async () => {
    const run = plant([decisionOutput('strategy: retry', 'reason: "A foreground run works."', 'approach: "Run the suite in the foreground."')]);
    const decisions = createRunDecisions(run.options);

    expect(await decisions.atStop(heldReport(run.trackerPath))).toBe(true);
    expect(run.retried).toEqual(['the decision chose retry']);
    expect(findNextTask(readFileSync(run.trackerPath, 'utf8'))?.blocker).toBe('Run the suite in the foreground.');
  });

  it('retry with no retry left: read as stop, the tracker left as the stop left it', async () => {
    const run = plant([decisionOutput('strategy: retry', 'reason: "A foreground run works."', 'approach: "Run it in the foreground."')]);
    run.left = 0;
    const decisions = createRunDecisions(run.options);

    const end = await endOf(() => decisions.atStop(heldReport(run.trackerPath)));

    expect(end.exitCode).toBe(DECISION_STOP_EXIT);
    expect(events[0]?.[1]).toMatchObject({ strategy: 'stop', reason: expect.stringContaining('no retry left') as unknown });
    expect(readFileSync(run.trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('reads a session that exited nonzero, and output with no block, as stop', async () => {
    const failed = plant([decisionOutput('strategy: jump', 'reason: "x"')], 3);
    expect((await endOf(() => createRunDecisions(failed.options).atStop(heldReport(failed.trackerPath)))).message)
      .toContain('the decision session exited 3');

    events = [];
    const silent = plant(['I could not decide.']);
    await endOf(() => createRunDecisions(silent.options).atStop(heldReport(silent.trackerPath)));
    expect(events[0]?.[1]).toMatchObject({ strategy: 'stop', reason: expect.stringContaining(UNREADABLE_PREFIX) as unknown });
  });

  it('halts as before, deciding nothing, when SIGINT ends the decision session', async () => {
    const run = plant([decisionOutput('strategy: jump', 'reason: "x"')]);
    const decisions = createRunDecisions({
      ...run.options,
      spawn: () => {
        run.interrupted = true;
        return Promise.resolve({ exitCode: 130, stdout: '' });
      },
    });

    expect(await decisions.atStop(heldReport(run.trackerPath))).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('the two bounds', () => {
  it('passes a task deferred once already over as a jump, saying so', async () => {
    const defer = decisionOutput('strategy: defer', 'reason: "Line 5 first."', 'after: 5');
    const run = plant([defer, defer]);
    const decisions = createRunDecisions(run.options);

    await decisions.atStop(heldReport(run.trackerPath));
    await decisions.atStop(heldReport(run.trackerPath));

    expect(events.map(([, data]) => (data as { strategy: string }).strategy)).toEqual(['defer', 'jump']);
    expect(events[1]?.[1]).toMatchObject({ reason: expect.stringContaining('deferred once already in this run') as unknown });
  });

  it('stops a task passed over once already that reaches a decision again', async () => {
    const jump = decisionOutput('strategy: jump', 'reason: "x"');
    const run = plant([jump, jump]);
    const decisions = createRunDecisions(run.options);

    await decisions.atStop(heldReport(run.trackerPath));
    const end = await endOf(() => decisions.atStop(heldReport(run.trackerPath)));

    expect(end.exitCode).toBe(DECISION_STOP_EXIT);
    expect(end.message).toContain('passed over once already in this run');
  });
});

describe('the seed and the end of the plan', () => {
  const seed: PassOverList = [{ task: { lineNum: 2, task: 'Check the env file a person writes' }, strategy: 'jump', reason: 'A person writes it.' }];

  it('opens with the seed, saving it on the record and skipping its line', () => {
    const run = plant([], 0, seed);
    const decisions = createRunDecisions(run.options);

    expect(run.saved).toEqual([seed]);
    expect(decisions.skipLines(TRACKER).has(2)).toBe(true);
  });

  it('ends a run left with only passed-over tasks with exit code 22, the passed-over event and a halt', async () => {
    const run = plant([], 0, seed);
    const decisions = createRunDecisions(run.options);
    const done = TRACKER.replace(/- \[ \] /g, '- [x] ');

    const end = await endOf(() => Promise.resolve(decisions.atPlanEnd(done)));

    expect(end.exitCode).toBe(PASSED_OVER_EXIT);
    expect(events).toEqual([
      ['passed-over', { tasks: [{ line: 3, text: 'Check the env file a person writes', strategy: 'jump', reason: 'A person writes it.' }] }],
      ['halt', { reason: 'passed over 1 task(s)' }],
    ]);
    expect(lines.join('\n')).toContain('line 3 (jump): Check the env file a person writes');
  });

  it('lets a plan whose passed-over tasks are all done end as it always did', () => {
    const run = plant([], 0, seed);

    expect(() => createRunDecisions(run.options).atPlanEnd(TRACKER.replace(/- \[(?: |BLOCKED)\] /g, '- [x] '))).not.toThrow();
    expect(events).toEqual([]);
  });
});
