/**
 * `rafa doctor` and `rafa loop start`, spawned for real, over one project
 * whose `.rafa/config.yaml` names `effort.sync: git` and loads no module:
 * `git` is one of `MODULE_SYNC_STRATEGIES` (`effort/sync/select.ts`),
 * which core ships no adapter for, so both commands read the same
 * `SyncModuleMissing` refusal through `readDoctorEffortSync`
 * (`commands/doctor-effort-sync.ts`) and `refuseUnservedSync`
 * (`start/preflight-sync.ts`).
 *
 * `doctor-effort-sync.test.ts` and `preflight-sync.test.ts` already drive
 * every seam of that reading in-process; what is untested there is that
 * the two REAL, spawned commands actually refuse over one planted
 * project and both name the `modules:` and `allowList:` lines that would
 * fix it, rather than two readings that happen to look alike on the
 * seams a unit test chose to drive. `doctor-preflight-parity.test.ts` is
 * this file's model for the same reason, over a different refusal.
 *
 * `rafa doctor` exits 1 with `effortSyncRefusal`'s line; `rafa loop
 * start` exits 1 with `syncRefusal`'s, before the plan is read, before
 * any prerequisite is checked and before any session: the scratch `PATH`
 * carries no `claude` at all, so a run that somehow reached a session
 * would fail to resolve one rather than silently calling the real thing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-module-missing-spawned-')));
afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** The plan every scratch project holds, relative to its root. */
const PLAN_FLAG = '--plan=.plans/PLAN-sync.md';

/** The project's config: `effort.sync: git`, and no module loads a `git` adapter. */
const CONFIG = ['version: 1', 'pr:', '  provider: none', 'effort:', '  sync: git', ''].join('\n');

/** The lines naming the fix, as `SyncModuleMissing` words them; both refusals carry every one. */
const MODULE_FIX_LINES = [
  'effort.sync is "git", and no module registers a sync adapter of that kind',
  'Core ships no git strategy; load a module that provides',
  'one with these lines in .rafa/config.yaml:',
  'modules:',
  '  - path: <module directory>',
  'allowList:',
  '  - <module name>',
];

/** Runs git in `repo`, under a scratch HOME and never the real one. */
function git(scratch: { repo: string; home: string }, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=sync@example.test', '-c', 'user.name=Rafa Sync', '-c', 'commit.gpgsign=false', ...args], {
    cwd: scratch.repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/**
 * Plants a scratch project holding `effort.sync: git`, on a feature
 * branch with a plan of one task, both notices dismissed, and no
 * `claude` anywhere on its `PATH`; see the module note.
 */
function plantScratch(): ReturnType<typeof plantScratchRepo> {
  const scratch = plantScratchRepo(scratchBase);
  writeDismissed(scratch.home, NOTICE_IDS);
  plantProjectConfig(scratch.repo, CONFIG);
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(scratch, 'checkout', '-q', '-b', 'feat/sync');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-sync.md'), '# Plan: sync\n\n- [ ] A task no session runs\n', 'utf8');
  return scratch;
}

describe('a project naming effort.sync: git with no module loaded', () => {
  it('fails `rafa doctor` with exit 1, naming the module lines', RUN_TIMEOUT, () => {
    const scratch = plantScratch();

    const run = runRafa(scratch, scratch.repo, ['doctor']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('Effort sync: fail, git');
    for (const line of MODULE_FIX_LINES) {
      expect(`${run.stdout}${run.stderr}`).toContain(line);
    }
  });

  it('refuses `rafa loop start` before any session, naming the module lines', RUN_TIMEOUT, () => {
    const scratch = plantScratch();

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Refusing to start: effort.sync names a strategy no adapter serves.');
    for (const line of MODULE_FIX_LINES) {
      expect(run.stderr).toContain(line);
    }
    expect(run.stderr).toContain('Nothing was checked and nothing was dispatched.');
    // The refusal is the preflight's very first check, ahead of every
    // prerequisite and any session: no prerequisite line is printed, and
    // the stand-in `claude` this scratch's `PATH` would resolve to, had
    // one been planted, was never called.
    expect(`${run.stdout}${run.stderr}`).not.toContain('Preflight');
    expect(existsSync(scratch.callLog)).toBe(false);
  });
});
