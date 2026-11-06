/**
 * What `rafa loop start` does about the project's `tsc` before anything
 * else, spawned as `bun src/rafa.ts loop start` through `runRafa` in
 * scratch projects under this file's temporary directory.
 *
 *   - Over a project holding `tsconfig.json` and a `node_modules/.bin/tsc`
 *     whose shebang names an interpreter missing from the PATH, it exits 1
 *     at once, well inside a `--start-at` deferral, prints the fix line
 *     naming that interpreter, writes no record under `.rafa/runs/` and
 *     spawns no `claude`.
 *   - The control, the same project with a tsc that prints
 *     `Version 5.9.3`, gets past the check to the preflight halt.
 *   - A project with no `tsconfig.json` is not read, so a refusing tsc
 *     also reaches the halt.
 *
 * Every run that gets past the check is made to halt at its preflight by
 * one required prerequisite whose probe exits 1, so no case needs a
 * session; a stand-in `claude` that logs its calls proves none was spawned.
 * The scratch HOME has both notices dismissed (`context/notices.md`).
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';

import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';

import { expectExit, plantProjectConfig, plantScratchRepo, plantStandInClaude, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 60_000 };

/** How long the deferral is, and how long a refusal may take against it. */
const DEFER_MINUTES = 2;
const REFUSAL_BUDGET_MS = 30_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-start-tsc-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const PLAN_FLAG = '--plan=.plans/PLAN-tsc.md';

/** The interpreter the refusing tsc's shebang names, found on no PATH. */
const MISSING_INTERPRETER = 'rafa-missing-interpreter';

/** The config every scratch project holds: no provider items, and one required item that fails. */
const CONFIG = [
  'pr:',
  '  provider: none',
  'prerequisites:',
  '  required:',
  '    - tool: needed',
  '      probe: \'exit 1\'',
  '',
].join('\n');

type TscKind = 'refusing' | 'working';

interface ProjectOptions {
  readonly tsconfig: boolean;
  readonly tsc: TscKind;
}

/** Runs git in the scratch repository under the scratch HOME alone. */
function git(scratch: ScratchRepo, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args], {
    cwd: scratch.repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/** Plants a scratch project on a feature branch; see the module note. */
function plantProject(options: ProjectOptions): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  plantStandInClaude(scratch);
  writeDismissed(scratch.home, NOTICE_IDS);
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\nnode_modules/\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(scratch, 'checkout', '-q', '-b', 'feat/tsc');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-tsc.md'), '# Plan: tsc\n\n- [ ] A task no session runs\n', 'utf8');
  plantProjectConfig(scratch.repo, CONFIG);
  if (options.tsconfig) writeFileSync(join(scratch.repo, 'tsconfig.json'), '{}\n', 'utf8');

  const binDir = join(scratch.repo, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const body = options.tsc === 'refusing'
    ? `#!/usr/bin/env ${MISSING_INTERPRETER}\n`
    : '#!/bin/sh\necho "Version 5.9.3"\n';
  const tsc = join(binDir, 'tsc');
  writeFileSync(tsc, body, 'utf8');
  chmodSync(tsc, 0o755);
  return scratch;
}

/** The local `HH:MM` that is `minutes` from now. */
function clockAhead(minutes: number): string {
  const at = new Date(Date.now() + minutes * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

describe('loop start over a tsc that cannot start', () => {
  it('exits 1 inside the deferral naming the interpreter, recording nothing and spawning no claude', () => {
    const scratch = plantProject({ tsconfig: true, tsc: 'refusing' });
    const started = Date.now();
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, `--start-at=${clockAhead(DEFER_MINUTES)}`]);
    const took = Date.now() - started;

    expectExit(run, 1, scratch);
    expect(took).toBeLessThan(REFUSAL_BUDGET_MS);
    expect(run.stderr).toContain('exited 127');
    expect(run.stderr).toContain(
      `tsc runs under ${MISSING_INTERPRETER}, which its first line names: put ${MISSING_INTERPRETER} on the PATH the loop runs under.`,
    );
    expect(`${run.stdout}${run.stderr}`).not.toContain('Preflight');
    expect(existsSync(join(scratch.repo, '.rafa', 'runs'))).toBe(false);
    expect(existsSync(scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);

  it('goes on to the preflight halt with a tsc that prints its version', () => {
    const scratch = plantProject({ tsconfig: true, tsc: 'working' });
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

    expectExit(run, 1, scratch);
    expect(run.stderr).not.toContain('which its first line names');
    expect(run.stderr).toContain('❌ preflight halted: 1 required item failed');
    expect(existsSync(scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);

  it('goes on to the preflight halt in a project with no tsconfig.json, whatever its tsc does', () => {
    const scratch = plantProject({ tsconfig: false, tsc: 'refusing' });
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

    expectExit(run, 1, scratch);
    expect(run.stderr).not.toContain('which its first line names');
    expect(run.stderr).toContain('❌ preflight halted: 1 required item failed');
    expect(existsSync(scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);
});
