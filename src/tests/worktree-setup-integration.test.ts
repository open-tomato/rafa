/**
 * `loop.worktreeSetup` run by the real CLI: `bun src/rafa.ts loop start
 * --as-worktree` spawned over a scratch git repository with a bare `origin`,
 * started twice over the same plan.
 *
 * `packages/rafa-run/src/start/worktree-setup.test.ts` drives the runner over a real shell and
 * `src/tests/run-coupled/start/run-checkout.test.ts` pins where `settleRunCheckout` calls it,
 * both over seams. Neither proves the command spawned: that the key reaches
 * the step through the config, that the command runs in the worktree and
 * not the main checkout, that it runs again on the start that reuses the
 * worktree, and that it runs before the first session.
 *
 * The scratch project's `.rafa/config.yaml` is `projectConfigText()` with a
 * `loop:` section appended, `worktreeSetup: echo run >> setup-marker.txt`.
 * The marker is gitignored beside `.plans/`, so no task commit takes it and
 * the main checkout's `git status --porcelain` stays empty. The stand-in
 * `claude` is the restart test's, plus one line logging whether the marker
 * exists in its working directory at each call; the first call finding it
 * proves the command ran before the first session.
 *
 * The first start ends on its blocked second task, the worktree holding one
 * marker line. The second start, run after a release file is planted, is
 * killed once task two's commit lands: the marker then holds two lines, the
 * worktree listing is unchanged, and the main checkout holds no marker at
 * either point.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';

import { CONFIG_DEFAULTS } from '../config-registry.js';
import { projectConfigText } from '../project/scaffold.js';

import { describeRun, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** The CLI entry the second start spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long the whole case, both runs included, may take. */
const RUN_TIMEOUT = { timeout: 90_000 };

/** How long task two's commit may take to land before this file gives up waiting for it. */
const POLL_TIMEOUT_MS = 45_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-setup-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The plan's stub, naming the branch `feat/<stub>` and the worktree's directory. */
const STUB = 'rafa-1347-setup-probe';

/** The branch {@link STUB} names. */
const BRANCH = `feat/${STUB}`;

/** The plan's first task, which the first run completes. */
const FIRST_TASK = 'Write the first probe file';

/** The plan's second task, which the first run fails and the second run completes. */
const SECOND_TASK = 'Write the second probe file';

/** The plan, two tasks. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${FIRST_TASK}\n- [ ] ${SECOND_TASK}\n`;

/** Where the plan sits, relative to the project root. */
const PLAN_REL = join('.plans', `PLAN-${STUB}.md`);

/** The flags both starts run under. */
const START_ARGS = ['loop', 'start', `--plan=${PLAN_REL}`, '--as-worktree', '--no-ci-wait'];

/** The file the setup command appends one line to, relative to its working directory. */
const MARKER = 'setup-marker.txt';

/** The setup command, as the project config states it: unquoted, so the shell reads the line as written. */
const SETUP_COMMAND = `echo run >> ${MARKER}`;

/** The project config: the scaffold's text with a `loop:` section naming {@link SETUP_COMMAND}. */
function setupConfigText(): string {
  return `${projectConfigText()}loop:\n  worktreeSetup: ${SETUP_COMMAND}\n`;
}

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

/** The paths `git worktree list --porcelain` lists, main checkout first. */
function worktreePaths(scratch: ScratchRepo): string[] {
  return git(scratch, scratch.repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

/** How many commits `HEAD` in `cwd` carries. */
function commitCount(scratch: ScratchRepo, cwd: string): number {
  return Number(git(scratch, cwd, 'rev-list', '--count', 'HEAD'));
}

/** Where `--as-worktree` adds the plan's worktree, under the default `loop.worktreeDir`. */
function worktreePathFor(scratch: ScratchRepo): string {
  return join(scratch.repo, CONFIG_DEFAULTS.loopWorktreeDir, STUB);
}

/** The file whose presence lets the stand-in's second session succeed. */
function releaseFileFor(scratch: ScratchRepo): string {
  return join(scratch.home, 'release');
}

/** The file the stand-in logs, per call, whether the marker was in its working directory. */
function markerLogFor(scratch: ScratchRepo): string {
  return join(scratch.home, 'marker-seen.log');
}

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/`: it drains its
 * prompt, logs its working directory and whether {@link MARKER} exists
 * there. Its first session writes `probe-1.txt` and answers a `rafa:report`
 * naming the task done. Any later one fails with exit 1 until the release
 * file exists, and then writes `probe-<n>.txt`.
 */
function plantSetupClaude(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo "called $PWD" >> '${scratch.callLog}'`,
    `if [ -e '${MARKER}' ]; then echo "marker present" >> '${markerLogFor(scratch)}'; else echo "marker absent" >> '${markerLogFor(scratch)}'; fi`,
    'count=$(ls probe-*.txt 2>/dev/null | wc -l)',
    `if [ "$count" -gt 0 ] && [ ! -e '${releaseFileFor(scratch)}' ]; then exit 1; fi`,
    'next=$((count + 1))',
    'printf \'written by the setup probe\\n\' > "probe-$next.txt"',
    'cat <<\'REPORT_EOF\'',
    '```rafa:report',
    'status: done',
    'feedback: "the stand-in wrote a probe file"',
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
 * holding that same branch, the two-task plan at {@link PLAN_REL}, the
 * `loop.worktreeSetup` config and the stand-in `claude`. `.plans/`,
 * `.rafa/`, `progress.txt` and the marker are gitignored.
 */
function plantSetupScratch(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  plantProjectConfig(scratch.repo, setupConfigText());
  const originPath = join(dirname(scratch.repo), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', originPath], {
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });

  git(scratch, scratch.repo, 'config', 'user.name', 'Rafa Loop');
  git(scratch, scratch.repo, 'config', 'user.email', 'loop@example.test');
  git(scratch, scratch.repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(scratch.repo, '.gitignore'), `.plans/\n.rafa/\nprogress.txt\n${MARKER}\n`, 'utf8');
  writeFileSync(join(scratch.repo, 'kept.txt'), 'kept\n', 'utf8');
  git(scratch, scratch.repo, 'add', '-A');
  git(scratch, scratch.repo, 'commit', '-q', '--no-verify', '-m', 'seed');

  const base = git(scratch, scratch.repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(scratch, scratch.repo, 'remote', 'add', 'origin', originPath);
  git(scratch, scratch.repo, 'push', '-q', '-u', 'origin', base);
  // The run reads its base from origin/HEAD, which a bare clone-less remote add leaves unset.
  git(scratch, scratch.repo, 'remote', 'set-head', 'origin', base);

  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, PLAN_REL), PLAN, 'utf8');

  plantSetupClaude(scratch);
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

/** The lines the setup command left in the marker under `dir`; none when the marker is absent. */
function markerLines(dir: string): string[] {
  const file = join(dir, MARKER);
  return existsSync(file)
    ? readFileSync(file, 'utf8').split('\n')
      .filter((line) => line !== '')
    : [];
}

/** What the stand-in logged about the marker, one entry per session call. */
function markerSightings(scratch: ScratchRepo): string[] {
  const log = markerLogFor(scratch);
  return existsSync(log)
    ? readFileSync(log, 'utf8').split('\n')
      .filter((line) => line !== '')
    : [];
}

/** Spawns the second `rafa loop start --as-worktree` in the background, its streams ignored. */
function spawnSecondStart(scratch: ScratchRepo) {
  return Bun.spawn([process.execPath, RAFA_ENTRY, ...START_ARGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

describe('rafa loop start --as-worktree, with loop.worktreeSetup set', () => {
  it('runs the setup in the worktree on the first start and again on the restart, never in the main checkout', async () => {
    const scratch = plantSetupScratch();
    const worktreePath = worktreePathFor(scratch);

    const first = runRafa(scratch, scratch.repo, START_ARGS);
    expect(`${first.stdout}${first.stderr}`, describeRun(first, scratch)).toContain('Task failed (exit 1). Marked as blocked.');
    expect(existsSync(join(worktreePath, 'probe-1.txt'))).toBe(true);
    expect(markerLines(worktreePath)).toEqual(['run']);
    expect(markerSightings(scratch)[0]).toBe('marker present');
    expect(existsSync(join(scratch.repo, MARKER))).toBe(false);
    expect(git(scratch, scratch.repo, 'status', '--porcelain')).toBe('');

    const listingBefore = worktreePaths(scratch);
    expect(listingBefore).toEqual([scratch.repo, worktreePath]);
    const commitsBefore = commitCount(scratch, worktreePath);
    writeFileSync(releaseFileFor(scratch), 'release\n', 'utf8');

    const proc = spawnSecondStart(scratch);
    try {
      await waitUntil(() => commitCount(scratch, worktreePath) > commitsBefore
        ? true
        : null, POLL_TIMEOUT_MS);

      expect(markerLines(worktreePath)).toEqual(['run', 'run']);
      expect(markerSightings(scratch)[2]).toBe('marker present');
      expect(git(scratch, worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
      expect(worktreePaths(scratch)).toEqual(listingBefore);
      expect(existsSync(join(scratch.repo, MARKER))).toBe(false);
      expect(git(scratch, scratch.repo, 'status', '--porcelain')).toBe('');
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});
