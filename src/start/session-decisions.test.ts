/**
 * Tests for the pass-over list on a `loop start` session record
 * (`start/session.ts`): `RunSession.decisionsChanged` writing it, and
 * `readPreviousPassOver` reading back the list of the plan's newest
 * ended run, stopped or done.
 *
 * Each case opens or plants records under a fresh project root in this
 * file's temporary directory, with the liveness of every pid handed in,
 * so no case reads a real process. Each reading of the previous list
 * sits beside a record it must pass over: another plan's, another
 * branch's, a running one, an older one behind a newer run with no list.
 */
import type { RunSessionOptions } from './session.js';
import type { SessionDecision, SessionRecord } from '../loop/sessions.js';

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { eventsFileOf } from '../loop/events-file.js';
import { readSession, runsDir, sessionFilePath } from '../loop/sessions.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { openRunSession, readPreviousDecisionNeeded, readPreviousPassOver } from './session.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-session-decisions-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let roots = 0;

/** A new, empty project root under {@link tempRoot}. */
function freshRoot(): string {
  roots += 1;
  const root = join(tempRoot, `root-${roots}`);
  mkdirSync(root);
  return root;
}

/** The id the opened session is given. */
const ID = 'session-0950';

/** A pid probe answering every pid alive. */
const ALIVE = (): boolean => true;

/** A pid probe answering every pid gone. */
const GONE = (): boolean => false;

const JUMP: SessionDecision = {
  task: { lineNum: 3, task: 'Gate on .env.local' },
  strategy: 'jump',
  reason: 'A person writes .env.local.',
};
const DEFER: SessionDecision = {
  task: { lineNum: 5, task: 'Use the helper' },
  strategy: 'defer',
  reason: 'Needs the helper.',
  after: { lineNum: 4, task: 'Write the helper' },
};

/** The options opening a session of the `demo` plan on `feat/demo` under `root`. */
function options(root: string): RunSessionOptions {
  return {
    repoRoot: root,
    planPath: join(root, '.plans', 'PLAN-demo.md'),
    planStub: 'demo',
    branch: 'feat/demo',
    seams: { newSessionId: () => ID, pid: 5151, now: () => new Date('2026-10-08T12:00:00.000Z'), isAlive: ALIVE },
  };
}

/** A record of the `demo` plan, with `overrides` laid over it. */
function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'session-0001',
    planStub: 'demo',
    plan: '.plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4242,
    startedAt: '2026-10-08T10:00:00.000Z',
    state: 'stopped',
    task: null,
    ...overrides,
  };
}

/** Writes each record by hand, as earlier runs would have. */
function plant(root: string, ...records: SessionRecord[]): void {
  mkdirSync(runsDir(root), { recursive: true });
  for (const value of records) {
    writeFileSync(sessionFilePath(root, value.sessionId), JSON.stringify(value, null, 2));
  }
}

/** The plan `readPreviousPassOver` is asked about under `root`, on `feat/demo` in the main checkout. */
function demoPlan(root: string) {
  return { planPath: join(root, '.plans', 'PLAN-demo.md'), planStub: 'demo', branch: 'feat/demo', checkout: root };
}

describe('RunSession.decisionsChanged', () => {
  it('writes the list to the record, and an empty one drops it', () => {
    const root = freshRoot();
    const session = openRunSession(options(root));

    session.decisionsChanged([JUMP, DEFER]);
    expect(readSession(root, ID, { isAlive: ALIVE }).decisions).toEqual([JUMP, DEFER]);

    session.decisionsChanged([]);
    expect(readSession(root, ID, { isAlive: ALIVE }).decisions).toBeUndefined();
  });

  it('warns in one line and goes on when the record cannot be written', () => {
    const root = freshRoot();
    const session = openRunSession(options(root));
    rmSync(sessionFilePath(root, ID));
    const lines: string[] = [];
    setActiveOutput(sinkOutput({ warn: (message) => {
      lines.push(message);
    } }));

    try {
      session.decisionsChanged([JUMP]);
    } finally {
      setActiveOutput(null);
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`Session ${ID}: the pass-over list was not written`);
  });
});

describe('readPreviousPassOver', () => {
  it('answers nothing when the plan has no record', () => {
    expect(readPreviousPassOver(freshRoot(), demoPlan(freshRoot()), { isAlive: GONE })).toEqual([]);
  });

  it('answers the list of the plan\'s newest stopped run', () => {
    const root = freshRoot();
    plant(
      root,
      record({ sessionId: 'session-0001', startedAt: '2026-10-08T08:00:00.000Z', decisions: [DEFER] }),
      record({ sessionId: 'session-0002', startedAt: '2026-10-08T09:00:00.000Z', decisions: [JUMP] }),
    );

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: GONE })).toEqual([JUMP]);
  });

  it('passes over a running record and another plan\'s', () => {
    const root = freshRoot();
    plant(
      root,
      record({ sessionId: 'session-0001', startedAt: '2026-10-08T08:00:00.000Z', decisions: [JUMP] }),
      record({ sessionId: 'session-0003', startedAt: '2026-10-08T09:30:00.000Z', planStub: 'other', plan: '.plans/PLAN-other.md', decisions: [DEFER] }),
      record({ sessionId: 'session-0004', startedAt: '2026-10-08T10:00:00.000Z', state: 'running', pid: 7777, decisions: [DEFER] }),
    );

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: (pid) => pid === 7777 })).toEqual([JUMP]);
  });

  it('reads the list a forced wrap-up run saved, though that run ended done', () => {
    const root = freshRoot();
    plant(
      root,
      record({ sessionId: 'session-0001', startedAt: '2026-10-08T08:00:00.000Z', decisions: [DEFER] }),
      record({ sessionId: 'session-0002', startedAt: '2026-10-08T09:00:00.000Z', state: 'done', decisions: [JUMP] }),
    );

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: GONE })).toEqual([JUMP]);
  });

  it('reads nothing past a newer run that ended with no list, done or stopped', () => {
    const root = freshRoot();
    plant(
      root,
      record({ sessionId: 'session-0001', startedAt: '2026-10-08T08:00:00.000Z', decisions: [JUMP] }),
      record({ sessionId: 'session-0002', startedAt: '2026-10-08T09:00:00.000Z', state: 'done' }),
    );

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: GONE })).toEqual([]);
  });

  it('reads a running record whose pid is gone as stopped', () => {
    const root = freshRoot();
    plant(root, record({ state: 'running', decisions: [DEFER] }));

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: ALIVE })).toEqual([]);
    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: GONE })).toEqual([DEFER]);
  });

  it('answers nothing when the newest stopped run saved no list, an older one\'s included', () => {
    const root = freshRoot();
    plant(
      root,
      record({ sessionId: 'session-0001', startedAt: '2026-10-08T08:00:00.000Z', decisions: [JUMP] }),
      record({ sessionId: 'session-0002', startedAt: '2026-10-08T09:00:00.000Z' }),
    );

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: GONE })).toEqual([]);
  });

  it('matches a stubless plan by its path', () => {
    const root = freshRoot();
    plant(root, record({ planStub: null, plan: 'PLAN.md', decisions: [JUMP] }));

    expect(readPreviousPassOver(root, { ...demoPlan(root), planPath: join(root, 'PLAN.md'), planStub: null }, { isAlive: GONE })).toEqual([JUMP]);
    expect(readPreviousPassOver(root, { ...demoPlan(root), planPath: join(root, 'OTHER.md'), planStub: null }, { isAlive: GONE })).toEqual([]);
  });

  it('reads no list another branch\'s stopped run of the plan saved', () => {
    const root = freshRoot();
    plant(root, record({ branch: 'feat/demo-old', decisions: [JUMP] }));

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: GONE })).toEqual([]);
    // The control: the same record on the run's branch is read.
    expect(readPreviousPassOver(root, { ...demoPlan(root), branch: 'feat/demo-old' }, { isAlive: GONE })).toEqual([JUMP]);
  });

  it('reads a record naming a worktree only from a run in that worktree, and one naming none from any', () => {
    const root = freshRoot();
    const worktree = join(root, 'wt', 'demo');
    plant(root, record({ worktree, decisions: [JUMP] }));

    expect(readPreviousPassOver(root, demoPlan(root), { isAlive: GONE })).toEqual([]);
    expect(readPreviousPassOver(root, { ...demoPlan(root), checkout: join(root, 'wt', 'other') }, { isAlive: GONE })).toEqual([]);
    expect(readPreviousPassOver(root, { ...demoPlan(root), checkout: worktree }, { isAlive: GONE })).toEqual([JUMP]);

    const bare = freshRoot();
    plant(bare, record({ decisions: [DEFER] }));
    expect(readPreviousPassOver(bare, { ...demoPlan(bare), checkout: join(bare, 'wt', 'demo') }, { isAlive: GONE })).toEqual([DEFER]);
  });
});

/** Writes `events`, each a name and its data, as `record`'s events file. */
function plantEvents(root: string, value: SessionRecord, events: readonly (readonly [string, Record<string, unknown>])[]): void {
  const lines = events.map(([name, data]) => JSON.stringify({ name, summary: name, data, ts: '2026-10-08T10:00:00.000Z' }));
  writeFileSync(eventsFileOf(root, value), `${lines.join('\n')}\n`);
}

describe('readPreviousDecisionNeeded', () => {
  const NEEDED = ['decision-needed', { task: 'Gate on .env.local  {model=haiku}', line: 4 }] as const;

  it('answers the task and line the previous run\'s decision-needed named', () => {
    const root = freshRoot();
    const stopped = record({ decisions: [] });
    plant(root, stopped);
    plantEvents(root, stopped, [['task-start', {}], NEEDED, ['task-blocked', { reason: 'status: blocked' }]]);

    expect(readPreviousDecisionNeeded(root, demoPlan(root), { isAlive: GONE })).toEqual({ task: 'Gate on .env.local  {model=haiku}', line: 4 });
  });

  it('answers none when the previous run went on past its decision, or never needed one', () => {
    const root = freshRoot();
    const went = record();
    plant(root, went);
    plantEvents(root, went, [['task-start', {}], NEEDED, ['task-blocked', {}], ['decision', { strategy: 'jump' }], ['task-start', {}]]);

    expect(readPreviousDecisionNeeded(root, demoPlan(root), { isAlive: GONE })).toBeNull();
    expect(readPreviousDecisionNeeded(freshRoot(), demoPlan(freshRoot()), { isAlive: GONE })).toBeNull();
  });

  it('reads past a newer run that reached no task, as one refused before its loop did', () => {
    const root = freshRoot();
    const needed = record({ sessionId: 'session-0001', startedAt: '2026-10-08T08:00:00.000Z' });
    const refused = record({ sessionId: 'session-0002', startedAt: '2026-10-08T09:00:00.000Z' });
    plant(root, needed, refused);
    plantEvents(root, needed, [['task-start', {}], NEEDED, ['task-blocked', {}]]);
    plantEvents(root, refused, [['error', { message: 'refused' }]]);

    expect(readPreviousDecisionNeeded(root, demoPlan(root), { isAlive: GONE })).toEqual({ task: 'Gate on .env.local  {model=haiku}', line: 4 });
  });
});
