/**
 * Pins the keys of a session row, a commit row, and
 * {@link EFFORT_KEY_PROJECTIONS} against `row-fields.lock.json`.
 *
 * A store row is read back by an older installed runtime long after this
 * checkout is gone, so a field it once wrote has to keep meaning what it
 * meant then. Removing a field, or renaming one, is exactly the change
 * that breaks that older reader — the same hazard a SQL migration's
 * `breaks` names, but here for a row's own shape rather than the table
 * that holds it. `migrations.ts` pins the SQL each entry ships with a
 * sha256 lock; this file pins the row shapes the same way, as the sorted
 * set of keys each one is expected to carry.
 *
 * `SESSION_SAMPLE` and `COMMIT_SAMPLE` are typed with no cast against
 * {@link SessionEffortRow} and {@link CommitEffortRow}, one field per
 * property the interfaces declare. `tsconfig.json` excludes `*.test.ts`
 * from `check-types`, so a field dropped from a sample here compiles
 * regardless; what actually pins the shape is `Object.keys` read back at
 * run time and compared with the lock, below. `refuseRemovedKeys` is the
 * guard: it throws the spec's own refusal text the moment a key the lock
 * names is no longer present, and the near-miss case drives it red by
 * dropping one key from a lock-shaped list, without touching the
 * checked-in lock or either sample.
 */
import type { CommitEffortRow, SessionEffortRow } from './types.js';

import { describe, expect, it } from 'bun:test';

import ROW_FIELDS_LOCK from './row-fields.lock.json';
import { EFFORT_KEY_PROJECTIONS } from './types.js';

/** The lock file's shape: each row kind's keys, sorted. */
interface RowFieldsLock {
  readonly sessions: readonly string[];
  readonly commits: readonly string[];
  readonly keyProjections: readonly string[];
}

const LOCK: RowFieldsLock = ROW_FIELDS_LOCK;

/** The spec's refusal text for a stored row field removed or renamed. */
const REMOVED_FIELD_REFUSAL =
  'removing or renaming a stored row field breaks older readers; see context/effort-store.md, Migrations';

/**
 * A session row with every field {@link SessionEffortRow} declares, as
 * the collector's session half would write one.
 */
const SESSION_SAMPLE: SessionEffortRow = {
  sessionId: '5ea4c400-0000-4000-8000-000000000001',
  filePath: '/logs/5ea4c400-0000-4000-8000-000000000001.jsonl',
  lineCount: 8,
  recordCount: 8,
  unparsedLineCount: 0,
  recordTypeCounts: { assistant: 4, user: 3 },
  assistantRecordCount: 4,
  firstTimestamp: '2026-09-24T09:00:00.000Z',
  lastTimestamp: '2026-09-24T09:00:41.250Z',
  gitBranchCounts: { main: 7 },
  entrypointCounts: { 'sdk-cli': 8 },
  effortCounts: {},
  sidechainRecordCount: 0,
  modelCounts: { 'claude-haiku-4-5': 4 },
  usage: {
    inputTokens: 900,
    outputTokens: 210,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ephemeral1hInputTokens: 0,
    ephemeral5mInputTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    thinkingTokens: 0,
  },
  kind: 'task',
  mode: 'local',
  branch: 'main',
  branchRecordCount: 7,
  distinctBranchCount: 1,
  branchType: null,
  branchStub: null,
  planStub: null,
  planStubMatch: 'none',
  issueIdentifier: null,
  taskText: null,
  enqueueRecordIndex: 0,
  sizeBytes: 2048,
  modifiedAt: '2026-09-24T09:00:42.000Z',
};

/**
 * A commit row with every field {@link CommitEffortRow} declares, as the
 * commit parser would answer one.
 */
const COMMIT_SAMPLE: CommitEffortRow = {
  sha: '0123456789abcdef0123456789abcdef01234567',
  timestamp: '2026-09-11T10:00:00+02:00',
  subject: 'feat: a subject',
  author: 'An Author',
  branch: null,
  filesChanged: 3,
  insertions: 10,
  deletions: 2,
  parentCount: 1,
  minutesSincePrevious: 12.345,
};

/** A sample's own keys, sorted — what the lock is checked against. */
function sortedKeys(sample: object): readonly string[] {
  return Object.keys(sample).sort();
}

/**
 * Throws the spec's refusal the moment `locked` names a key `actual` no
 * longer carries — the check a removed or renamed field has to fail.
 */
function refuseRemovedKeys(
  locked: readonly string[],
  actual: readonly string[],
): void {
  const held = new Set(actual);
  const removed = locked.filter((key) => !held.has(key));
  if (removed.length > 0) throw new Error(REMOVED_FIELD_REFUSAL);
}

describe('the row fields lock', () => {
  it('holds exactly the session row\'s keys, sorted', () => {
    const actual = sortedKeys(SESSION_SAMPLE);
    expect(actual).toEqual([...LOCK.sessions].sort());
    expect(() => refuseRemovedKeys(LOCK.sessions, actual)).not.toThrow();
  });

  it('holds exactly the commit row\'s keys, sorted', () => {
    const actual = sortedKeys(COMMIT_SAMPLE);
    expect(actual).toEqual([...LOCK.commits].sort());
    expect(() => refuseRemovedKeys(LOCK.commits, actual)).not.toThrow();
  });

  it('holds exactly EFFORT_KEY_PROJECTIONS\'s keys, sorted', () => {
    const actual = sortedKeys(EFFORT_KEY_PROJECTIONS);
    expect(actual).toEqual([...LOCK.keyProjections].sort());
    expect(() => refuseRemovedKeys(LOCK.keyProjections, actual)).not.toThrow();
  });
});

describe('a stored row field removed or renamed (control)', () => {
  it('refuses with the spec\'s text when a session key drops out', () => {
    const withoutSessionId = LOCK.sessions.filter((key) => key !== 'sessionId');

    expect(() => refuseRemovedKeys(LOCK.sessions, withoutSessionId))
      .toThrow(REMOVED_FIELD_REFUSAL);
  });

  it('refuses with the spec\'s text when a commit key drops out', () => {
    const withoutSha = LOCK.commits.filter((key) => key !== 'sha');

    expect(() => refuseRemovedKeys(LOCK.commits, withoutSha))
      .toThrow(REMOVED_FIELD_REFUSAL);
  });

  it('refuses with the spec\'s text when a key projection drops out', () => {
    const withoutCommits = LOCK.keyProjections.filter((key) => key !== 'commits');

    expect(() => refuseRemovedKeys(LOCK.keyProjections, withoutCommits))
      .toThrow(REMOVED_FIELD_REFUSAL);
  });

  it('does not refuse a key added rather than removed', () => {
    const withExtra = [...LOCK.sessions, 'aNewField'];

    expect(() => refuseRemovedKeys(LOCK.sessions, withExtra)).not.toThrow();
  });
});
