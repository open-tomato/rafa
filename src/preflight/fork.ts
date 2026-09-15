/**
 * The worktree fork helper: a new git worktree for a task to run in,
 * `bun install --frozen-lockfile` in it when the root holds a `bun.lock`,
 * then the fork's own preflight, in the order "Preflight" in
 * `.specs/phase-1-installable.md` fixes.
 *
 * The loop forks no worktree in phase 1: it runs one thread until phase
 * 6, so nothing calls {@link forkWorktree} yet. It ships now so the order
 * is fixed, and proved, before a caller exists.
 *
 * ## What one fork does, in order
 *
 *   1. **Reads where the root sits in its repository**: `git rev-parse
 *      --show-prefix` in `root`, empty at the top level and
 *      `packages/app/` below it. The fork's counterpart of the root is
 *      that prefix under the new worktree, so a project below the top
 *      level installs and probes in its own directory of the fork.
 *   2. **Makes the worktree**: `git worktree add -q -b <branch> <path>`
 *      in `root`, `path` resolved against `root`, starting at the root's
 *      `HEAD`.
 *   3. **Installs, when the root holds a `bun.lock`**: `bun install
 *      --frozen-lockfile` in the fork's counterpart of the root. The
 *      lockfile is looked for in the root, not in the fork: a `bun.lock`
 *      the root holds untracked installs into a fork holding none, and
 *      one tracked but deleted from the root's checkout installs nothing.
 *   4. **Runs the fork's preflight**: `runPreflight` (`preflight/run.ts`)
 *      over the items handed in, each probe in the fork's counterpart of
 *      the root, with the same environment.
 *
 * Each step runs only when the one before it passed, so a halt names the
 * step that failed, and nothing after it ran.
 *
 * `git` and `bun` run through {@link spawnCommand} unless `runCommand`
 * replaces it: looked up on the `PATH` of the environment handed in,
 * which is where Bun looks a bare command up, with stdin closed, and with
 * no timeout, since an install over the network may take minutes where a
 * probe may not. Both streams are read: stdout for the prefix, stderr for
 * a halt.
 *
 * ## What a halt answers
 *
 * A halt carries its step, the exit code a caller halts with, and a
 * message opening `fork halted in <dir>: `, the directory the failed step
 * ran in:
 *
 *   - `worktree` or `install`: the command, how it ended, and the first
 *     line of stderr that is not blank, when there is one:
 *
 *         fork halted in /work/fork: `bun install --frozen-lockfile` exited 1: error: lockfile had changes, but lockfile is frozen
 *
 *     The exit code is the command's own. A command that could not be
 *     started `could not be run`, followed by the reason, with exit code 1.
 *   - `preflight`: the runner's halt, which names every failed required
 *     item, its probe, and its exit code with the first line of stderr,
 *     with exit code 1, the code `loop start` halts with.
 *
 * An optional item that failed halts nothing: the report answers its
 * `known-missing:` line, and the runner's `warn` writes it as it does for
 * `loop start`.
 *
 * ## What it leaves to its caller
 *
 * Nothing is removed on a halt: the worktree and its branch stay for the
 * caller to read or remove. No row is stored: the report's checks reach
 * the store's `preflight` table through the caller, as
 * `start/preflight.ts` stores the checks of `loop start`. No line is
 * printed but the runner's warnings.
 *
 * ## Readings
 *
 * Taken on bun 1.3.14 and git 2.50.1 (Darwin 25.6.0), in scratch
 * repositories:
 *
 *   - `bun install --frozen-lockfile` whose `package.json` no longer
 *     matches `bun.lock` exits 1, its stderr opening `error: lockfile had
 *     changes, but lockfile is frozen` with a `note:` line after it. In a
 *     directory holding no `bun.lock` it installs, writes no lockfile, and
 *     exits 0.
 *   - `git worktree add` without `-q` writes `Preparing worktree (new
 *     branch '<branch>')` to stderr ahead of its `fatal:` line; with `-q`
 *     the `fatal:` line is the first.
 *   - An add onto a path that exists exits 128 and still leaves its new
 *     branch behind. An add naming a branch that exists exits 255.
 *   - `git rev-parse --show-prefix` outside a repository exits 128:
 *     `fatal: not a git repository (or any of the parent directories): .git`.
 */
import type { PreflightEnv, PreflightOptions, PreflightReport, PreflightTiers } from './run.js';

import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { messageOf } from '../config-sections.js';

import { firstLineOf, runPreflight } from './run.js';

/** The lockfile whose presence in the root makes a fork install. */
export const LOCKFILE = 'bun.lock';

/** The install a fork runs when the root holds {@link LOCKFILE}. */
const INSTALL_COMMAND: readonly string[] = Object.freeze(['bun', 'install', '--frozen-lockfile']);

/** The read of where the root sits in its repository. */
const PREFIX_COMMAND: readonly string[] = Object.freeze(['git', 'rev-parse', '--show-prefix']);

/** The exit code of a halt whose command never started, or whose preflight halted. */
const HALT_EXIT_CODE = 1;

/** The step a fork halted at. */
export type ForkStep = 'worktree' | 'install' | 'preflight';

/** How a fork's install went: `not-reached` when the worktree step halted. */
export type InstallOutcome = 'passed' | 'failed' | 'skipped' | 'not-reached';

/** What one command run answered. */
export interface CommandRun {
  /** Its exit code, 128 plus the signal when killed; null when it never started. */
  readonly exitCode: number | null;
  /** What it wrote to stdout. */
  readonly stdout: string;
  /** What it wrote to stderr, or why it could not start. */
  readonly stderr: string;
}

/** Where, and in what environment, a command runs. */
export interface CommandOptions {
  readonly cwd: string;
  readonly env: PreflightEnv;
}

/** Runs one command; {@link spawnCommand} is the real one. Never rejects for a failing command. */
export type CommandRunner = (argv: readonly string[], options: CommandOptions) => Promise<CommandRun>;

/** Why a fork halted; see the module note. */
export interface ForkHalt {
  readonly step: ForkStep;
  /** The exit code a caller halts with. */
  readonly exitCode: number;
  /** `fork halted in <dir>: ` followed by what failed. */
  readonly message: string;
}

/** What a fork is made from, and the seams it runs through. */
export interface ForkOptions {
  /** The project root the fork is taken from, inside a git repository. */
  readonly root: string;
  /** Where the worktree goes, resolved against `root`. */
  readonly path: string;
  /** The branch the worktree is made on, which must not exist yet. */
  readonly branch: string;
  /** What the fork's preflight checks. */
  readonly items: PreflightTiers;
  /** What `git`, `bun` and every probe run with. `process.env` when left out. */
  readonly env?: PreflightEnv;
  /** {@link spawnCommand} when left out. */
  readonly runCommand?: CommandRunner;
  /** The preflight runner's other seams. Each left out is the runner's own default. */
  readonly checks?: Omit<PreflightOptions, 'cwd' | 'env'>;
}

/** What a fork answers. */
export interface WorktreeFork {
  /** The worktree's absolute path. */
  readonly path: string;
  /** The branch it was asked to be made on. */
  readonly branch: string;
  /** The fork's counterpart of the root, where the install and the probes run; null when the worktree step halted. */
  readonly root: string | null;
  /** How the install went. */
  readonly install: InstallOutcome;
  /** The fork's preflight; null when a step before it halted. */
  readonly report: PreflightReport | null;
  /** Why the fork halted; null when it did not. */
  readonly halt: ForkHalt | null;
}

/** Spawns `argv` in `options.cwd` with stdin closed and both output streams piped. */
function spawnPiped(argv: readonly string[], options: CommandOptions) {
  return Bun.spawn([...argv], {
    cwd: options.cwd,
    env: { ...options.env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

/**
 * Runs `argv` in `options.cwd` with stdin closed, its command looked up on
 * the `PATH` of `options.env`, and answers its exit code and both streams.
 * A command that fails or cannot start answers so, and never rejects.
 */
export async function spawnCommand(argv: readonly string[], options: CommandOptions): Promise<CommandRun> {
  let proc: ReturnType<typeof spawnPiped>;
  try {
    proc = spawnPiped(argv, options);
  } catch (error) {
    return Object.freeze({ exitCode: null, stdout: '', stderr: messageOf(error) });
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

/** The halt of a command run in `dir` that did not pass; see the module note. */
function commandHalt(
  step: Exclude<ForkStep, 'preflight'>,
  dir: string,
  argv: readonly string[],
  run: CommandRun,
): ForkHalt {
  const ending = run.exitCode === null
    ? 'could not be run'
    : `exited ${run.exitCode}`;
  const stated = `\`${argv.join(' ')}\` ${ending}`;
  const line = firstLineOf(run.stderr);
  const detail = line === null
    ? stated
    : `${stated}: ${line}`;
  return Object.freeze({ step, exitCode: run.exitCode ?? HALT_EXIT_CODE, message: `fork halted in ${dir}: ${detail}` });
}

/** Whether `root` holds a {@link LOCKFILE} as a file. */
function holdsLockfile(root: string): boolean {
  return statSync(join(root, LOCKFILE), { throwIfNoEntry: false })?.isFile() === true;
}

/** A fork's answer, frozen. */
function answer(fork: WorktreeFork): WorktreeFork {
  return Object.freeze(fork);
}

/** Where the worktree step left a fork: its counterpart of the root, or its halt. */
type MadeWorktree = { readonly root: string; readonly halt: null } | { readonly root: null; readonly halt: ForkHalt };

/** Steps 1 and 2: reads the root's prefix, then makes the worktree at `path`. */
async function makeWorktree(options: ForkOptions, path: string, run: CommandRunner, env: PreflightEnv): Promise<MadeWorktree> {
  const prefix = await run(PREFIX_COMMAND, { cwd: options.root, env });
  if (prefix.exitCode !== 0) return { root: null, halt: commandHalt('worktree', options.root, PREFIX_COMMAND, prefix) };

  const add = ['git', 'worktree', 'add', '-q', '-b', options.branch, path];
  const added = await run(add, { cwd: options.root, env });
  if (added.exitCode !== 0) return { root: null, halt: commandHalt('worktree', options.root, add, added) };

  return { root: resolve(path, prefix.stdout.replace(/\n$/, '')), halt: null };
}

/**
 * Forks a worktree of the repository `options.root` sits in, installs in
 * it when the root holds a `bun.lock`, then runs its preflight, and
 * answers how far it got; see the module note. A step that fails halts
 * the fork, and the answer names it. Rejects only when the root's
 * `bun.lock` cannot be checked for a reason other than its absence.
 */
export async function forkWorktree(options: ForkOptions): Promise<WorktreeFork> {
  const env = options.env ?? process.env;
  const run = options.runCommand ?? spawnCommand;
  const path = resolve(options.root, options.path);
  const branch = options.branch;

  const made = await makeWorktree(options, path, run, env);
  if (made.halt !== null) return answer({ path, branch, root: null, install: 'not-reached', report: null, halt: made.halt });
  const root = made.root;

  let install: InstallOutcome = 'skipped';
  if (holdsLockfile(options.root)) {
    const installed = await run(INSTALL_COMMAND, { cwd: root, env });
    if (installed.exitCode !== 0) {
      const halt = commandHalt('install', root, INSTALL_COMMAND, installed);
      return answer({ path, branch, root, install: 'failed', report: null, halt });
    }
    install = 'passed';
  }

  const report = await runPreflight(options.items, { ...options.checks, cwd: root, env });
  const halt = report.halt === null
    ? null
    : Object.freeze({ step: 'preflight' as const, exitCode: HALT_EXIT_CODE, message: `fork halted in ${root}: ${report.halt}` });
  return answer({ path, branch, root, install, report, halt });
}
