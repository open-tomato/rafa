/**
 * Integration test for the `local` Learning adapter over a real
 * directory: the definition-of-done lessons two sessions push settle
 * into a blessed bundle, a flagged pair and a `discarded` push-log
 * line, and a flag on the bundle's leader, written by id, survives a
 * later push.
 */
import type { DescribedInstinctRecord, PushLogLine } from '../adapters/learning/local.js';
import type { Learning, SyncPayload } from '../ports/index.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createLocalLearning, localInstinctsDir } from '../adapters/learning/local.js';
import { actionHash } from '../learning/index.js';

const NOW = '2026-09-14T10:00:00.000Z';
const FIRST = '2026-09-12T10:00:00.000Z';
const SECOND = '2026-09-13T10:00:00.000Z';

const DONE_TRIGGER = 'a task says done before its definition of done holds';
const CHECK_TRIGGER = 'the definition of done names a check no gate runs';

const RUN_GATES = 'run every gate the definition of done names before writing done';
const TRUST_SELF = 'trust the diff and write done';
const NAME_GATE = 'name the gate command beside each line of the definition';
const NAME_FILE = 'name the file each line of the definition touches';

let tempDir = '';
let root = '';
let learning: Learning;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-learning-adapter-'));
  root = join(tempDir, 'repo');
  learning = createLocalLearning({
    instinctsDir: localInstinctsDir(root),
    home: join(tempDir, 'home'),
    minConfidence: 0.5,
    now: () => NOW,
    warn: () => undefined,
  });
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

function lesson(
  id: string,
  trigger: string,
  action: string,
  confidence: number,
  createdAt: string,
): DescribedInstinctRecord {
  return {
    id,
    trigger,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: createdAt,
    updated_at: createdAt,
    description: {
      kind: 'gotcha',
      domain: 'workflow',
      scope: 'project',
      source: 'task-report',
      evidence: [{ plan: 'rafa-25', task: 1, session: 'session', outcome: 'done' }],
      cause: 'the definition of done was not checked',
      projectId: null,
    },
  };
}

function payload(sourceId: string, ...instincts: DescribedInstinctRecord[]): SyncPayload {
  return { source_id: sourceId, instincts };
}

function pushLog(): PushLogLine[] {
  const text = readFileSync(join(localInstinctsDir(root), 'instincts.ndjson'), 'utf8');
  return text.split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line) as PushLogLine);
}

describe('local learning adapter across sessions', () => {
  it('blesses the leader, flags the close pair and logs the discarded action', async () => {
    await learning.push(payload(
      'session-1',
      lesson('done-run-gates', DONE_TRIGGER, RUN_GATES, 0.7, FIRST),
      lesson('check-name-gate', CHECK_TRIGGER, NAME_GATE, 0.6, FIRST),
    ));
    await learning.push(payload(
      'session-2',
      lesson('done-trust-self', DONE_TRIGGER, TRUST_SELF, 0.4, SECOND),
      lesson('check-name-file', CHECK_TRIGGER, NAME_FILE, 0.55, SECOND),
    ));

    const bundle = await learning.pullBlessed();
    expect(bundle.instincts.map((record) => record.id)).toEqual(['done-run-gates']);

    const log = pushLog();
    const discardedLine = log.find((line) => line.incoming.id === 'done-trust-self');
    expect(discardedLine?.source_id).toBe('session-2');
    expect(discardedLine?.rule).toBe('higher-confidence');
    expect(discardedLine?.discarded).toEqual(['done-trust-self']);
    expect(discardedLine?.produced).toEqual(['done-run-gates']);

    const flaggedLine = log.find((line) => line.incoming.id === 'check-name-file');
    expect(flaggedLine?.rule).toBe('flagged');
    expect([...flaggedLine!.produced].sort()).toEqual(['check-name-file', 'check-name-gate']);
    expect(flaggedLine?.discarded).toEqual([]);
  });

  it('keeps a leader flagged by id out of the bundle after a later push', async () => {
    await learning.flag('done-run-gates', 'the gates it names are stale');
    expect((await learning.pullBlessed()).instincts).toEqual([]);

    await learning.push(payload(
      'session-3',
      lesson('done-run-gates-again', DONE_TRIGGER, RUN_GATES, 0.7, '2026-09-14T09:00:00.000Z'),
    ));

    const bundle = await learning.pullBlessed();
    expect(bundle.instincts.map((record) => record.id)).not.toContain('done-run-gates');
    expect(bundle.instincts).toEqual([]);
  });
});
