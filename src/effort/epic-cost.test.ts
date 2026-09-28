/**
 * Tests for the epic cost reading.
 *
 * The store cases open real backends under a fresh temporary root, so an
 * empty store is the first-run absence both backends answer, not a stub
 * answering `[]`. Rows planted through the NDJSON backend are partial
 * session rows, cast as `store/contract.test.ts` casts its own: the
 * reading takes only the fields {@link EpicCostRow} names.
 *
 * The member-with-no-rows case plants rows for OTHER issues beside it,
 * including `rafa-2460-…`, whose stub opens with the member's digits, so a
 * prefix match without the hyphen reads as spend. Its control is the
 * stub-naming case, where the same store answers non-zero.
 */
import type { EpicCostRow } from './epic-cost.js';
import type { EffortRow } from './store/types.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  MEMBERSHIP_NOTE,
  NO_ESTIMATE,
  readEpicCost,
  renderEpicCost,
  summariseEpicCost,
} from './epic-cost.js';
import { emptyUsageTotals } from './session-log.js';
import { openNdjsonStore, openSqliteStore } from './store/index.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-epic-cost-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk. */
function freshRoot(): string {
  planted += 1;
  return join(tempBase, String(planted));
}

/** A session row with only what the reading needs. */
function row(fields: Partial<EpicCostRow> & { sessionId: string }): EpicCostRow {
  return {
    issueIdentifier: null,
    planStub: null,
    firstTimestamp: null,
    lastTimestamp: null,
    usage: emptyUsageTotals(),
    ...fields,
  };
}

/** Tokens split over the four counters the sum reads. */
function usage(input: number, output: number, cacheRead: number, cacheWrite: number): EpicCostRow['usage'] {
  return {
    ...emptyUsageTotals(),
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
    // Not a token the cost sums; planted so a sum over every counter reds.
    webSearchRequests: 99,
  };
}

/** Rows for issues other than #246 and #300. */
const OTHERS: readonly EpicCostRow[] = [
  row({
    sessionId: 'other-prefix',
    planStub: 'rafa-2460-other',
    firstTimestamp: '2026-09-01T10:00:00.000Z',
    lastTimestamp: '2026-09-01T11:00:00.000Z',
    usage: usage(1, 1, 1, 1),
  }),
  row({ sessionId: 'other-issue', issueIdentifier: 'RAFA-24', usage: usage(5, 5, 5, 5) }),
];

/** Plants partial rows through the NDJSON backend. */
function plantStore(rows: readonly EpicCostRow[]): ReturnType<typeof openNdjsonStore> {
  const store = openNdjsonStore(freshRoot());
  store.append('sessions', rows as unknown as readonly EffortRow<'sessions'>[]);
  return store;
}

describe('readEpicCost', () => {
  it('answers zero from an empty store on either backend', () => {
    for (const open of [openSqliteStore, openNdjsonStore]) {
      const cost = readEpicCost(open(freshRoot()), [246]);
      expect(cost).toEqual({ runs: 0, wallSeconds: 0, runsWithoutTime: 0, tokens: 0 });
    }
  });

  it('answers zero for a member no row names, beside rows for other issues', () => {
    const store = plantStore(OTHERS);
    expect(store.read('sessions')).toHaveLength(2);
    expect(readEpicCost(store, [246])).toEqual({ runs: 0, wallSeconds: 0, runsWithoutTime: 0, tokens: 0 });
  });

  it('counts a run whose plan stub names a member', () => {
    const store = plantStore([
      ...OTHERS,
      row({
        sessionId: 'by-stub',
        planStub: 'rafa-246-epic-lifecycle',
        firstTimestamp: '2026-09-02T10:00:00.000Z',
        lastTimestamp: '2026-09-02T10:30:00.000Z',
        usage: usage(100, 20, 5000, 700),
      }),
    ]);
    expect(readEpicCost(store, [246])).toEqual({ runs: 1, wallSeconds: 1800, runsWithoutTime: 0, tokens: 5820 });
  });
});

describe('summariseEpicCost', () => {
  it('takes a bare board id as a stub naming the member', () => {
    expect(summariseEpicCost([row({ sessionId: 'a', planStub: 'rafa-246' })], [246]).runs).toBe(1);
  });

  it('counts a run by its issue identifier, whatever its case', () => {
    const rows = [row({ sessionId: 'a', issueIdentifier: 'RAFA-300' }), row({ sessionId: 'b', issueIdentifier: 'rafa-300' })];
    expect(summariseEpicCost(rows, [300]).runs).toBe(2);
  });

  it('counts a session once when it names members twice or is stored twice', () => {
    const twice = row({
      sessionId: 'dup',
      issueIdentifier: 'RAFA-300',
      planStub: 'rafa-246-epic-lifecycle',
      firstTimestamp: '2026-09-02T10:00:00.000Z',
      lastTimestamp: '2026-09-02T10:10:00.000Z',
      usage: usage(10, 0, 0, 0),
    });
    expect(summariseEpicCost([twice, twice], [246, 300])).toEqual({
      runs: 1,
      wallSeconds: 600,
      runsWithoutTime: 0,
      tokens: 10,
    });
  });

  it('sums each run\'s own span, so overlapping runs both count', () => {
    const rows = [
      row({
        sessionId: 'a',
        planStub: 'rafa-246-x',
        firstTimestamp: '2026-09-02T10:00:00.000Z',
        lastTimestamp: '2026-09-02T11:00:00.000Z',
      }),
      row({
        sessionId: 'b',
        planStub: 'rafa-246-x',
        firstTimestamp: '2026-09-02T10:30:00.000Z',
        lastTimestamp: '2026-09-02T11:00:00.000Z',
      }),
      row({ sessionId: 'c', planStub: 'rafa-246-x', firstTimestamp: 'not a time', lastTimestamp: 'nor this' }),
      row({ sessionId: 'd', planStub: 'rafa-246-x' }),
    ];
    expect(summariseEpicCost(rows, [246])).toEqual({ runs: 4, wallSeconds: 5400, runsWithoutTime: 2, tokens: 0 });
  });
});

describe('renderEpicCost', () => {
  it('writes the cost beside the estimate, then the membership note', () => {
    const lines = renderEpicCost({ runs: 12, wallSeconds: 3 * 3600 + 5 * 60, runsWithoutTime: 0, tokens: 1234567 }, ' two weeks ');
    expect(lines).toEqual([
      'cost: 12 runs · 3h 5m · 1,234,567 tokens — estimate: two weeks',
      MEMBERSHIP_NOTE,
    ]);
    expect(MEMBERSHIP_NOTE).toStartWith('cost follows membership at close time');
  });

  it('writes one run, no time and no estimate plainly', () => {
    expect(renderEpicCost({ runs: 1, wallSeconds: 0, runsWithoutTime: 1, tokens: 0 }, null)[0])
      .toBe(`cost: 1 run · 0m · 0 tokens — estimate: ${NO_ESTIMATE}`);
    expect(renderEpicCost({ runs: 0, wallSeconds: 0, runsWithoutTime: 0, tokens: 0 }, '   ')[0])
      .toBe(`cost: 0 runs · 0m · 0 tokens — estimate: ${NO_ESTIMATE}`);
  });
});
