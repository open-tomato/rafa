/**
 * `rafa loop start` spawned end to end over a two-task plan in a
 * main-checkout loop (no `--as-worktree`), replaying the 2026-09-29
 * incident the loop guard's own module note describes
 * (`./checkout-guard.ts`): a branch checked out in the SAME working tree
 * the loop runs in, mid-task, while the loop's checkout and the operator's
 * happen to be one and the same directory.
 *
 * The stand-in session for the first task sleeps before it writes its
 * tracked change, the same window `checkout-guard-commits-integration.test.ts`
 * pauses the run in; here it is used instead to run `git switch main` in
 * the checkout while that session is still asleep — standing in for
 * someone switching branches in another terminal on a checkout that is
 * really the same directory. The session goes on to finish and report
 * done, unaware its checkout moved, and the guard the third checklist
 * item wired in before the task's own commit (`./checkout-watch.ts`,
 * `before: 'commit'`) must catch it there: the task marked `[BLOCKED]`
 * on `checkout moved`, its session's edit left uncommitted in the working
 * tree, and neither `main` nor the run's own branch carrying a new
 * commit. Per the guard's own contract, the checkout is never switched
 * back, so the run ends on `main`, at the one commit both branches still
 * share.
 *
 * `checkout-guard.test.ts`'s "halts on the 2026-09-29 incident" case
 * already pins `guardCheckout`'s reading of this exact move, called
 * directly over a real repository. What it cannot prove is that a real
 * `loop start` run, with a real session between the switch and the
 * guard's next check, reaches the same halt rather than committing the
 * session's work onto whatever branch the switch left behind — which is
 * what this file spawns the whole command to show.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { CHECKOUT_MOVED } from './checkout-guard.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the template literal below. */
const FENCE = '```';

/** How long the stand-in sleeps per call, in whole seconds: a window to switch the checkout mid-session. */
const STAND_IN_DELAY_SECONDS = 2;

/** How long a case may wait for a condition to hold, or the spawned run to finish. */
const RUN_TIMEOUT = 90_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'checkout-guard-incident';

/** The branch the run holds; cut from `main` before the run starts. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first task: its session's edit is the one the halt must leave uncommitted. */
const TASK1 = 'Write an edit while main is checked out from under the loop';

/** The second task: never dispatched, since the halt on the first task's commit stops the run first. */
const TASK2 = 'Never dispatched: the halt on the first task\'s commit stops the run first';

/** The plan both tasks sit on. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${TASK1}\n- [ ] ${TASK2}\n`;

/** The tracked file the stand-in's session writes; the edit the halt must keep uncommitted. */
const MARKER_FILE = 'loop-task-output.txt';

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

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checkout-guard-incident-')));
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
 * prompt, sleeps {@link STAND_IN_DELAY_SECONDS} — a window to switch the
 * checkout to `main` while it holds the first task's session — writes
 * {@link MARKER_FILE} as a tracked change for `commitTaskWork` to find,
 * logs the call, and answers a `rafa:report` naming the task done. A
 * second call (which the halt this file proves must never happen) would
 * overwrite the same marker rather than adding a second one; the call log
 * is what tells the two apart.
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
    'printf \'%s\\n\' \'feedback: "the stand-in wrote its edit while main was checked out"\'',
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
 * A scratch git repository on {@link BRANCH} cut from `main`, its own HOME
 * and `bin/` beside it, holding `.rafa/config.yaml` and {@link PLAN} at
 * `.plans/PLAN-<stub>.md`, with the stand-in `claude` written to
 * `bin/claude`. `.plans/`, `.rafa/` and `progress.txt` are gitignored, as
 * a real project's are. `main` and {@link BRANCH} share the seed commit,
 * so switching between them mid-run moves the branch alone — the same
 * shape the incident's own recovery line (`git switch <branch>`) answers.
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

  git(repo, home, 'init', '-q', '-b', 'main', '.');
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

/** Spawns `rafa loop start` over {@link RUN_FLAGS} in the background, its streams ignored. */
function spawnLoopStart(scratch: Scratch) {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  return Bun.spawn([process.execPath, RAFA_ENTRY, 'loop', 'start', ...RUN_FLAGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    stdout: 'ignore',
    stderr: 'ignore',
  });
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

/** Waits until `repo`'s sole session reads `stopped`, the run having ended. */
function waitForStopped(repo: string): Promise<true> {
  return waitUntil(() => {
    const sessions = readSessions(repo);
    return sessions.length === 1 && sessions[0]?.state === 'stopped'
      ? true
      : null;
  }, RUN_TIMEOUT);
}

describe('the loop guard replaying the 2026-09-29 incident in a real run', () => {
  it('halts the first task at its commit when main is switched to mid-task, keeping its edit uncommitted on neither branch', async () => {
    const scratch = plant();
    const proc = spawnLoopStart(scratch);
    try {
      // The first task dispatches, its stand-in session still draining its
      // prompt and about to sleep; this is the window to switch the
      // checkout to `main` from under it, standing in for someone doing
      // the same in another terminal on what turns out to be this same
      // directory.
      await waitForTask(scratch.repo, TASK1);
      const seedHead = gitOut(scratch.repo, scratch.home, 'rev-parse', 'HEAD');
      expect(gitOut(scratch.repo, scratch.home, 'rev-parse', BRANCH)).toBe(seedHead);
      expect(gitOut(scratch.repo, scratch.home, 'rev-parse', 'main')).toBe(seedHead);

      git(scratch.repo, scratch.home, 'switch', '-q', 'main');
      expect(gitOut(scratch.repo, scratch.home, 'symbolic-ref', '--short', 'HEAD')).toBe('main');

      await waitForStopped(scratch.repo);
      expect(await proc.exited).toBe(0);

      // The session ran and wrote its edit before reporting done; the
      // guard is what caught the branch moved, ahead of `commitTaskWork`.
      expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');
      expect(readFileSync(join(scratch.repo, MARKER_FILE), 'utf8')).toBe('written by the loop\n');

      const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
      const tracker = readFileSync(trackerPath, 'utf8');
      expect(tracker).toContain(`- [BLOCKED] ${TASK1}  <!-- blocked: ${CHECKOUT_MOVED} -->`);
      expect(tracker).toContain(`- [ ] ${TASK2}`);

      // Never switched back: the checkout is left exactly where the
      // switch put it, on `main`, at the one commit both branches still
      // share — no commit landed on either while the run held it.
      expect(gitOut(scratch.repo, scratch.home, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
      expect(gitOut(scratch.repo, scratch.home, 'rev-parse', 'HEAD')).toBe(seedHead);
      expect(gitOut(scratch.repo, scratch.home, 'rev-parse', 'main')).toBe(seedHead);
      expect(gitOut(scratch.repo, scratch.home, 'rev-parse', BRANCH)).toBe(seedHead);
      expect(gitOut(scratch.repo, scratch.home, 'rev-list', '--count', 'main')).toBe('1');
      expect(gitOut(scratch.repo, scratch.home, 'rev-list', '--count', BRANCH)).toBe('1');

      // The session's edit was left in place, uncommitted, exactly as the
      // halt's lines say it would be.
      expect(gitOut(scratch.repo, scratch.home, 'status', '--porcelain')).toBe(`?? ${MARKER_FILE}`);
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});
