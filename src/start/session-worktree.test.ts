/**
 * Tests for the worktree path `loop start` records on a run whose
 * checkout is not the project root (`start/session.ts`):
 * {@link openRunSession} handed a checkout, over a fresh project root per
 * case.
 *
 * The stamp sits beside two controls differing in one thing: the same
 * open with the checkout the project root itself, and with no checkout
 * handed at all. A key left out is asserted with `Object.keys`, since
 * bun's `toEqual` reads a key set to undefined as a key left out.
 */
import type { RunSessionOptions } from './session.js';

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSession } from '../loop/sessions.js';

import { openRunSession } from './session.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-session-worktree-'));

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

/** The id every opened session is given. */
const ID = 'session-0370';

/** A pid probe answering every pid alive. */
const ALIVE = (): boolean => true;

/** The keys a record without a hop or a worktree holds, in the order it is written. */
const PLAIN_KEYS = ['sessionId', 'planStub', 'plan', 'branch', 'pid', 'startedAt', 'state', 'task'];

/** Opens a `demo` session under `root` with `overrides` laid over its options, and answers the stored record. */
function opened(root: string, overrides: Partial<RunSessionOptions> = {}) {
  openRunSession({
    repoRoot: root,
    planPath: join(root, '.rafa', 'plans', 'PLAN-demo.md'),
    planStub: 'demo',
    branch: 'feat/demo',
    seams: { newSessionId: () => ID, pid: 5151, now: () => new Date('2026-09-29T11:00:00.000Z'), isAlive: ALIVE },
    ...overrides,
  });
  return readSession(root, ID, { isAlive: ALIVE });
}

describe('openRunSession and the worktree path', () => {
  it('records a checkout other than the project root as the worktree, keeping the plan relative to the root', () => {
    const root = freshRoot();
    const worktree = join(root, '.rafa', 'worktrees', 'demo');

    const record = opened(root, { checkout: worktree });

    expect(record.worktree).toBe(worktree);
    expect(Object.keys(record)).toEqual([...PLAIN_KEYS, 'worktree']);
    expect(record.plan).toBe(join('.rafa', 'plans', 'PLAN-demo.md'));
  });

  it('records no worktree key when the checkout is the project root', () => {
    const root = freshRoot();

    const record = opened(root, { checkout: root });

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
  });

  it('records no worktree key when no checkout is handed', () => {
    const root = freshRoot();

    const record = opened(root);

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
  });
});
