/**
 * The task step's ESLint run (`start/lint-step.ts`), driven over seams: a
 * scripted git, a scripted lint runner answering the JSON report ESLint
 * 9.39.5 printed for the measured cases, and a temporary checkout that
 * holds an `eslint.config.mjs` unless the case says otherwise.
 *
 * Nothing here spawns ESLint. The one real spawn, of `runEslint`, runs
 * `bun -e` in its place. Every claim that the step ran nothing or stayed
 * green is paired with a case where the same input, changed in one
 * thing, runs it or goes red.
 */
import type { LintRunOptions, LintRunResult, LintStepInput } from './lint-step.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  hasEslintConfig,
  LINT_COMMAND,
  lintBlockerText,
  parseLintReport,
  readLintFiles,
  runEslint,
  runLintStep,
} from './lint-step.js';

const BASE = 'base0000';
const STOP = 130;
const DIFF_KEY = `diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`;

let checkout: string;
let lines: { level: string; message: string }[];

beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'lint-step-'));
  writeFileSync(join(checkout, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
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
      argv: ['bunx', 'eslint', '--no-warn-ignored', '--format', 'json', 'src/a.ts', 'data/b.json', 'docs/c.md', 'img/d.png'],
    }]);
    expect(linesAt('info')).toEqual([`🧹 lint step after "second task": ${LINT_COMMAND.join(' ')} over 4 file(s) exited 0; 0 error(s) in 0 file(s).`]);
  });

  it('is red on a nonzero exit, its blocker naming each file with its count and the command', async () => {
    const outcome = await runLintStep(inputWith(['a.json', 'src/b.ts'], { exitCode: 1, stdout: redReport(), stderr: '' }));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toBe(
      'The runner\'s lint step after "second task" found ESLint errors in the task\'s diff. '
      + 'Files with errors: a.json (1 error), src/b.ts (1 error). '
      + 'Run bunx eslint --no-warn-ignored a.json src/b.ts and make them pass.',
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

  it('warns and runs nothing when git does not answer the diff', async () => {
    const seen: LintRunOptions[] = [];
    const outcome = await runLintStep(inputWith(null, GREEN, seen));
    expect(outcome).toEqual({ ran: false, red: false, interrupted: false, blocker: null });
    expect(seen).toHaveLength(0);
    expect(linesAt('warn')[0]).toContain('fatal: bad revision');
  });

  it('warns and runs nothing when the runner throws', async () => {
    const outcome = await runLintStep(inputWith(['src/a.ts'], GREEN, [], { runLint: () => Promise.reject(new Error('bunx not found')) }));
    expect(outcome).toMatchObject({ ran: false, red: false });
    expect(linesAt('warn')[0]).toContain('bunx not found');
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

  it('says it could not run ESLint on exit 2 with no report and ResolveMessage {} on stderr', async () => {
    const outcome = await runLintStep(inputWith(['src/a.ts'], { exitCode: 2, stdout: '', stderr: 'ResolveMessage {}\n' }));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).not.toContain('found ESLint errors');
    expect(outcome.blocker).toBe(
      'The runner\'s lint step after "second task" could not run ESLint: '
      + 'bunx eslint exited 2 and printed no report: ResolveMessage {}',
    );
    expect(linesAt('info')).toEqual([`🧹 lint step after "second task": ${LINT_COMMAND.join(' ')} over 1 file(s) exited 2 and printed no report.`]);

    // Control: the same exit with a report naming a file is found errors.
    const found = await runLintStep(inputWith(['a.json', 'src/b.ts'], { exitCode: 2, stdout: redReport(), stderr: 'ResolveMessage {}\n' }));
    expect(found.blocker).toContain('found ESLint errors');
  });

  it('says it could not run ESLint on a crash with no report, naming the exit code and the cause ESLint printed', async () => {
    const stderr = '\nOops! Something went wrong! :(\n\nESLint: 9.39.5\n\nNo files matching the pattern "gone.ts" were found.\n';
    const outcome = await runLintStep(inputWith(['src/a.ts'], { exitCode: 2, stdout: '', stderr }));
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toBe(
      'The runner\'s lint step after "second task" could not run ESLint: '
      + 'bunx eslint exited 2 and printed no report: No files matching the pattern "gone.ts" were found.',
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
    const text = lintBlockerText('lint step after "t"', { exitCode: 1, stderr: '' }, [{ file: 'a.ts', errors: 2, lines: [] }]);
    expect(text).toContain('a.ts (2 errors)');
  });

  it('ends on the exit code alone when ESLint printed nothing to stderr', () => {
    const text = lintBlockerText('lint step after "t"', { exitCode: 2, stderr: '' }, null);
    expect(text).toBe('The runner\'s lint step after "t" could not run ESLint: bunx eslint exited 2 and printed no report.');
  });

  it('keeps the found-errors wording for a report that names no file', () => {
    const text = lintBlockerText('lint step after "t"', { exitCode: 1, stderr: '' }, []);
    expect(text).toBe('The runner\'s lint step after "t" found ESLint errors in the task\'s diff. bunx eslint exited 1 and its report named no file with an error.');
  });
});

describe('runEslint', () => {
  it('answers the exit code and both streams of what it spawned', async () => {
    const argv = [process.execPath, '-e', 'process.stdout.write("[]"); process.stderr.write("said"); process.exit(3)'];
    expect(await runEslint({ cwd: checkout, argv })).toEqual({ exitCode: 3, stdout: '[]', stderr: 'said' });
  });
});
