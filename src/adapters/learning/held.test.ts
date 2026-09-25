/**
 * Tests for the held set's mapping (`src/adapters/learning/held.ts`).
 *
 * Every instinct a case starts from is read by `parseInstinct` from the
 * text `writeInstinct` makes, so the cases run over what the adapter
 * reads off a real `.md` file. Merged records come from the library's
 * own `merge`, not from hand-built literals, so a case about "the
 * earliest held member of a merged record" is about the record `merge`
 * answers.
 *
 * Each selection sits beside a control that the other answer was
 * reachable: the earliest member's description beside the same pair aged
 * the other way round, a flagged trigger beside one held twice with one
 * action, the fallback beside a held member that overrides it.
 */
import type { InstinctRecord } from '../../ports/index.js';
import type { Instinct } from '../../schema/instinct.js';

import { describe, expect, test } from 'bun:test';

import { actionHash, merge } from '../../learning/index.js';
import { parseInstinct, writeInstinct } from '../../schema/instinct.js';

import {
  earliestHeldMember,
  toHeldInstinct,
  toHeldRecord,
  toHeldRecords,
} from './held.js';

/** The trigger every fixture carries unless it says otherwise. */
const TRIGGER = 'when running tests in a freshly forked worktree';

/** The action every fixture carries unless it says otherwise. */
const ACTION = 'Run `bun install --frozen-lockfile` before the first test.';

/** The time a merge in these cases stamps. */
const NOW = '2026-09-25T12:00:00Z';

/** What a fixture may change, in the `Instinct` names, without its hash. */
type Changes = Partial<Omit<Instinct, 'actionHash'>>;

/**
 * A held instinct as `parseInstinct` reads it from the file
 * `writeInstinct` makes of the defaults plus `changes`.
 */
function heldInstinct(changes: Changes = {}): Instinct {
  const action = changes.action ?? ACTION;
  const drafted: Instinct = {
    id: 'bun-install-after-fork',
    trigger: TRIGGER,
    kind: 'gotcha',
    domain: 'workflow',
    confidence: 0.5,
    usageCount: 1,
    sources: [],
    artifact: null,
    signal: 'loud',
    scope: 'project',
    projectId: null,
    source: 'demoted',
    evidence: [],
    promotedTo: null,
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-20T10:00:00Z',
    action,
    cause: 'Worktree creation copies the tree, not `node_modules`.',
    ...changes,
    actionHash: actionHash(action),
  };
  const parsed = parseInstinct(writeInstinct(drafted));
  expect(parsed.issues).toEqual([]);
  return parsed.instinct!;
}

/** The instincts `merge` produced for the payload's first record. */
function producedBy(held: readonly Instinct[], source: string, incoming: InstinctRecord): InstinctRecord[] {
  const result = merge(toHeldRecords(held), { source_id: source, instincts: [incoming] }, NOW);
  return result.decisions[0]!.produced;
}

describe('toHeldRecord', () => {
  test('answers the port\'s fields in the port\'s order, active, leaving absent optionals out', () => {
    const instinct = heldInstinct();

    const record = toHeldRecord(instinct);

    expect(Object.keys(record)).toEqual([
      'id',
      'trigger',
      'action',
      'action_hash',
      'confidence',
      'usage_count',
      'signal',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(record).toEqual({
      id: 'bun-install-after-fork',
      trigger: TRIGGER,
      action: ACTION,
      action_hash: actionHash(ACTION),
      confidence: 0.5,
      usage_count: 1,
      signal: 'loud',
      status: 'active',
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
    });
  });

  test('carries sources, artifact and promoted_to when the file has them', () => {
    const instinct = heldInstinct({
      sources: ['s-1', 's-2'],
      usageCount: 2,
      artifact: 'Cannot find package',
      promotedTo: 'context/verification.md',
    });

    const record = toHeldRecord(instinct);

    expect(Object.keys(record)).toEqual([
      'id',
      'trigger',
      'action',
      'action_hash',
      'confidence',
      'usage_count',
      'sources',
      'artifact',
      'signal',
      'status',
      'promoted_to',
      'created_at',
      'updated_at',
    ]);
    expect(record).toMatchObject({
      sources: ['s-1', 's-2'],
      usage_count: 2,
      artifact: 'Cannot find package',
      promoted_to: 'context/verification.md',
    });
    expect(record.sources).not.toBe(instinct.sources);
  });

  test('carries none of the file\'s descriptive fields as record keys', () => {
    const record = toHeldRecord(heldInstinct({ projectId: '8f2c1a9d3e4b' }));

    for (const key of ['kind', 'domain', 'scope', 'source', 'evidence', 'cause', 'project_id']) {
      expect(Object.hasOwn(record, key)).toBe(false);
    }
  });
});

describe('toHeldRecords', () => {
  test('flags every record on a trigger held with two actions, one wording apart', () => {
    const leader = heldInstinct({ id: 'leader', confidence: 0.55 });
    const rival = heldInstinct({
      id: 'rival',
      trigger: `  ${TRIGGER.toUpperCase().replace(' ', '   ')} `,
      action: 'Copy node_modules into the worktree.',
    });
    const lone = heldInstinct({ id: 'lone', trigger: 'when a hook refuses a commit' });

    const records = toHeldRecords([leader, rival, lone]);

    expect(records.map((record) => [record.id, record.status])).toEqual([
      ['leader', 'flagged'],
      ['rival', 'flagged'],
      ['lone', 'active'],
    ]);
  });

  test('keeps a trigger held twice with one action active', () => {
    const first = heldInstinct({ id: 'first' });
    const second = heldInstinct({ id: 'second', action: `  ${ACTION.toUpperCase()}  ` });

    const records = toHeldRecords([first, second]);

    expect(records.map((record) => record.status)).toEqual(['active', 'active']);
  });

  test('answers the flagged pair a merge produced once the pair is written and read back', () => {
    const produced = producedBy(
      [heldInstinct({ id: 'held', confidence: 0.5 })],
      'session-b',
      toHeldRecord(heldInstinct({
        id: 'pushed',
        action: 'Copy node_modules into the worktree.',
        confidence: 0.55,
        createdAt: '2026-09-21T10:00:00Z',
      })),
    );
    expect(produced.map((record) => record.status)).toEqual(['flagged', 'flagged']);
    const fallback = heldInstinct();

    const written = produced.map((record) => toHeldInstinct(record, [], fallback)!);
    const reread = written.map((instinct) => parseInstinct(writeInstinct(instinct)).instinct!);

    expect(toHeldRecords(reread).map((record) => [record.id, record.status])).toEqual([
      ['pushed', 'flagged'],
      ['held', 'flagged'],
    ]);
  });

  test('answers an empty set as no records', () => {
    expect(toHeldRecords([])).toEqual([]);
  });
});

describe('earliestHeldMember', () => {
  const older = heldInstinct({ id: 'b-older', createdAt: '2026-09-19T10:00:00Z' });
  const newer = heldInstinct({ id: 'a-newer', createdAt: '2026-09-20T10:00:00Z' });

  test('answers the oldest held instinct on the trigger with the action hash', () => {
    expect(earliestHeldMember(toHeldRecord(newer), [newer, older])?.id).toBe('b-older');
  });

  test('orders one created_at by id', () => {
    const twin = heldInstinct({ id: 'a-twin', createdAt: '2026-09-19T10:00:00Z' });

    expect(earliestHeldMember(toHeldRecord(newer), [older, twin])?.id).toBe('a-twin');
  });

  test('passes over an older instinct on another trigger or with another action', () => {
    const otherTrigger = heldInstinct({
      id: 'other-trigger',
      trigger: 'when a hook refuses a commit',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const otherAction = heldInstinct({
      id: 'other-action',
      action: 'Copy node_modules into the worktree.',
      createdAt: '2026-01-01T00:00:00Z',
    });

    const found = earliestHeldMember(toHeldRecord(newer), [otherTrigger, otherAction, newer]);

    expect(found?.id).toBe('a-newer');
  });

  test('answers null when no held instinct is a member', () => {
    expect(earliestHeldMember(toHeldRecord(newer), [])).toBeNull();
  });
});

describe('toHeldInstinct', () => {
  /** Two held members of one action, each described differently. */
  function describedPair(firstAt: string, secondAt: string): [Instinct, Instinct] {
    return [
      heldInstinct({
        id: 'first',
        kind: 'gotcha',
        domain: 'workflow',
        scope: 'project',
        source: 'demoted',
        evidence: [{ extracted: '2026-09-01' }],
        cause: 'The first cause.',
        projectId: '8f2c1a9d3e4b',
        sources: ['s-1'],
        createdAt: firstAt,
        updatedAt: firstAt,
      }),
      heldInstinct({
        id: 'second',
        kind: 'pattern',
        domain: 'testing',
        scope: 'user',
        source: 'task-report',
        evidence: [{ plan: 'p', task: 't', session: 's-2', outcome: 'done' }],
        cause: 'The second cause.',
        projectId: null,
        sources: ['s-2'],
        confidence: 0.6,
        createdAt: secondAt,
        updatedAt: secondAt,
      }),
    ];
  }

  /** The descriptive fields of `instinct`. */
  function descriptionOf(instinct: Instinct): Partial<Instinct> {
    return {
      kind: instinct.kind,
      domain: instinct.domain,
      scope: instinct.scope,
      source: instinct.source,
      evidence: instinct.evidence,
      cause: instinct.cause,
      projectId: instinct.projectId,
    };
  }

  test('keeps the earliest held member\'s description on a record merge collapsed', () => {
    const held = describedPair('2026-09-18T10:00:00Z', '2026-09-19T10:00:00Z');
    const [record] = producedBy(held, 's-3', toHeldRecord(heldInstinct({
      id: 'third',
      kind: 'location',
      cause: 'The pushed cause.',
      createdAt: '2026-09-01T10:00:00Z',
    })));

    const written = toHeldInstinct(record!, held);

    expect(record!.id).toBe('third');
    expect(written).toMatchObject(descriptionOf(held[0]));
    expect(written).toMatchObject({
      id: record!.id,
      confidence: record!.confidence,
      usageCount: 3,
      sources: ['s-1', 's-2', 's-3'],
      updatedAt: NOW,
    });
  });

  test('keeps the other member\'s description when it is the earliest', () => {
    const held = describedPair('2026-09-19T10:00:00Z', '2026-09-18T10:00:00Z');
    const [record] = producedBy(held, 's-3', toHeldRecord(heldInstinct({ id: 'third' })));

    expect(toHeldInstinct(record!, held)).toMatchObject(descriptionOf(held[1]));
  });

  test('prefers a held member over the fallback', () => {
    const held = describedPair('2026-09-18T10:00:00Z', '2026-09-19T10:00:00Z');
    const fallback = heldInstinct({ kind: 'location', cause: 'The fallback cause.' });

    expect(toHeldInstinct(toHeldRecord(held[1]), held, fallback)).toMatchObject(descriptionOf(held[0]));
  });

  test('describes a new-trigger record by the fallback', () => {
    const fallback = heldInstinct({
      kind: 'pattern',
      domain: 'testing',
      source: 'task-report',
      evidence: [{ plan: 'p', task: 't', session: 's-9', outcome: 'done' }],
      cause: 'The fallback cause.',
    });
    const incoming = toHeldRecord(heldInstinct({ id: 'new', trigger: 'when a hook refuses a commit' }));
    const [record] = producedBy([heldInstinct()], 's-9', incoming);

    const written = toHeldInstinct(record!, [heldInstinct()], fallback);

    expect(written).toMatchObject({ ...descriptionOf(fallback), id: 'new', sources: ['s-9'] });
  });

  test('answers null when neither a held member nor a fallback describes the record', () => {
    const incoming = toHeldRecord(heldInstinct({ id: 'new', trigger: 'when a hook refuses a commit' }));

    expect(toHeldInstinct(incoming, [heldInstinct()])).toBeNull();
  });

  test('computes the action hash from the action rather than copying it', () => {
    const record = { ...toHeldRecord(heldInstinct()), action_hash: 'stale' };

    const written = toHeldInstinct(record, [], heldInstinct());

    expect(written?.actionHash).toBe(actionHash(ACTION));
  });

  test('writes a record without sources as none, and absent optionals as null', () => {
    const record = toHeldRecord(heldInstinct());

    expect(toHeldInstinct(record, [heldInstinct()])).toMatchObject({
      sources: [],
      artifact: null,
      promotedTo: null,
    });
  });

  test('reads a file back as the instinct it was, through a record and back', () => {
    const instinct = heldInstinct({
      sources: ['s-1', 's-2'],
      usageCount: 2,
      artifact: 'Cannot find package',
      promotedTo: 'context/verification.md',
      projectId: '8f2c1a9d3e4b',
      evidence: [{ plan: 'p', task: 't', session: 's-1', outcome: 'done' }],
    });

    const written = toHeldInstinct(toHeldRecord(instinct), [instinct])!;
    const reread = parseInstinct(writeInstinct(written));

    expect(written).toEqual(instinct);
    expect(reread.issues).toEqual([]);
    expect(reread.instinct).toEqual(instinct);
  });

  test('changes neither the record nor the held set', () => {
    const held = Object.freeze([Object.freeze(heldInstinct())]);
    const record = Object.freeze(toHeldRecord(heldInstinct({ sources: ['s-1'] })));

    const written = toHeldInstinct(record, held)!;

    expect(written.sources).not.toBe(record.sources);
    expect(written.evidence).not.toBe(held[0]!.evidence);
  });
});
