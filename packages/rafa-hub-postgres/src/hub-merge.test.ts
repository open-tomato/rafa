/**
 * The merge by origin pair, decided without a database: a row whose
 * pair the table holds adds nothing, a pair the payload carries twice
 * adds one row, a row relayed by another device is still its origin's,
 * a row with no origin is matched by every column but `seq`, and the new
 * rows take the hub's `seq` from the one they are handed up. Each case
 * that skips a row has a near miss beside it that keeps one, so a merge
 * that skipped everything could not pass.
 */
import type { HeldRows } from './hub-merge.js';
import type { WireRow } from '@open-tomato/rafa/store';

import { describe, expect, it } from 'bun:test';

import { contentKey, mergeByOrigin, pairKey, unknownColumns } from './hub-merge.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

/** A commit table's columns, `seq` first, as `schema.ts` holds them. */
const COLUMNS = ['seq', 'sha', 'row_json', 'origin_store', 'origin_seq'];

/** Nothing held. */
const NONE: HeldRows = { pairs: new Set(), contents: new Set() };

/** A commit row of `origin`'s `originSeq`, sent under the device's own `seq`. */
function commit(origin: string | null, originSeq: number | null, sha = `sha-${String(origin)}-${String(originSeq)}`): WireRow {
  return { seq: 40 + (originSeq ?? 0), sha, row_json: JSON.stringify({ sha }), origin_store: origin, origin_seq: originSeq };
}

/** The origin pairs of `rows`, in order. */
function pairsOf(rows: readonly WireRow[]): (string | null)[] {
  return rows.map(pairKey);
}

describe('pairKey', () => {
  it('spells a row\'s pair, and none when either half is unset', () => {
    expect(pairKey(commit(A, 3))).toBe(`${A}:3`);
    expect([pairKey(commit(null, 3)), pairKey(commit(A, null))]).toEqual([null, null]);
  });
});

describe('mergeByOrigin, by origin pair', () => {
  it('adds every row of an empty table, in payload order', () => {
    const fresh = mergeByOrigin([commit(A, 1), commit(A, 2)], NONE, COLUMNS, 1);
    expect(pairsOf(fresh)).toEqual([`${A}:1`, `${A}:2`]);
  });

  it('adds nothing for a pair the table holds, and the row of a pair it does not', () => {
    const held: HeldRows = { pairs: new Set([`${A}:1`]), contents: new Set() };
    const fresh = mergeByOrigin([commit(A, 1), commit(A, 2)], held, COLUMNS, 1);
    expect(pairsOf(fresh)).toEqual([`${A}:2`]);
  });

  it('matches by pair alone, so a held pair sent with other columns still adds nothing', () => {
    const held: HeldRows = { pairs: new Set([`${A}:1`]), contents: new Set() };
    const fresh = mergeByOrigin([commit(A, 1, 'another-sha')], held, COLUMNS, 1);
    expect(fresh).toEqual([]);
  });

  it('keeps one row of a pair the payload carries twice', () => {
    const fresh = mergeByOrigin([commit(A, 1), commit(A, 1), commit(A, 2)], NONE, COLUMNS, 1);
    expect(pairsOf(fresh)).toEqual([`${A}:1`, `${A}:2`]);
  });

  it('reads a row another device relays as its origin\'s, whoever pushed it', () => {
    const held: HeldRows = { pairs: new Set([`${A}:1`]), contents: new Set() };
    const relayed = mergeByOrigin([commit(B, 1), commit(A, 1)], held, COLUMNS, 1);
    expect(pairsOf(relayed)).toEqual([`${B}:1`]);
  });

  it('tells two origins\' rows of one origin_seq apart', () => {
    const held: HeldRows = { pairs: new Set([`${A}:1`]), contents: new Set() };
    expect(pairsOf(mergeByOrigin([commit(B, 1)], held, COLUMNS, 1))).toEqual([`${B}:1`]);
  });
});

describe('mergeByOrigin, a row with no origin', () => {
  it('adds nothing for a row the table holds column for column, whatever seq it was sent under', () => {
    const row = commit(null, null, 'legacy');
    const held: HeldRows = { pairs: new Set(), contents: new Set([contentKey({ ...row, seq: 999 }, COLUMNS)]) };
    expect(mergeByOrigin([row], held, COLUMNS, 1)).toEqual([]);
  });

  it('adds a row that differs from the held one in any column, and one of two equal rows', () => {
    const row = commit(null, null, 'legacy');
    const held: HeldRows = { pairs: new Set(), contents: new Set([contentKey(row, COLUMNS)]) };
    const other = { ...row, row_json: '{"sha":"legacy","more":1}' };
    const fresh = mergeByOrigin([row, other, other], held, COLUMNS, 1);
    expect(fresh.map((kept) => kept['row_json'])).toEqual([other.row_json]);
  });

  it('never reads a held pair as a held content, nor the other way', () => {
    const paired = commit(A, 1);
    const held: HeldRows = { pairs: new Set(), contents: new Set([contentKey(paired, COLUMNS)]) };
    expect(pairsOf(mergeByOrigin([paired], held, COLUMNS, 1))).toEqual([`${A}:1`]);
  });
});

describe('mergeByOrigin, the rows it answers', () => {
  it('numbers the new rows from the seq it is handed, one apart, never the device\'s', () => {
    const held: HeldRows = { pairs: new Set([`${A}:2`]), contents: new Set() };
    const fresh = mergeByOrigin([commit(A, 1), commit(A, 2), commit(A, 3)], held, COLUMNS, 17);
    expect(fresh.map((row) => row['seq'])).toEqual([17, 18]);
  });

  it('holds every column of the table, a column the row leaves out as null', () => {
    const behind: WireRow = { seq: 1, session_id: 's', row_json: '{}', origin_store: A, origin_seq: 1 };
    const [row] = mergeByOrigin([behind], NONE, ['seq', 'session_id', 'row_json', 'worktree', 'origin_store', 'origin_seq'], 1);
    expect(row).toEqual({ seq: 1, session_id: 's', row_json: '{}', worktree: null, origin_store: A, origin_seq: 1 });
  });
});

describe('unknownColumns', () => {
  it('names each column a row carries that the table lacks, once and sorted', () => {
    const rows = [{ ...commit(A, 1), zeta: 1 }, { ...commit(A, 2), alpha: 2, zeta: 3 }];
    expect(unknownColumns(rows, COLUMNS)).toEqual(['alpha', 'zeta']);
  });

  it('names none for rows that fit, or leave columns out', () => {
    expect(unknownColumns([commit(A, 1), { seq: 1, sha: 'x' }], COLUMNS)).toEqual([]);
  });
});
