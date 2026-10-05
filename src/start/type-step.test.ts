/**
 * The task step's type check (`start/type-step.ts`), driven over a
 * planted git repository: a `tsconfig.json` that excludes its test
 * files, as this repository's does, a `node_modules` symlinked to this
 * repository's so the real tsc and `@types/bun` resolve, a base commit
 * and a task commit on top.
 *
 * The comparison cases run the real tsc through the real git runner, so
 * the base worktree is made and removed for real. The cases that run
 * nothing, and the readers, use a scripted git and a scripted runner.
 * Every claim that the step stayed green or ran nothing is paired with a
 * case where the same input, changed in one thing, goes red or runs.
 */
import type { TypeDiagnostic, TypeRunOptions, TypeRunResult, TypeStepInput } from './type-step.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createGitRunner } from '../pr/index.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  newErrors,
  parseTscOutput,
  readTypeFiles,
  runTsc,
  runTypeStep,
  scratchTsconfig,
  TSC_FLAGS,
} from './type-step.js';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const STOP = 130;

/** Two real tsc runs and a worktree take about 1.5 s here; the default 5 s leaves a loaded machine little room. */
const TSC_TIMEOUT = 30_000;

/** The planted repository's config: strict, ES2022, its test files excluded. */
const TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  exclude: ['node_modules', '**/*.test.ts'],
}, null, 2)}\n`;

/** A clean test file that imports `bun:test` and spreads a `Set`, which only an ES2015+ target allows. */
const CLEAN = [
  'import { expect, it } from \'bun:test\';',
  '',
  'it(\'spreads a set\', () => {',
  '  expect([...new Set([\'a\'])]).toEqual([\'a\']);',
  '});',
];

/** A line tsc answers with `TS2322: Type 'string' is not assignable to type 'number'.` */
const ERROR_LINE = 'export const count: number = \'one\';';

/** A second line with the same code and message as {@link ERROR_LINE}. */
const SAME_ERROR_LINE = 'export const other: number = \'two\';';

const TS2322 = 'TS2322 Type \'string\' is not assignable to type \'number\'.';

let repo: string;
let lines: { level: string; message: string }[];

/** Runs git in the planted repository under a fixed identity and no operator config; answers stdout. */
function git(...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Writes each file under the repository and commits them all; answers the commit. */
function commit(files: Readonly<Record<string, readonly string[]>>, message: string): string {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), `${body.join('\n')}\n`, 'utf8');
  }
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', message);
  return git('rev-parse', 'HEAD');
}

/** The lines of one level. */
function linesAt(level: string): readonly string[] {
  return lines.filter((line) => line.level === level).map((line) => line.message);
}

/** The step's input over the planted repository from `base`, through the real git and tsc. */
function realInput(base: string, overrides: Partial<TypeStepInput> = {}): TypeStepInput {
  return { checkout: repo, base, task: 'second task', git: createGitRunner(repo), stopCode: STOP, ...overrides };
}

/** A runner answering `result` and recording what it was asked to spawn. */
function runnerAnswering(result: TypeRunResult, seen: TypeRunOptions[] = []): (options: TypeRunOptions) => Promise<TypeRunResult> {
  return (options) => {
    seen.push(options);
    return Promise.resolve(result);
  };
}

/** A git whose `--name-status` diff from `base` is `entries`, recording each call. */
function gitWith(base: string, entries: readonly (readonly string[])[], calls: string[] = []): GitRunner {
  return (args) => {
    const key = args.join(' ');
    calls.push(key);
    const answer: GitResult = key === `diff --name-status -z --find-renames --diff-filter=d ${base} HEAD`
      ? { ok: true, stdout: entries.map((entry) => `${entry.join('\0')}\0`).join(''), stderr: '' }
      : { ok: false, stdout: '', stderr: 'fatal: bad revision' };
    return answer;
  };
}

/** The step's input over a scripted git naming `entries` and a scripted runner answering `result`. */
function scriptedInput(entries: readonly (readonly string[])[], result: TypeRunResult, seen: TypeRunOptions[] = [], overrides: Partial<TypeStepInput> = {}): TypeStepInput {
  return { checkout: repo, base: 'base0000', task: 'second task', git: gitWith('base0000', entries), runTypes: runnerAnswering(result, seen), stopCode: STOP, ...overrides };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'type-step-'));
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'tsconfig.json'), TSCONFIG, 'utf8');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n', 'utf8');
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(repo, 'node_modules'));
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => lines.push({ level: 'info', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
  }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(repo, { recursive: true, force: true });
});

describe('runTypeStep over a planted repository', () => {
  it('is red on an error the task added, its blocker naming the file, place and message', async () => {
    const base = commit({ 'a.test.ts': CLEAN }, 'base');
    commit({ 'a.test.ts': [...CLEAN, ERROR_LINE] }, 'task');
    const outcome = await runTypeStep(realInput(base));
    expect(outcome).toMatchObject({ ran: true, red: true, interrupted: false });
    expect(outcome.blocker).toContain(`The runner's type step after "second task" found type errors in the task's test files that ${base} did not hold.`);
    expect(outcome.blocker).toContain(`New errors: a.test.ts:6:14 ${TS2322}.`);
    expect(linesAt('info')).toContain(`   a.test.ts:6:14 ${TS2322}`);
  }, TSC_TIMEOUT);

  it('is green on an error the file held at the base, and red once a second error with the same message joins it', async () => {
    const base = commit({ 'a.test.ts': [...CLEAN, ERROR_LINE] }, 'base');
    commit({ 'a.test.ts': [...CLEAN, ERROR_LINE, '// edited by the task'] }, 'task');
    const held = await runTypeStep(realInput(base));
    expect(held).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
    expect(linesAt('info')).toContain(`🔎 type step after "second task": tsc over 1 test file(s): 1 error(s), 0 not held at ${base}.`);

    // Control: a second error with the same code and message is one more than the base held.
    commit({ 'a.test.ts': [...CLEAN, ERROR_LINE, SAME_ERROR_LINE] }, 'task again');
    const added = await runTypeStep(realInput(base));
    expect(added.red).toBe(true);
    expect(added.blocker).toContain(`New errors: a.test.ts:7:14 ${TS2322}.`);
    expect(added.blocker).not.toContain('a.test.ts:6:');
  }, TSC_TIMEOUT);

  it('is green on the base\'s error moved down by lines the task added above it', async () => {
    const base = commit({ 'a.test.ts': [...CLEAN, ERROR_LINE] }, 'base');
    commit({ 'a.test.ts': ['// one', '// two', ...CLEAN, ERROR_LINE] }, 'task');
    const outcome = await runTypeStep(realInput(base));
    expect(outcome).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
    expect(linesAt('info')).toContain(`🔎 type step after "second task": tsc over 1 test file(s): 1 error(s), 0 not held at ${base}.`);
  }, TSC_TIMEOUT);

  it('reads every error of a file new since the base as new, even one another file held at the base', async () => {
    const base = commit({ 'a.test.ts': [...CLEAN, ERROR_LINE] }, 'base');
    commit({ 'b.test.ts': [...CLEAN, ERROR_LINE, SAME_ERROR_LINE] }, 'task');
    const outcome = await runTypeStep(realInput(base));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`New errors: b.test.ts:6:14 ${TS2322}; b.test.ts:7:14 ${TS2322}.`);
    expect(outcome.blocker).not.toContain('a.test.ts');
  }, TSC_TIMEOUT);

  it('checks a renamed file against its old path at the base, and removes the base worktree after', async () => {
    const base = commit({ 'a.test.ts': [...CLEAN, ERROR_LINE] }, 'base');
    git('mv', 'a.test.ts', 'renamed.test.ts');
    commit({}, 'task');
    const outcome = await runTypeStep(realInput(base));
    expect(outcome).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
    const worktrees = git('worktree', 'list', '--porcelain').split('\n')
      .filter((line) => line.startsWith('worktree '));
    expect(worktrees).toHaveLength(1);
  }, TSC_TIMEOUT);

  it('reads a clean file clean, with none of the TS2802 or bun:test errors a wrong scratch tsconfig gives', async () => {
    const base = commit({ 'README.md': ['# planted'] }, 'base');
    commit({ 'a.test.ts': CLEAN }, 'task');
    const outcome = await runTypeStep(realInput(base));
    expect(outcome).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
    expect(linesAt('info')).toEqual(['🔎 type step after "second task": tsc over 1 test file(s): no type error.']);

    // Controls: the same file through the two wrong configs of the module note.
    const scratch = mkdtempSync(join(tmpdir(), 'type-step-scratch-'));
    try {
      const tsc = join(repo, 'node_modules', '.bin', 'tsc');
      const right = JSON.parse(scratchTsconfig(repo, ['a.test.ts'])) as Record<string, unknown>;
      writeFileSync(join(scratch, 'bare.json'), JSON.stringify({ ...right, extends: 'tsconfig.json' }), 'utf8');
      writeFileSync(join(scratch, 'no-roots.json'), JSON.stringify({ ...right, compilerOptions: {} }), 'utf8');
      const bare = await runTsc({ cwd: repo, argv: [tsc, '-p', join(scratch, 'bare.json'), ...TSC_FLAGS] });
      expect(bare.stdout).toContain('a.test.ts(4,14): error TS2802:');
      const noRoots = await runTsc({ cwd: repo, argv: [tsc, '-p', join(scratch, 'no-roots.json'), ...TSC_FLAGS] });
      expect(noRoots.stdout).toContain('error TS2307: Cannot find module \'bun:test\'');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, TSC_TIMEOUT);

  it('runs nothing on a diff with no test file, and runs once the diff holds one', async () => {
    const base = commit({ 'a.test.ts': CLEAN }, 'base');
    commit({ 'src/a.ts': [ERROR_LINE], 'a.test.json': ['{}'] }, 'task');
    const seen: TypeRunOptions[] = [];
    const runTypes = runnerAnswering({ exitCode: 0, stdout: '', stderr: '' }, seen);
    const outcome = await runTypeStep(realInput(base, { runTypes }));
    expect(outcome).toEqual({ ran: false, red: false, interrupted: false, blocker: null });
    expect(seen).toHaveLength(0);
    expect(linesAt('info')).toEqual(['🔎 type step after "second task": the task changed no .test.ts file; nothing to type-check.']);

    // Control: the same base with a test file in the diff runs tsc over it alone.
    commit({ 'b.test.ts': CLEAN }, 'task again');
    expect((await runTypeStep(realInput(base, { runTypes }))).ran).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.argv.slice(-3)).toEqual([...TSC_FLAGS]);
  });

  it('runs nothing when tsc cannot be spawned, and runs once node_modules is back', async () => {
    const base = commit({ 'README.md': ['# planted'] }, 'base');
    commit({ 'a.test.ts': [...CLEAN, ERROR_LINE] }, 'task');
    rmSync(join(repo, 'node_modules'));
    const outcome = await runTypeStep(realInput(base));
    expect(outcome).toEqual({ ran: false, red: false, interrupted: false, blocker: null });
    expect(linesAt('warn')[0]).toContain('could not run tsc (ENOENT');

    // Control: with node_modules back the same diff runs, and is red.
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(repo, 'node_modules'));
    expect(await runTypeStep(realInput(base))).toMatchObject({ ran: true, red: true });
  }, TSC_TIMEOUT);
});

describe('runTypeStep over scripted seams', () => {
  const ADDED = [['A', 'a.test.ts']] as const;

  it('runs nothing in a checkout with no tsconfig.json, asking git nothing, and runs once one is planted', async () => {
    rmSync(join(repo, 'tsconfig.json'));
    const calls: string[] = [];
    const seen: TypeRunOptions[] = [];
    const clean = { exitCode: 0, stdout: '', stderr: '' };
    const outcome = await runTypeStep(scriptedInput(ADDED, clean, seen, { git: gitWith('base0000', ADDED, calls) }));
    expect(outcome).toEqual({ ran: false, red: false, interrupted: false, blocker: null });
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(linesAt('info')).toEqual(['🔎 type step after "second task": no tsconfig.json at the checkout root; nothing to type-check.']);

    writeFileSync(join(repo, 'tsconfig.json'), TSCONFIG, 'utf8');
    expect((await runTypeStep(scriptedInput(ADDED, clean, seen))).ran).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('warns and runs nothing when git does not answer the diff', async () => {
    const seen: TypeRunOptions[] = [];
    const outcome = await runTypeStep(scriptedInput(ADDED, { exitCode: 0, stdout: '', stderr: '' }, seen, { git: gitWith('other', ADDED) }));
    expect(outcome.ran).toBe(false);
    expect(seen).toHaveLength(0);
    expect(linesAt('warn')[0]).toContain('fatal: bad revision');
  });

  it('reads a run ended on the stop code, or under the runner\'s SIGINT, as a stop and never red', async () => {
    const red = { exitCode: 2, stdout: `a.test.ts(6,14): error ${TS2322.replace(' ', ': ')}\n`, stderr: '' };
    expect(await runTypeStep(scriptedInput(ADDED, { exitCode: STOP, stdout: '', stderr: '' })))
      .toEqual({ ran: true, red: false, interrupted: true, blocker: null });
    expect(await runTypeStep(scriptedInput(ADDED, red, [], { isInterrupted: () => true })))
      .toMatchObject({ red: false, interrupted: true });

    // Control: the same run without the flag is red, the added file holding no base.
    expect(await runTypeStep(scriptedInput(ADDED, red, [], { isInterrupted: () => false })))
      .toMatchObject({ red: true, interrupted: false });
  });

  it('is red with a could-not-check blocker when tsc reports the scratch config or an error with no file', async () => {
    const outcome = await runTypeStep(scriptedInput(ADDED, { exitCode: 2, stdout: 'error TS5023: Unknown compiler option \'nope\'.\n', stderr: '' }));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toBe('The runner\'s type step after "second task" could not type-check the task\'s test files: tsc exited 2: error TS5023: Unknown compiler option \'nope\'.');

    const silent = await runTypeStep(scriptedInput(ADDED, { exitCode: 1, stdout: '', stderr: '' }));
    expect(silent.blocker).toBe('The runner\'s type step after "second task" could not type-check the task\'s test files: tsc exited 1 and printed no error.');

    // Control: an error in a module the test imports is check-types's, and leaves the step green.
    const imported = await runTypeStep(scriptedInput(ADDED, { exitCode: 2, stdout: `src/a.ts(1,14): error ${TS2322.replace(' ', ': ')}\n`, stderr: '' }));
    expect(imported).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
  });
});

describe('readTypeFiles', () => {
  it('keeps the .test.ts files, an added one with no base and a renamed one with its old path', () => {
    const git = gitWith('b', [['M', 'm.test.ts'], ['A', 'n.test.ts'], ['R087', 'old.test.ts', 'new.test.ts'], ['M', 'src/a.ts'], ['A', 'x.test.tsx']]);
    expect(readTypeFiles(git, 'b')).toEqual([
      { head: 'm.test.ts', base: 'm.test.ts' },
      { head: 'n.test.ts', base: null },
      { head: 'new.test.ts', base: 'old.test.ts' },
    ]);
  });
});

describe('parseTscOutput', () => {
  it('reads file errors relative to the cwd, joins continuation lines and keeps errors with no file', () => {
    const stdout = [
      'src/a.test.ts(189,27): error TS2769: No overload matches this call.',
      '  Overload 1 of 2, \'(expected: string[]): void\', gave the following error.',
      'error TS6053: File \'/x/gone.test.ts\' not found.',
      '',
    ].join('\n');
    expect(parseTscOutput(stdout, '/repo')).toEqual([
      { file: 'src/a.test.ts', line: 189, column: 27, code: 'TS2769', message: 'No overload matches this call.\n  Overload 1 of 2, \'(expected: string[]): void\', gave the following error.' },
      { file: null, line: 0, column: 0, code: 'TS6053', message: 'File \'/x/gone.test.ts\' not found.' },
    ]);
  });
});

describe('newErrors', () => {
  const at = (file: string, line: number, message = 'm'): TypeDiagnostic => ({ file, line, column: 1, code: 'TS2322', message });

  it('cancels one head error per base error of the same file, code and message, whatever its line', () => {
    expect(newErrors([at('a', 9), at('a', 12)], [at('a', 3)])).toEqual([at('a', 12)]);
    expect(newErrors([at('a', 9)], [at('b', 9)])).toEqual([at('a', 9)]);
    expect(newErrors([at('a', 9, 'other')], [at('a', 9)])).toEqual([at('a', 9, 'other')]);
  });
});
