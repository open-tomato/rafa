/**
 * Scratch repositories a spawned `rafa loop start` runs in: a git
 * repository with a plan, a HOME with the standing notices dismissed,
 * and a stand-in `claude` on the PATH that answers every call the same
 * way. Moved out of `loop-output.test.ts` so the events-mode suite
 * (`loop-events-output.test.ts`) plants the same repositories.
 *
 * {@link scratchPlanter} gives each test file a directory of its own,
 * removed by the `remove` it answers, which the file calls in `afterAll`.
 *
 * @module tests/loop-scratch
 */
import type { OutputMode } from '../config-sections.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';

import { plantProjectConfig } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { scratchHomeEnv } from './scratch-home-env.js';

/** The `src/` directory. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The CLI entry every command case runs. */
export const RAFA_ENTRY = join(SRC_DIR, 'rafa.ts');

/** The plan stub every planting runs. */
export const STUB = 'probe';

/** The flag naming the planted plan. */
export const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The one task the open plan holds. */
export const TASK = 'A task for the stand-in';

/** A plan holding one open task. */
export const PLAN_OPEN = `# Plan: ${STUB}\n\n- [ ] ${TASK}\n`;

/** A plan holding no open task, and a block never closed after its last task. */
export const PLAN_DONE = `# Plan: ${STUB}\n\n- [x] A finished task\n\n\`\`\`rafa:notes\na note never closed\n`;

/** The flags a session case runs with: the whole plan injected, so no fallback warning sits among its lines. */
export const SESSION_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** How long a case may run, over the kill below. */
export const RUN_TIMEOUT = { timeout: 60_000 };

/** How long one run may take before it is killed, so a run that never stops fails its case. */
const KILL_AFTER_MS = 45_000;

/** What a scratch repository is planted with. */
export interface Planting {
  /** The branch checked out. */
  readonly branch: string;
  /** The plan at `.plans/PLAN-probe.md`, or null for none. */
  readonly plan: string | null;
  /** `.rafa/config.yaml`; the file `rafa init` writes when absent, so every run stands in a project. */
  readonly config?: string;
  /** The exit code the stand-in answers every call with. Defaults to 0. */
  readonly claudeExit?: number;
  /** What the stand-in writes to stdout on every call, byte for byte. Defaults to nothing. */
  readonly claudeStdout?: string;
  /**
   * A file, named relative to the repository, the stand-in appends a line
   * to on every call, so the task's commit finds tracked work. Defaults to
   * none, which leaves the task nothing to commit.
   */
  readonly claudeWork?: string;
  /**
   * Whether the scratch HOME still owes the standing notices
   * (`src/notices/notices.ts`). Defaults to dismissed, so every other
   * case reads the run's own lines and nothing else; `pending` is the one
   * case that reads the notices.
   */
  readonly notices?: 'pending';
}

/** One planted scratch repository and what a run under it reads. */
export interface Scratch {
  readonly repo: string;
  readonly home: string;
  /** The stand-in `claude`. */
  readonly claude: string;
  /** The file the stand-in appends a line to per call, outside the repository. */
  readonly callLog: string;
  /** The PATH a run gets: the stand-in, then git's own directory. */
  readonly path: string;
}

/** Runs git in a scratch repository under that scratch HOME. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/** Plants a scratch repository, its HOME and its stand-in, under `base`, as run number `n`. */
function plantUnder(base: string, n: number, planting: Planting): Scratch {
  const root = join(base, `run-${n}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });
  if (planting.notices !== 'pending') writeDismissed(home, NOTICE_IDS);

  const callLog = join(root, 'calls.log');
  const claudeStdout = join(root, 'claude-stdout.txt');
  writeFileSync(claudeStdout, planting.claudeStdout ?? '', 'utf8');
  const claude = join(bin, 'claude');
  const work = planting.claudeWork === undefined
    ? []
    : [`echo work >> '${join(repo, planting.claudeWork)}'`];
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo called >> '${callLog}'`,
    ...work,
    `/bin/cat '${claudeStdout}'`,
    `exit ${planting.claudeExit ?? 0}`,
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', planting.branch);

  if (planting.plan !== null) {
    mkdirSync(join(repo, '.plans'));
    writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), planting.plan, 'utf8');
  }
  plantProjectConfig(repo, planting.config);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  // The runner's suite steps spawn `bun test` themselves, so bun must resolve in the child.
  const bunBinary = Bun.which('bun');
  if (bunBinary === null) throw new Error('bun is not on the PATH this suite runs under');
  return { repo, home, claude, callLog, path: [bin, dirname(gitBinary), dirname(bunBinary)].join(delimiter) };
}

/**
 * Typed by every run here, so that no run composes the real sources for
 * the ending hint in the scratch repository. The ending itself is
 * driven in `src/next/ending.test.ts`.
 */
const NO_HINT = '--no-hint';

/** What one `rafa loop start` run did. */
export interface LoopRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `rafa loop start` in a scratch repository, in one output mode, with `env` added to its environment. */
export function runLoopStart(
  scratch: Scratch,
  mode: OutputMode,
  flags: readonly string[],
  env: Readonly<Record<string, string>> = {},
): LoopRun {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  const runEnv: Record<string, string> = { TMPDIR: RESOLVED_TMPDIR, ...env, PATH: scratch.path, ...scratchHomeEnv(scratch.home) };
  if (mode !== 'text') runEnv.RAFA_OUTPUT = mode;
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'loop', 'start', ...flags, NO_HINT], {
    cwd: scratch.repo,
    env: runEnv,
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/**
 * The temp directory resolved through its links, handed to every run.
 * A development build migrates an effort store only under the temp
 * directory, and on macOS a scratch path resolves to `/private/var` while
 * the unresolved temp directory reads `/var`; without it every task's
 * report is refused and the run stops after its first task.
 */
const RESOLVED_TMPDIR = realpathSync(tmpdir());

/** A test file's own planter: its scratch directory, and the call that removes it. */
export interface ScratchPlanter {
  /** Plants one scratch repository under the file's directory. */
  readonly plant: (planting: Planting) => Scratch;
  /** Removes the file's directory and everything planted in it. */
  readonly remove: () => void;
}

/** A planter over a scratch directory named from `prefix`, its path resolved as git answers it. */
export function scratchPlanter(prefix: string): ScratchPlanter {
  const base = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  let planted = 0;
  return Object.freeze({
    plant: (planting: Planting): Scratch => {
      planted += 1;
      return plantUnder(base, planted, planting);
    },
    remove: (): void => {
      rmSync(base, { recursive: true, force: true });
    },
  });
}
