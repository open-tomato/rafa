/**
 * `rafa loop start --as-worktree` run to a real task commit, spawned as
 * `bun src/rafa.ts loop start` through a real git repository with a bare
 * `origin` — the success path `worktree-start-refusals-integration.test.ts`
 * deliberately never reaches, since every one of its cases stops before
 * any session runs.
 *
 * `src/start/worktree.test.ts` already pins `addRunWorktree`'s argv and
 * refusals over a stubbed `GitRunner`, and `src/start/run-checkout.test.ts`
 * pins that `--as-worktree` settles the checkout to the worktree's path
 * with seams standing in for git. Neither proves the ONE thing this file
 * does: that a real task session, dispatched with the worktree as its
 * `cwd`, has its tracked change committed there by the real
 * `commitTaskWork` (`start/commit.ts`) — on `feat/<stub>`, cut from a
 * freshly fetched `origin/<base>` — while the MAIN checkout, the
 * directory `bun src/rafa.ts` was spawned in, never moves off the branch
 * it started on and never gains so much as an untracked file.
 *
 * A single-task plan is run in the background so the loop can be killed
 * once the worktree's commit is observed, rather than waited out through
 * the wrap-up session `--as-worktree` also runs in that same worktree:
 * `loop-sessions.test.ts` already runs a stand-in loop to a clean exit
 * elsewhere, and reaching one here would only add the wrap-up's own git
 * traffic (a merge with `origin/main`, a push, a `gh pr create` the
 * stand-in never makes) without proving anything more about the worktree
 * itself. `finishRelease` (`start/release-stage.ts`) commits nothing for
 * a `preparation` of `null` or `skipped`, which is what a repository with
 * no `package.json` and no `CHANGELOG.md` always answers, so the task's
 * commit stays the worktree's `HEAD` for as long as this file keeps
 * looking at it.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config-schema.js';

import { plantScratchRepo } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { scratchHomeEnv } from './scratch-home-env.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long the whole case, background run included, may take. */
const RUN_TIMEOUT = { timeout: 60_000 };

/** How long the worktree's commit may take to land before this file gives up waiting for it. */
const POLL_TIMEOUT_MS = 45_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-start-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The plan's stub, naming the branch `feat/<stub>` and the worktree's directory. */
const STUB = 'rafa-370-worktree-probe';

/** The branch {@link STUB} names. */
const BRANCH = `feat/${STUB}`;

/** The plan's one task. */
const TASK = 'Write the worktree probe file';

/** The plan, one task, no more. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${TASK}\n`;

/** Where the plan sits, relative to the project root. */
const PLAN_REL = join('.plans', `PLAN-${STUB}.md`);

/** The tracked file the stand-in task session writes, committed as the task's own work. */
const MARKER_FILE = 'worktree-task-output.txt';

/** Runs git in `cwd` under `scratch`'s isolated identity, no gpg signing, and answers its trimmed stdout. */
function git(scratch: ScratchRepo, cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
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
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/`: it drains its
 * prompt, writes {@link MARKER_FILE} — a tracked change `commitTaskWork`
 * finds waiting once the task session returns — logs the call, and
 * answers a `rafa:report` naming the task done, whichever session it was
 * called for. Nothing here runs a real `git`, so the wrap-up's own
 * commit, merge and push never happen; see the module note.
 */
function plantWorktreeClaude(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `printf 'written by the worktree task\\n' > '${MARKER_FILE}'`,
    `echo called >> '${scratch.callLog}'`,
    'cat <<\'REPORT_EOF\'',
    '```rafa:report',
    'status: done',
    'feedback: "the stand-in wrote the worktree probe file"',
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
 * real project's are, so nothing the run reads or writes under them ever
 * shows as untracked in `git status`.
 */
function plantWorktreeScratch(): ScratchRepo {
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

  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');

  plantWorktreeClaude(scratch);
  return scratch;
}

/** Polls `read` every `pollMs` until it answers other than null, or throws past `timeoutMs`. */
async function waitUntil<T>(read: () => T | null, timeoutMs: number, pollMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for a condition to hold');
    await Bun.sleep(pollMs);
  }
}

/** Spawns `rafa loop start --as-worktree` over the planted plan, in the background, its streams ignored. */
function spawnLoopStart(scratch: ScratchRepo) {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== join(scratch.bin, 'claude')) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  return Bun.spawn(
    [process.execPath, RAFA_ENTRY, 'loop', 'start', `--plan=${PLAN_REL}`, '--as-worktree', '--no-ci-wait'],
    {
      cwd: scratch.repo,
      env: { PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
}

describe('rafa loop start --as-worktree, spawned over a real git repository', () => {
  it('lands the task commit on feat/<stub> in the worktree, leaving the main checkout exactly as it was', async () => {
    const scratch = plantWorktreeScratch();
    const base = currentBranch(scratch);
    const baseHead = git(scratch, scratch.repo, 'rev-parse', 'HEAD');
    const worktreePath = worktreePathFor(scratch);

    const proc = spawnLoopStart(scratch);
    try {
      // The worktree's commit count rises from the one commit `origin/<base>`
      // carried to two only once the task session has returned and
      // `commitTaskWork` has run over its change.
      await waitUntil(() => {
        if (!existsSync(join(worktreePath, '.git'))) return null;
        return commitCount(scratch, worktreePath) > 1
          ? true
          : null;
      }, POLL_TIMEOUT_MS);

      expect(currentBranch(scratch, worktreePath)).toBe(BRANCH);
      const changedFiles = git(scratch, worktreePath, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
      expect(changedFiles.split('\n')).toContain(MARKER_FILE);
      expect(existsSync(join(worktreePath, MARKER_FILE))).toBe(true);

      // The main checkout: never switched, never behind or ahead of where it started.
      expect(currentBranch(scratch)).toBe(base);
      expect(git(scratch, scratch.repo, 'rev-parse', 'HEAD')).toBe(baseHead);
      expect(git(scratch, scratch.repo, 'status', '--porcelain')).toBe('');
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});
