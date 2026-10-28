/**
 * `rafa loop start` on a detached HEAD, spawned end to end through the
 * planter of `src/tests/loop-scratch.ts` in a repository whose `origin`
 * is a bare remote: the branch a run creates is cut from `origin/<base>`,
 * so the remote has to be there.
 *
 * Three cases, each on a HEAD left detached by `git switch --detach`:
 *
 *  - no flag: the run is refused with exit code 1, the refusal names
 *    `--create-branch`, HEAD has not moved and `.rafa/runs/` holds no
 *    record;
 *  - `--any-branch` alone: the same refusal, the flag waives which branch
 *    the run is on and never that it is on one;
 *  - `--create-branch`: the run's record names `feat/probe`, the checkout
 *    stands on `feat/probe`, and no record holds `HEAD` as a branch.
 *
 * `PLAN_OPEN` is stubbed `probe`, so the branch the offer creates is
 * `feat/probe`.
 */
import type { Scratch } from '../tests/loop-scratch.js';

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { RUNS_DIR, readSessions } from '@open-tomato/rafa/core/loop';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';

import { describeRun } from '../tests/cli-capture.js';
import { PLAN_FLAG, PLAN_OPEN, RUN_TIMEOUT, STUB, runLoopStart, scratchPlanter } from '../tests/loop-scratch.js';

/** The branch the run is based on. */
const BASE = 'main';

/** The branch a run on the stub creates. */
const CREATED = `feat/${STUB}`;

/** The flag the refusal has to name. */
const CREATE_BRANCH = '--create-branch';

/** The flags every run carries: the plan, and no wait on a CI that does not exist. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait'];

/** The config of a run with no provider to reach, so the wrap-up opens no pull request. */
const CONFIG_NONE = 'pr:\n  provider: none\n';

const planter = scratchPlanter('rafa-detached-head-');
afterAll(() => {
  planter.remove();
});

/** Runs git in the scratch repository under its HOME and a fixed identity; answers trimmed stdout. */
function git(scratch: Scratch, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: scratch.repo,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', ...gitIdentityEnv() },
  }).trim();
}

/** A planted repository with a bare `origin` holding its base, its HEAD detached at the base's tip. */
function plantDetached(): Scratch {
  const scratch = planter.plant({ branch: BASE, plan: PLAN_OPEN, config: CONFIG_NONE });
  const remote = join(dirname(scratch.repo), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch', BASE, remote], { stdio: 'pipe' });
  git(scratch, 'remote', 'add', 'origin', remote);
  git(scratch, 'push', '-q', 'origin', BASE);
  git(scratch, 'fetch', '-q', 'origin');
  git(scratch, 'switch', '-q', '--detach');
  return scratch;
}

/** The names under `.rafa/runs/`, none when the folder was never made. */
function runRecords(scratch: Scratch): readonly string[] {
  const dir = join(scratch.repo, '.rafa', RUNS_DIR);
  return existsSync(dir)
    ? readdirSync(dir)
    : [];
}

/** Whether `text` holds `HEAD` as the value of a `branch` key. */
function holdsHeadBranch(text: string): boolean {
  return /"branch"\s*:\s*"HEAD"/.test(text);
}

describe('rafa loop start on a detached HEAD, with a bare remote', () => {
  for (const flags of [[], ['--any-branch']] as const) {
    const label = flags.length === 0
      ? 'no flag'
      : flags.join(' ');

    it(`refuses with exit code 1 naming ${CREATE_BRANCH}, moving nothing, under ${label}`, () => {
      const scratch = plantDetached();
      const headBefore = git(scratch, 'rev-parse', 'HEAD');

      const run = runLoopStart(scratch, 'text', [...RUN_FLAGS, ...flags]);

      expect(run.exitCode, describeRun(run, { ...scratch })).toBe(1);
      expect(run.stderr).toContain(CREATE_BRANCH);
      expect(git(scratch, 'rev-parse', 'HEAD')).toBe(headBefore);
      expect(git(scratch, 'branch', '--list', CREATED)).toBe('');
      expect(runRecords(scratch)).toEqual([]);
      expect(existsSync(scratch.callLog)).toBe(false);
    }, RUN_TIMEOUT);
  }

  it(`records ${CREATED} and stands on it under ${CREATE_BRANCH}, never recording HEAD as a branch`, () => {
    const scratch = plantDetached();

    const run = runLoopStart(scratch, 'text', [...RUN_FLAGS, CREATE_BRANCH]);

    const records = readSessions(scratch.repo);
    expect(records.length, describeRun(run, { ...scratch })).toBeGreaterThan(0);
    expect(records.map((record) => record.branch)).toEqual(records.map(() => CREATED));
    expect(git(scratch, 'symbolic-ref', '--short', 'HEAD')).toBe(CREATED);
    const dir = join(scratch.repo, '.rafa', RUNS_DIR);
    for (const name of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!name.isFile()) continue;
      const file = join(name.parentPath, name.name);
      expect(holdsHeadBranch(readFileSync(file, 'utf8')), file).toBe(false);
    }
  }, RUN_TIMEOUT);
});
