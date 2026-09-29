/**
 * What `rafa loop start` does about the effort store before its first
 * session, spawned as `bun src/rafa.ts loop start` through `runRafa` in
 * scratch projects under this file's temporary directory.
 *
 *   - It refuses while `RAFA_EFFORT_DIR` is set, before anything is
 *     checked, recorded or dispatched, beside the control of the same
 *     run with the variable empty, which counts as unset and goes on.
 *   - Its preflight warns once for each migration the project's store
 *     logs that this rafa does not know and that is additive, and goes on
 *     to use the store: the halt's rows are stored in it. The control is
 *     the same run over a store holding no unknown migration.
 *
 * Every run is made to halt at its preflight by one required
 * prerequisite whose probe exits 1, so no case needs a session: the halt
 * is the reading that the run got past the refusal and the warning, and
 * a stand-in `claude` that logs its calls proves no session was spawned.
 * The scratch HOME has both notices dismissed (`context/notices.md`).
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from '../effort/store/bring-forward.js';
import { unknownAdditiveWarning } from '../effort/store/schema-report.js';
import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';

import { plantProjectConfig, plantScratchRepo, plantStandInClaude, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-start-effort-store-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The plan every scratch project holds, relative to its root. */
const PLAN_FLAG = '--plan=.plans/PLAN-store.md';

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

/** The first line of the refusal, as the spec words it, for `dir`. */
function refusalLine(dir: string): string {
  return `❌ RAFA_EFFORT_DIR is set (${dir}); a loop records to the project's own store. Unset it and run again.`;
}

/** Runs git in `repo` under the scratch HOME alone. */
function git(scratch: ScratchRepo, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args], {
    cwd: scratch.repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/**
 * Plants a scratch project on a feature branch, holding a plan of one
 * task and the config above, a stand-in `claude` and both notices
 * dismissed; see the module note.
 */
function plantLoopScratch(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  plantStandInClaude(scratch);
  writeDismissed(scratch.home, NOTICE_IDS);
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(scratch, 'checkout', '-q', '-b', 'feat/store');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-store.md'), '# Plan: store\n\n- [ ] A task no session runs\n', 'utf8');
  plantProjectConfig(scratch.repo, CONFIG);
  return scratch;
}

/** Plants the project's own store, brought forward by this build, and answers its path. */
function plantStore(scratch: ScratchRepo): string {
  const dir = join(scratch.repo, '.rafa', 'effort');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'effort.sqlite');
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open');
  } finally {
    db.close();
  }
  return path;
}

/** Logs a migration this build does not know and that breaks nothing, as a newer rafa would have. */
function logUnknownAdditive(path: string, id: string, appliedBy: string): void {
  const db = new Database(path, { readwrite: true });
  try {
    db.run(
      'INSERT INTO schema_migrations (id, sha256, breaks, applied_at, applied_by) VALUES (?, ?, ?, ?, ?)',
      [id, 'b'.repeat(64), '[]', '2026-10-01T09:00:00.000Z', appliedBy],
    );
  } finally {
    db.close();
  }
}

/** How many rows the store at `path` holds in its `preflight` table. */
function preflightRows(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ n: number }, []>('SELECT count(*) AS n FROM preflight').get()?.n ?? 0;
  } finally {
    db.close();
  }
}

/** How many times `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('loop start while RAFA_EFFORT_DIR is set', () => {
  it('refuses before anything is checked, recorded or dispatched, where an empty value goes on to the preflight', () => {
    const copy = join(tempBase, 'a-copy');
    const refused = plantLoopScratch();
    const run = runRafa(refused, refused.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait'], { RAFA_EFFORT_DIR: copy });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(refusalLine(copy));
    expect(run.stderr).toContain('Nothing was checked and nothing was dispatched.');
    expect(`${run.stdout}${run.stderr}`).not.toContain('Preflight');
    expect(existsSync(join(refused.repo, '.rafa', 'runs'))).toBe(false);
    expect(existsSync(refused.callLog)).toBe(false);

    // The control: the same run with the variable empty, which counts as unset.
    const control = plantLoopScratch();
    const passed = runRafa(control, control.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait'], { RAFA_EFFORT_DIR: '' });
    expect(passed.exitCode).toBe(1);
    expect(passed.stderr).not.toContain('RAFA_EFFORT_DIR is set');
    expect(passed.stderr).toContain('❌ preflight halted: 1 required item failed');
    expect(existsSync(control.callLog)).toBe(false);
  }, RUN_TIMEOUT);
});

describe('loop start over a store logging an unknown additive migration', () => {
  it('warns once for it and uses the store as it is, where a store holding none prints no such warning', () => {
    const scratch = plantLoopScratch();
    const path = plantStore(scratch);
    logUnknownAdditive(path, 'future-notes', '0.30.0');
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);
    const output = `${run.stdout}${run.stderr}`;

    const warning = unknownAdditiveWarning({ id: 'future-notes', appliedBy: '0.30.0' });
    expect(occurrences(output, warning)).toBe(1);
    // The run went on to its preflight and stored its halt in that store.
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('and `rafa effort report` lists the halt.');
    expect(preflightRows(path)).toBe(1);
    expect(existsSync(scratch.callLog)).toBe(false);

    // The control: the same run over a store holding no unknown migration.
    const control = plantLoopScratch();
    const controlPath = plantStore(control);
    const passed = runRafa(control, control.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);
    expect(passed.exitCode).toBe(1);
    expect(`${passed.stdout}${passed.stderr}`).not.toContain('this rafa does not know');
    expect(preflightRows(controlPath)).toBe(1);
  }, RUN_TIMEOUT);
});
