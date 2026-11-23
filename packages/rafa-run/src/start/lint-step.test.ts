/**
 * The task step's ESLint run (`start/lint-step.ts`), driven over seams: a
 * scripted git, a scripted lint runner answering the JSON report ESLint
 * 9.39.5 printed for the measured cases, and a temporary checkout that
 * holds an `eslint.config.mjs` and a stand-in `node_modules/.bin/eslint`
 * unless the case says otherwise.
 *
 * Nothing here spawns ESLint. The real spawn of `runEslint` runs `bun -e`
 * in its place, and the one of `resolveEslint` runs it under a registry
 * stub, to show that resolving from a checkout with no `node_modules`
 * above it asks no registry. Every claim that the step ran nothing or stayed
 * green is paired with a case where the same input, changed in one
 * thing, runs it or goes red.
 */
import type { LintRunOptions, LintRunResult, LintStepInput } from './lint-step.js';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  hasEslintConfig,
  lintBlockerText,
  LOCAL_ESLINT_BIN,
  parseLintReport,
  readLintFiles,
  resolveEslint,
  runEslint,
  runLintStep,
} from './lint-step.js';

const BASE = 'base0000';
const STOP = 130;
const DIFF_KEY = `diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`;

/** The command the run output and the blocker name for the planted ESLint. */
const SHOWN = `${LOCAL_ESLINT_BIN} --no-warn-ignored`;

let checkout: string;
let eslintBin: string;
let lines: { level: string; message: string }[];

/** Writes `text` at `path` under `root`, its folders made. */
function plant(root: string, path: string, text: string): string {
  const at = join(root, path);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, text, 'utf8');
  return at;
}

beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'lint-step-'));
  writeFileSync(join(checkout, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
  eslintBin = plant(checkout, LOCAL_ESLINT_BIN, '#!/bin/sh\nexit 0\n');
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => lines.push({ level: 'info', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
  }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(checkout, { recursive: true, force: true });
});

/** The lines of one level. */
function linesAt(level: string): readonly string[] {
  return lines.filter((line) => line.level === level).map((line) => line.message);
}

/** A git whose filtered diff from {@link BASE} is `paths`, or that answers nothing when `paths` is null. */
function gitWith(paths: readonly string[] | null, calls: string[] = []): GitRunner {
  return (args) => {
    const key = args.join(' ');
    calls.push(key);
    const answer: GitResult = paths !== null && key === DIFF_KEY
      ? { ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' }
      : { ok: false, stdout: '', stderr: 'fatal: bad revision' };
    return answer;
  };
}

/** A report entry as ESLint's JSON formatter writes one, for `file` under the checkout. */
function entry(file: string, messages: readonly { ruleId: string; line: number; column: number; message: string }[]): Record<string, unknown> {
  return {
    filePath: join(checkout, file),
    messages: messages.map((message) => ({ ...message, severity: 2 })),
    errorCount: messages.length,
    fatalErrorCount: 0,
    warningCount: 0,
  };
}

/** The measured red report: one-space indented JSON and a double-quoted string. */
function redReport(): string {
  return JSON.stringify([
    entry('a.json', [{ ruleId: 'jsonc/indent', line: 2, column: 1, message: 'Expected indentation of 2 spaces but found 1.' }]),
    entry('src/b.ts', [{ ruleId: '@stylistic/quotes', line: 1, column: 11, message: 'Strings must use singlequote.' }]),
  ]);
}

/** A lint runner answering `result` and recording what it was asked to spawn. */
function runnerAnswering(result: LintRunResult, seen: LintRunOptions[] = []): (options: LintRunOptions) => Promise<LintRunResult> {
  return (options) => {
    seen.push(options);
    return Promise.resolve(result);
  };
}

/** The step's input over `paths`, linted by `result`. */
function inputWith(paths: readonly string[] | null, result: LintRunResult, seen: LintRunOptions[] = [], overrides: Partial<LintStepInput> = {}): LintStepInput {
  return {
    checkout,
    base: BASE,
    task: 'second task',
    git: gitWith(paths),
    runLint: runnerAnswering(result, seen),
    stopCode: STOP,
    ...overrides,
  };
}

const GREEN: LintRunResult = { exitCode: 0, stdout: '[]', stderr: '' };

describe('runLintStep', () => {
  it('is green on exit 0, having linted every changed file, data files included', async () => {
    const seen: LintRunOptions[] = [];
    const outcome = await runLintStep(inputWith(['src/a.ts', 'data/b.json', 'docs/c.md', 'img/d.png'], GREEN, seen));
    expect(outcome).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
    expect(seen).toEqual([{
      cwd: checkout,
      argv: [eslintBin, '--no-warn-ignored', '--format', 'json', 'src/a.ts', 'data/b.json', 'docs/c.md', 'img/d.png'],
    }]);
    expect(linesAt('info')).toEqual([`🧹 lint step after "second task": ${SHOWN} over 4 file(s) exited 0; 0 error(s) in 0 file(s).`]);
  });

  it('is red on a nonzero exit, its blocker naming each file with its count and the command', async () => {
    const outcome = await runLintStep(inputWith(['a.json', 'src/b.ts'], { exitCode: 1, stdout: redReport(), stderr: '' }));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toBe(
      'The runner\'s lint step after "second task" found ESLint errors in the task\'s diff. '
      + 'Files with errors: a.json (1 error), src/b.ts (1 error). '
      + 'Run node_modules/.bin/eslint --no-warn-ignored a.json src/b.ts and make them pass.',
    );
    expect(linesAt('info')).toContain('   a.json:2:1 Expected indentation of 2 spaces but found 1. (jsonc/indent)');
  });

  it('runs nothing on an empty diff, and lints the same checkout once one file changed', async () => {
    const seen: LintRunOptions[] = [];
    const outcome = await runLintStep(inputWith([], GREEN, seen));
    expect(outcome).toEqual({ ran: false, red: false, interrupted: false, blocker: null });
    expect(seen).toHaveLength(0);
    expect(linesAt('info')).toEqual(['🧹 lint step after "second task": the task changed no file; nothing to lint.']);

    // Control: one changed file runs the lint.
    await runLintStep(inputWith(['src/a.ts'], GREEN, seen));
    expect(seen).toHaveLength(1);
  });

  it('is green on a diff of only ignored files, which ESLint answers with exit 0 and an empty report under --no-warn-ignored', async () => {
    const seen: LintRunOptions[] = [];
    const ignored = ['packages/rafa-hub/package.json', 'packages/rafa-hub/src/bin.ts', '.github/workflows/verify.yml'];
    const outcome = await runLintStep(inputWith(ignored, GREEN, seen));
    expect(outcome).toMatchObject({ ran: true, red: false, blocker: null });
    expect(seen[0]?.argv).toContain('--no-warn-ignored');
    expect(seen[0]?.argv.slice(-3)).toEqual(ignored);
  });

  it('runs nothing in a checkout with no eslint.config file, and runs once one is planted', async () => {
    rmSync(join(checkout, 'eslint.config.mjs'));
    const calls: string[] = [];
    const seen: LintRunOptions[] = [];
    const outcome = await runLintStep(inputWith(['src/a.ts'], GREEN, seen, { git: gitWith(['src/a.ts'], calls) }));
    expect(outcome.ran).toBe(false);
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(linesAt('info')[0]).toContain('no eslint.config file at the checkout root');

    writeFileSync(join(checkout, 'eslint.config.ts'), 'export default [];\n', 'utf8');
    expect((await runLintStep(inputWith(['src/a.ts'], GREEN, seen))).ran).toBe(true);
  });

  it('spawns nothing in a checkout with an ESLint config and no ESLint, and spawns the local bin once one is planted', async () => {
    rmSync(join(checkout, 'node_modules'), { recursive: true });
    const calls: string[] = [];
    const seen: LintRunOptions[] = [];
    const outcome = await runLintStep(inputWith(['src/a.ts'], GREEN, seen, { git: gitWith(['src/a.ts'], calls) }));
    expect(outcome).toEqual({ ran: false, red: false, interrupted: false, blocker: null });
    expect(seen).toHaveLength(0);
    expect(seen.filter((options) => options.argv[0] === 'bunx')).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(linesAt('info')).toEqual([
      '🧹 lint step after "second task": no ESLint installed in the checkout (no node_modules/.bin/eslint, no eslint package resolves from it); nothing to lint.',
    ]);

    // Control: the same checkout with its ESLint planted spawns that bin, not bunx.
    plant(checkout, LOCAL_ESLINT_BIN, '#!/bin/sh\nexit 0\n');
    expect((await runLintStep(inputWith(['src/a.ts'], GREEN, seen))).ran).toBe(true);
    expect(seen.map((options) => options.argv[0])).toEqual([eslintBin]);
  });

  it('warns and runs nothing when git does not answer the diff', async () => {
    const seen: LintRunOptions[] = [];
    const outcome = await runLintStep(inputWith(null, GREEN, seen));
    expect(outcome).toEqual({ ran: false, red: false, interrupted: false, blocker: null });
    expect(seen).toHaveLength(0);
    expect(linesAt('warn')[0]).toContain('fatal: bad revision');
  });

  it('warns and runs nothing when the runner throws', async () => {
    const outcome = await runLintStep(inputWith(['src/a.ts'], GREEN, [], { runLint: () => Promise.reject(new Error('spawn EACCES')) }));
    expect(outcome).toMatchObject({ ran: false, red: false });
    expect(linesAt('warn')[0]).toContain('spawn EACCES');
  });

  it('reads a run ended on the stop code, or under the runner\'s SIGINT, as a stop and never red', async () => {
    const stopped = await runLintStep(inputWith(['src/a.ts'], { exitCode: STOP, stdout: '', stderr: '' }));
    expect(stopped).toEqual({ ran: true, red: false, interrupted: true, blocker: null });

    const flagged = await runLintStep(inputWith(['src/a.ts'], { exitCode: 1, stdout: redReport(), stderr: '' }, [], { isInterrupted: () => true }));
    expect(flagged).toMatchObject({ red: false, interrupted: true });

    // Control: the same red run without the flag is red.
    const red = await runLintStep(inputWith(['src/a.ts'], { exitCode: 1, stdout: redReport(), stderr: '' }, [], { isInterrupted: () => false }));
    expect(red).toMatchObject({ red: true, interrupted: false });
  });

  it('says it could not run ESLint on exit 2 with no report, as a config that throws answers', async () => {
    const stderr = '\nOops! Something went wrong! :(\n\nESLint: 9.39.5\n\nError: boom\n    at file:///x/eslint.config.mjs:1:7\n';
    const outcome = await runLintStep(inputWith(['src/a.ts'], { exitCode: 2, stdout: '', stderr }));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).not.toContain('found ESLint errors');
    expect(outcome.blocker).toBe(
      'The runner\'s lint step after "second task" could not run ESLint: '
      + 'node_modules/.bin/eslint exited 2 and printed no report: Error: boom',
    );
    expect(linesAt('info')).toEqual([`🧹 lint step after "second task": ${SHOWN} over 1 file(s) exited 2 and printed no report.`]);

    // Control: the same exit with a report naming a file is found errors.
    const found = await runLintStep(inputWith(['a.json', 'src/b.ts'], { exitCode: 2, stdout: redReport(), stderr }));
    expect(found.blocker).toContain('found ESLint errors');
  });

  it('says it could not run ESLint on a crash with no report, naming the exit code and the cause ESLint printed', async () => {
    const stderr = '\nOops! Something went wrong! :(\n\nESLint: 9.39.5\n\nNo files matching the pattern "gone.ts" were found.\n';
    const outcome = await runLintStep(inputWith(['src/a.ts'], { exitCode: 2, stdout: '', stderr }));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toBe(
      'The runner\'s lint step after "second task" could not run ESLint: '
      + 'node_modules/.bin/eslint exited 2 and printed no report: No files matching the pattern "gone.ts" were found.',
    );
  });
});

describe('readLintFiles', () => {
  it('asks git for the diff with deleted files left out', () => {
    const calls: string[] = [];
    expect(readLintFiles(gitWith(['a.ts', 'b.json'], calls), BASE)).toEqual(['a.ts', 'b.json']);
    expect(calls).toEqual([DIFF_KEY]);
  });
});

/** Runs `code` under `bun -e` in `cwd` with the registry pointed at a stub, answering how many requests the stub got and what `code` printed. */
async function underRegistryStub(cwd: string, code: string): Promise<{ requests: readonly string[]; stdout: string }> {
  const requests: string[] = [];
  const stub = Bun.serve({
    port: 0,
    fetch: (request) => {
      requests.push(new URL(request.url).pathname);
      return new Response('not here', { status: 404 });
    },
  });
  try {
    const registry = `http://127.0.0.1:${stub.port}/`;
    const proc = Bun.spawn([process.execPath, '-e', code], {
      cwd,
      env: { ...process.env, npm_config_registry: registry, BUN_CONFIG_REGISTRY: registry },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { requests, stdout };
  } finally {
    await stub.stop(true);
  }
}

describe('resolveEslint', () => {
  it('answers null with no node_modules at or above the checkout, asking no registry, where a bare Bun.resolveSync asks one', async () => {
    rmSync(join(checkout, 'node_modules'), { recursive: true });
    expect(resolveEslint(checkout)).toBeNull();

    const module = JSON.stringify(join(import.meta.dir, 'lint-step.ts'));
    const resolved = await underRegistryStub(checkout, `const { resolveEslint } = await import(${module}); console.log(String(resolveEslint(${JSON.stringify(checkout)})));`);
    expect(resolved.stdout.trim()).toBe('null');
    expect(resolved.requests).toEqual([]);

    // Control: the same resolution asked of Bun alone, from the same checkout, reaches the registry.
    const bare = await underRegistryStub(checkout, `try { Bun.resolveSync('eslint/package.json', ${JSON.stringify(checkout)}); } catch {}`);
    expect(bare.requests).toContain('/eslint');
  }, 30_000);

  it('answers null with a node_modules that holds no ESLint, and the package bin in a checkout that holds one', () => {
    rmSync(join(checkout, 'node_modules'), { recursive: true });
    // Two checkouts side by side: Bun keeps a directory it found no package in for the life of the process.
    const empty = join(checkout, 'empty');
    mkdirSync(join(empty, 'node_modules'), { recursive: true });
    expect(resolveEslint(empty)).toBeNull();

    const installed = join(checkout, 'installed');
    plant(installed, 'node_modules/eslint/package.json', JSON.stringify({ name: 'eslint', bin: { eslint: './bin/eslint.js' } }));
    const bin = plant(installed, 'node_modules/eslint/bin/eslint.js', '');
    expect(resolveEslint(installed)).toBe(bin);
  });

  it('prefers node_modules/.bin/eslint to the package', () => {
    plant(checkout, 'node_modules/eslint/package.json', JSON.stringify({ name: 'eslint', bin: './bin/eslint.js' }));
    plant(checkout, 'node_modules/eslint/bin/eslint.js', '');
    expect(resolveEslint(checkout)).toBe(eslintBin);
  });

  it('finds the package in a node_modules above the checkout, as a workspace member\'s', () => {
    rmSync(join(checkout, 'node_modules'), { recursive: true });
    const member = join(checkout, 'packages', 'member');
    mkdirSync(member, { recursive: true });
    expect(resolveEslint(member)).toBeNull();

    plant(checkout, 'node_modules/eslint/package.json', JSON.stringify({ name: 'eslint', bin: './bin/eslint.js' }));
    const bin = plant(checkout, 'node_modules/eslint/bin/eslint.js', '');
    expect(resolveEslint(member)).toBe(bin);
  });
});

describe('hasEslintConfig', () => {
  it('is true with a flat config at the root and false without', () => {
    expect(hasEslintConfig(checkout)).toBe(true);
    rmSync(join(checkout, 'eslint.config.mjs'));
    expect(hasEslintConfig(checkout)).toBe(false);
  });
});

describe('parseLintReport', () => {
  it('names each file with an error relative to the checkout, leaving out files with none', () => {
    const report = JSON.stringify([
      ...JSON.parse(redReport()) as unknown[],
      { filePath: join(checkout, 'clean.ts'), messages: [], errorCount: 0, fatalErrorCount: 0, warningCount: 0 },
    ]);
    const files = parseLintReport(report, checkout);
    expect(files?.map((file) => [file.file, file.errors])).toEqual([['a.json', 1], ['src/b.ts', 1]]);
  });

  it('answers null for output that is not a JSON array', () => {
    expect(parseLintReport('', checkout)).toBeNull();
    expect(parseLintReport('{}', checkout)).toBeNull();
    expect(parseLintReport('[]', checkout)).toEqual([]);
  });
});

describe('lintBlockerText', () => {
  it('counts errors in the plural', () => {
    const text = lintBlockerText('lint step after "t"', LOCAL_ESLINT_BIN, { exitCode: 1, stderr: '' }, [{ file: 'a.ts', errors: 2, lines: [] }]);
    expect(text).toContain('a.ts (2 errors)');
  });

  it('names the ESLint it is handed, never bunx, in the command it hands the session', () => {
    const files = [{ file: 'a.ts', errors: 1, lines: [] }];
    const shared = lintBlockerText('lint step after "t"', '../node_modules/eslint/bin/eslint.js', { exitCode: 1, stderr: '' }, files);
    expect(shared).toContain('Run ../node_modules/eslint/bin/eslint.js --no-warn-ignored a.ts and make them pass.');
    expect(shared).not.toContain('bunx');
  });

  it('ends on the exit code alone when ESLint printed nothing to stderr', () => {
    const text = lintBlockerText('lint step after "t"', LOCAL_ESLINT_BIN, { exitCode: 2, stderr: '' }, null);
    expect(text).toBe('The runner\'s lint step after "t" could not run ESLint: node_modules/.bin/eslint exited 2 and printed no report.');
  });

  it('keeps the found-errors wording for a report that names no file', () => {
    const text = lintBlockerText('lint step after "t"', LOCAL_ESLINT_BIN, { exitCode: 1, stderr: '' }, []);
    expect(text).toBe('The runner\'s lint step after "t" found ESLint errors in the task\'s diff. node_modules/.bin/eslint exited 1 and its report named no file with an error.');
  });
});

describe('runEslint', () => {
  it('answers the exit code and both streams of what it spawned', async () => {
    const argv = [process.execPath, '-e', 'process.stdout.write("[]"); process.stderr.write("said"); process.exit(3)'];
    expect(await runEslint({ cwd: checkout, argv })).toEqual({ exitCode: 3, stdout: '[]', stderr: 'said' });
  });
});
