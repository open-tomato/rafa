/**
 * A spawned test of the since-last-command notice: the real `bun
 * src/rafa.ts`, run in a scratch project with one commit on `main`.
 *
 * The plain command is `plan list`: it runs inside a project, spends
 * nothing and is neither `status` nor `cleanup`. A worktree under
 * `.claude/worktrees/` goes idle when the times of its directory and of
 * its `HEAD`, `logs/HEAD` and `index` (the files `src/cleanup/worktrees.ts`
 * reads) are set past `cleanup.worktreeIdleDays`.
 *
 * Held here: a first command prints no notice and writes
 * `.rafa/status-seen.json`; a second with nothing new prints nothing; the
 * crossing prints exactly one line naming `rafa cleanup`, once; the same
 * crossing under `--output=json` prints none; `status.notice: false`
 * prints none; the hook makes no network call (`gh` and `git` wrappers on
 * the PATH log every argv, `origin` is unreachable).
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { NOTICE_PREFIX } from '../status/notice.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 120_000 };

const IDLE_DAYS = 7;
const AGE_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const PLAIN = ['plan', 'list'];
const SEEN_PATH = join('.rafa', 'status-seen.json');
const WORKTREE_NAME = 'idle-probe';

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-notice-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** Runs git in `cwd` under the scratch home, answering its trimmed stdout. */
function git(scratch: ScratchRepo, cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    env: {
      PATH: scratch.path,
      HOME: scratch.home,
      GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Probe',
      GIT_AUTHOR_EMAIL: 'probe@example.com',
      GIT_COMMITTER_NAME: 'Probe',
      GIT_COMMITTER_EMAIL: 'probe@example.com',
    },
  }).trim();
}

/** A scratch project with one commit on `main`, `status.notice` as given. */
function plantWorld(notice = true): ScratchRepo {
  const scratch = plantScratchRepo(scratchBase);
  const { repo } = scratch;
  plantProjectConfig(repo, [
    'cleanup:',
    `  worktreeIdleDays: ${String(IDLE_DAYS)}`,
    'status:',
    `  notice: ${String(notice)}`,
    '',
  ].join('\n'));
  git(scratch, repo, ['checkout', '-q', '-B', 'main']);
  writeFileSync(join(repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(repo, '.gitignore'), '.rafa/\n.claude/\n', 'utf8');
  git(scratch, repo, ['add', '-A']);
  git(scratch, repo, ['commit', '-q', '-m', 'initial']);
  return scratch;
}

/** Adds a worktree under `.claude/worktrees/`, answering its path. Recent until {@link ageWorktree}. */
function addWorktree(scratch: ScratchRepo): string {
  const path = join(scratch.repo, '.claude', 'worktrees', WORKTREE_NAME);
  mkdirSync(dirname(path), { recursive: true });
  git(scratch, scratch.repo, ['worktree', 'add', '-q', '-b', 'wt/idle-probe', path]);
  return path;
}

/** Sets the times of the worktree's directory, `HEAD`, `logs/HEAD` and `index` past the idle days. */
function ageWorktree(scratch: ScratchRepo, path: string): void {
  const gitDir = git(scratch, path, ['rev-parse', '--absolute-git-dir']);
  const old = new Date(Date.now() - AGE_DAYS * MS_PER_DAY);
  for (const file of [path, join(gitDir, 'HEAD'), join(gitDir, 'logs', 'HEAD'), join(gitDir, 'index')]) {
    utimesSync(file, old, old);
  }
}

/** The stderr lines carrying the notice. */
function noticeLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.includes(NOTICE_PREFIX));
}

describe('the since-last-command notice, spawned', () => {
  it('prints no notice on a first command and writes the snapshot', RUN_TIMEOUT, () => {
    const scratch = plantWorld();

    const run = runRafa(scratch, scratch.repo, PLAIN);

    expect(run.exitCode).toBe(0);
    expect(noticeLines(run.stderr)).toEqual([]);
    expect(existsSync(join(scratch.repo, SEEN_PATH))).toBe(true);
  });

  it('prints nothing on a second command with nothing new', RUN_TIMEOUT, () => {
    const scratch = plantWorld();
    runRafa(scratch, scratch.repo, PLAIN);

    const run = runRafa(scratch, scratch.repo, PLAIN);

    expect(run.exitCode).toBe(0);
    expect(noticeLines(run.stderr)).toEqual([]);
  });

  it('prints one line naming rafa cleanup when a worktree goes idle, and none after it', RUN_TIMEOUT, () => {
    const scratch = plantWorld();
    const worktree = addWorktree(scratch);
    runRafa(scratch, scratch.repo, PLAIN);
    ageWorktree(scratch, worktree);

    const crossing = runRafa(scratch, scratch.repo, PLAIN);
    const after = runRafa(scratch, scratch.repo, PLAIN);

    expect(crossing.exitCode).toBe(0);
    const lines = noticeLines(crossing.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('1 worktree went idle');
    expect(lines[0]).toContain('rafa cleanup');
    expect(noticeLines(after.stderr)).toEqual([]);
  });

  it('prints no line under --output=json when a worktree goes idle', RUN_TIMEOUT, () => {
    const scratch = plantWorld();
    const worktree = addWorktree(scratch);
    runRafa(scratch, scratch.repo, PLAIN);
    ageWorktree(scratch, worktree);

    const run = runRafa(scratch, scratch.repo, [...PLAIN, '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(noticeLines(run.stderr)).toEqual([]);
    expect(noticeLines(run.stdout)).toEqual([]);
  });

  it('prints none with status.notice false', RUN_TIMEOUT, () => {
    const scratch = plantWorld(false);
    const worktree = addWorktree(scratch);
    runRafa(scratch, scratch.repo, PLAIN);
    ageWorktree(scratch, worktree);

    const run = runRafa(scratch, scratch.repo, PLAIN);

    expect(run.exitCode).toBe(0);
    expect(noticeLines(run.stderr)).toEqual([]);
    expect(existsSync(join(scratch.repo, SEEN_PATH))).toBe(false);
  });

  it('makes no network call: no gh call, no git fetch, ls-remote, pull or push', RUN_TIMEOUT, () => {
    const scratch = plantWorld();
    git(scratch, scratch.repo, ['remote', 'add', 'origin', 'https://unreachable.invalid/none.git']);
    const realGit = Bun.which('git');
    if (realGit === null) throw new Error('git is not on the PATH this suite runs under');
    const log = join(scratch.home, 'argv.log');
    for (const [name, body] of [['gh', 'exit 1'], ['git', `exec '${realGit}' "$@"`]] as const) {
      const file = join(scratch.bin, name);
      writeFileSync(file, [
        '#!/bin/sh',
        `printf '%s' '${name}' >> '${log}'`,
        `for a in "$@"; do printf ' %s' "$a" >> '${log}'; done`,
        `printf '\\n' >> '${log}'`,
        body,
        '',
      ].join('\n'), 'utf8');
      chmodSync(file, 0o755);
    }

    const first = runRafa(scratch, scratch.repo, PLAIN);
    const second = runRafa(scratch, scratch.repo, PLAIN);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const calls = readFileSync(log, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(calls.some((line) => line.startsWith('git '))).toBe(true);
    expect(calls.filter((line) => line.startsWith('gh'))).toEqual([]);
    expect(calls.filter((line) => /\s(fetch|ls-remote|pull|push)(\s|$)/.test(line))).toEqual([]);
  });
});
