/**
 * `rafa loop start` over a stand-in sync strategy a module brings,
 * spawned as the real `rafa` binary (`src/tests/cli-capture.ts`): what the
 * end-of-task `hubContact.pushThenPull()` (`src/start.ts`,
 * `src/effort/sync/contact.ts`) does to the store the run records to.
 *
 * The strategy is the `pull-merge-sync` module under
 * `src/modules/testdata/`, loaded as `effort.sync: service` through
 * `modules:` and `allowList:`. Its pull is the `file` strategy's, so the
 * merge is `mergeStore`'s, handed the request's session id; the other
 * device's store is a file this test mints under its own scratch
 * directory, holding one dispatch row the run's store does not, and named
 * to the module through `RAFA_TEST_OTHER_STORE`.
 *
 *   - Beside no other run, the end-of-task pull merges that row into the
 *     store. The run's own record is live while it pulls, so the merge
 *     passing means the guard passed it by its session id.
 *   - Beside a second live run on the same store, a record planted with
 *     this test process's pid and a session id of its own, the same pull
 *     is refused by the live-loop guard, naming that run. The row is not
 *     merged, the rest of the run is unharmed, and the task is still
 *     ticked: a contact never throws and never sets the exit code.
 *
 * The stand-in `claude` answers a `done` report to every session it is
 * handed, the wrap-up's included, and the project's `pr.provider` is
 * `none`, so the run needs no `gh` and no remote.
 */
import type { ScratchRepo } from './cli-capture.js';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { writeDispatch } from '../effort/store/dispatches.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { beginSession } from '../loop/sessions.js';
import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';
import { createGitRunner } from '../pr/index.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 90_000 };

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-sync-pull-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The module whose `service` strategy merges another device's store. */
const PULL_MERGE_MODULE = fileURLToPath(new URL('../modules/testdata/pull-merge-sync', import.meta.url));

/** The hub the `service` config names: never dialled by the fixture, which reaches no hub. */
const HUB_URL = 'http://127.0.0.1:9';

/** The dispatch row the other device wrote and the run's store does not hold. */
const OTHER_DEVICE_SESSION = 's-other-device';

/** The session id of the second live run planted beside the first. */
const SECOND_RUN_SESSION = '20260929-101500-cafe';

/** The plan every case runs, relative to the root. */
const PLAN_FLAG = '--plan=.plans/PLAN-sync.md';

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

/** Runs git in `scratch`'s repository, throwing what it said when it failed: a fixture step. */
function git(scratch: ScratchRepo, ...args: string[]): void {
  const result = createGitRunner(scratch.repo)(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
}

/** Writes a stand-in `claude` answering {@link STAND_IN_REPORT} to every session. */
function plantSessionClaude(scratch: ScratchRepo): void {
  const reportPath = join(scratch.bin, 'report.txt');
  writeFileSync(reportPath, STAND_IN_REPORT, 'utf8');
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `cat '${reportPath}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** The project config: the module's strategy as `service`, no pull request provider. */
function projectConfig(): string {
  return [
    'pr:',
    '  provider: none',
    'effort:',
    '  sync: service',
    'hub:',
    `  url: ${HUB_URL}`,
    'modules:',
    `  - path: ${PULL_MERGE_MODULE}`,
    'allowList:',
    '  - pull-merge-sync',
    '',
  ].join('\n');
}

/** A project on `feat/sync` with a one-task plan, over a stand-in session, both notices dismissed. */
function plantLoopProject(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  writeDismissed(scratch.home, NOTICE_IDS);
  git(scratch, 'config', 'user.name', 'Rafa Sync');
  git(scratch, 'config', 'user.email', 'sync@example.invalid');
  git(scratch, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  plantProjectConfig(scratch.repo, projectConfig());
  plantSessionClaude(scratch);
  git(scratch, 'checkout', '-q', '-b', 'feat/sync');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-sync.md'), '# Plan: sync\n\n- [ ] Only task\n', 'utf8');
  return scratch;
}

/**
 * Another device's store under `scratch`'s own directory, outside its
 * repository, minted with no project so the merge has no other-project
 * refusal to make, holding one dispatch row. Answers the store's file.
 */
function plantOtherDevice(scratch: ScratchRepo): string {
  const root = join(dirname(scratch.repo), 'other-device');
  mkdirSync(root, { recursive: true });
  const path = sqliteStorePath(root);
  withSqliteStore(path, 'write', true, () => undefined, {
    readProject: () => ({ rootCommit: null, remote: null }),
    newStoreId: () => 'store-other-device',
    now: () => new Date('2026-09-29T08:00:00.000Z'),
  });
  writeDispatch(root, { sessionId: OTHER_DEVICE_SESSION, planStub: null, taskLine: 'task of another device', declaration: null, flags: [] });
  return path;
}

/** Plants a second live run record: this test process's pid is alive, so it reads `running`. */
function plantSecondRun(scratch: ScratchRepo): void {
  beginSession(scratch.repo, {
    sessionId: SECOND_RUN_SESSION,
    planStub: 'rafa-second-run',
    plan: '.rafa/plans/rafa-second-run.md',
    branch: 'feat/rafa-second-run',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
}

/** Every `dispatches.session_id` the run's own store holds. */
function dispatchSessions(scratch: ScratchRepo): string[] {
  const db = new Database(sqliteStorePath(scratch.repo), { readonly: true });
  try {
    return db.query<{ session_id: string }, []>('SELECT session_id FROM dispatches').all()
      .map((row) => row.session_id);
  } finally {
    db.close();
  }
}

/** The lines the module logged, one per end-of-task pull; none when it never pulled. */
function pullLog(scratch: ScratchRepo): string[] {
  const log = join(scratch.repo, '.rafa', 'sync-calls.log');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n')
    .filter((line) => line !== '');
}

/** Runs the loop over `scratch`, the other device's store named to the module. */
function startLoop(scratch: ScratchRepo, otherStore: string): ReturnType<typeof runRafa> {
  return runRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait'], { RAFA_TEST_OTHER_STORE: otherStore });
}

describe('rafa loop start over a module\'s sync strategy whose pull merges another device\'s rows', () => {
  it('merges the other device\'s row at the end of the task, passing the run\'s own live record', () => {
    const scratch = plantLoopProject();
    const otherStore = plantOtherDevice(scratch);

    const run = startLoop(scratch, otherStore);
    const output = `${run.stdout}${run.stderr}`;

    expectExit(run, 0, scratch);
    expect(readFileSync(join(scratch.repo, '.plans', 'PLAN_TRACKER-sync.md'), 'utf8')).toContain('- [x] Only task');
    expect(pullLog(scratch)).toEqual(['pulled:merged:1']);
    expect(output).not.toContain('effort sync:');
    expect(dispatchSessions(scratch)).toContain(OTHER_DEVICE_SESSION);
  }, RUN_TIMEOUT);

  it('refuses the pull beside a second live run on the same store, naming it, and merges nothing', () => {
    const scratch = plantLoopProject();
    const otherStore = plantOtherDevice(scratch);
    plantSecondRun(scratch);

    const run = startLoop(scratch, otherStore);
    const output = `${run.stdout}${run.stderr}`;

    // A contact never throws and never sets the exit code: the task is still done.
    expectExit(run, 0, scratch);
    expect(readFileSync(join(scratch.repo, '.plans', 'PLAN_TRACKER-sync.md'), 'utf8')).toContain('- [x] Only task');
    expect(pullLog(scratch)).toEqual(['refused']);
    expect(output).toContain('effort sync: pull over service failed: REFUSED');
    expect(output).toContain(`loop ${SECOND_RUN_SESSION} (pid ${String(process.pid)}, plan rafa-second-run) is running on this store`);
    expect(dispatchSessions(scratch)).not.toContain(OTHER_DEVICE_SESSION);
  }, RUN_TIMEOUT);
});
