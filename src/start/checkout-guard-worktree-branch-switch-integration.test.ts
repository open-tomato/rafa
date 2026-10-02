/**
 * `rafa loop start --as-worktree` spawned end to end over a one-task plan,
 * proving the loop guard (`./checkout-watch.ts`, `./checkout-guard.ts`)
 * never even looks at the MAIN checkout when the run's own checkout is a
 * worktree: `guardCheckout` (`./checkout-guard.ts`) reads `expected.checkout`
 * alone, and for a worktree run that is the worktree's directory, never the
 * project root.
 *
 * The task's stand-in session sleeps before it writes its tracked change,
 * the same window `checkout-guard-commits-integration.test.ts` and
 * `checkout-guard-worktree-integration.test.ts` use to disrupt a run mid
 * task; here it is used instead to check out another branch in the MAIN
 * checkout — the directory `bun src/rafa.ts` was spawned in — while that
 * session still runs in the worktree, standing in for someone working on
 * something else in the project's own directory while a parallel run holds
 * a worktree beside it. Since the run's checkout is the worktree, never the
 * main checkout, the switch never trips the guard: the task's session
 * finishes, `commitTaskWork` lands its commit on the worktree exactly as
 * `worktree-start-integration.test.ts` shows it does with nothing
 * disrupting it, and the main checkout is left exactly where the switch put
 * it, never reverted — the guard's own contract, `checkout-guard.ts`'s
 * module note says, is to never switch a checkout back.
 *
 * `checkout-guard.ts`'s own module note already documents `--show-toplevel`
 * reading the MAIN checkout from inside a worktree whose own `.git` file
 * was removed, which is the `foreign` case, not this one — this file's
 * branch switch happens in a checkout `guardCheckout` is never even asked
 * to read, so no `CheckoutReading` of the main checkout is produced at all.
 * `checkout-guard-incident-integration.test.ts` already proves the same
 * switch DOES halt a run when the checkout switched really is the run's
 * own, in a main-checkout (non-worktree) loop; this file is that case's
 * mirror image, proving the same switch changes nothing when the run's own
 * checkout is a worktree elsewhere.
 */
import type { ScratchRepo } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config-schema.js';
import { readSessions } from '../loop/sessions.js';
import { plantScratchRepo } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { CHECKOUT_MOVED } from './checkout-guard.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long the stand-in sleeps per call, in whole seconds: a window to switch branches in the main checkout mid-session. */
const STAND_IN_DELAY_SECONDS = 2;

/** How long a case may wait for a condition to hold, or the spawned run to finish. */
const RUN_TIMEOUT = 90_000;

/** The plan's stub, naming the run's branch `feat/<stub>` and the worktree's directory. */
const STUB = 'checkout-guard-worktree-branch-switch';

/** The branch the worktree run holds. */
const BRANCH = `feat/${STUB}`;

/** The branch checked out in the main checkout mid-task, standing in for unrelated work happening there. */
const OTHER_BRANCH = 'other-work';

/** Where the plan sits, relative to the project root. */
const PLAN_REL = join('.plans', `PLAN-${STUB}.md`);

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The plan's one task: its worktree session runs while the main checkout switches branches. */
const TASK = 'Write the worktree task\'s own tracked change while main switches branches';

/** The plan, one task, no more. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${TASK}\n`;

/** The tracked file the stand-in's session writes into the worktree, committed as the task's own work. */
const MARKER_FILE = 'worktree-task-output.txt';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checkout-guard-worktree-branch-switch-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Runs git in `cwd` under `scratch`'s isolated identity, no gpg signing, and answers its trimmed stdout. */
function git(scratch: ScratchRepo, cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: scratch.home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
    },
  ).trim();
}

/** The branch checked out in `cwd`, `scratch`'s repository by default. */
function currentBranch(scratch: ScratchRepo, cwd: string = scratch.repo): string {
  return git(scratch, cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
}

/** How many commits `HEAD` in `cwd` carries. */
function commitCount(scratch: ScratchRepo, cwd: string): number {
  return Number(git(scratch, cwd, 'rev-list', '--count', 'HEAD'));
}

/** Where `--as-worktree` adds the plan's worktree, under the default `loop.worktreeDir`. */
function worktreePathFor(scratch: ScratchRepo): string {
  return join(scratch.repo, CONFIG_DEFAULTS.loopWorktreeDir, STUB);
}

/** A bare repository at `path`, standing in for `origin`, under `scratch`'s isolated identity. */
function initBareOrigin(scratch: ScratchRepo, path: string): void {
  execFileSync('git', ['init', '-q', '--bare', path], {
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/**
 * Writes the stand-in `claude` into `scratch`'s `bin/`. It drains its
 * prompt, sleeps {@link STAND_IN_DELAY_SECONDS} — a window to switch the
 * MAIN checkout to {@link OTHER_BRANCH} while it holds the task's session
 * inside the worktree — then writes {@link MARKER_FILE} into its `cwd` (the
 * worktree), logs the call, and answers a `rafa:report` naming the task
 * done. A second call (which the halt this file proves must never happen)
 * would append a second `called` line; the call log is what tells the two
 * apart.
 */
function plantWorktreeStandIn(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `/bin/sleep ${STAND_IN_DELAY_SECONDS}`,
    `printf 'written by the worktree task\\n' > '${MARKER_FILE}'`,
    `echo called >> '${scratch.callLog}'`,
    'cat <<\'REPORT_EOF\'',
    '```rafa:report',
    'status: done',
    'feedback: "the stand-in wrote its edit while main switched branches"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    '```',
    'REPORT_EOF',
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/**
 * A scratch project on its initial branch, one commit, a bare `origin`
 * holding that same branch, the plan at {@link PLAN_REL} and the stand-in
 * `claude`. `.plans/`, `.rafa/` and `progress.txt` are gitignored, as a
 * real project's are.
 */
function plant(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  const originPath = join(dirname(scratch.repo), 'origin.git');
  initBareOrigin(scratch, originPath);

  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  writeFileSync(join(scratch.repo, 'kept.txt'), 'kept\n', 'utf8');
  git(scratch, scratch.repo, 'add', '-A');
  git(scratch, scratch.repo, 'commit', '-q', '--no-verify', '-m', 'seed');

  const base = currentBranch(scratch);
  git(scratch, scratch.repo, 'remote', 'add', 'origin', originPath);
  git(scratch, scratch.repo, 'push', '-q', '-u', 'origin', base);

  // A second branch, cut from the same seed, for the main checkout to
  // switch to mid-task — standing in for unrelated work happening in the
  // project's own directory while the worktree run holds it elsewhere.
  git(scratch, scratch.repo, 'branch', OTHER_BRANCH);
  git(scratch, scratch.repo, 'checkout', '-q', base);

  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');

  plantWorktreeStandIn(scratch);
  return scratch;
}

/** Spawns `rafa loop start --as-worktree` over the planted plan, in the background, its streams ignored. */
function spawnLoopStart(scratch: ScratchRepo) {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== join(scratch.bin, 'claude')) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  return Bun.spawn(
    [process.execPath, RAFA_ENTRY, 'loop', 'start', `--plan=${PLAN_REL}`, '--as-worktree', '--no-ci-wait', '--inject=full'],
    {
      cwd: scratch.repo,
      env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
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

describe('the loop guard leaving the main checkout\'s own branch switches alone during a real --as-worktree run', () => {
  it('lands the task commit on the worktree while main switches branches, never halting and never reverting the switch', async () => {
    const scratch = plant();
    const base = currentBranch(scratch);
    const worktreePath = worktreePathFor(scratch);

    const proc = spawnLoopStart(scratch);
    try {
      // The task dispatches, its stand-in session still draining its
      // prompt and about to sleep; this is the window to switch the MAIN
      // checkout to `other-work`, standing in for someone working on
      // something else in the project's own directory while this run
      // holds a worktree beside it.
      await waitForTask(scratch.repo, TASK);
      git(scratch, scratch.repo, 'switch', '-q', OTHER_BRANCH);
      expect(currentBranch(scratch)).toBe(OTHER_BRANCH);

      // The worktree's commit count rises from the one commit
      // `origin/<base>` carried to two only once the task session has
      // returned and `commitTaskWork` has run over its change — proving
      // the run went on to commit rather than halting on the switch.
      await waitUntil(() => {
        if (!existsSync(join(worktreePath, '.git'))) return null;
        return commitCount(scratch, worktreePath) > 1
          ? true
          : null;
      }, RUN_TIMEOUT);

      expect(currentBranch(scratch, worktreePath)).toBe(BRANCH);
      const changedFiles = git(scratch, worktreePath, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
      expect(changedFiles.split('\n')).toContain(MARKER_FILE);
      expect(existsSync(join(worktreePath, MARKER_FILE))).toBe(true);
      expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');

      const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
      const tracker = readFileSync(trackerPath, 'utf8');
      expect(tracker).toContain(`- [x] ${TASK}`);
      expect(tracker).not.toContain(CHECKOUT_MOVED);

      // The MAIN checkout: left exactly where the switch put it, never
      // reverted — the guard's own contract, and here it was never even
      // asked to look, since the run's own checkout is the worktree.
      expect(currentBranch(scratch)).toBe(OTHER_BRANCH);
      expect(git(scratch, scratch.repo, 'status', '--porcelain')).toBe('');
      expect(base).not.toBe(OTHER_BRANCH);
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});
