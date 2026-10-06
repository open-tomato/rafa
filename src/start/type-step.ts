/**
 * The type check in the runner's task step: `tsc` over the `*.test.ts`
 * files the task changed since its base commit, red only on an error
 * the same file did not hold at the base.
 *
 * ## Why the step type-checks test files
 *
 * `tsconfig.json` excludes every `*.test.ts` file and `bun test` strips types
 * without checking them, so a type error in a test file is green on
 * every gate (`context/verification.md`). Test files already hold
 * thousands of errors no gate ever reported, so failing on every error
 * in a touched file would block a task for errors it inherited. The step
 * reads the errors of each test file at HEAD against the same file at
 * the base, and only an error the task added is red.
 *
 * ## What is checked
 *
 * The files of `git diff --name-status -z --find-renames --diff-filter=d
 * <base> HEAD` whose path ends in `.test.ts`. A renamed file is checked
 * against its old path at the base; an added file has no base, so all of
 * its errors are new.
 *
 * `tsc` reads the files through a scratch tsconfig written OUTSIDE the
 * tree: it `extends` the tree's `tsconfig.json` by absolute path, lists
 * the files by absolute path under `files`, sets `include` to `[]`, and
 * names `<modules>/@types` absolutely under `typeRoots`; the run is
 * `<modules>/.bin/tsc -p <scratch> --noEmit --pretty false` with the
 * tree as its cwd ({@link scratchTsconfig}). `<modules>` is the
 * `node_modules` {@link findNodeModules} walks up to, below.
 * Each part was measured on tsc 5.9.3: a bare `tsconfig.json` under
 * `extends` is looked up as a package, so tsc reports `TS6053: File
 * 'tsconfig.json' not found` on the scratch file and checks under its
 * defaults, where spreading a `Set` is `TS2802`; with no `typeRoots`,
 * `import ... from 'bun:test'` is `TS2307: Cannot find module
 * 'bun:test'`. The unit tests hold both controls.
 *
 * Only errors in the listed files are read: an error tsc reports in a
 * module a test imports is `check-types`'s to report.
 *
 * `<modules>` is found by walking up from the checkout to the first
 * directory holding `node_modules/.bin/tsc`, the checkout itself first,
 * as `bun` and `tsc` resolve imports. A loop's worktree under
 * `.rafa/worktrees/` holds no `node_modules` of its own, so the walk
 * reaches the main checkout's. It stops at the parent of `git rev-parse
 * --path-format=absolute --git-common-dir`, the main checkout's root, so
 * a `node_modules` above the repository is never used. When git does not
 * answer, or the checkout is not under that root, only the checkout is
 * looked at. When the walk finds none, `<modules>` is the checkout's
 * `node_modules`, and the spawn fails as the table below says.
 *
 * The base is a detached worktree of `<base>` in a temporary directory,
 * its `node_modules` a symlink to `<modules>`, so a test file at the
 * base is checked against the modules it imported then, not against the
 * task's. It is made only when a file with an error at HEAD existed at
 * the base, and removed with `git worktree remove --force` after the
 * run. A base with no `tsconfig.json` holds no errors: every error is
 * new.
 *
 * An error is the file it is in, its code and its whole message,
 * continuation lines included; its line and column are left out, so an
 * error that moved when lines were added above it is the same error.
 * The comparison counts: a file that held one `TS2322` with a message at
 * the base and holds two now has one new.
 *
 * Measured in this repository on tsc 5.9.3 under bun 1.3 (2026-10-05,
 * three runs each, through {@link runTypeStep} with a stubbed diff and
 * `HEAD` as the base). Over files that already hold errors, so the
 * step runs tsc twice and makes the base worktree: 2.7 s over 1 test
 * file (`src/config-schema.test.ts`) and 9.8 s over 5 (that file,
 * `src/project/scaffold.test.ts`, `src/commands/index.test.ts`,
 * `src/start/lint-step.test.ts`, `src/start/suite-step.test.ts`). Over
 * 1 clean file (`src/start/lint-step.test.ts`), one tsc run and no
 * worktree: 1.4 s. Making and removing the worktree is about 0.1 s of
 * it; the rest is tsc reading each file's import graph, which for
 * `suite-step.test.ts` reaches most of `src/`.
 *
 * ## When nothing runs
 *
 * | Case | What the step does |
 * |---|---|
 * | no `tsconfig.json` at the checkout root | prints one line, runs nothing |
 * | git does not answer the diff | warns, runs nothing |
 * | the diff holds no `*.test.ts` file | prints one line, runs nothing |
 * | `tsc` cannot be spawned | warns, runs nothing |
 * | the base worktree cannot be made, or tsc cannot run in it | warns, never red |
 *
 * The fourth is a walk that found no `node_modules/.bin/tsc`: measured on
 * bun 1.3, `Bun.spawn` throws `ENOENT: no such file or directory,
 * posix_spawn '<path>'`. None of these is red: each says the step has
 * nothing to compare, and none says the task added an error.
 *
 * ## Red, and the blocker
 *
 * A new error is red, and the blocker has the shape a lint failure's
 * has (`lint-step.ts`): what the step found, the errors with their
 * places (up to {@link ERRORS_LISTED}), and how to check them again.
 *
 * A HEAD run that printed an error with no file, or on the scratch
 * tsconfig, or that exited nonzero and printed no error at all, could
 * not check the files: it is red, and the blocker says the step could
 * not type-check, with the exit code and the first line tsc printed,
 * since a config tsc cannot read would otherwise pass every task.
 *
 * A run that ends on the stop code, or while the runner has received
 * SIGINT, is {@link TypeOutcome.interrupted}: never red, as an
 * interrupted test run is not.
 */
import type { GitRunner } from '../pr/index.js';

import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/index.js';

/** The suffix of the files the step checks. */
export const TEST_FILE_SUFFIX = '.test.ts';

/** The flags the step runs tsc with, after `-p <scratch>`. */
export const TSC_FLAGS: readonly string[] = ['--noEmit', '--pretty', 'false'];

/** How many errors the blocker and the run output list before they count the rest. */
export const ERRORS_LISTED = 10;

/** The directory the walk looks for, and the step's modules come from. */
const NODE_MODULES = 'node_modules';

/** Where tsc sits under a `node_modules`. */
const TSC_BIN: readonly string[] = ['.bin', 'tsc'];

/** The scratch tsconfig's file name. */
const SCRATCH_NAME = 'tsconfig.json';

/** One error line of `--pretty false`: `file(line,col): error TSn: message`. */
const FILE_ERROR = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** An error line with no file: `error TSn: message`. */
const GLOBAL_ERROR = /^error (TS\d+): (.*)$/;

/** What a {@link TypeRunner} spawns, and where. */
export interface TypeRunOptions {
  readonly cwd: string;
  readonly argv: readonly string[];
}

/** What one spawn answered. */
export interface TypeRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawns tsc; {@link runTsc} is the real one. */
export type TypeRunner = (options: TypeRunOptions) => Promise<TypeRunResult>;

/** One error tsc printed. */
export interface TypeDiagnostic {
  /** The file relative to the tree tsc ran in, or null for an error with no file. */
  readonly file: string | null;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  /** The whole message, its continuation lines joined by newlines. */
  readonly message: string;
}

/** A test file of the diff: its path at HEAD, and at the base or null when it is new. */
export interface TypeFile {
  readonly head: string;
  readonly base: string | null;
}

/** What the type step answered. */
export interface TypeOutcome {
  /** True when tsc ran over the checkout; false when one of the cases of the module note ran nothing. */
  readonly ran: boolean;
  readonly red: boolean;
  /** True when the run was read as a stop on SIGINT, never red. */
  readonly interrupted: boolean;
  /** The blocker text of a red run; null otherwise. */
  readonly blocker: string | null;
}

/** What {@link runTypeStep} is handed. */
export interface TypeStepInput {
  /** The checkout tsc and git run in. */
  readonly checkout: string;
  /** The commit the task started from. */
  readonly base: string;
  /** The task's sentence, for the label and the blocker. */
  readonly task: string;
  readonly git: GitRunner;
  /** {@link runTsc} when left out. */
  readonly runTypes?: TypeRunner;
  /** The exit code read as SIGINT. */
  readonly stopCode: number;
  /** True once the runner has received SIGINT; never, when left out. */
  readonly isInterrupted?: () => boolean;
}

/** What one tsc run over a tree came to. */
type TreeRun =
  | { readonly kind: 'threw'; readonly why: string }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'broken'; readonly run: TypeRunResult; readonly said: string | undefined }
  | { readonly kind: 'read'; readonly errors: readonly TypeDiagnostic[] };

/** The base's errors, keyed by HEAD path, or the outcome that ends the step without them. */
type BaseReading =
  | { readonly errors: readonly TypeDiagnostic[] }
  | { readonly outcome: TypeOutcome };

const NOTHING_RAN: TypeOutcome = { ran: false, red: false, interrupted: false, blocker: null };
const GREEN: TypeOutcome = { ran: true, red: false, interrupted: false, blocker: null };
const INTERRUPTED: TypeOutcome = { ran: true, red: false, interrupted: true, blocker: null };

/** Spawns `argv` in `cwd`, reading both streams to their end. */
export async function runTsc(options: TypeRunOptions): Promise<TypeRunResult> {
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

/** The label the step's lines and blocker name it by. */
export function typeLabel(task: string): string {
  return `type step after "${task}"`;
}

/** The paths of one `--name-status -z` entry, renames and copies holding two. */
function pathsOf(status: string): number {
  return /^[RC]/.test(status)
    ? 2
    : 1;
}

/** The `*.test.ts` files changed from `base` to HEAD, deleted ones left out, or null with a warning when git does not answer. */
export function readTypeFiles(git: GitRunner, base: string): readonly TypeFile[] | null {
  const result = git(['diff', '--name-status', '-z', '--find-renames', '--diff-filter=d', base, 'HEAD']);
  if (!result.ok) {
    activeOutput().warn(`⚠️  git diff from ${base} did not answer (${gitSaid(result) || 'nothing said'}); the type step runs nothing.`);
    return null;
  }
  const fields = result.stdout.split('\0').filter((field) => field !== '');
  const files: TypeFile[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index] ?? '';
    const count = pathsOf(status);
    const paths = fields.slice(index + 1, index + 1 + count);
    index += 1 + count;
    const head = paths[paths.length - 1];
    if (head === undefined || !head.endsWith(TEST_FILE_SUFFIX)) continue;
    files.push({ head, base: status.startsWith('A')
      ? null
      : paths[0] ?? null });
  }
  return files;
}

/** `path` with its symlinks resolved, or resolved alone when it does not exist. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The root the walk stops at: the parent of git's common dir, or null when git does not answer. */
function walkStop(git: GitRunner): string | null {
  const result = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const common = result.stdout.trim();
  return result.ok && common !== ''
    ? dirname(realPath(common))
    : null;
}

/** True when `dir` is `root` or below it. */
function isUnder(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root.endsWith(sep)
    ? root
    : `${root}${sep}`);
}

/**
 * The `node_modules` of the first directory from `checkout` up that holds
 * `node_modules/.bin/tsc`, stopping at the parent of git's common dir;
 * null when none does. See the module note.
 */
export function findNodeModules(checkout: string, git: GitRunner): string | null {
  const start = realPath(checkout);
  const stop = walkStop(git);
  const top = stop !== null && isUnder(start, stop)
    ? stop
    : start;
  for (let dir = start; ; dir = dirname(dir)) {
    const modules = join(dir, NODE_MODULES);
    if (existsSync(join(modules, ...TSC_BIN))) return modules;
    if (dir === top || dirname(dir) === dir) return null;
  }
}

/** The scratch tsconfig over `files` (relative to `tree`), its types from `modules`; see the module note. */
export function scratchTsconfig(tree: string, files: readonly string[], modules: string): string {
  const root = resolve(tree);
  return `${JSON.stringify({
    extends: join(root, 'tsconfig.json'),
    compilerOptions: { typeRoots: [join(resolve(modules), '@types')] },
    files: files.map((file) => join(root, file)),
    include: [],
  }, null, 2)}\n`;
}

/** The errors tsc printed under `--pretty false`, each file relative to `cwd`. */
export function parseTscOutput(stdout: string, cwd: string): readonly TypeDiagnostic[] {
  const errors: TypeDiagnostic[] = [];
  for (const line of stdout.split('\n')) {
    const atFile = FILE_ERROR.exec(line);
    const global = atFile === null
      ? GLOBAL_ERROR.exec(line)
      : null;
    const last = errors[errors.length - 1];
    if (atFile !== null) {
      const [, file = '', row = '0', column = '0', code = '', message = ''] = atFile;
      errors.push({ file: relative(cwd, resolve(cwd, file)), line: Number(row), column: Number(column), code, message });
    } else if (global !== null) {
      errors.push({ file: null, line: 0, column: 0, code: global[1] ?? '', message: global[2] ?? '' });
    } else if (line.startsWith('  ') && last !== undefined) {
      errors[errors.length - 1] = { ...last, message: `${last.message}\n${line.trimEnd()}` };
    }
  }
  return errors;
}

/** The identity of an error in the comparison: its code and whole message. */
function identity(error: Pick<TypeDiagnostic, 'code' | 'message'>): string {
  return `${error.code} ${error.message}`;
}

/**
 * The errors of `head` not at the base: per file, each error at the base
 * (keyed by its HEAD path) cancels one error with the same code and
 * message at HEAD, wherever its line.
 */
export function newErrors(head: readonly TypeDiagnostic[], base: readonly TypeDiagnostic[]): readonly TypeDiagnostic[] {
  const left = new Map<string, number>();
  for (const error of base) {
    const key = `${error.file ?? ''}\0${identity(error)}`;
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  return head.filter((error) => {
    const key = `${error.file ?? ''}\0${identity(error)}`;
    const count = left.get(key) ?? 0;
    if (count === 0) return true;
    left.set(key, count - 1);
    return false;
  });
}

/** `file:line:column TSn message`, the message's first line only. */
function errorLine(error: TypeDiagnostic): string {
  const first = error.message.split('\n')[0] ?? '';
  return `${error.file ?? '(no file)'}:${error.line}:${error.column} ${error.code} ${first}`;
}

/** Up to {@link ERRORS_LISTED} error lines, the rest counted. */
function listed(errors: readonly TypeDiagnostic[]): readonly string[] {
  const shown = errors.slice(0, ERRORS_LISTED).map(errorLine);
  return errors.length > ERRORS_LISTED
    ? [...shown, `...and ${errors.length - ERRORS_LISTED} more`]
    : shown;
}

/** The blocker of a run with new errors; see the module note. */
export function typeBlockerText(label: string, base: string, errors: readonly TypeDiagnostic[]): string {
  const files = [...new Set(errors.map((error) => error.file ?? ''))];
  // A tsc message often ends in its own period; the sentence's closing one would double it.
  const shown = listed(errors).join('; ')
    .replace(/\.$/u, '');
  return `The runner's ${label} found type errors in the task's test files that ${base} did not hold. `
    + `New errors: ${shown}. `
    + `Fix them, then check ${files.join(' ')} with tsc ${TSC_FLAGS.join(' ')} -p over a tsconfig outside the checkout `
    + 'that extends its tsconfig.json by absolute path and lists them under files.';
}

/** The blocker of a HEAD run that could not check the files. */
export function brokenBlockerText(label: string, run: Pick<TypeRunResult, 'exitCode'>, said: string | undefined): string {
  return `The runner's ${label} could not type-check the task's test files: tsc exited ${run.exitCode}${said === undefined
    ? ' and printed no error.'
    : `: ${said}`}`;
}

/** The error that says tsc could not check the files: one with no file, or on the scratch tsconfig. */
function configError(errors: readonly TypeDiagnostic[], scratch: string, cwd: string): TypeDiagnostic | undefined {
  const config = relative(cwd, scratch);
  return errors.find((error) => error.file === null || error.file === config);
}

/** The first line tsc printed on either stream, or undefined when it printed none. */
function firstLine(run: TypeRunResult): string | undefined {
  return `${run.stdout}\n${run.stderr}`.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
}

/** Runs `<modules>/.bin/tsc` over `files` of `tree` through a scratch tsconfig; see the module note. */
async function checkTree(input: TypeStepInput, modules: string, tree: string, files: readonly string[]): Promise<TreeRun> {
  const scratchDir = mkdtempSync(join(tmpdir(), 'rafa-type-step-'));
  const scratch = join(scratchDir, SCRATCH_NAME);
  try {
    writeFileSync(scratch, scratchTsconfig(tree, files, modules), 'utf8');
    const tsc = join(modules, ...TSC_BIN);
    let run: TypeRunResult;
    try {
      run = await (input.runTypes ?? runTsc)({ cwd: tree, argv: [tsc, '-p', scratch, ...TSC_FLAGS] });
    } catch (error) {
      return { kind: 'threw', why: messageOf(error) };
    }
    if (run.exitCode === input.stopCode || input.isInterrupted?.() === true) return { kind: 'interrupted' };
    const errors = parseTscOutput(run.stdout, tree);
    const config = configError(errors, scratch, tree);
    if (config !== undefined) return { kind: 'broken', run, said: `error ${config.code}: ${config.message.split('\n')[0] ?? ''}` };
    if (run.exitCode !== 0 && errors.length === 0) return { kind: 'broken', run, said: firstLine(run) };
    const wanted = new Set(files);
    return { kind: 'read', errors: errors.filter((error) => error.file !== null && wanted.has(error.file)) };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/** Runs `check` in a detached worktree of the base, its `node_modules` linked to `modules`, removed after; null with a warning when it cannot be made. */
async function inBaseTree(input: TypeStepInput, label: string, modules: string, check: (tree: string) => Promise<TreeRun>): Promise<TreeRun | null> {
  const parent = mkdtempSync(join(tmpdir(), 'rafa-type-base-'));
  const tree = join(parent, 'tree');
  try {
    const added = input.git(['worktree', 'add', '--detach', tree, input.base]);
    if (!added.ok) {
      activeOutput().warn(`⚠️  The ${label} could not check out ${input.base} (${gitSaid(added) || 'nothing said'}); it reads no error as new.`);
      return null;
    }
    if (existsSync(modules) && !existsSync(join(tree, NODE_MODULES))) symlinkSync(modules, join(tree, NODE_MODULES));
    if (!existsSync(join(tree, 'tsconfig.json'))) return { kind: 'read', errors: [] };
    return await check(tree);
  } finally {
    if (existsSync(tree)) {
      const removed = input.git(['worktree', 'remove', '--force', tree]);
      if (!removed.ok) activeOutput().warn(`⚠️  The ${label} could not remove its worktree ${tree} (${gitSaid(removed) || 'nothing said'}).`);
    }
    rmSync(parent, { recursive: true, force: true });
  }
}

/** The base's errors keyed by HEAD path, or the outcome that ends the step. */
async function baseErrors(input: TypeStepInput, label: string, modules: string, files: readonly TypeFile[]): Promise<BaseReading> {
  const pairs = files.filter((file): file is TypeFile & { base: string } => file.base !== null);
  if (pairs.length === 0) return { errors: [] };
  const run = await inBaseTree(input, label, modules, (tree) => checkTree(input, modules, tree, pairs.map((file) => file.base)));
  if (run === null) return { outcome: GREEN };
  if (run.kind === 'interrupted') return { outcome: interrupted(label) };
  if (run.kind !== 'read') {
    const why = run.kind === 'threw'
      ? run.why
      : brokenBlockerText(label, run.run, run.said);
    activeOutput().warn(`⚠️  The ${label} could not check the files at ${input.base} (${why}); it reads no error as new.`);
    return { outcome: GREEN };
  }
  const headOf = new Map(pairs.map((file) => [file.base, file.head]));
  return { errors: run.errors.map((error) => ({ ...error, file: headOf.get(error.file ?? '') ?? error.file })) };
}

/** Prints the interruption and answers its outcome. */
function interrupted(label: string): TypeOutcome {
  activeOutput().info(`⏹  The ${label} was interrupted by SIGINT: read as a stop, not as errors.`);
  return INTERRUPTED;
}

/** The test files to check, or null after printing why nothing runs. */
function filesToCheck(input: TypeStepInput, label: string): readonly TypeFile[] | null {
  if (!existsSync(join(input.checkout, 'tsconfig.json'))) {
    activeOutput().info(`🔎 ${label}: no tsconfig.json at the checkout root; nothing to type-check.`);
    return null;
  }
  const files = readTypeFiles(input.git, input.base);
  if (files === null) return null;
  if (files.length > 0) return files;
  activeOutput().info(`🔎 ${label}: the task changed no ${TEST_FILE_SUFFIX} file; nothing to type-check.`);
  return null;
}

/** Type-checks the task's test files against the base; see the module note. Never throws. */
export async function runTypeStep(input: TypeStepInput): Promise<TypeOutcome> {
  const label = typeLabel(input.task);
  const files = filesToCheck(input, label);
  if (files === null) return NOTHING_RAN;
  const modules = findNodeModules(input.checkout, input.git) ?? join(resolve(input.checkout), NODE_MODULES);
  const head = await checkTree(input, modules, input.checkout, files.map((file) => file.head));
  if (head.kind === 'threw') {
    activeOutput().warn(`⚠️  The ${label} could not run tsc (${head.why}); the run goes on without it.`);
    return NOTHING_RAN;
  }
  if (head.kind === 'interrupted') return interrupted(label);
  if (head.kind === 'broken') {
    const blocker = brokenBlockerText(label, head.run, head.said);
    activeOutput().info(`🔎 ${label}: ${blocker}`);
    return { ran: true, red: true, interrupted: false, blocker };
  }
  const ran = `🔎 ${label}: tsc over ${files.length} test file(s)`;
  if (head.errors.length === 0) {
    activeOutput().info(`${ran}: no type error.`);
    return GREEN;
  }
  const base = await baseErrors(input, label, modules, files.filter((file) => head.errors.some((error) => error.file === file.head)));
  if ('outcome' in base) return base.outcome;
  const added = newErrors(head.errors, base.errors);
  activeOutput().info(`${ran}: ${head.errors.length} error(s), ${head.errors.length - added.length} already held at ${input.base}, ${added.length} not held.`);
  for (const line of listed(added)) activeOutput().info(`   ${line}`);
  if (added.length === 0) return GREEN;
  return { ran: true, red: true, interrupted: false, blocker: typeBlockerText(label, input.base, added) };
}
