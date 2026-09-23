/**
 * A `search` session row through both store backends.
 *
 * `search` is the session kind `rafa skill search` and
 * `rafa agent search` add to `SessionKind`. The row below is typed as
 * {@link SessionEffortRow} with no cast, but `tsconfig.json` excludes
 * `*.test.ts` from `check-types`, so that typing gates nothing; the
 * kind's membership is asserted at run time instead, below. The cases
 * prove each backend stores and answers the row as it stores every
 * other kind: the row
 * read back byte-identical (compared by `JSON.stringify`, which unlike
 * `toEqual` sees field order), keyed by its session id, and still there
 * through a second handle over the same root.
 *
 * Neither backend validates `kind` — the SQLite `sessions` table keeps
 * the row as JSON beside its key — so the kind's membership in what a
 * report can filter by is asserted here too, against `SESSION_KINDS`,
 * with `task` as the control that the lookup answers a member at all.
 */
import type { SessionEffortRow } from '../collect.js';
import type { EffortStore } from './types.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SESSION_KINDS } from '../report.js';

import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore } from './sqlite.js';

/** A search session's row as the collector writes one, every field present. */
const SEARCH_SESSION: SessionEffortRow = {
  sessionId: '5ea4c400-0000-4000-8000-000000000001',
  filePath: '/logs/5ea4c400-0000-4000-8000-000000000001.jsonl',
  lineCount: 8,
  recordCount: 8,
  unparsedLineCount: 0,
  recordTypeCounts: { assistant: 4, user: 3, 'queue-operation': 1 },
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
  kind: 'search',
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

/** Both openers, named as `.rafa/config.yaml`'s `store` key names them. */
const BACKENDS: readonly (readonly [string, (root: string) => EffortStore])[] = [
  ['sqlite', openSqliteStore],
  ['ndjson', openNdjsonStore],
];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-store-search-row-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

describe('the search session kind', () => {
  it('is a kind a report can filter by', () => {
    expect(SESSION_KINDS).toContain('task');
    expect(SESSION_KINDS).toContain('search');
  });
});

describe.each(BACKENDS)('%s: a search session row', (name, open) => {
  it('appends and reads back byte-identical', () => {
    const store = open(join(tempBase, `${name}-round-trip`));

    const result = store.append('sessions', [SEARCH_SESSION]);
    const rows = store.read('sessions');

    expect([result.appended, result.skipped]).toEqual([1, 0]);
    expect(rows.map((row) => JSON.stringify(row))).toEqual([JSON.stringify(SEARCH_SESSION)]);
    expect(rows[0]?.kind).toBe('search');
  });

  it('is keyed by its session id and survives a second handle', () => {
    const root = join(tempBase, `${name}-reopen`);
    open(root).append('sessions', [SEARCH_SESSION]);

    const reopened = open(root);

    expect(reopened.keys('sessions')).toEqual(new Set([SEARCH_SESSION.sessionId]));
    expect(reopened.read('sessions').map((row) => row.kind)).toEqual(['search']);
    const again = reopened.append('sessions', [SEARCH_SESSION]);
    expect([again.appended, again.skipped]).toEqual([0, 1]);
  });
});
