/**
 * `rafa loop start` sent SIGINT while its suite step runs, spawned as the
 * real `rafa` binary (`src/tests/cli-capture.ts`): the signal that reaches
 * the runner alone, as `rafa loop stop` sends it, while `bun test` is
 * still running. `src/start/suite-step.ts` reads that as a stop and never
 * as a red step (`start.ts`'s `interrupted` flag, `isInterrupted`).
 *
 * The project holds two tasks and one test file, which passes at once
 * until a stand-in `claude` has answered the first task's session, and
 * then holds the suite open: it writes a ready file and waits for a
 * proceed file. The first task carries `{tests=full}`, so its task step
 * runs that file, and the case signals the loop's pid the moment the
 * ready file is there. The baseline, which runs before any session, so
 * passes untouched.
 *
 * The run then ends as `rafa loop stop` ends one between tasks:
 *
 *   - exit code 0, and the stop announced on the output;
 *   - the run record `stopped`, its last step the `task` step recorded
 *     `interrupted`, holding no new failure;
 *   - the tracker with the first task ticked and the second left open,
 *     carrying no `[BLOCKED]` line and no blocker comment, which a red
 *     step would have written on the second;
 *   - the second task never dispatched: the stand-in answered once.
 *
 * The project's `pr.provider` is `none`, so the run needs no `gh` and no
 * remote, and `bun` is put on the scratch PATH for the nested `bun test`
 * the runner spawns.
 */
import type { ScratchRepo } from './cli-capture.js';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { NOTICE_IDS, writeDismissed } from '../notices/notices.js';
import { createGitRunner } from '../pr/index.js';

import { describeRun, expectExit, plantProjectConfig, plantScratchRepo, startRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 90_000 };

/** How long the case waits for the suite step to say it is running. */
const READY_WAIT_MS = 60_000;

/** How often the case looks for the ready file. */
const POLL_MS = 25;

/** How long the signal gets to reach the runner before the suite is let go. */
const SIGNAL_SETTLE_MS = 500;

/** How long the held test waits for the proceed file before it gives up on its own. */
const HOLD_LIMIT_MS = 40_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-suite-sigint-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The plan the case runs, relative to the root. */
const PLAN_FLAG = '--plan=.plans/PLAN-sigint.md';

/** The two tasks: the first routed to the full suite, so its task step runs the held test. */
const PLAN_TEXT = '# Plan: sigint\n\n- [ ] First task {tests=full}\n- [ ] Second task\n';

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

/** The files the stand-in, the held test and the case share, outside the repository. */
interface Markers {
  /** Written by the stand-in `claude`: a session has run. */
  readonly sessionRan: string;
  /** Written by the held test: the suite step is running. */
  readonly ready: string;
  /** Written by the case once the signal has been sent: the held test may end. */
  readonly proceed: string;
}

/** Runs git in `scratch`'s repository, throwing what it said when it failed: a fixture step. */
function git(scratch: ScratchRepo, ...args: string[]): void {
  const result = createGitRunner(scratch.repo)(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
}

/** The marker files for `scratch`, beside its HOME. */
function markersOf(scratch: ScratchRepo): Markers {
  const dir = dirname(scratch.home);
  return {
    sessionRan: join(dir, 'session-ran'),
    ready: join(dir, 'suite-ready'),
    proceed: join(dir, 'suite-proceed'),
  };
}

/** Writes a stand-in `claude` that notes it ran, logs the call and answers {@link STAND_IN_REPORT}. */
function plantSessionClaude(scratch: ScratchRepo, markers: Markers): void {
  const reportPath = join(scratch.bin, 'report.txt');
  writeFileSync(reportPath, STAND_IN_REPORT, 'utf8');
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo called >> '${scratch.callLog}'`,
    `touch '${markers.sessionRan}'`,
    `cat '${reportPath}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** The test file that passes until a session has run, and then holds the suite open. */
function heldTestText(markers: Markers): string {
  return [
    'import { existsSync, writeFileSync } from \'node:fs\';',
    '',
    'import { expect, test } from \'bun:test\';',
    '',
    'test(\'holds the suite open once a task session has run\', async () => {',
    `  if (!existsSync(${JSON.stringify(markers.sessionRan)})) return;`,
    `  writeFileSync(${JSON.stringify(markers.ready)}, 'ready');`,
    `  const deadline = Date.now() + ${String(HOLD_LIMIT_MS)};`,
    `  while (!existsSync(${JSON.stringify(markers.proceed)}) && Date.now() < deadline) await Bun.sleep(${String(POLL_MS)});`,
    '  expect(true).toBe(true);',
    `}, ${String(HOLD_LIMIT_MS + 10_000)});`,
    '',
  ].join('\n');
}

/** A project on `feat/sigint` with the two-task plan, over a stand-in session, both notices dismissed. */
function plantLoopProject(markers: (scratch: ScratchRepo) => Markers): ScratchRepo {
  const base = plantScratchRepo(tempBase);
  const bun = Bun.which('bun');
  if (bun === null) throw new Error('bun is not on the PATH this suite runs under');
  // The runner spawns a nested `bun test`, which needs `bun` on the PATH it is given.
  const scratch: ScratchRepo = { ...base, path: [base.path, dirname(bun)].join(delimiter) };
  const held = markers(scratch);
  writeDismissed(scratch.home, NOTICE_IDS);
  git(scratch, 'config', 'user.name', 'Rafa Sigint');
  git(scratch, 'config', 'user.email', 'sigint@example.invalid');
  git(scratch, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  writeFileSync(join(scratch.repo, 'held.test.ts'), heldTestText(held), 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  plantProjectConfig(scratch.repo, 'pr:\n  provider: none\n');
  plantSessionClaude(scratch, held);
  git(scratch, 'checkout', '-q', '-b', 'feat/sigint');
  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, '.plans', 'PLAN-sigint.md'), PLAN_TEXT, 'utf8');
  return scratch;
}

/** Resolves once `file` exists, or throws after {@link READY_WAIT_MS}. */
async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + READY_WAIT_MS;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`${file} never appeared: the suite step did not start`);
    await Bun.sleep(POLL_MS);
  }
}

describe('rafa loop start sent SIGINT during its suite step', () => {
  it('ends the run stopped, records the step interrupted and writes no blocker on the tracker', async () => {
    const scratch = plantLoopProject(markersOf);
    const markers = markersOf(scratch);
    const run = startRafa(scratch, scratch.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

    try {
      await waitForFile(markers.ready);
    } catch (error) {
      process.kill(run.pid, 'SIGKILL');
      const ended = await run.result;
      throw new Error(`${String(error)}\n${describeRun(ended, scratch)}`);
    }
    process.kill(run.pid, 'SIGINT');
    await Bun.sleep(SIGNAL_SETTLE_MS);
    writeFileSync(markers.proceed, 'proceed', 'utf8');
    const ended = await run.result;
    const output = `${ended.stdout}${ended.stderr}`;

    expectExit(ended, 0, scratch);
    expect(output).toContain('Stopping here, as rafa loop stop does: no task is marked blocked.');
    expect(output).not.toContain('Task marked as blocked');

    const [record, ...others] = readSessions(scratch.repo);
    expect(others).toEqual([]);
    expect(record?.state).toBe('stopped');
    const steps = record?.steps ?? [];
    const last = steps[steps.length - 1];
    expect(last?.kind).toBe('task');
    expect(last?.interrupted).toBe(true);
    expect(last?.newFailures).toEqual([]);

    const tracker = readFileSync(join(scratch.repo, '.plans', 'PLAN_TRACKER-sigint.md'), 'utf8');
    expect(tracker).toContain('- [x] First task');
    expect(tracker).toContain('- [ ] Second task');
    expect(tracker).not.toContain('[BLOCKED]');
    expect(tracker).not.toContain('<!-- blocked:');

    expect(readFileSync(scratch.callLog, 'utf8').split('\n')
      .filter((line) => line !== '')).toEqual(['called']);
  }, RUN_TIMEOUT);
});
