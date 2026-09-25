/**
 * An end-to-end proof of `rafa instinct list --blessed` and
 * `--conflicts`: two trigger pairs are pushed through the `local`
 * learning adapter into a scratch repository (0.5/0.8, a clear winner,
 * and 0.5/0.55, within the gap), then `rafa instinct list` is spawned
 * as `bun src/rafa.ts` under the scratch HOME.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { DescribedInstinctRecord } from '../adapters/learning/local.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createLocalLearning, localInstinctsDir } from '../adapters/learning/local.js';
import { actionHash } from '../learning/index.js';

import { plantScratchRepo, runRafa } from './cli-capture.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-list-')));
const RUN_TIMEOUT = 30_000;
const NOW = '2026-09-25T00:00:00.000Z';

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** One record for `trigger` and `action`, held by one source. */
function record(id: string, trigger: string, action: string, confidence: number): DescribedInstinctRecord {
  return {
    id,
    trigger,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: 1,
    sources: ['task-1'],
    signal: 'loud',
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
    description: {
      kind: 'gotcha',
      domain: 'testing',
      scope: 'project',
      source: 'task-report',
      evidence: [{ plan: 'rafa-25', task: 6, session: 'session-1', outcome: 'done' }],
      cause: 'a scratch cause',
      projectId: null,
    },
  };
}

let scratch: ScratchRepo;

beforeAll(async () => {
  scratch = plantScratchRepo(tempRoot);
  const learning = createLocalLearning({
    instinctsDir: localInstinctsDir(scratch.repo),
    home: scratch.home,
    minConfidence: 0.5,
    now: () => NOW,
  });
  await learning.push({
    source_id: 'task-1',
    instincts: [
      record('clear-low', 'clear winner trigger', 'use the slow path', 0.5),
      record('close-a', 'close call trigger', 'restart the daemon', 0.5),
    ],
  });
  await learning.push({
    source_id: 'task-2',
    instincts: [
      record('clear-high', 'clear winner trigger', 'use the fast path', 0.8),
      record('close-b', 'close call trigger', 'clear the cache', 0.55),
    ],
  });
});

describe('rafa instinct list in a scratch repository', () => {
  it('--blessed shows the 0.8 action and not the losing or flagged ones', () => {
    const run = runRafa(scratch, scratch.repo, ['instinct', 'list', '--blessed']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('use the fast path');
    expect(run.stdout).not.toContain('use the slow path');
    expect(run.stdout).not.toContain('restart the daemon');
    expect(run.stdout).not.toContain('clear the cache');
  }, RUN_TIMEOUT);

  it('--conflicts shows the flagged pair side by side, highest confidence first', () => {
    const run = runRafa(scratch, scratch.repo, ['instinct', 'list', '--conflicts']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('close call trigger');
    const cache = run.stdout.indexOf('clear the cache');
    const daemon = run.stdout.indexOf('restart the daemon');
    expect(cache).toBeGreaterThan(-1);
    expect(daemon).toBeGreaterThan(cache);
    expect(run.stdout).not.toContain('use the fast path');
    expect(run.stdout).not.toContain('use the slow path');
  }, RUN_TIMEOUT);
});
