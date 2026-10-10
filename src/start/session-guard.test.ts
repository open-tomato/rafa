/**
 * Tests for `haltBeforeSession` (`start/session-guard.ts`): which of the
 * two halts it runs for a task and for the wrap-up, the `halt` event it
 * emits on a move, and that a checkout that held writes, prints and
 * emits nothing.
 *
 * The guard reaches no disk and no git here: its seams answer a checkout
 * that holds or one that is gone. The tracker is a real file under this
 * file's temporary directory, since the task's halt marks its line. The
 * case that removes a real worktree between the first guard and the
 * render is in `dispatch.test.ts`.
 */
import type { CheckoutExpectation, CheckoutGuardSeams } from './checkout-guard.js';
import type { CliEvent } from '../ports/index.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import { CHECKOUT_MOVED, haltHeadline } from './checkout-guard.js';
import { haltBeforeSession } from './session-guard.js';

const CHECKOUT = '/scratch/worktree';
const BRANCH = 'feat/rafa-848';
const HEAD = 'a'.repeat(40);
const EXPECTED: CheckoutExpectation = { projectRoot: '/scratch/repo', checkout: CHECKOUT, branch: BRANCH, head: HEAD };
const TRACKER = '- [x] The task before\n- [ ] Hold the checkout before the render\n';

/** Seams answering a checkout on {@link BRANCH} at {@link HEAD}. */
const HELD: CheckoutGuardSeams = {
  realDir: (path) => path,
  git: () => (args) => {
    const stdout = args.includes('--show-toplevel')
      ? CHECKOUT
      : args.includes('symbolic-ref')
        ? BRANCH
        : HEAD;
    return { ok: true, stdout: `${stdout}\n`, stderr: '' };
  },
};

/** Seams answering a checkout whose directory is gone. */
const GONE: CheckoutGuardSeams = { realDir: () => null };

const scratch = mkdtempSync(join(tmpdir(), 'rafa-session-guard-'));
let planted = 0;

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A new tracker holding {@link TRACKER}. */
function plantTracker(): string {
  planted += 1;
  const path = join(scratch, `PLAN_TRACKER-${planted}.md`);
  writeFileSync(path, TRACKER);
  return path;
}

describe('haltBeforeSession', () => {
  let errors: string[] = [];
  let events: CliEvent[] = [];

  beforeEach(() => {
    errors = [];
    events = [];
    setActiveOutput(sinkOutput({ error: (line) => errors.push(line), event: (event) => events.push(event) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** The name and data of each event emitted, without its timestamp. */
  const emitted = (): unknown[] => events.map((event) => (event.type === 'event'
    ? { name: event.name, data: event.data }
    : event));

  it('answers false and writes, prints and emits nothing while the checkout holds', () => {
    const trackerPath = plantTracker();

    expect(haltBeforeSession({ expected: EXPECTED, trackerPath, taskInfo: { lineNum: 1 } }, HELD)).toBe(false);
    expect(haltBeforeSession({ expected: EXPECTED, trackerPath, taskInfo: null }, HELD)).toBe(false);

    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(errors).toEqual([]);
    expect(events).toEqual([]);
  });

  it('marks the task blocked on the guard\'s text and emits the halt when the checkout is gone', () => {
    const trackerPath = plantTracker();

    expect(haltBeforeSession({ expected: EXPECTED, trackerPath, taskInfo: { lineNum: 1 } }, GONE)).toBe(true);

    const task = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(task?.status).toBe('blocked');
    expect(task?.blocker).toBe(CHECKOUT_MOVED);
    expect(errors[0]).toBe(`\n${haltHeadline(CHECKOUT)}`);
    expect(errors.at(-1)).toBe(`   Task marked as blocked on ${CHECKOUT_MOVED}; nothing was dispatched. Restore the checkout, then run again.`);
    expect(emitted()).toEqual([{ name: 'halt', data: { reason: CHECKOUT_MOVED } }]);
  });

  it('marks nothing ahead of the wrap-up, and still prints and emits the halt', () => {
    const trackerPath = plantTracker();

    expect(haltBeforeSession({ expected: EXPECTED, trackerPath, taskInfo: null }, GONE)).toBe(true);

    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(errors[0]).toBe(`\n${haltHeadline(CHECKOUT)}`);
    expect(errors.at(-1)).toBe('   The wrap-up was not started. Restore the checkout, then run again to retry the wrap-up.');
    expect(emitted()).toEqual([{ name: 'halt', data: { reason: CHECKOUT_MOVED } }]);
  });
});
