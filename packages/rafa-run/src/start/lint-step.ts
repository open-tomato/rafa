/**
 * The ESLint run in the runner's task step (`runTaskStep`,
 * `suite-task-step.ts`): the checkout's own ESLint, run with
 * `--no-warn-ignored` over every file the task changed since its base
 * commit, read as red on a nonzero exit.
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
 * on ESLint 9.39.5 at this repository's root: over a `.claude/**` file,
 * which `eslint.config.mjs` ignores, and over `.yml` and hook files no
 * config block matches, ESLint exits 0 and its JSON report is `[]`; the
 * control without the flag prints `File ignored because of a matching
 * ignore pattern` and `File ignored because no matching configuration
 * was supplied` as warnings, still exiting 0. A binary file no config
 * matches adds no entry either. Files under `packages/` are linted, not
 * ignored: a `.ts` and a `README.md` there each get a report entry, and
 * a planted package file with a double-quoted string exits 1 with
 * `@stylistic/quotes` named.
 *
 * The run adds `--format json`, so the step reads each file's error
 * count instead of parsing the stylish report; the command the blocker
 * hands the session is the resolved ESLint, relative to the checkout
 * ({@link eslintShownAs}), with {@link LINT_FLAGS} and the files,
 * without it.
 *
 * ## Which ESLint runs
 *
 * The step spawns the checkout's own ESLint and never `bunx`
 * ({@link resolveEslint}): `node_modules/.bin/eslint` under the checkout
 * root, else the bin of the `eslint` package `Bun.resolveSync` finds from
 * the checkout, which reaches a `node_modules` above it, as in a
 * workspace member or a scratch directory under a checkout. With no
 * ESLint there, `bunx` asked the registry for the latest `eslint`,
 * installed it in a temporary folder and ran it with the loop's
 * environment (#1602).
 *
 * `Bun.resolveSync` is asked only when a `node_modules` directory sits at
 * or above the checkout. Measured on Bun 1.3.14 against a local registry
 * stub: resolving `eslint/package.json` from a directory with no
 * `node_modules` above it sent `GET /eslint` to the registry (Bun's
 * auto-install), and from a directory holding an empty `node_modules` it
 * threw `Cannot find module` with no request. Bun also keeps a directory
 * it found no `eslint` in for the life of the process: measured on Bun
 * 1.3.14, a package planted after a missed lookup was not found by the
 * same process and was by a new one. `node_modules/.bin/eslint` is read
 * from the disk each time, so a session that installs the checkout's
 * dependencies is linted from its next task on.
 *
 * ## When nothing runs
 *
 * | Case | What the step does |
 * |---|---|
 * | no {@link ESLINT_CONFIG_FILES} file at the checkout root | prints one line, runs nothing |
 * | no ESLint resolves from the checkout | prints one line naming the missing ESLint, runs nothing |
 * | the diff is empty | prints one line, runs nothing |
 * | git does not answer the diff | warns, runs nothing |
 * | the resolved ESLint cannot be spawned | warns, runs nothing |
 *
 * The first is a project that does not use ESLint: measured on ESLint
 * 9.39.5 in an empty directory, ESLint exits 2 with `ESLint couldn't
 * find an eslint.config.(js|mjs|cjs) file`, which would block every task
 * of such a project. The second is a checkout with a config and no
 * ESLint installed: a fresh worktree before its install, or a project
 * that lints only in CI. None of the five is red: each says the step has
 * nothing to read, and none says the task broke a rule.
 *
 * ## Red, and the blocker
 *
 * A nonzero exit is red, and the blocker tells two causes apart by
 * whether ESLint printed its JSON report.
 *
 * With a report, ESLint ran and the blocker has the shape a test
 * failure's has (`blockerText`, `suite-blocker.ts`): what the step found,
 * the files with their counts, and the command running them, as in `The
 * runner's lint step after "<task>" found ESLint errors in the task's
 * diff. Files with errors: a.json (1 error). Run node_modules/.bin/eslint
 * --no-warn-ignored a.json and make them pass.`
 *
 * With no report (stdout that is not a JSON array), the step could not
 * run ESLint, and the blocker says so with the exit code and the first
 * line ESLint wrote to stderr, its crash banner left out: `The runner's
 * lint step after "<task>" could not run ESLint: node_modules/.bin/eslint
 * exited 2 and printed no report: Error: boom`. That is a config ESLint
 * could not load: measured on ESLint 9.39.5, a config that throws `boom`
 * exits 2 with an empty stdout, and the first stderr line under the
 * crash banner is `Error: boom`. It is not an error in the task's diff,
 * so the blocker does not hand the session a rule to fix, and the run
 * output prints `exited 2 and printed no report` in place of an error
 * count. A report that names no file with an error under a nonzero
 * exit keeps the found wording, with the exit code and the first
 * stderr line.
 *
 * The task step joins the blocker after its own, when both are red, and
 * writes the one blocker on its repair task (`suite-blocker.ts`); the
 * run record holds the test run alone.
 *
 * A run that ends on the stop code, or while the runner has received
 * SIGINT, is {@link LintOutcome.interrupted}: never red, as an
 * interrupted test run is not.
 */
import type { GitRunner } from '@open-tomato/rafa-pr';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { gitSaid } from '@open-tomato/rafa-pr';

/** The flags the resolved ESLint runs with before its report flags and the files; the blocker hands the session these. */
export const LINT_FLAGS: readonly string[] = ['--no-warn-ignored'];

/** Where a checkout's installed ESLint links its bin, relative to the checkout root. */
export const LOCAL_ESLINT_BIN: string = join('node_modules', '.bin', 'eslint');

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
  /** {@link runEslint} when left out; it is handed the resolved ESLint ({@link resolveEslint}), never `bunx`. */
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

/** True when a `node_modules` directory sits in `dir` or a directory above it. */
function hasNodeModulesAbove(dir: string): boolean {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, 'node_modules'))) return true;
    if (dirname(at) === at) return false;
  }
}

/** The bin `eslint/package.json` names for `eslint`, a string or a map. */
function binOf(manifest: unknown): string | null {
  if (typeof manifest !== 'object' || manifest === null) return null;
  const bin = (manifest as Record<string, unknown>)['bin'];
  if (typeof bin === 'string') return bin;
  if (typeof bin !== 'object' || bin === null) return null;
  const named = (bin as Record<string, unknown>)['eslint'];
  return typeof named === 'string'
    ? named
    : null;
}

/**
 * The absolute path of the ESLint the checkout holds, or null when none
 * resolves: {@link LOCAL_ESLINT_BIN} under `checkout`, else the bin of the
 * `eslint` package `Bun.resolveSync` finds from `checkout`, asked only
 * when a `node_modules` sits at or above it; see the module note.
 */
export function resolveEslint(checkout: string): string | null {
  const local = join(checkout, LOCAL_ESLINT_BIN);
  if (existsSync(local)) return local;
  if (!hasNodeModulesAbove(checkout)) return null;
  try {
    const manifest = Bun.resolveSync('eslint/package.json', checkout);
    const bin = binOf(JSON.parse(readFileSync(manifest, 'utf8')));
    if (bin === null) return null;
    const path = join(dirname(manifest), bin);
    return existsSync(path)
      ? path
      : null;
  } catch {
    return null;
  }
}

/** The resolved `eslint` as the blocker and the run output name it: relative to the checkout. */
export function eslintShownAs(checkout: string, eslint: string): string {
  return relative(checkout, eslint);
}

/** The command the blocker hands the session: `eslint`, as {@link eslintShownAs} names it, with {@link LINT_FLAGS}. */
function commandText(eslint: string): string {
  return [eslint, ...LINT_FLAGS].join(' ');
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

/** The first line ESLint wrote to stderr, crash banner lines left out, or undefined when it wrote none. */
function firstStderrLine(stderr: string): string | undefined {
  return stderr.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !CRASH_BANNER.test(line));
}

/** `<eslint> exited <code> and <what>`, with the first stderr line when there is one. */
function exitText(eslint: string, run: Pick<LintRunResult, 'exitCode' | 'stderr'>, what: string): string {
  const said = firstStderrLine(run.stderr);
  return `${eslint} exited ${run.exitCode} and ${what}${said === undefined
    ? '.'
    : `: ${said}`}`;
}

/**
 * The blocker a red lint run writes; see the module note. `eslint` is
 * the resolved ESLint as {@link eslintShownAs} names it. `files` is null
 * when the run printed no JSON report, which the blocker reads as a step
 * that could not run ESLint.
 */
export function lintBlockerText(label: string, eslint: string, run: Pick<LintRunResult, 'exitCode' | 'stderr'>, files: readonly LintFileErrors[] | null): string {
  if (files === null) return `The runner's ${label} could not run ESLint: ${exitText(eslint, run, 'printed no report')}`;
  const found = `The runner's ${label} found ESLint errors in the task's diff.`;
  if (files.length === 0) return `${found} ${exitText(eslint, run, 'its report named no file with an error')}`;
  const named = files.map(({ file, errors }) => `${file} (${errors} ${errors === 1
    ? 'error'
    : 'errors'})`);
  return `${found} Files with errors: ${named.join(', ')}. Run ${[commandText(eslint), ...files.map(({ file }) => file)].join(' ')} and make them pass.`;
}

/** Prints the run's summary and its first error lines; `files` is null when the run printed no report. */
function announce(label: string, eslint: string, count: number, run: LintRunResult, files: readonly LintFileErrors[] | null): void {
  const ran = `🧹 ${label}: ${commandText(eslint)} over ${count} file(s) exited ${run.exitCode}`;
  if (files === null) {
    activeOutput().info(`${ran} and printed no report.`);
    return;
  }
  const errors = files.reduce((sum, file) => sum + file.errors, 0);
  activeOutput().info(`${ran}; ${errors} error(s) in ${files.length} file(s).`);
  const lines = files.flatMap((file) => file.lines);
  for (const line of lines.slice(0, ERRORS_LISTED)) activeOutput().info(`   ${line}`);
  if (lines.length > ERRORS_LISTED) activeOutput().info(`   ...and ${lines.length - ERRORS_LISTED} more.`);
}

/** What the step lints with: the resolved ESLint and the task's files. */
interface LintPlan {
  readonly eslint: string;
  readonly files: readonly string[];
}

/** The ESLint and the files to lint, or null after printing why nothing runs. */
function planLint(input: LintStepInput, label: string): LintPlan | null {
  if (!hasEslintConfig(input.checkout)) {
    activeOutput().info(`🧹 ${label}: no eslint.config file at the checkout root; nothing to lint.`);
    return null;
  }
  const eslint = resolveEslint(input.checkout);
  if (eslint === null) {
    activeOutput().info(`🧹 ${label}: no ESLint installed in the checkout (no ${LOCAL_ESLINT_BIN}, no eslint package resolves from it); nothing to lint.`);
    return null;
  }
  const files = readLintFiles(input.git, input.base);
  if (files === null) return null;
  if (files.length > 0) return { eslint, files };
  activeOutput().info(`🧹 ${label}: the task changed no file; nothing to lint.`);
  return null;
}

/** Runs ESLint over the task's diff; see the module note. Never throws. */
export async function runLintStep(input: LintStepInput): Promise<LintOutcome> {
  const label = lintLabel(input.task);
  const plan = planLint(input, label);
  if (plan === null) return NOTHING_RAN;
  const { eslint, files } = plan;
  const shown = eslintShownAs(input.checkout, eslint);
  let run: LintRunResult;
  try {
    run = await (input.runLint ?? runEslint)({ cwd: input.checkout, argv: [eslint, ...LINT_FLAGS, ...LINT_REPORT_FLAGS, ...files] });
  } catch (error) {
    activeOutput().warn(`⚠️  The ${label} could not run (${messageOf(error)}); the run goes on without it.`);
    return NOTHING_RAN;
  }
  if (run.exitCode === input.stopCode || input.isInterrupted?.() === true) {
    activeOutput().info(`⏹  The ${label} was interrupted by SIGINT: read as a stop, not as errors.`);
    return { ran: true, red: false, interrupted: true, blocker: null };
  }
  const reported = parseLintReport(run.stdout, input.checkout);
  announce(label, shown, files.length, run, reported);
  if (run.exitCode === 0) return { ran: true, red: false, interrupted: false, blocker: null };
  return { ran: true, red: true, interrupted: false, blocker: lintBlockerText(label, shown, run, reported) };
}
