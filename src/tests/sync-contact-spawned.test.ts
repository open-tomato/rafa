/**
 * Where a command pushes then pulls through its hub contact
 * (`src/effort/sync/contact.ts`), spawned as the real `rafa` binary
 * (`src/tests/cli-capture.ts`) in scratch projects under this file's
 * temporary directory:
 *
 *   - `rafa effort collect`, once its rows are stored and its summary
 *     written (`src/effort/collect.ts`);
 *   - `rafa loop start`, at the end of each task, through the one contact
 *     it makes for its run (`src/start.ts`).
 *
 * The `service` strategy is the `hub-down-sync` module under
 * `src/modules/testdata/`, loaded through `modules:` and `allowList:`:
 * its push and pull each log their direction to `.rafa/sync-calls.log`
 * and reject as a hub that cannot be reached. So the log counts the
 * contacts a command made, and each case reads the unreachable line
 * whole, counted, beside the log.
 *
 * Each claim sits beside a control that could have failed it: the same
 * project naming `effort.sync: local`, which loads the same module and
 * contacts nothing, and, for the loop, a plan of two tasks, which pushes
 * twice and still writes the line once.
 */
import type { ScratchRepo } from './cli-capture.js';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { hubUnreachableLine } from '../effort/sync/contact.js';
import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';
import { createGitRunner } from '../pr/index.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 90_000 };

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-contact-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The module whose `service` strategy never reaches its hub. */
const HUB_DOWN_MODULE = fileURLToPath(new URL('../modules/testdata/hub-down-sync', import.meta.url));

/** The hub the `service` configs name: a port nothing listens on, never dialled by the fixture. */
const HUB_URL = 'http://127.0.0.1:9';

/**
 * The line a contact writes when its push found the hub unreachable, as
 * the text output writes a warning: behind `warn: `.
 */
const UNREACHABLE_LINE = `warn: ${hubUnreachableLine(HUB_URL, new Error('connect ECONNREFUSED on push'))}`;

/** What every line a contact writes opens with. */
const SYNC_OPENING = 'effort sync:';

/** A config naming `strategy` as `effort.sync`, loading the hub-down module either way. */
function configFor(strategy: 'service' | 'local'): string {
  return [
    'pr:',
    '  provider: none',
    'effort:',
    `  sync: ${strategy}`,
    'hub:',
    `  url: ${HUB_URL}`,
    'modules:',
    `  - path: ${HUB_DOWN_MODULE}`,
    'allowList:',
    '  - hub-down-sync',
    '',
  ].join('\n');
}

/** The directions the fixture was called for under `scratch`, in order; none when it never was. */
function syncCalls(scratch: ScratchRepo): string[] {
  const log = join(scratch.repo, '.rafa', 'sync-calls.log');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n')
    .filter((line) => line !== '');
}

/** How many of the run's lines, stdout and stderr together, are `line` exactly. */
function linesEqualTo(output: string, line: string): number {
  return output.split('\n').filter((written) => written === line).length;
}

/** How many of the run's lines open as a contact's lines do. */
function syncLines(output: string): number {
  return output.split('\n').filter((written) => written.includes(SYNC_OPENING)).length;
}

/** Runs git in `scratch`'s repository, throwing what it said when it failed: a fixture step. */
function git(scratch: ScratchRepo, ...args: string[]): void {
  const result = createGitRunner(scratch.repo)(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
}

/** A scratch project with one commit and the config for `strategy`, both notices dismissed. */
function plantProject(strategy: 'service' | 'local'): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  writeDismissed(scratch.home, NOTICE_IDS);
  git(scratch, 'config', 'user.name', 'Rafa Sync');
  git(scratch, 'config', 'user.email', 'sync@example.invalid');
  git(scratch, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  plantProjectConfig(scratch.repo, configFor(strategy));
  return scratch;
}

/** The report a stand-in session ends on: `done`, holding nothing back. */
const STAND_IN_REPORT = [
  '```rafa:report',
  'status: done',
  'feedback: "the stand-in answered"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  '```',
  '',
].join('\n');

/** Writes a stand-in `claude` that reads its stdin, logs the call and answers {@link STAND_IN_REPORT}. */
function plantSessionClaude(scratch: ScratchRepo): void {
  const reportPath = join(scratch.bin, 'report.txt');
  writeFileSync(reportPath, STAND_IN_REPORT, 'utf8');
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo session-call >> '${scratch.callLog}'`,
    `cat '${reportPath}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** The plan every loop case runs, relative to the root. */
const PLAN_FLAG = '--plan=.plans/PLAN-sync.md';

/** A project for the loop on `feat/sync`, its plan holding `tasks`, over a stand-in session. */
function plantLoopProject(strategy: 'service' | 'local', tasks: readonly string[]): ScratchRepo {
  const scratch = plantProject(strategy);
  plantSessionClaude(scratch);
  git(scratch, 'checkout', '-q', '-b', 'feat/sync');
  mkdirSync(join(scratch.repo, '.plans'));
  const checklist = tasks.map((task) => `- [ ] ${task}`);
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-sync.md'), ['# Plan: sync', '', ...checklist, ''].join('\n'), 'utf8');
  return scratch;
}

/** The tracker the loop keeps beside the plan. */
function tracker(scratch: ScratchRepo): string {
  return readFileSync(join(scratch.repo, '.plans', 'PLAN_TRACKER-sync.md'), 'utf8');
}

describe('rafa effort collect under a service whose hub is down', () => {
  it('stores its rows, pushes once, writes one unreachable line and exits 0, where local contacts nothing', () => {
    const scratch = plantProject('service');
    const run = runRafa(scratch, scratch.repo, ['effort', 'collect', '--no-sessions']);
    const output = `${run.stdout}${run.stderr}`;

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('+1 rows');
    expect(linesEqualTo(output, UNREACHABLE_LINE)).toBe(1);
    expect(syncLines(output)).toBe(1);
    // The unreachable push skipped its pull.
    expect(syncCalls(scratch)).toEqual(['push']);

    // The control: the same project naming `local` stores the same row and contacts nothing.
    const control = plantProject('local');
    const passed = runRafa(control, control.repo, ['effort', 'collect', '--no-sessions']);
    const controlOutput = `${passed.stdout}${passed.stderr}`;
    expect(passed.exitCode).toBe(0);
    expect(passed.stdout).toContain('+1 rows');
    expect(syncLines(controlOutput)).toBe(0);
    expect(syncCalls(control)).toEqual([]);
  }, RUN_TIMEOUT);
});

describe('rafa loop start under a service whose hub is down', () => {
  it('pushes at the end of each task and writes the unreachable line once for the run', () => {
    const scratch = plantLoopProject('service', ['First task', 'Second task']);
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);
    const output = `${run.stdout}${run.stderr}`;

    expect(run.exitCode).toBe(0);
    expect(tracker(scratch)).toContain('- [x] First task');
    expect(tracker(scratch)).toContain('- [x] Second task');
    // One push per task, each skipping its pull, and one line for the whole run.
    expect(syncCalls(scratch)).toEqual(['push', 'push']);
    expect(linesEqualTo(output, UNREACHABLE_LINE)).toBe(1);
    expect(syncLines(output)).toBe(1);
  }, RUN_TIMEOUT);

  it('contacts nothing and writes no sync line under local', () => {
    const scratch = plantLoopProject('local', ['First task', 'Second task']);
    const run = runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);
    const output = `${run.stdout}${run.stderr}`;

    expect(run.exitCode).toBe(0);
    expect(tracker(scratch)).toContain('- [x] Second task');
    expect(syncCalls(scratch)).toEqual([]);
    expect(syncLines(output)).toBe(0);
  }, RUN_TIMEOUT);
});
