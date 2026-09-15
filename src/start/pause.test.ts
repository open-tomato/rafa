/**
 * Tests for the loop's hold between tasks (`start/pause.ts`).
 *
 * Each case plants a session record under a fresh project root in this
 * file's temporary directory, and drives `holdWhilePaused` with a sleep
 * seam that waits for nothing: it records the milliseconds it was asked
 * for and runs the step the case names for that wait, as
 * `rafa loop resume` would act between two reads. A wait past the fortieth
 * throws, so a hold that never ends fails its case rather than the suite.
 * The lines are read through a sink output set for the case and unset
 * after it.
 *
 * Each ending sits beside a control: a record reading `running`, which the
 * hold neither waits on nor writes to nor prints for, beside the same
 * record `paused`; a resume after two waits beside an interrupt after one,
 * and beside a resume written during the wait the interrupt came in, which
 * the interrupt wins; a record removed while held beside the same hold
 * with the record there;
 * and a task that cannot be cleared beside one that is.
 */
import type { PauseHoldOutcome } from './pause.js';
import type { SessionRecord } from '../loop/sessions.js';

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { runsDir, sessionFilePath, updateSession } from '../loop/sessions.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { holdWhilePaused, PAUSE_POLL_MS } from './pause.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-pause-'));

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

/** The id of the session every case holds. */
const ID = 'session-0300';

/** The most waits a case allows before it calls the hold endless. */
const MAX_WAITS = 40;

/** The line the hold writes once it holds. */
const HOLDING = `info:\n⏸️  Session ${ID} is paused before its next task: \`rafa loop resume\` goes on, and \`rafa loop stop\` ends the run.`;

/** The line the hold writes once it is resumed. */
const RESUMED = `info:▶️  Session ${ID} resumed.`;

/** A record of the `demo` plan running its first task, with `overrides` laid over it. */
function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: ID,
    planStub: 'demo',
    plan: '.plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 6161,
    startedAt: '2026-09-15T12:00:00.000Z',
    state: 'running',
    task: { line: 3, text: 'The first task' },
    ...overrides,
  };
}

/** Writes a record by hand, as `loop start` and `loop pause` would, and answers its path. */
function plantRecord(root: string, value: SessionRecord): string {
  mkdirSync(runsDir(root), { recursive: true });
  const file = sessionFilePath(root, value.sessionId);
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

/** The record as the file stores it. */
function stored(root: string): SessionRecord {
  return JSON.parse(readFileSync(sessionFilePath(root, ID), 'utf8')) as SessionRecord;
}

/** How one hold went. */
interface Held {
  readonly outcome: PauseHoldOutcome;
  /** The milliseconds each wait was asked for, in order. */
  readonly waits: readonly number[];
  /** Each line written, as `level:message`. */
  readonly lines: readonly string[];
}

/** What a case hands the hold beyond its steps. */
interface HoldOptions {
  /** The run reads as interrupted once this many waits have run. */
  readonly interruptAfter?: number;
  /** The poll the seam names; the module's own when left out. */
  readonly pollMs?: number;
}

/** Holds the session under `root`, running `steps[i]` during wait `i`. See the file note. */
async function hold(root: string, steps: readonly (() => void)[], options: HoldOptions = {}): Promise<Held> {
  const lines: string[] = [];
  const waits: number[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.push(`info:${message}`);
    },
    warn: (message) => {
      lines.push(`warn:${message}`);
    },
    error: (message) => {
      lines.push(`error:${message}`);
    },
  }));
  try {
    const outcome = await holdWhilePaused({
      repoRoot: root,
      sessionId: ID,
      isInterrupted: () => options.interruptAfter !== undefined && waits.length >= options.interruptAfter,
      seams: {
        pollMs: options.pollMs,
        sleep: async (ms) => {
          if (waits.length >= MAX_WAITS) throw new Error(`the hold did not end after ${MAX_WAITS} waits`);
          waits.push(ms);
          steps[waits.length - 1]?.();
        },
      },
    });
    return { outcome, waits, lines };
  } finally {
    setActiveOutput(null);
  }
}

/** A step writing `running` to the record, as `rafa loop resume` does. */
function resumeStep(root: string): () => void {
  return () => {
    updateSession(root, ID, { state: 'running' });
  };
}

describe('holdWhilePaused over a record that is not paused', () => {
  it('answers not-paused at once for a running record, waiting on, writing and printing nothing', async () => {
    const root = freshRoot();
    const file = plantRecord(root, record());
    const before = readFileSync(file, 'utf8');

    const held = await hold(root, []);

    expect(held).toEqual({ outcome: 'not-paused', waits: [], lines: [] });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('holdWhilePaused over a paused record', () => {
  it('clears the task, then holds until a wait finds the record running again', async () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));
    const seenDuringFirstWait: (SessionRecord['task'] | undefined)[] = [];

    const held = await hold(root, [() => seenDuringFirstWait.push(stored(root).task), resumeStep(root)]);

    expect(held.outcome).toBe('resumed');
    expect(held.waits).toEqual([PAUSE_POLL_MS, PAUSE_POLL_MS]);
    expect(seenDuringFirstWait).toEqual([null]);
    expect(stored(root)).toEqual(record({ state: 'running', task: null }));
    expect(held.lines).toEqual([HOLDING, RESUMED]);
  });

  it('waits the poll its seam names', async () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));

    const held = await hold(root, [resumeStep(root)], { pollMs: 25 });

    expect(held.waits).toEqual([25]);
    expect(held.outcome).toBe('resumed');
  });

  it('ends any stored state but paused as resumed, as a hand-written done', async () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));

    const held = await hold(root, [() => updateSession(root, ID, { state: 'done' })]);

    expect(held.outcome).toBe('resumed');
    expect(held.waits).toHaveLength(1);
  });

  it('ends as interrupted after the wait the run was interrupted during, the record still paused', async () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));

    const held = await hold(root, [], { interruptAfter: 1 });

    expect(held.outcome).toBe('interrupted');
    expect(held.waits).toEqual([PAUSE_POLL_MS]);
    expect(stored(root).state).toBe('paused');
    expect(held.lines).toEqual([HOLDING]);
  });

  it('ends as interrupted when a resume is written during the wait the run was interrupted in', async () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));

    const held = await hold(root, [resumeStep(root)], { interruptAfter: 1 });

    expect(held.outcome).toBe('interrupted');
    expect(held.lines).toEqual([HOLDING]);
  });

  it('ends as interrupted before any wait for a run interrupted already', async () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));

    const held = await hold(root, [], { interruptAfter: 0 });

    expect(held.outcome).toBe('interrupted');
    expect(held.waits).toEqual([]);
  });
});

describe('holdWhilePaused over a record it cannot read or write', () => {
  it('warns and answers unreadable, waiting on nothing, when there is no record', async () => {
    const root = freshRoot();

    const held = await hold(root, []);

    expect(held.outcome).toBe('unreadable');
    expect(held.waits).toEqual([]);
    expect(held.lines).toHaveLength(1);
    expect(held.lines[0]).toStartWith(`warn:\n⚠️  Session ${ID}: its record cannot be read between tasks, so the run goes on unpaused: session record `);
  });

  it('warns and answers unreadable when the record is removed while held', async () => {
    const root = freshRoot();
    const file = plantRecord(root, record({ state: 'paused' }));

    const held = await hold(root, [() => rmSync(file)]);

    expect(held.outcome).toBe('unreadable');
    expect(held.waits).toEqual([PAUSE_POLL_MS]);
    expect(held.lines[0]).toBe(HOLDING);
    expect(held.lines[1]).toContain('its record cannot be read between tasks');
  });

  it('warns that the task was not cleared and still holds, when the runs directory cannot be written', async () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));
    chmodSync(runsDir(root), 0o500);
    let held: Held;
    try {
      held = await hold(root, [() => {
        chmodSync(runsDir(root), 0o700);
        updateSession(root, ID, { state: 'running' });
      }]);
    } finally {
      chmodSync(runsDir(root), 0o700);
    }

    expect(held.outcome).toBe('resumed');
    expect(held.lines).toHaveLength(3);
    expect(held.lines[0]).toStartWith(`warn:\n⚠️  Session ${ID}: that no task runs while paused was not written: `);
    expect(held.lines.slice(1)).toEqual([HOLDING, RESUMED]);
    expect(stored(root).task).toEqual({ line: 3, text: 'The first task' });
  });
});
