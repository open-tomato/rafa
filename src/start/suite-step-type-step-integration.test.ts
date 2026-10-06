/**
 * `runTaskStep` (`./suite-step.ts`) driven over a real scratch git
 * repository, proving the type step (`./type-step.ts`) end to end through
 * the runner's own task step: real git for the diff and the base
 * worktree, the real `tsc` of this repository (the scratch's
 * `node_modules` is a symlink to this repository's, as the module note of
 * `./type-step.ts` describes for its base worktree), and a real `bun test`
 * for the step's test run. Nothing is stubbed but the run record's append,
 * which a case reads back.
 *
 * The scratch repository holds a strict `tsconfig.json` that, like this
 * repository's, excludes every `*.test.ts` file, so `check-types` never
 * reads one; only the type step does. It holds no `eslint.config` file,
 * so the lint step runs nothing. The seed commit is the task's base; the
 * task's own commit is made on top of it.
 *
 *   1. A task commit adding a type error to a test file is red: the
 *      step's blocker names the error (`TS2322`, the file and its line),
 *      and a repair task is inserted, blocked on it. The test run itself
 *      is green, since `bun test` strips types.
 *   2. A task commit editing a test file that already held a type error
 *      at the base is green: the error moved lines and is the same error,
 *      so it is not new, and no blocker is written.
 *   3. The same edit also adding a second, different error is red, and
 *      the blocker names the new error alone, never the inherited one:
 *      the comparison is the base's errors against HEAD's, not "the file
 *      holds an error".
 *   4. Run from a worktree nested under the planted checkout (as a loop's
 *      `.rafa/worktrees/<stub>`), which holds no `node_modules` of its own,
 *      the step still runs, and reads a new error as red.
 */
import type { SuiteStepContext } from './suite-step.js';
import type { SessionStep } from '../loop/sessions.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { realNodeModules } from '../tests/real-node-modules.js';

import { runTaskStep } from './suite-step.js';

/** This file's own test timeout: two `tsc` runs, a worktree and a real `bun test` per case. */
const CASE_TIMEOUT_MS = 120_000;

/** The task the step runs after. */
const TASK = 'Add the greeting test';

/** The test file every case edits. */
const TEST_FILE = 'greeting.test.ts';

/** The scratch repository's `tsconfig.json`: this repository's strict core, `*.test.ts` excluded as in `tsconfig.json`. */
const TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    moduleDetection: 'force',
    isolatedModules: true,
    esModuleInterop: true,
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['*.ts'],
  exclude: ['node_modules', '**/*.test.ts'],
}, null, 2)}\n`;

/** A tracker holding the one task, which a red step writes its repair task beside. */
const TRACKER = `# Plan: type-step\n\n# Stage: One\n\n- [x] ${TASK}\n`;

/** A test file with no type error. */
const CLEAN = [
  'import { expect, it } from \'bun:test\';',
  '',
  'it(\'greets\', () => {',
  '  expect(1).toBe(1);',
  '});',
  '',
].join('\n');

/** The error the base holds in {@link INHERITED}, and the line the message names. */
const INHERITED_ERROR = 'Type \'string\' is not assignable to type \'number\'.';

/** A test file already holding one type error (`TS2322`), its tests green. */
const INHERITED = [
  'import { expect, it } from \'bun:test\';',
  '',
  'const count: number = \'three\';',
  '',
  'it(\'greets\', () => {',
  '  expect(count).toBe(\'three\' as never);',
  '});',
  '',
].join('\n');

/** {@link INHERITED} with a test added above the error, which moves it down two lines. */
const INHERITED_MOVED = INHERITED.replace('const count', [
  'it(\'greets twice\', () => {',
  '  expect(2).toBe(2);',
  '});',
  '',
  'const count',
].join('\n'));

/** {@link INHERITED_MOVED} with a second, different error: a missing property of a number. */
const INHERITED_PLUS_NEW = `${INHERITED_MOVED}const missing: boolean = 42;\n`;

/** {@link CLEAN} with one error added. */
const CLEAN_PLUS_ERROR = `${CLEAN}const added: number = 'not a number';\n`;

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-type-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A scratch repository, and what a case reads of it. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly trackerPath: string;
  readonly base: string;
}

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing, answering its stdout. */
function git(cwd: string, home: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

/**
 * A scratch repository whose seed commit holds `seed` as {@link TEST_FILE}
 * beside the `tsconfig.json`, its `node_modules` linked to this
 * repository's; its seed commit is the returned `base`.
 */
function plant(seed: string): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n', 'utf8');
  writeFileSync(join(repo, 'tsconfig.json'), TSCONFIG, 'utf8');
  writeFileSync(join(repo, TEST_FILE), seed, 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  symlinkSync(realNodeModules(), join(repo, 'node_modules'));

  const trackerPath = join(root, 'PLAN_TRACKER-type-step.md');
  writeFileSync(trackerPath, TRACKER, 'utf8');
  return { repo, home, trackerPath, base: git(repo, home, 'rev-parse', 'HEAD') };
}

/** Commits `content` as {@link TEST_FILE} in `scratch` as the task's commit. */
function commitTask(scratch: Scratch, content: string): void {
  writeFileSync(join(scratch.repo, TEST_FILE), content, 'utf8');
  git(scratch.repo, scratch.home, 'add', '-A');
  git(scratch.repo, scratch.home, 'commit', '-q', '--no-verify', '-m', TASK);
}

let lines: string[];
let steps: SessionStep[];

beforeEach(() => {
  lines = [];
  steps = [];
  setActiveOutput(sinkOutput({
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message),
    error: (message) => lines.push(message),
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

/** Runs the task step over `scratch`, its checkout the scratch repository, everything but the record's append real. */
function runStep(scratch: Scratch): ReturnType<typeof runTaskStep> {
  const context: SuiteStepContext = {
    repoRoot: scratch.repo,
    checkout: scratch.repo,
    trackerPath: scratch.trackerPath,
    sessionId: 'type-step-integration',
    settings: {
      testsFullSuiteTriggers: ['bunfig.toml', 'tsconfig*.json', 'package.json'],
      testsIntegration: ['**/*-integration.test.ts'],
      testsAlwaysRun: [],
    },
    owns: () => Promise.resolve(null),
    seams: { appendStep: (step) => steps.push(step) },
  };
  return runTaskStep(context, { baseline: null, base: scratch.base, declared: 'affected', task: TASK });
}

describe('runTaskStep over a real scratch repository, its type step real', () => {
  it('is red, with the error in the blocker, when the task commit adds a type error to a test file', async () => {
    const scratch = plant(CLEAN);
    commitTask(scratch, CLEAN_PLUS_ERROR);

    const outcome = await runStep(scratch);

    expect(outcome.red).toBe(true);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.blocker).toContain(`${TEST_FILE}:6:7 TS2322 ${INHERITED_ERROR}`);
    expect(outcome.blocker).toContain('type step after');
    // The tests themselves are green: bun strips types, so only the type step is red.
    expect(outcome.step?.newFailures).toEqual([]);
    expect(steps).toHaveLength(1);
    expect(outcome.repairInserted).toBe(true);
    expect(readFileSync(scratch.trackerPath, 'utf8')).toContain(`${TEST_FILE}:6:7 TS2322`);
  }, CASE_TIMEOUT_MS);

  it('is green when the task commit edits a test file that already held a type error at the base', async () => {
    const scratch = plant(INHERITED);
    commitTask(scratch, INHERITED_MOVED);

    const outcome = await runStep(scratch);

    expect(outcome.red).toBe(false);
    expect(outcome.blocker).toBeNull();
    expect(outcome.repairInserted).toBe(false);
    expect(readFileSync(scratch.trackerPath, 'utf8')).toBe(TRACKER);
    // The inherited error was seen, and read as not new: not a step that ran nothing.
    expect(lines.some((line) => line.includes('1 error(s), 1 already held at'))).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('is red on the new error alone when the same edit also adds a second, different error', async () => {
    const scratch = plant(INHERITED);
    commitTask(scratch, INHERITED_PLUS_NEW);

    const outcome = await runStep(scratch);

    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain('TS2322 Type \'number\' is not assignable to type \'boolean\'.');
    expect(outcome.blocker).not.toContain(INHERITED_ERROR);
  }, CASE_TIMEOUT_MS);

  it('runs from a worktree nested under a checkout holding node_modules, and reads a new error as red', async () => {
    const scratch = plant(CLEAN);
    const worktree = join(scratch.repo, '.rafa', 'worktrees', 'stub');
    git(scratch.repo, scratch.home, 'worktree', 'add', '-q', '-b', 'task', worktree, scratch.base);
    expect(existsSync(join(worktree, 'node_modules'))).toBe(false);
    const nested: Scratch = { ...scratch, repo: worktree };
    commitTask(nested, CLEAN_PLUS_ERROR);

    const outcome = await runStep(nested);

    // The step ran (found the checkout's tsc through the walk) rather than running nothing.
    expect(lines.some((line) => line.includes('could not run tsc'))).toBe(false);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`${TEST_FILE}:6:7 TS2322 ${INHERITED_ERROR}`);
    expect(outcome.blocker).toContain('type step after');
  }, CASE_TIMEOUT_MS);
});
