/**
 * Tests for `withoutConflicted` (`conflicted.ts`): an empty map drops
 * nothing, a map naming every row drops each of them, the payload's
 * cursor, migrations and projection fields stay as they were, and a
 * table the map names that the payload lacks drops nothing. Every
 * payload is a fixture built here; no store is opened.
 */
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { describe, expect, it } from 'bun:test';

import { withoutConflicted } from './conflicted.js';

function row(seq: number, id: string): WireRow {
  return Object.freeze({ seq, id, origin_store_id: 'aaaaaaaa-0000-4000-8000-00000000000a' });
}

const PAYLOAD: WirePayload = Object.freeze({
  format: 'rafa-effort-wire',
  version: 1,
  migrations: Object.freeze(['0001-initial', '0002-origins']),
  tables: Object.freeze({
    sessions: Object.freeze([row(3, 's-3'), row(4, 's-4'), row(5, 's-5')]),
    commits: Object.freeze([row(7, 'c-7')]),
  }),
  cursor: Object.freeze({ sessions: 5, commits: 7 }),
  projected: Object.freeze({ sessions: Object.freeze(['0003-later']) }),
  projectedColumns: Object.freeze({ sessions: Object.freeze(['later_column']) }),
});

describe('withoutConflicted', () => {
  it('drops nothing under an empty map and answers the payload itself', () => {
    const answer = withoutConflicted(PAYLOAD, new Map());

    expect(answer.dropped).toBe(0);
    expect(answer.payload).toBe(PAYLOAD);
  });

  it('drops every row the map names, leaving each table empty under its key', () => {
    const conflicted = new Map([
      ['sessions', new Set([3, 4, 5])],
      ['commits', new Set([7])],
    ]);

    const answer = withoutConflicted(PAYLOAD, conflicted);

    expect(answer.dropped).toBe(4);
    expect(answer.payload.tables).toEqual({ sessions: [], commits: [] });
  });

  it('keeps the rows the map does not name, in their order', () => {
    const answer = withoutConflicted(PAYLOAD, new Map([['sessions', new Set([4])]]));

    expect(answer.dropped).toBe(1);
    expect(answer.payload.tables.sessions?.map((kept) => kept.seq)).toEqual([3, 5]);
    expect(answer.payload.tables.commits).toBe(PAYLOAD.tables.commits);
  });

  it('keeps the cursor, the migrations and the projection fields as they were', () => {
    const answer = withoutConflicted(PAYLOAD, new Map([['sessions', new Set([5])], ['commits', new Set([7])]]));

    expect(answer.dropped).toBe(2);
    expect(answer.payload.cursor).toBe(PAYLOAD.cursor);
    expect(answer.payload.cursor).toEqual({ sessions: 5, commits: 7 });
    expect(answer.payload.migrations).toBe(PAYLOAD.migrations);
    expect(answer.payload.projected).toBe(PAYLOAD.projected);
    expect(answer.payload.projectedColumns).toBe(PAYLOAD.projectedColumns);
    expect(answer.payload.format).toBe(PAYLOAD.format);
    expect(answer.payload.version).toBe(PAYLOAD.version);
  });

  it('drops nothing for a table the payload lacks', () => {
    const answer = withoutConflicted(PAYLOAD, new Map([['task_lessons', new Set([3, 7])]]));

    expect(answer.dropped).toBe(0);
    expect(answer.payload).toBe(PAYLOAD);
    expect(Object.keys(answer.payload.tables)).toEqual(['sessions', 'commits']);
  });

  it('leaves the payload it was given unchanged', () => {
    withoutConflicted(PAYLOAD, new Map([['sessions', new Set([3, 4, 5])]]));

    expect(PAYLOAD.tables.sessions?.map((kept) => kept.seq)).toEqual([3, 4, 5]);
  });
});
