/**
 * `rafa cleanup`, dispatched, over the scratch repository of
 * `src/cleanup/scratch-repository.ts` with run records planted under
 * `.rafa/runs/`: a running record with a live pid (this process), the
 * newest finished record of a plan, two older finished records of that
 * plan with events files, and the newest record of a second plan.
 *
 * `--dry-run` lists exactly the two older records as `rm` lines and
 * removes nothing; a run removes both records and their events files;
 * and `readSession` still reads the newest record of each plan afterwards.
 */
import type { CapturedRun } from './cli-capture.js';
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { SessionRecord } from '../loop/sessions.js';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createScratchRepository, SCRATCH_NOW } from '../cleanup/scratch-repository.js';
import { createCleanupCommand } from '../commands/cleanup.js';
import { readSession, runsDir, sessionFilePath } from '../loop/sessions.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { eventsFilePath } from '../start/loop-events.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

const ENTER: Key = { name: 'enter' };
const CLOCK_AHEAD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** A pid no process holds. */
const DEAD_PID = 2_000_000_000;

const RUNNING = 'run-live';
const NEWEST_DEMO = 'run-demo-new';
const OLDER = ['run-demo-old-1', 'run-demo-old-2'];
const NEWEST_OTHER = 'run-other-new';

let repo: ScratchRepository;

beforeEach(() => {
  repo = createScratchRepository();
  plantProjectConfig(repo.clone);
  repo.git(['branch', '-D', 'gone']);
  plantRuns();
});

afterEach(() => {
  repo.dispose();
});

function record(sessionId: string, overrides: Partial<SessionRecord>): SessionRecord {
  return {
    sessionId,
    planStub: 'demo',
    plan: '.plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: DEAD_PID,
    startedAt: '2026-09-01T12:00:00.000Z',
    state: 'done',
    task: null,
    ...overrides,
  };
}

function plantRuns(): void {
  const records = [
    record(RUNNING, { planStub: 'live', plan: '.plans/PLAN-live.md', state: 'running', pid: process.pid, startedAt: '2026-09-01T00:00:00.000Z' }),
    record(OLDER[0]!, { startedAt: '2026-09-02T00:00:00.000Z' }),
    record(OLDER[1]!, { startedAt: '2026-09-03T00:00:00.000Z' }),
    record(NEWEST_DEMO, { startedAt: '2026-09-04T00:00:00.000Z' }),
    record(NEWEST_OTHER, { planStub: 'other', plan: '.plans/PLAN-other.md', startedAt: '2026-09-01T00:00:00.000Z' }),
  ];
  mkdirSync(runsDir(repo.clone), { recursive: true });
  for (const entry of records) {
    writeFileSync(sessionFilePath(repo.clone, entry.sessionId), `${JSON.stringify(entry, null, 2)}\n`);
  }
  for (const id of OLDER) writeFileSync(eventsFilePath(repo.clone, id), '{}\n');
}

async function cleanup(words: readonly string[], answers: readonly string[]): Promise<CapturedRun> {
  const queue = [...answers];
  const double = createPullRequestsDouble({ listMerged: () => Promise.resolve([]) });
  const terminal: Terminal = {
    isTTY: true,
    setRawMode: () => undefined,
    write: () => undefined,
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
  return dispatchInProject(['cleanup', ...words], [], [createCleanupCommand({
    now: () => new Date(SCRATCH_NOW.getTime() + CLOCK_AHEAD_DAYS * MS_PER_DAY),
    readRemote: () => 'git@github.com:open-tomato/scratch.git',
    pullRequests: () => double.pulls,
    terminal: () => terminal,
    keys: async function* (): AsyncGenerator<Key> {
      yield ENTER;
    },
    openPrompter: (): Prompter => ({
      say: () => undefined,
      ask: (question) => {
        const answer = queue.shift();
        if (answer === undefined) throw new Error(`no scripted answer for: ${question}`);
        return Promise.resolve(answer);
      },
      close: () => undefined,
    }),
    cwd: () => repo.clone,
  })], { root: repo.clone, home: repo.home });
}

function rmLines(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line.startsWith('rm '));
}

describe('rafa cleanup over planted run records', () => {
  it('lists exactly the two older records under --dry-run and removes nothing', async () => {
    const run = await cleanup(['--dry-run'], []);
    expect(run.exitCode).toBe(0);
    const lines = rmLines(run.stdout);
    expect(lines).toHaveLength(OLDER.length);
    for (const id of OLDER) {
      expect(lines.filter((line) => line.includes(sessionFilePath(repo.clone, id)))).toHaveLength(1);
      expect(lines.join('\n')).toContain(eventsFilePath(repo.clone, id));
      expect(existsSync(sessionFilePath(repo.clone, id))).toBe(true);
      expect(existsSync(eventsFilePath(repo.clone, id))).toBe(true);
    }
    for (const id of [RUNNING, NEWEST_DEMO, NEWEST_OTHER]) expect(run.stdout).not.toContain(`${id}.json`);
  });

  it('removes both older records and their events files, and readSession still reads the newest of each plan', async () => {
    const run = await cleanup([], ['y']);
    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    for (const id of OLDER) {
      expect(existsSync(sessionFilePath(repo.clone, id))).toBe(false);
      expect(existsSync(eventsFilePath(repo.clone, id))).toBe(false);
    }
    expect(readSession(repo.clone, NEWEST_DEMO).sessionId).toBe(NEWEST_DEMO);
    expect(readSession(repo.clone, NEWEST_OTHER).sessionId).toBe(NEWEST_OTHER);
    expect(readSession(repo.clone, RUNNING).sessionId).toBe(RUNNING);
  });
});
