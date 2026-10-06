/**
 * `rafa loop start --as-worktree` spawned end to end, proving the loop
 * guard `dispatchTask` runs immediately before a session's spawn
 * (`./dispatch.ts`) catches a worktree removed AFTER the pre-dispatch
 * guard in `src/start.ts` has passed, rather than letting the spawn throw
 * `ENOENT: posix_spawn 'claude'` (#585).
 *
 * The seam between the two guards is not the suite step itself: the
 * baseline's `bun test` runs before `renderProgressForDispatch` writes
 * `progress.txt` into the checkout, so a checkout removed there stops the
 * run on that render (`progress.txt could not be rendered`), never
 * reaching the guard this file is about. The first call the run makes into
 * the checkout after that render is `readAlwaysRunFiles`' `git ls-files
 * -z` (`./task-gate-lines.ts`), made while the task's dispatch options
 * are built. The scratch `bin/` holds a `git` wrapper: it runs the real
 * `git` over the same arguments, and when that is the `ls-files -z` read
 * made from the worktree, removes the worktree whole afterwards. The
 * baseline has passed, the progress file is rendered, the pre-dispatch
 * guard has held, and `dispatchTask`'s own guard finds the checkout gone.
 *
 * Three facts: the tracker line reads `[BLOCKED]` with the checkout
 * guard's blocker, the run's output carries no `ENOENT: posix_spawn`
 * (and the stand-in `claude` was never called), and the run's events file
 * holds a `halt` event whose reason is `checkout moved`.
 * `checkout-guard-worktree-integration.test.ts` is the sibling that
 * removes the worktree mid-session instead.
 */
import type { ScratchRepo } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config-schema.js';
import { plantScratchRepo } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { CHECKOUT_MOVED } from './checkout-guard.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long the spawned run may take: one real `bun test` of a one-test project. */
const RUN_TIMEOUT = 90_000;

/** The plan's stub, naming the branch `feat/<stub>` and the worktree's directory. */
const STUB = 'checkout-guard-before-spawn';

/** Where the plan sits, relative to the project root. */
const PLAN_REL = join('.plans', `PLAN-${STUB}.md`);

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The plan's only task: its session must never be spawned. */
const TASK = 'Never spawned: the worktree is gone before the session starts';

/** The refusal this file proves the run never reaches. */
const SPAWN_CRASH = 'ENOENT: posix_spawn';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checkout-guard-before-spawn-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Runs git in `cwd` under `scratch`'s isolated identity, no gpg signing. */
function git(scratch: ScratchRepo, cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, HOME: scratch.home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
    },
  );
}

/** Where `--as-worktree` adds the plan's worktree, under the default `loop.worktreeDir`. */
function worktreePathFor(scratch: ScratchRepo): string {
  return join(scratch.repo, CONFIG_DEFAULTS.loopWorktreeDir, STUB);
}

/**
 * Writes the `git` wrapper into `scratch`'s `bin/`: the real `git` over the
 * same arguments, then, once the call is `ls-files -z` run from `worktree`,
 * the worktree's removal. The real exit code and output are kept.
 */
function plantGitWrapper(scratch: ScratchRepo, realGit: string, worktree: string): void {
  const wrapper = join(scratch.bin, 'git');
  writeFileSync(wrapper, [
    '#!/bin/sh',
    `if [ "$1" = ls-files ] && [ "$2" = -z ] && [ "$PWD" = '${worktree}' ]; then`,
    `  '${realGit}' "$@"`,
    '  code=$?',
    '  cd /',
    `  rm -rf '${worktree}'`,
    '  exit $code',
    'fi',
    `exec '${realGit}' "$@"`,
    '',
  ].join('\n'), 'utf8');
  chmodSync(wrapper, 0o755);
}

/** Writes a stand-in `claude` that logs any call it gets: the run must make none. */
function plantClaude(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo called >> '${scratch.callLog}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** A scratch project with a one-test suite, a one-task plan and the stand-ins. */
function plant(realGit: string): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  writeFileSync(
    join(scratch.repo, 'ok.test.ts'),
    'import { expect, test } from \'bun:test\';\n\ntest(\'ok\', () => {\n  expect(1).toBe(1);\n});\n',
    'utf8',
  );
  git(scratch, scratch.repo, 'add', '-A');
  git(scratch, scratch.repo, 'commit', '-q', '--no-verify', '-m', 'seed');

  // `--as-worktree` cuts the branch from a fresh `origin/<base>`.
  const originPath = join(dirname(scratch.repo), 'origin.git');
  git(scratch, scratch.home, 'init', '-q', '--bare', originPath);
  const base = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: scratch.repo, encoding: 'utf8' }).trim();
  git(scratch, scratch.repo, 'remote', 'add', 'origin', originPath);
  git(scratch, scratch.repo, 'push', '-q', '-u', 'origin', base);

  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, PLAN_REL), `# Plan: ${STUB}\n\n- [ ] ${TASK}\n`, 'utf8');

  plantClaude(scratch);
  plantGitWrapper(scratch, realGit, worktreePathFor(scratch));
  return scratch;
}

/** The `name` and `data.reason` of each line of the events file under `repo`'s runs folder. */
function haltReasons(repo: string): readonly (string | undefined)[] {
  const runs = join(repo, '.rafa', 'runs');
  return readdirSync(runs)
    .filter((name) => name.endsWith('.events.ndjson'))
    .flatMap((name) => readFileSync(join(runs, name), 'utf8').split('\n'))
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { name?: string; data?: { reason?: string } })
    .filter((event) => event.name === 'halt')
    .map((event) => event.data?.reason);
}

describe('the loop guard just before the session spawn, in a real --as-worktree run', () => {
  it('blocks the task and spawns nothing when the worktree is removed after the pre-dispatch guard', () => {
    const realBun = Bun.which('bun');
    if (realBun === null) throw new Error('bun is not on the PATH this suite runs under');
    const realGit = Bun.which('git', { PATH: plantScratchRepo(tempBase).path });
    if (realGit === null) throw new Error('git is not on the PATH this suite runs under');
    const scratch = plant(realGit);
    const worktree = worktreePathFor(scratch);
    const path = [scratch.path, dirname(realBun)].join(delimiter);

    const run = Bun.spawnSync(
      [process.execPath, RAFA_ENTRY, 'loop', 'start', `--plan=${PLAN_REL}`, '--as-worktree', '--no-ci-wait', '--inject=full'],
      {
        cwd: scratch.repo,
        env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: path, ...scratchHomeEnv(scratch.home) },
        timeout: RUN_TIMEOUT,
      },
    );
    const stdout = run.stdout.toString();
    const stderr = run.stderr.toString();

    // The wrapper ran, so the worktree is gone and nothing recreated it.
    expect(existsSync(worktree)).toBe(false);

    const tracker = readFileSync(join(scratch.repo, '.plans', TRACKER_NAME), 'utf8');
    expect(tracker).toContain(`- [BLOCKED] ${TASK}  <!-- blocked: ${CHECKOUT_MOVED} -->`);

    expect(stdout + stderr).not.toContain(SPAWN_CRASH);
    expect(existsSync(scratch.callLog)).toBe(false);
    expect(haltReasons(scratch.repo)).toEqual(['checkout moved']);
  }, RUN_TIMEOUT + 30_000);
});
