/**
 * The ESLint run in the runner's task step (`runTaskStep`,
 * `suite-step.ts`): `bunx eslint --no-warn-ignored` over every file the
 * task changed since its base commit, read as red on a nonzero exit.
 *
 * ## Why the step lints
 *
 * The task prompt tells the session to lint the files it changed, and a
 * session that skipped it, or linted only its `.ts` files, still commits.
 * The step lints the task's diff itself, so a style error, a one-space
 * indented JSON file among them, blocks the next task as a new failing
 * test does, instead of waiting for `bun run lint` at the stage end.
 *
 * ## What is linted
 *
 * The files of `git diff --name-only -z --no-renames --diff-filter=d
 * <base> HEAD`, every kind: data and prose files are linted too, since
 * the root config lints JSON and Markdown. `--diff-filter=d` leaves out
 * the deleted files, which ESLint answers with exit 2 (measured on
 * ESLint 9.39.5: `No files matching the pattern "<path>" were found`);
 * `--no-renames` lists a renamed file under its new path.
 *
 * `--no-warn-ignored` keeps a diff of only ignored files green. Measured
 * on ESLint 9.39.5 at this repository's root: over `packages/**` files,
 * which `eslint.config.mjs` ignores, and over `.yml` and hook files no
 * config block matches, ESLint exits 0 and its JSON report is `[]`; the
 * control without the flag prints `File ignored because of a matching
 * ignore pattern` and `File ignored because no matching configuration
 * was supplied` as warnings, still exiting 0. A binary file no config
 * matches adds no entry either.
 *
 * The run adds `--format json`, so the step reads each file's error
 * count instead of parsing the stylish report; the command the blocker
 * hands the session is {@link LINT_COMMAND} over the files, without it.
 *
 * ## When nothing runs
 *
 * | Case | What the step does |
 * |---|---|
 * | no {@link ESLINT_CONFIG_FILES} file at the checkout root | prints one line, runs nothing |
 * | the diff is empty | prints one line, runs nothing |
 * | git does not answer the diff | warns, runs nothing |
 * | `bunx` cannot be spawned | warns, runs nothing |
 *
 * The first is a project that does not use ESLint: measured on ESLint
 * 9.39.5 in an empty directory, `bunx eslint` exits 2 with `ESLint
 * couldn't find an eslint.config.(js|mjs|cjs) file`, which would block
 * every task of such a project. None of the four is red: each says the
 * step has nothing to read, and none says the task broke a rule.
 *
 * ## Red, and the blocker
 *
 * A nonzero exit is red. Its blocker has the shape a test failure's has
 * (`blockerText`, `suite-blocker.ts`): what the step found, the files with
 * their counts, and the command running them, as in `The runner's lint
 * step after "<task>" found ESLint errors in the task's diff. Files with
 * errors: a.json (1 error). Run bunx eslint --no-warn-ignored a.json and
 * make them pass.` When the exit is nonzero and the report names no file
 * with an error (a config that throws, exit 2), the blocker says the
 * exit code and the first line ESLint wrote to stderr instead. The task
 * step joins this text after its own, when both are red, and writes the
 * one blocker on its repair task (`suite-blocker.ts`); the run record
 * holds the test run alone.
 *
 * A run that ends on the stop code, or while the runner has received
 * SIGINT, is {@link LintOutcome.interrupted}: never red, as an
 * interrupted test run is not.
 */
import type { GitRunner } from '../pr/index.js';

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/index.js';

/** The command the step runs, before its report flags and the files; the blocker hands the session this. */
export const LINT_COMMAND: readonly string[] = ['bunx', 'eslint', '--no-warn-ignored'];

/** The flags the step adds so that it reads a JSON report. */
export const LINT_REPORT_FLAGS: readonly string[] = ['--format', 'json'];

/** The flat config files ESLint 9 reads at the project root; with none, the step runs nothing. */
export const ESLINT_CONFIG_FILES: readonly string[] = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

/** How many error lines the run output prints before it counts the rest. */
const ERRORS_LISTED = 10;

/** The lines ESLint prints above the cause of a crash: `Oops! Something went wrong! :(` and its version. */
const CRASH_BANNER = /^(?:Oops!|ESLint: \d)/;

/** What a {@link LintRunner} spawns, and where. */
export interface LintRunOptions {
  readonly cwd: string;
  readonly argv: readonly string[];
}

/** What one spawn answered. */
export interface LintRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawns the lint; {@link runEslint} is the real one. */
export type LintRunner = (options: LintRunOptions) => Promise<LintRunResult>;

/** One file the report names with at least one error. */
export interface LintFileErrors {
  /** The file, relative to the checkout. */
  readonly file: string;
  readonly errors: number;
  /** One line per error: `file:line:column message (rule)`. */
  readonly lines: readonly string[];
}

/** What the lint step answered. */
export interface LintOutcome {
  /** True when ESLint ran; false when one of the cases of the module note ran nothing. */
  readonly ran: boolean;
  readonly red: boolean;
  /** True when the run was read as a stop on SIGINT, never red. */
  readonly interrupted: boolean;
  /** The blocker text of a red run; null otherwise. */
  readonly blocker: string | null;
}

/** What {@link runLintStep} is handed. */
export interface LintStepInput {
  /** The checkout ESLint and git run in. */
  readonly checkout: string;
  /** The commit the task started from. */
  readonly base: string;
  /** The task's sentence, for the label and the blocker. */
  readonly task: string;
  readonly git: GitRunner;
  /** {@link runEslint} when left out. */
  readonly runLint?: LintRunner;
  /** The exit code read as SIGINT. */
  readonly stopCode: number;
  /** True once the runner has received SIGINT; never, when left out. */
  readonly isInterrupted?: () => boolean;
}

/** The outcome of a step that ran nothing. */
const NOTHING_RAN: LintOutcome = { ran: false, red: false, interrupted: false, blocker: null };

/** Spawns `argv` in `cwd`, reading both streams to their end. */
export async function runEslint(options: LintRunOptions): Promise<LintRunResult> {
  const proc = Bun.spawn([...options.argv], {
    cwd: options.cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** True when `checkout` holds one of {@link ESLINT_CONFIG_FILES} at its root. */
export function hasEslintConfig(checkout: string): boolean {
  return ESLINT_CONFIG_FILES.some((name) => existsSync(join(checkout, name)));
}

/** The files changed from `base` to HEAD, deleted ones left out, or null with a warning when git does not answer. */
export function readLintFiles(git: GitRunner, base: string): readonly string[] | null {
  const result = git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=d', base, 'HEAD']);
  if (result.ok) return result.stdout.split('\0').filter((path) => path !== '');
  activeOutput().warn(`⚠️  git diff from ${base} did not answer (${gitSaid(result) || 'nothing said'}); the lint step runs nothing.`);
  return null;
}

/** The line of one report message. */
function messageLine(file: string, message: Record<string, unknown>): string {
  const rule = typeof message['ruleId'] === 'string'
    ? ` (${message['ruleId']})`
    : '';
  return `${file}:${String(message['line'] ?? 0)}:${String(message['column'] ?? 0)} ${String(message['message'] ?? '')}${rule}`;
}

/** The errors of one report entry, or null when it names no error. */
function fileErrorsOf(entry: Record<string, unknown>, cwd: string): LintFileErrors | null {
  const errors = entry['errorCount'];
  if (typeof entry['filePath'] !== 'string' || typeof errors !== 'number' || errors === 0) return null;
  const file = relative(cwd, entry['filePath']);
  const messages = Array.isArray(entry['messages'])
    ? entry['messages'] as Record<string, unknown>[]
    : [];
  const lines = messages.filter((message) => message['severity'] === 2).map((message) => messageLine(file, message));
  return { file, errors, lines };
}

/**
 * The files ESLint's JSON report `stdout` names with an error, each
 * relative to `cwd`, or null when `stdout` is not a JSON array.
 */
export function parseLintReport(stdout: string, cwd: string): readonly LintFileErrors[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => fileErrorsOf(entry, cwd))
    .filter((errors) => errors !== null);
}

/** The label the step's lines and blocker name it by. */
export function lintLabel(task: string): string {
  return `lint step after "${task}"`;
}

/** The blocker a red lint run writes; see the module note. */
export function lintBlockerText(label: string, run: Pick<LintRunResult, 'exitCode' | 'stderr'>, files: readonly LintFileErrors[]): string {
  const parts = [`The runner's ${label} found ESLint errors in the task's diff.`];
  if (files.length > 0) {
    const named = files.map(({ file, errors }) => `${file} (${errors} ${errors === 1
      ? 'error'
      : 'errors'})`);
    parts.push(`Files with errors: ${named.join(', ')}. Run ${[...LINT_COMMAND, ...files.map(({ file }) => file)].join(' ')} and make them pass.`);
    return parts.join(' ');
  }
  const said = run.stderr.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !CRASH_BANNER.test(line));
  parts.push(`${LINT_COMMAND.slice(0, 2).join(' ')} exited ${run.exitCode} and printed no report${said === undefined
    ? '.'
    : `: ${said}`}`);
  return parts.join(' ');
}

/** Prints the run's summary and its first error lines. */
function announce(label: string, count: number, run: LintRunResult, files: readonly LintFileErrors[]): void {
  const errors = files.reduce((sum, file) => sum + file.errors, 0);
  activeOutput().info(`🧹 ${label}: ${LINT_COMMAND.join(' ')} over ${count} file(s) exited ${run.exitCode}; ${errors} error(s) in ${files.length} file(s).`);
  const lines = files.flatMap((file) => file.lines);
  for (const line of lines.slice(0, ERRORS_LISTED)) activeOutput().info(`   ${line}`);
  if (lines.length > ERRORS_LISTED) activeOutput().info(`   ...and ${lines.length - ERRORS_LISTED} more.`);
}

/** The files to lint, or null after printing why nothing runs. */
function filesToLint(input: LintStepInput, label: string): readonly string[] | null {
  if (!hasEslintConfig(input.checkout)) {
    activeOutput().info(`🧹 ${label}: no eslint.config file at the checkout root; nothing to lint.`);
    return null;
  }
  const files = readLintFiles(input.git, input.base);
  if (files === null) return null;
  if (files.length > 0) return files;
  activeOutput().info(`🧹 ${label}: the task changed no file; nothing to lint.`);
  return null;
}

/** Runs ESLint over the task's diff; see the module note. Never throws. */
export async function runLintStep(input: LintStepInput): Promise<LintOutcome> {
  const label = lintLabel(input.task);
  const files = filesToLint(input, label);
  if (files === null) return NOTHING_RAN;
  let run: LintRunResult;
  try {
    run = await (input.runLint ?? runEslint)({ cwd: input.checkout, argv: [...LINT_COMMAND, ...LINT_REPORT_FLAGS, ...files] });
  } catch (error) {
    activeOutput().warn(`⚠️  The ${label} could not run (${messageOf(error)}); the run goes on without it.`);
    return NOTHING_RAN;
  }
  if (run.exitCode === input.stopCode || input.isInterrupted?.() === true) {
    activeOutput().info(`⏹  The ${label} was interrupted by SIGINT: read as a stop, not as errors.`);
    return { ran: true, red: false, interrupted: true, blocker: null };
  }
  const reported = parseLintReport(run.stdout, input.checkout) ?? [];
  announce(label, files.length, run, reported);
  if (run.exitCode === 0) return { ran: true, red: false, interrupted: false, blocker: null };
  return { ran: true, red: true, interrupted: false, blocker: lintBlockerText(label, run, reported) };
}
