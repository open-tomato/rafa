/**
 * Tests for the worktree fork helper (`src/preflight/fork.ts`).
 *
 * Every fork is of a real git repository committed under the case's own
 * temporary directory, run by the real `git` of the system directories
 * and a stand-in `bun` planted in the case's `bin/`. The environment
 * handed to the fork holds a `HOME` and a `PATH` under that directory,
 * and a `FORK_LOG` naming the file the stand-in and each probe append a
 * line to, so the log's order is the order the fork ran them in. Each
 * case that builds that environment asserts its paths resolve under the
 * case's directory, and that `FORK_LOG` is not set in this process, so a
 * line in the log was written by a command run with the environment
 * handed in. No case waits on the probe timeout.
 *
 * A reading that could pass on a helper doing nothing sits beside a
 * control proving the fixture could have failed it:
 *
 *   - the install: a root holding `bun.lock` runs the stand-in before the
 *     probe, and the same fork of a root holding none runs it not at all;
 *   - the lockfile read off the root: an untracked `bun.lock` in the root
 *     installs though the fork holds none, and a tracked one deleted from
 *     the root's checkout installs nothing though the fork holds it;
 *   - each halt: the passing fork differing from it only in what failed;
 *   - the directory: a root below the top level installs and probes in
 *     the fork's counterpart, where the top level's fork does so in the
 *     worktree itself;
 *   - stdin closed: a child process whose stdin holds a line runs a
 *     command through `spawnCommand`, and the same command spawned with
 *     stdin inherited reads that line.
 */
import type { ForkOptions } from './fork.js';
import type { PreflightTiers } from './run.js';
import type { OptionalPrerequisiteItem, PrerequisiteItem } from '../config.js';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { forkWorktree, spawnCommand } from './fork.js';

/** The system directories `git`, `sh` and `echo` are found in. */
const SYSTEM_PATH = ['/usr/bin', '/bin'].join(delimiter);

/** This module, as a child process imports it. */
const FORK_MODULE = join(import.meta.dir, 'fork.ts');

/** The branch every fork is made on. */
const BRANCH = 'fork/task-1';

/** What a frozen install whose lockfile no longer matches writes first (bun 1.3.14). */
const LOCK_LINE = 'error: lockfile had changes, but lockfile is frozen';

/** What it writes after that line. */
const NOTE_LINE = 'note: try re-running without --frozen-lockfile and commit the updated lockfile';

let scratch = '';
let bin = '';
let home = '';
let log = '';
let fork = '';

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-preflight-fork-')));
  bin = join(scratch, 'bin');
  home = join(scratch, 'home');
  log = join(scratch, 'fork.log');
  fork = join(scratch, 'fork');
  mkdirSync(bin);
  mkdirSync(home);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** True when `path` sits under the case's temporary directory. */
function isUnderScratch(path: string): boolean {
  const rel = relative(scratch, path);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
}

/** The environment a fork is handed: the case's `HOME`, a `PATH` holding its `bin/` first, and `FORK_LOG`. */
function forkEnv(path: string = [bin, SYSTEM_PATH].join(delimiter)): Record<string, string> {
  expect(isUnderScratch(home)).toBe(true);
  expect(isUnderScratch(bin)).toBe(true);
  expect(isUnderScratch(log)).toBe(true);
  expect(process.env.FORK_LOG).toBeUndefined();
  return { HOME: home, PATH: path, FORK_LOG: log };
}

/** Runs the real `git` for a fixture, under the case's `HOME`, answering its stdout. */
function git(cwd: string, args: readonly string[]): string {
  const run = Bun.spawnSync(['git', '-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', ...args], {
    cwd,
    env: { HOME: home, PATH: SYSTEM_PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')} exited ${run.exitCode}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

/** A repository at `<scratch>/repo` with `files` committed on `main`. */
function repoWith(files: Readonly<Record<string, string>>): string {
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  for (const [name, content] of Object.entries(files)) {
    const path = join(repo, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'fixture']);
  return repo;
}

/** Writes an executable `/bin/sh` script named `name` into the case's `bin/`. */
function plant(name: string, body: readonly string[]): string {
  const path = join(bin, name);
  writeFileSync(path, ['#!/bin/sh', ...body, ''].join('\n'), 'utf8');
  chmodSync(path, 0o755);
  return path;
}

/**
 * Plants a stand-in `bun` that logs its words, its directory and whether
 * `package.json` is there, then writes each of `stderr` and exits `code`.
 */
function plantBun(code = 0, stderr: readonly string[] = []): void {
  plant('bun', [
    'if [ -f package.json ]; then manifest=yes; else manifest=no; fi',
    'echo "bun $* in $(pwd) package.json=$manifest" >> "$FORK_LOG"',
    ...stderr.map((line) => `printf '%s\\n' '${line}' >&2`),
    `exit ${code}`,
  ]);
}

/** The lines the stand-in and the probes logged, in order. */
function logLines(): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

/** A required item whose probe logs the directory it ran in, then exits `code` after `stderr`. */
function loggingProbe(code = 0, stderr = ''): PrerequisiteItem {
  const complaint = stderr === ''
    ? ''
    : ` echo '${stderr}' >&2;`;
  return Object.freeze({
    kind: 'tool',
    name: 'git',
    probe: `echo "probe in $(pwd)" >> "$FORK_LOG";${complaint} exit ${code}`,
  });
}

/** The two tiers a fork checks. */
function tiers(
  required: readonly PrerequisiteItem[],
  optional: readonly OptionalPrerequisiteItem[] = [],
): PreflightTiers {
  return Object.freeze({ required, optional });
}

/** The options of a fork of `root` into `<scratch>/fork`, each overridable. */
function forkOf(root: string, overrides: Partial<ForkOptions> = {}): ForkOptions {
  return {
    root,
    path: fork,
    branch: BRANCH,
    items: tiers([loggingProbe()]),
    env: forkEnv(),
    checks: { warn: () => undefined, timeoutMs: 5000 },
    ...overrides,
  };
}

describe('forkWorktree', () => {
  it('forks the worktree, installs in it, then runs its preflight there when the root holds bun.lock', async () => {
    const root = repoWith({ 'package.json': '{}\n', 'bun.lock': '{}\n' });
    plantBun();

    const result = await forkWorktree(forkOf(root));

    expect(logLines()).toEqual([
      `bun install --frozen-lockfile in ${fork} package.json=yes`,
      `probe in ${fork}`,
    ]);
    expect(result).toMatchObject({ path: fork, branch: BRANCH, root: fork, install: 'passed', halt: null });
    expect(result.report?.checks.map((check) => check.outcome)).toEqual(['pass']);
    expect(git(root, ['worktree', 'list', '--porcelain'])).toContain(`worktree ${fork}\n`);
    expect(git(fork, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(BRANCH);
    expect(git(fork, ['rev-parse', 'HEAD'])).toBe(git(root, ['rev-parse', 'HEAD']));
  });

  it('runs no install when the root holds no bun.lock, and still runs the preflight in the fork', async () => {
    const root = repoWith({ 'package.json': '{}\n' });
    plantBun();

    const result = await forkWorktree(forkOf(root));

    expect(logLines()).toEqual([`probe in ${fork}`]);
    expect(result).toMatchObject({ root: fork, install: 'skipped', halt: null });
    expect(existsSync(join(fork, 'package.json'))).toBe(true);
  });

  it('reads bun.lock off the root, installing for an untracked one the fork does not hold', async () => {
    const root = repoWith({ 'package.json': '{}\n' });
    writeFileSync(join(root, 'bun.lock'), '{}\n', 'utf8');
    plantBun();

    const result = await forkWorktree(forkOf(root));

    expect(existsSync(join(fork, 'bun.lock'))).toBe(false);
    expect(result.install).toBe('passed');
    expect(logLines()).toEqual([
      `bun install --frozen-lockfile in ${fork} package.json=yes`,
      `probe in ${fork}`,
    ]);
  });

  it('runs no install for a tracked bun.lock deleted from the root, though the fork holds it', async () => {
    const root = repoWith({ 'package.json': '{}\n', 'bun.lock': '{}\n' });
    unlinkSync(join(root, 'bun.lock'));
    plantBun();

    const result = await forkWorktree(forkOf(root));

    expect(existsSync(join(fork, 'bun.lock'))).toBe(true);
    expect(result.install).toBe('skipped');
    expect(logLines()).toEqual([`probe in ${fork}`]);
  });

  it('halts on a failed install with its exit code and first stderr line, running no preflight', async () => {
    const root = repoWith({ 'package.json': '{}\n', 'bun.lock': '{}\n' });
    plantBun(3, [LOCK_LINE, NOTE_LINE]);

    const result = await forkWorktree(forkOf(root));

    expect(result.halt).toEqual({
      step: 'install',
      exitCode: 3,
      message: `fork halted in ${fork}: \`bun install --frozen-lockfile\` exited 3: ${LOCK_LINE}`,
    });
    expect(result).toMatchObject({ root: fork, install: 'failed', report: null });
    expect(logLines()).toEqual([`bun install --frozen-lockfile in ${fork} package.json=yes`]);
    expect(existsSync(join(fork, 'package.json'))).toBe(true);
  });

  it('halts with exit code 1 when bun cannot be run, running no preflight', async () => {
    const root = repoWith({ 'package.json': '{}\n', 'bun.lock': '{}\n' });
    expect(Bun.which('bun', { PATH: SYSTEM_PATH })).toBeNull();

    const result = await forkWorktree(forkOf(root, { env: forkEnv(SYSTEM_PATH) }));

    expect(result.halt?.step).toBe('install');
    expect(result.halt?.exitCode).toBe(1);
    expect(result.halt?.message).toStartWith(`fork halted in ${fork}: \`bun install --frozen-lockfile\` could not be run: `);
    expect(result.halt?.message).toContain('bun');
    expect(result).toMatchObject({ install: 'failed', report: null });
    expect(logLines()).toEqual([]);
  });

  it('halts at the worktree when its path already exists, running neither the install nor the preflight', async () => {
    const root = repoWith({ 'package.json': '{}\n', 'bun.lock': '{}\n' });
    plantBun();
    mkdirSync(fork);
    writeFileSync(join(fork, 'occupied'), '', 'utf8');

    const result = await forkWorktree(forkOf(root));

    expect(result.halt).toEqual({
      step: 'worktree',
      exitCode: 128,
      message: `fork halted in ${root}: \`git worktree add -q -b ${BRANCH} ${fork}\` exited 128: fatal: '${fork}' already exists`,
    });
    expect(result).toMatchObject({ path: fork, root: null, install: 'not-reached', report: null });
    expect(logLines()).toEqual([]);
  });

  it('halts at the worktree outside a git repository, making no worktree', async () => {
    const root = join(scratch, 'plain');
    mkdirSync(root);
    plantBun();

    const result = await forkWorktree(forkOf(root));

    expect(result.halt?.step).toBe('worktree');
    expect(result.halt?.exitCode).toBe(128);
    expect(result.halt?.message).toStartWith(`fork halted in ${root}: \`git rev-parse --show-prefix\` exited 128: fatal: not a git repository`);
    expect(result).toMatchObject({ root: null, install: 'not-reached', report: null });
    expect(existsSync(fork)).toBe(false);
    expect(logLines()).toEqual([]);
  });

  it('halts at the preflight when a required item fails in the fork, after the install', async () => {
    const root = repoWith({ 'package.json': '{}\n', 'bun.lock': '{}\n' });
    plantBun();

    const result = await forkWorktree(forkOf(root, { items: tiers([loggingProbe(4, 'probe says no')]) }));

    expect(logLines()).toEqual([
      `bun install --frozen-lockfile in ${fork} package.json=yes`,
      `probe in ${fork}`,
    ]);
    expect(result.report?.halt).toContain('exited 4: probe says no');
    expect(result.halt).toEqual({
      step: 'preflight',
      exitCode: 1,
      message: `fork halted in ${fork}: ${result.report?.halt}`,
    });
    expect(result).toMatchObject({ root: fork, install: 'passed' });
  });

  it('answers the known-missing line of a failed optional item without halting', async () => {
    const root = repoWith({ 'package.json': '{}\n' });
    const warnings: string[] = [];
    const mgrep: OptionalPrerequisiteItem = Object.freeze({
      kind: 'tool',
      name: 'mgrep',
      probe: 'exit 1',
      reason: 'faster search; grep is the fallback',
    });

    const result = await forkWorktree(forkOf(root, {
      items: tiers([], [mgrep]),
      checks: { warn: (message) => warnings.push(message), timeoutMs: 5000 },
    }));

    expect(result.halt).toBeNull();
    expect(result.report?.knownMissing).toEqual(['known-missing: mgrep (faster search; grep is the fallback)']);
    expect(warnings).toHaveLength(1);
  });

  it('installs and probes in the fork counterpart of a root below the top level', async () => {
    const repo = repoWith({ 'packages/app/package.json': '{}\n', 'packages/app/bun.lock': '{}\n' });
    const root = join(repo, 'packages', 'app');
    const counterpart = join(fork, 'packages', 'app');
    plantBun();

    const result = await forkWorktree(forkOf(root));

    expect(result).toMatchObject({ path: fork, root: counterpart, install: 'passed', halt: null });
    expect(logLines()).toEqual([
      `bun install --frozen-lockfile in ${counterpart} package.json=yes`,
      `probe in ${counterpart}`,
    ]);
  });

  it('resolves a relative path against the root', async () => {
    const root = repoWith({ 'package.json': '{}\n' });
    const expected = join(scratch, 'relative-fork');

    const result = await forkWorktree(forkOf(root, { path: '../relative-fork' }));

    expect(result).toMatchObject({ path: expected, root: expected, halt: null });
    expect(logLines()).toEqual([`probe in ${expected}`]);
  });
});

describe('spawnCommand', () => {
  it('answers the exit code, stdout and stderr of a command found on the PATH handed in', async () => {
    plant('talker', ['echo "out $1"', 'echo err >&2', 'exit 5']);
    expect(Bun.which('talker')).toBeNull();

    const run = await spawnCommand(['talker', 'one'], { cwd: scratch, env: forkEnv() });

    expect(run).toEqual({ exitCode: 5, stdout: 'out one\n', stderr: 'err\n' });
  });

  it('answers a null exit code and the reason for a command it cannot start', async () => {
    const run = await spawnCommand(['rafa-no-such-command'], { cwd: scratch, env: forkEnv() });

    expect(run.exitCode).toBeNull();
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('rafa-no-such-command');
  });

  /**
   * Spawns a bun child whose stdin holds a line and which runs a script
   * reading one line, either through `spawnCommand` or with stdin
   * inherited, answering what the script wrote.
   */
  async function readThroughChild(mode: 'runner' | 'inherit'): Promise<string> {
    const reader = plant('reader', ['if read -r line; then echo "read:$line"; else echo "eof"; fi']);
    const fixture = join(scratch, 'stdin-fixture.ts');
    writeFileSync(fixture, [
      `import { spawnCommand } from ${JSON.stringify(FORK_MODULE)};`,
      `const env = ${JSON.stringify(forkEnv())};`,
      'if (process.argv[2] === "runner") {',
      '  const run = await spawnCommand(["reader"], { cwd: process.cwd(), env });',
      '  process.stdout.write(run.stdout);',
      '} else {',
      `  const proc = Bun.spawn([${JSON.stringify(reader)}], { env, stdin: "inherit", stdout: "pipe", stderr: "ignore" });`,
      '  process.stdout.write(await new Response(proc.stdout).text());',
      '}',
      '',
    ].join('\n'), 'utf8');
    const child = Bun.spawn([process.execPath, fixture, mode], {
      cwd: scratch,
      env: forkEnv(),
      stdin: new TextEncoder().encode('a line on stdin\n'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
    return stdout;
  }

  it('reads end of file on stdin where the same command with stdin inherited reads the line', async () => {
    expect(await readThroughChild('inherit')).toBe('read:a line on stdin\n');
    expect(await readThroughChild('runner')).toBe('eof\n');
  });
});
