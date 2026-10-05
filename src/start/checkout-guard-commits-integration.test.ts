/**
 * `rafa loop start` spawned end to end over a two-task plan, proving the
 * loop guard (`./checkout-watch.ts`, `./checkout-guard.ts`) tells its own
 * commit apart from one made outside it.
 *
 * The first task's stand-in session writes a tracked marker file, which
 * `commitTaskWork` commits as the task's own work — the loop's own
 * commit, which the guard must hold across rather than halt on. The run
 * is paused (`rafa loop pause`) while that first session runs, so it
 * holds right after that commit and before the second task is
 * dispatched; a commit made directly in the repository while it holds
 * there stands in for one made in another terminal. `rafa loop resume`
 * then lets the run go on to its guard check ahead of the second task,
 * which must halt on that outside commit: `checkout moved`, the task
 * marked `[BLOCKED]`, the second stand-in session never spawned, and
 * neither the outside commit nor the checkout touched.
 *
 * `checkout-watch.test.ts` already pins `haltIfCheckoutMoved`'s halt and
 * hold over a real repository, called directly with a planted
 * `CheckoutExpectation`. What it cannot prove is that a real `loop start`
 * run, dispatching real tasks through real sessions, carries the same
 * expectation from one task's commit to the next guard check unmoved —
 * which is what this file spawns the whole command to show.
 */
import type { CapturedRun } from '../tests/cli-capture.js';
import type { Subprocess } from 'bun';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { expectExit, plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { CHECKOUT_MOVED } from './checkout-guard.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the template literal below. */
const FENCE = '```';

/** How long the stand-in sleeps per call, in whole seconds: a window to pause the run mid-session. */
const STAND_IN_DELAY_SECONDS = 2;

/** How long a case may wait for a condition to hold, or the spawned run to finish. */
const RUN_TIMEOUT = 90_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'checkout-guard-commits';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first task: its session's marker file is what the loop's own commit carries. */
const TASK1 = 'Write the loop\'s own tracked change';

/** The second task: never reached, since the outside commit halts the run ahead of it. */
const TASK2 = 'Never dispatched: the outside commit halts the run first';

/** The plan both tasks sit on. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${TASK1}\n- [ ] ${TASK2}\n`;

/** The tracked file the stand-in's session writes, committed as the first task's own work. */
const MARKER_FILE = 'loop-task-output.txt';

/** The file committed directly in the repository, standing in for a commit made in another terminal. */
const OUTSIDE_FILE = 'outside-commit.txt';

/** The flags every `loop start` in this file runs with. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** A scratch repository, and what a spawned run reads under it. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly claude: string;
  readonly callLog: string;
  readonly path: string;
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checkout-guard-commits-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** The trimmed stdout git answers for `args`, run the same way as {@link git}. */
function gitOut(cwd: string, home: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

/**
 * Writes the stand-in `claude` into `scratch`'s `bin/`. It drains its
 * prompt, sleeps {@link STAND_IN_DELAY_SECONDS} — a window to pause the
 * run while it holds the first task's session — writes {@link MARKER_FILE}
 * as a tracked change for `commitTaskWork` to find, logs the call, and
 * answers a `rafa:report` naming the task done. A second call (which the
 * halt this file proves must never happen) would overwrite the same
 * marker rather than adding a second one; the call log is what tells the
 * two apart.
 */
function plantStandIn(scratch: Scratch): void {
  writeFileSync(scratch.claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `/bin/sleep ${STAND_IN_DELAY_SECONDS}`,
    `printf 'written by the loop\\n' > '${MARKER_FILE}'`,
    `echo called >> '${scratch.callLog}'`,
    // No `cat`: the PATH this stand-in runs under may hold no coreutils
    // beside git's own directory (see `context/verification.md`).
    `printf '%s\\n' '${FENCE}rafa:report'`,
    'printf \'%s\\n\' \'status: done\'',
    'printf \'%s\\n\' \'feedback: "the stand-in wrote the loop\'"\'"\'s own tracked change"\'',
    'printf \'%s\\n\' \'findings: []\'',
    'printf \'%s\\n\' \'skills_used: []\'',
    'printf \'%s\\n\' \'blockers: []\'',
    'printf \'%s\\n\' \'out_of_scope_bugs: []\'',
    `printf '%s\\n' '${FENCE}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(scratch.claude, 0o755);
}

/**
 * A scratch git repository on {@link BRANCH}, its own HOME and `bin/`
 * beside it, holding `.rafa/config.yaml` and {@link PLAN} at
 * `.plans/PLAN-<stub>.md`, with the stand-in `claude` written to
 * `bin/claude`. `.plans/`, `.rafa/` and `progress.txt` are gitignored, as
 * a real project's are.
 */
function plant(): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const scratch: Scratch = {
    repo,
    home,
    claude: join(bin, 'claude'),
    callLog: join(root, 'calls.log'),
    path: [bin, dirname(gitBinary)].join(delimiter),
  };
  plantStandIn(scratch);

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo);

  return scratch;
}

/** Runs `bun src/rafa.ts` with `words` in `scratch`'s repository, waiting for it to finish. */
function run(scratch: Scratch, words: readonly string[]): CapturedRun {
  const proc = Bun.spawnSync([process.execPath, RAFA_ENTRY, ...words], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    timeout: 30_000,
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/** A background `rafa loop start`: the child, and what it answers once it ends. */
interface RunningLoop {
  readonly proc: Subprocess;
  /** Resolves once the child has ended; exit code null when a signal ended it. */
  readonly result: Promise<CapturedRun>;
}

/** Spawns `rafa loop start` over {@link RUN_FLAGS} in the background, collecting its streams. */
function spawnLoopStart(scratch: Scratch): RunningLoop {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  const proc = Bun.spawn([process.execPath, RAFA_ENTRY, 'loop', 'start', ...RUN_FLAGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const result = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    .then(([stdout, stderr, exitCode]) => ({ exitCode: proc.signalCode === null
      ? exitCode
      : null, stdout, stderr }));
  return { proc, result };
}

/** Polls `read` every `pollMs` until it answers other than null, or throws past `timeoutMs`. */
async function waitUntil<T>(read: () => T | null, timeoutMs: number, pollMs = 25): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for a condition to hold');
    await Bun.sleep(pollMs);
  }
}

/** Waits until `repo`'s sole session names `text` as its running task. */
function waitForTask(repo: string, text: string): Promise<true> {
  return waitUntil(() => {
    const sessions = readSessions(repo);
    return sessions.length === 1 && sessions[0]?.task?.text === text
      ? true
      : null;
  }, RUN_TIMEOUT);
}

/** Waits until `repo`'s sole session reads `paused` and names no task: the hold has taken effect. */
function waitForPausedIdle(repo: string): Promise<true> {
  return waitUntil(() => {
    const sessions = readSessions(repo);
    const session = sessions.length === 1
      ? sessions[0]
      : undefined;
    return session !== undefined && session.state === 'paused' && session.task === null
      ? true
      : null;
  }, RUN_TIMEOUT);
}

/** Waits until `repo`'s sole session reads `stopped`, the run having ended. */
function waitForStopped(repo: string): Promise<true> {
  return waitUntil(() => {
    const sessions = readSessions(repo);
    return sessions.length === 1 && sessions[0]?.state === 'stopped'
      ? true
      : null;
  }, RUN_TIMEOUT);
}

describe('the loop guard across a real run\'s own commit and one made outside it', () => {
  it('holds across the loop\'s own first commit, then halts on a commit made outside it before the second task', async () => {
    const scratch = plant();
    const { proc, result } = spawnLoopStart(scratch);
    try {
      // The first task dispatches, its stand-in session still sleeping;
      // pausing here lets the run hold right after that task's own
      // commit and before the second task's guard check.
      await waitForTask(scratch.repo, TASK1);
      expectExit(run(scratch, ['loop', 'pause']), 0, { ...scratch });
      await waitForPausedIdle(scratch.repo);

      const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
      expect(readFileSync(trackerPath, 'utf8')).toBe(`# Plan: ${STUB}\n\n- [x] ${TASK1}\n- [ ] ${TASK2}\n`);
      expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');

      // The loop's own commit: one task session's tracked change, committed
      // by `commitTaskWork` while the guard held.
      const afterOwnCommit = gitOut(scratch.repo, scratch.home, 'rev-list', '--count', 'HEAD');
      expect(afterOwnCommit).toBe('2');
      // The subject lower-cases the task text's first word, so the message
      // is read past it, where the rest of the sentence stands unchanged.
      const ownCommitMessage = gitOut(scratch.repo, scratch.home, 'log', '-1', '--format=%B');
      expect(ownCommitMessage).toContain('the loop\'s own tracked change');

      // A commit made directly in the repository, standing in for one made
      // in another terminal while the run holds.
      writeFileSync(join(scratch.repo, OUTSIDE_FILE), 'made outside the loop\n', 'utf8');
      git(scratch.repo, scratch.home, 'add', OUTSIDE_FILE);
      git(scratch.repo, scratch.home, 'commit', '-q', '-m', 'made in another terminal');
      const outsideHead = gitOut(scratch.repo, scratch.home, 'rev-parse', 'HEAD');

      expectExit(run(scratch, ['loop', 'resume']), 0, { ...scratch });
      await waitForStopped(scratch.repo);
      expectExit(await result, 0, { ...scratch });

      // Only the outside commit halted the run: the second task was never
      // dispatched, so the stand-in was called exactly once.
      expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');
      const tracker = readFileSync(trackerPath, 'utf8');
      expect(tracker).toContain(`- [x] ${TASK1}`);
      expect(tracker).toContain(`- [BLOCKED] ${TASK2}  <!-- blocked: ${CHECKOUT_MOVED} -->`);

      // Neither the outside commit nor the branch was touched by the halt:
      // no reset, no switch, and nothing further committed on top of it.
      expect(gitOut(scratch.repo, scratch.home, 'rev-parse', 'HEAD')).toBe(outsideHead);
      expect(gitOut(scratch.repo, scratch.home, 'rev-list', '--count', 'HEAD')).toBe('3');
      expect(gitOut(scratch.repo, scratch.home, 'symbolic-ref', '--short', 'HEAD')).toBe(BRANCH);
      expect(gitOut(scratch.repo, scratch.home, 'status', '--porcelain')).toBe('');
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});
