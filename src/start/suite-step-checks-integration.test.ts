/**
 * The task, stage and pre-wrap-up steps reading the three check-point
 * entries (`checks.task`, `checks.stage`, `checks.loop`), over a scratch
 * git repository and the config a project's own `.rafa/config.yaml`
 * resolves to, with `runSuite` the one recorded seam.
 *
 * Git, the test-file walk, `bunfig.toml`'s preload read, the tracker, the
 * baseline file and `loadConfig` are all real; only what would spawn
 * `bun test`, ESLint and tsc is handed in, so no case here runs a suite.
 * The plan has one stage with one task. Its stage step is taken by
 * `runStageStep` directly: `dueStages` (`./suite-stage-ledger.ts`) answers
 * a stage only while a task is left open, and in a one-stage plan the
 * pre-wrap-up step stands in for the stage's own. The plan's header names
 * an issue and the stand-in `gh` answers its epic, whose `Owns:` line
 * names `alpha` and `beta`; the task's commit touches `alpha` alone.
 *
 * Three projects, each driven through the baseline and the three steps:
 *
 *   1. No `templates` and no `checks` key: every entry is empty, so the
 *      baseline is not taken, and each step spawns nothing, is recorded
 *      at scope `none` with reason `no-check` and prints that no check is
 *      configured, never that anything passed.
 *   2. `templates: [escalation]`: the task's diff touches `bunfig.toml`,
 *      a `tests.fullSuiteTriggers` file, so `checks.task: [affected]`
 *      runs the full suite with reason `trigger`; `checks.stage:
 *      [related, integration]` runs the `Owns:` folders' files the diff
 *      touched with the integration files; `checks.loop: [full]` runs the
 *      full suite.
 *   3. The same template with `checks.stage: [related]` in the file: the
 *      stage step runs the `Owns:` folders' files alone.
 */
import type { StepOutcome, SuiteStepContext } from './suite-step.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { SuiteResult, SuiteRunOptions } from '../suite/run.js';
import type { SessionStep } from '@open-tomato/rafa/core/loop';

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '@open-tomato/rafa/core/config/load';
import { setActiveOutput } from '@open-tomato/rafa/core/output';

import { plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { ensureBaseline, planOwnsReader, runPreWrapUpStep, runStageStep, runTaskStep } from './suite-step.js';

/** The plan's one stage. */
const STAGE_NAME = 'One';

/** The plan's one task. */
const TASK = 'Touch the alpha module and bunfig.toml';

/** The spec issue the plan's header names. */
const SPEC_ISSUE = 9;

/** The epic the spec issue's label names. */
const EPIC_SLUG = 'widgets';

/** The plan: a header naming {@link SPEC_ISSUE}, one stage, one task. */
const PLAN = [
  '# Plan: checks',
  '',
  '```rafa:plan',
  `issue: ${String(SPEC_ISSUE)}`,
  '```',
  '',
  `# Stage: ${STAGE_NAME}`,
  '',
  `- [x] ${TASK}`,
  '',
].join('\n');

/** The tracker's path under the scratch repository; a `PLAN_TRACKER-<stub>.md` name. */
const TRACKER_RELATIVE = '.rafa/plans/PLAN_TRACKER-checks.md';

/** The spec issue, as `gh issue view --json` writes it. */
const SPEC_VIEW_JSON = JSON.stringify({
  number: SPEC_ISSUE,
  title: 'the spec',
  body: 'spec body',
  state: 'OPEN',
  labels: [{ name: 'type:spec' }, { name: `epic:${EPIC_SLUG}` }],
  author: { login: 'someone' },
});

/** The epic, as `gh issue list --json` writes it: its `Owns:` line names `alpha` and `beta`. */
const EPIC_LIST_JSON = JSON.stringify([{
  number: 50,
  title: 'Widgets epic',
  body: 'Owns: alpha, beta\n\n## Acceptance criteria\n\n- green',
  state: 'OPEN',
  stateReason: '',
  labels: [{ name: 'type:epic' }, { name: `epic:${EPIC_SLUG}` }],
}]);

/** The stand-in `gh`: the two commands `readPlanOwns` sends, and a failure for any other. */
const gh: GhRunner = (args) => {
  const command = `${args[0] ?? ''} ${args[1] ?? ''}`;
  if (command === 'issue view') return Promise.resolve({ ok: true, stdout: SPEC_VIEW_JSON, stderr: '' });
  if (command === 'issue list') return Promise.resolve({ ok: true, stdout: EPIC_LIST_JSON, stderr: '' });
  return Promise.resolve({ ok: false, stdout: '', stderr: `unplanned gh call: ${args.join(' ')}` });
};

/** What the repository holds at its seed commit: an `Owns:` folder each, an integration file outside both, and a `bunfig.toml`. */
const SEED_FILES: Readonly<Record<string, string>> = {
  'alpha/mod.ts': 'export const alpha = 1;\n',
  'alpha/mod.test.ts': 'export {};\n',
  'beta/mod.ts': 'export const beta = 1;\n',
  'beta/mod.test.ts': 'export {};\n',
  'shared/flow-integration.test.ts': 'export {};\n',
  'bunfig.toml': '[test]\n',
  '.gitignore': '.rafa/\n',
};

/** The test files the stage step may run, each named by one of the cases. */
const ALPHA_TEST_FILE = 'alpha/mod.test.ts';
const INTEGRATION_TEST_FILE = 'shared/flow-integration.test.ts';

/** The line a `none` step prints, for `step` of `entry`. */
function noCheckLine(step: string, entry: string): string {
  return `🧪 ${step}: no check configured (${entry} is empty); nothing ran.`;
}

/** The line `ensureBaseline` prints when no entry names a check. */
const NO_BASELINE_LINE = '📏 No check-point entry names a check; no suite baseline is taken.';

/** What one project's baseline and three steps left behind. */
interface Taken {
  /** The options `runSuite` was handed, in order. */
  readonly runs: readonly SuiteRunOptions[];
  /** The steps recorded, in order. */
  readonly steps: readonly SessionStep[];
  /** Every line printed. */
  readonly lines: readonly string[];
  readonly task: StepOutcome;
  readonly stage: StepOutcome;
  readonly preWrapUp: StepOutcome;
  /** True when the baseline was taken. */
  readonly baselined: boolean;
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-checks-')));
let planted = 0;
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` under `home`'s isolated identity, answering its output. */
function git(cwd: string, home: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

/** A green suite result for the options `runSuite` was handed, its command naming the narrowing. */
function greenResult(options: SuiteRunOptions): SuiteResult {
  return {
    command: ['bun', 'test', ...(options.paths ?? []), ...(options.changedSince === undefined
      ? []
      : [`--changed=${options.changedSince}`])],
    exitCode: 0,
    summary: 'Ran 1 tests across 1 files. [1.00ms]',
    failures: [],
    errors: 0,
    junit: 'read',
    unhandled: [],
    outputTail: [],
  };
}

/**
 * Plants a scratch repository holding `config` as its `.rafa/config.yaml`,
 * the baseline and the first commit's tracker, then takes the baseline
 * and the task, stage and pre-wrap-up steps over a task commit that
 * touches `alpha/mod.ts` and `bunfig.toml`.
 */
async function takeSteps(config: string): Promise<Taken> {
  planted += 1;
  const root = join(tempRoot, `run-${String(planted)}`);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  for (const dir of [repo, home, join(repo, '.rafa', 'plans')]) mkdirSync(dir, { recursive: true });

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  for (const [file, text] of Object.entries(SEED_FILES)) {
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), text, 'utf8');
  }
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  const seed = git(repo, home, 'rev-parse', 'HEAD');

  const trackerPath = join(repo, TRACKER_RELATIVE);
  writeFileSync(trackerPath, PLAN, 'utf8');
  plantProjectConfig(repo, config);
  const settings = (await loadConfig({ root: repo, home }, {}, () => {})).config;

  const runs: SuiteRunOptions[] = [];
  const steps: SessionStep[] = [];
  const lines: string[] = [];
  const context: SuiteStepContext = {
    repoRoot: repo,
    checkout: repo,
    trackerPath,
    sessionId: 'session-1',
    settings,
    owns: planOwnsReader({ planContent: PLAN, gh }),
    seams: {
      runSuite: (options) => {
        runs.push(options);
        return Promise.resolve(greenResult(options));
      },
      appendStep: (step) => steps.push(step),
      runLint: () => Promise.resolve({ exitCode: 0, stdout: '[]', stderr: '' }),
      runTypes: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    },
  };

  setActiveOutput(sinkOutput({
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message),
    error: (message) => lines.push(message),
  }));
  try {
    const { baseline } = await ensureBaseline(context);
    appendFileSync(join(repo, 'alpha/mod.ts'), '// touched by the task\n');
    appendFileSync(join(repo, 'bunfig.toml'), '# touched by the task\n');
    git(repo, home, 'add', '-A');
    git(repo, home, 'commit', '-q', '--no-verify', '-m', 'task');

    const task = await runTaskStep(context, { baseline, base: seed, declared: null, task: TASK });
    const stage = await runStageStep(context, { stage: 0, name: STAGE_NAME }, baseline);
    const preWrapUp = await runPreWrapUpStep(context, baseline);
    return { runs, steps, lines, task, stage, preWrapUp, baselined: baseline !== null };
  } finally {
    setActiveOutput(null);
  }
}

/** The recorded step of `kind`, or a failure naming what was recorded. */
function stepOf(taken: Taken, kind: SessionStep['kind']): SessionStep {
  const step = taken.steps.find((candidate) => candidate.kind === kind);
  if (step === undefined) throw new Error(`no ${kind} step was recorded; the record holds ${taken.steps.map((s) => s.kind).join(', ')}`);
  return step;
}

describe('a project with no templates and no checks key', () => {
  let taken: Taken;
  beforeAll(async () => {
    taken = await takeSteps('pr:\n  provider: none\n');
  });

  it('takes no baseline and runs no suite in any step', () => {
    expect(taken.baselined).toBe(false);
    expect(taken.runs).toEqual([]);
  });

  it('records each of the task, stage and pre-wrap-up steps at scope none with reason no-check', () => {
    expect(taken.steps).toEqual([
      { kind: 'task', scope: 'none', reason: 'no-check', command: [], exitCode: 0, summary: null, failures: [], newFailures: [] },
      { kind: 'stage', scope: 'none', reason: 'no-check', command: [], exitCode: 0, summary: null, failures: [], newFailures: [] },
      { kind: 'pre-wrap-up', scope: 'none', reason: 'no-check', command: [], exitCode: 0, summary: null, failures: [], newFailures: [] },
    ]);
  });

  it('answers each step green and blocks nothing', () => {
    for (const outcome of [taken.task, taken.stage, taken.preWrapUp]) {
      expect(outcome).toMatchObject({ red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false });
    }
  });

  it('prints that no check is configured for each step and the baseline, and nothing says passed', () => {
    expect(taken.lines).toContain(NO_BASELINE_LINE);
    expect(taken.lines).toContain(noCheckLine('task step', 'checks.task'));
    expect(taken.lines).toContain(noCheckLine(`stage step for "${STAGE_NAME}"`, 'checks.stage'));
    expect(taken.lines).toContain(noCheckLine('pre-wrap-up step', 'checks.loop'));
    expect(taken.lines.some((line) => line.includes('passed'))).toBe(false);
  });
});

describe('a project adopting templates: [escalation]', () => {
  let taken: Taken;
  beforeAll(async () => {
    taken = await takeSteps('templates: [escalation]\npr:\n  provider: none\n');
  });

  it('takes the baseline, then records the four steps in order', () => {
    expect(taken.baselined).toBe(true);
    expect(taken.steps.map((step) => step.kind)).toEqual(['baseline', 'task', 'stage', 'pre-wrap-up']);
    expect(taken.lines).not.toContain(NO_BASELINE_LINE);
  });

  it('runs the full suite with reason trigger for a task diff touching bunfig.toml', () => {
    expect(stepOf(taken, 'task')).toMatchObject({ scope: 'full', reason: 'trigger', command: ['bun', 'test'] });
    // The baseline, the task step and the pre-wrap-up step each run path-less.
    expect(taken.runs.filter((run) => run.paths === undefined && run.changedSince === undefined)).toHaveLength(3);
  });

  it('runs the Owns: folders\' files the stage diff touched with the integration files, and not the other folder\'s', () => {
    const stage = stepOf(taken, 'stage');
    const paths = [ALPHA_TEST_FILE, INTEGRATION_TEST_FILE];
    expect(stage).toMatchObject({ scope: paths, reason: 'stage', command: ['bun', 'test', ...paths] });
    expect(taken.runs.filter((run) => run.paths !== undefined).map((run) => run.paths)).toEqual([paths]);
  });

  it('runs the full suite for the pre-wrap-up step under checks.loop [full]', () => {
    expect(stepOf(taken, 'pre-wrap-up')).toMatchObject({ scope: 'full', reason: 'declared' });
  });

  it('is green throughout and prints no no-check line', () => {
    for (const outcome of [taken.task, taken.stage, taken.preWrapUp]) expect(outcome.red).toBe(false);
    expect(taken.lines.some((line) => line.includes('no check configured'))).toBe(false);
  });
});

describe('a project adopting the template with checks.stage: [related]', () => {
  let taken: Taken;
  beforeAll(async () => {
    taken = await takeSteps('templates: [escalation]\nchecks:\n  stage: [related]\npr:\n  provider: none\n');
  });

  it('runs the Owns: folders\' files the stage diff touched alone, without the integration files', () => {
    const stage = stepOf(taken, 'stage');
    expect(stage).toMatchObject({ scope: [ALPHA_TEST_FILE], reason: 'stage', command: ['bun', 'test', ALPHA_TEST_FILE] });
    expect(taken.runs.filter((run) => run.paths !== undefined).map((run) => run.paths)).toEqual([[ALPHA_TEST_FILE]]);
  });

  it('leaves the task and pre-wrap-up steps as the template sets them', () => {
    expect(stepOf(taken, 'task')).toMatchObject({ scope: 'full', reason: 'trigger' });
    expect(stepOf(taken, 'pre-wrap-up')).toMatchObject({ scope: 'full', reason: 'declared' });
  });
});
