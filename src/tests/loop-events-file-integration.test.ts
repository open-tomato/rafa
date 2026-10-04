/**
 * The events file of a run (`start/loop-events.ts`), over spawned
 * `bun src/rafa.ts loop start` runs under `RAFA_OUTPUT=text` in scratch
 * projects:
 *
 *   - A run that blocks its one task leaves
 *     `.rafa/runs/<id>.events.ndjson` holding one parsable line per
 *     emitted event, though text prints none of them.
 *   - A run that ends on a throw, here a refused `effort.sync`, writes a
 *     last `error` line.
 *   - `readSessions`, `loop list` and `loop status` still read the
 *     `.json` record beside it alone: one record, one row, per run.
 *
 * The stand-in `claude` writes no report, so the task is held. The
 * scratch HOME has both notices dismissed (`context/notices.md`).
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { runsDir, readSessions } from '../loop/sessions.js';
import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';
import { EVENTS_EXTENSION } from '../start/loop-events.js';

import { plantProjectConfig, plantScratchRepo, plantStandInClaude, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 60_000 };
const PLAN_FLAG = '--plan=.plans/PLAN-store.md';
const TEXT = { RAFA_OUTPUT: 'text' };

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-events-file-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Runs git in `repo` under the scratch HOME alone. */
function git(scratch: ScratchRepo, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args], {
    cwd: scratch.repo,
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/** Plants a scratch project on a feature branch holding a one-task plan and `config`. */
function plantLoopScratch(config: string): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  plantStandInClaude(scratch);
  writeDismissed(scratch.home, NOTICE_IDS);
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(scratch, 'checkout', '-q', '-b', 'feat/store');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-store.md'), '# Plan: store\n\n- [ ] A task\n', 'utf8');
  plantProjectConfig(scratch.repo, config);
  return scratch;
}

/** The run's events file lines, each parsed; throws on a line that is no JSON. */
function eventLines(scratch: ScratchRepo): { id: string; lines: Array<{ name: string; summary: string; data: object; ts: string }> } {
  const files = readdirSync(runsDir(scratch.repo)).filter((name) => name.endsWith(EVENTS_EXTENSION));
  expect(files).toHaveLength(1);
  const file = files[0] ?? '';
  const text = readFileSync(join(runsDir(scratch.repo), file), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  const lines = text.split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line));
  return { id: file.slice(0, -EVENTS_EXTENSION.length), lines };
}

/** Asserts the readers see the one `.json` record `id` and no events file. */
function expectRecordReadAlone(scratch: ScratchRepo, id: string): void {
  const jsonFiles = readdirSync(runsDir(scratch.repo)).filter((name) => name.endsWith('.json'));
  expect(jsonFiles).toEqual([`${id}.json`]);
  expect(readSessions(scratch.repo).map((record) => record.sessionId)).toEqual([id]);

  // Revived under this process's pid, so list and status, which skip a stopped run, show it.
  const recordFile = join(runsDir(scratch.repo), `${id}.json`);
  const record = JSON.parse(readFileSync(recordFile, 'utf8')) as object;
  writeFileSync(recordFile, JSON.stringify({ ...record, state: 'running', pid: process.pid }), 'utf8');

  const list = runRafa(scratch, scratch.repo, ['loop', 'list'], TEXT);
  expect(list.exitCode).toBe(0);
  expect(list.stdout.split(id).length - 1).toBe(1);
  expect(`${list.stdout}${list.stderr}`).not.toContain('ndjson');

  const status = runRafa(scratch, scratch.repo, ['loop', 'status'], TEXT);
  expect(status.exitCode).toBe(0);
  expect(status.stdout).toContain(id);
  expect(`${status.stdout}${status.stderr}`).not.toContain('ndjson');
}

describe('the events file of a loop start run under RAFA_OUTPUT=text', () => {
  it('holds one parsable line per emitted event, which text itself printed none of', () => {
    const scratch = plantLoopScratch('pr:\n  provider: none\n');
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait'], TEXT);
    expect(run.exitCode).toBe(0);

    const { id, lines } = eventLines(scratch);
    expect(lines.map((line) => line.name)).toEqual(['task-start', 'task-blocked']);
    for (const line of lines) {
      expect(typeof line.summary).toBe('string');
      expect(Number.isNaN(Date.parse(line.ts))).toBe(false);
      expect(line).not.toHaveProperty('type');
    }
    expect(run.stdout).not.toContain('"name":"task-start"');
    expectRecordReadAlone(scratch, id);
  }, RUN_TIMEOUT);

  it('ends on an error line when the run throws', () => {
    const scratch = plantLoopScratch('pr:\n  provider: none\neffort:\n  sync: p2p\n');
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait'], TEXT);
    expect(run.exitCode).toBe(1);

    const { id, lines } = eventLines(scratch);
    const last = lines[lines.length - 1];
    expect(last?.name).toBe('error');
    expect(last?.summary).toContain('Refusing to start: effort.sync names a strategy no adapter serves.');
    expect((last?.data as { message: string }).message).toContain('"p2p"');
    expect(lines.filter((line) => line.name === 'error')).toHaveLength(1);
    expectRecordReadAlone(scratch, id);
  }, RUN_TIMEOUT);
});
