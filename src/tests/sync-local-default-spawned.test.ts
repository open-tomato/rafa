/**
 * `rafa doctor`, `rafa effort copy`, `rafa effort merge` and `rafa loop
 * start` spawned for real over one project whose `.rafa/config.yaml`
 * names no `effort.sync` at all: `readDoctorEffortSync`
 * (`commands/doctor-effort-sync.ts`) and `refuseUnservedSync`
 * (`start/preflight-sync.ts`) both resolve the config's `effortSync`
 * default, `local`, which `CORE_ADAPTER_REGISTRY` serves with no module.
 *
 * `sync-module-missing-spawned.test.ts` is this file's model for the same
 * reason, over the opposite reading: `effort.sync: git` with no module
 * loaded. Its two commands read `local` as `ok` here instead of `fail`;
 * this file's job is the other half of that parity, that the row change
 * introduced no regression in the commands that have nothing to do with
 * `effort.sync` — a device merging in, copying out, or starting a loop —
 * once a project holding no `effort.sync` key stopped being the only kind
 * of project there was.
 *
 * `doctor` reads the row as `ok, local` and exits 0. `effort copy` and
 * `effort merge` never read `effortSync` at all (`commands/effort/copy.ts`,
 * `commands/effort/merge.ts` name no such seam), so a store copied and a
 * second store merged in behave exactly as `effort-merge-move-spawn.test.ts`
 * already prints for a project naming a `sync` kind explicitly: exit 0,
 * the usual lines, nothing about sync anywhere in either report. `loop
 * start`'s preflight passes the sync check silently and halts on one
 * ordinary required item that has nothing to do with it, the same halt
 * `loop-start-effort-store.test.ts` prints for a project of this same
 * shape, before any session: the scratch `PATH` carries no `claude` at
 * all, so a run that somehow reached a session would fail to resolve one
 * rather than silently calling the real thing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from '../effort/store/bring-forward.js';
import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-local-default-spawned-')));
afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** The plan every scratch project holds, relative to its root. */
const PLAN_FLAG = '--plan=.plans/PLAN-sync.md';

/** The project's config: no `effort:` section at all, so `effortSync` resolves to its default, `local`. */
const CONFIG = ['version: 1', 'pr:', '  provider: none', ''].join('\n');

/** The config `loop start`'s case adds: the same, plus one required item that always fails, unrelated to sync. */
const LOOP_CONFIG = [
  'version: 1',
  'pr:',
  '  provider: none',
  'prerequisites:',
  '  required:',
  '    - tool: needed',
  '      probe: \'exit 1\'',
  '',
].join('\n');

/** Runs git in `repo`, under a scratch HOME and never the real one. */
function git(scratch: { repo: string; home: string }, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=sync@example.test', '-c', 'user.name=Rafa Sync', '-c', 'commit.gpgsign=false', ...args], {
    cwd: scratch.repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/**
 * Plants a scratch project holding `config`, on a feature branch with a
 * plan of one task, both notices dismissed, and no `claude` anywhere on
 * its `PATH`; see the module note.
 */
function plantScratch(config: string): ReturnType<typeof plantScratchRepo> {
  const scratch = plantScratchRepo(scratchBase);
  writeDismissed(scratch.home, NOTICE_IDS);
  plantProjectConfig(scratch.repo, config);
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(scratch, 'checkout', '-q', '-b', 'feat/sync');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-sync.md'), '# Plan: sync\n\n- [ ] A task no session runs\n', 'utf8');
  return scratch;
}

/** Makes an effort store at `path`, brought forward by this build, as an installed one would be. */
function withStore(path: string, use: (db: Database) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { identity: { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' } });
    use(db);
  } finally {
    db.close();
  }
}

/** Plants the `store_meta` row naming `storeId` of `project`. */
function plantMeta(db: Database, path: string, storeId: string, project: string): void {
  db.query(
    'INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path, file_dev, file_ino, minted_at)'
      + ' VALUES (1, ?, ?, NULL, \'host\', ?, 1, 1, ?)',
  ).run(storeId, project, path, '2026-09-29T10:00:00.000Z');
}

describe('a project naming no effort.sync at all', () => {
  it('passes `rafa doctor`\'s `effort sync` row as `local`, and exits 0', RUN_TIMEOUT, () => {
    const scratch = plantScratch(CONFIG);

    const run = runRafa(scratch, scratch.repo, ['doctor']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Effort sync: ok, local');
    expect(run.stdout).not.toContain('Effort sync: fail');
  });

  it('leaves `rafa effort copy` and `rafa effort merge` unchanged', RUN_TIMEOUT, () => {
    const scratch = plantScratch(CONFIG);
    const path = join(scratch.repo, '.rafa', 'effort', 'effort.sqlite');
    withStore(path, (db) => {
      plantMeta(db, path, 'here', 'proj-sync-default');
    });

    const copyRun = runRafa(scratch, scratch.repo, ['effort', 'copy']);
    expect(copyRun.exitCode).toBe(0);
    expect(copyRun.stdout).toContain('✅ Copied effort.sqlite from');
    expect(`${copyRun.stdout}${copyRun.stderr}`).not.toContain('effort.sync');

    const otherDir = realpathSync(mkdtempSync(join(scratchBase, 'other-')));
    const otherPath = join(otherDir, 'effort.sqlite');
    withStore(otherPath, (db) => {
      plantMeta(db, otherPath, 'there', 'proj-sync-default');
    });

    const mergeRun = runRafa(scratch, scratch.repo, ['effort', 'merge', otherPath]);
    expect(mergeRun.exitCode).toBe(0);
    expect(mergeRun.stdout).toContain('✅ Merged. A copy of the original is kept at');
    expect(`${mergeRun.stdout}${mergeRun.stderr}`).not.toContain('effort.sync');
  });

  it('refuses `rafa loop start` at its ordinary preflight, naming no sync refusal, before any session', RUN_TIMEOUT, () => {
    const scratch = plantScratch(LOOP_CONFIG);

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ preflight halted: 1 required item failed');
    expect(run.stderr).not.toContain('Refusing to start: effort.sync');
    expect(run.stderr).not.toContain('sync');
    expect(existsSync(scratch.callLog)).toBe(false);
  });
});
