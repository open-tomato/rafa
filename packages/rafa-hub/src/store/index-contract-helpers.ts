/**
 * The file-free helpers of the hub index contract suite
 * (`index-contract.ts`): the row text a search looks for, a hit's key,
 * a refusal's message, and the shape a search answer is held to. None
 * reads a file or a database, so a connector with no files (Postgres)
 * runs them as the SQLite one does; what the suite reads of a
 * connector's storage it reads through the probe the run is handed.
 */
import type { IndexSearchHit } from './port.js';
import type { WireRow } from '@open-tomato/rafa/store';

/** The keys a hit, its origin and a search answer hold, and nothing else. */
const HIT_KEYS: readonly string[] = ['origin', 'score', 'table'];
const ORIGIN_KEYS: readonly string[] = ['originSeq', 'originStore'];
const RESULT_KEYS: readonly string[] = ['hits'];

/** `row` with `text` added to its `row_json` under `key`, its other keys kept. */
export function withText(row: WireRow, key: string, text: string): WireRow {
  const rowJson = row['row_json'];
  const parsed = typeof rowJson === 'string'
    ? JSON.parse(rowJson) as Record<string, unknown>
    : {};
  return { ...row, row_json: JSON.stringify({ ...parsed, [key]: text }) };
}

/** A hit's key as one string: `table:store/seq`. */
export function keyOf(hit: IndexSearchHit): string {
  return `${hit.table}:${hit.origin.originStore}/${String(hit.origin.originSeq)}`;
}

/** The keys of `hits`, sorted. */
export function keysOf(hits: readonly IndexSearchHit[]): string[] {
  return hits.map(keyOf).sort();
}

/** What a rejected call rejected with, as a message. */
export async function refusal(work: Promise<unknown>): Promise<string> {
  const error = await work.then(() => null, (thrown: unknown) => thrown);
  if (!(error instanceof Error)) throw new Error('hub index contract: the call did not reject');
  return error.message;
}

/** Whether `value` is a plain record whose own keys are exactly `keys`, frozen. */
export function frozenWithKeys(value: object, keys: readonly string[]): boolean {
  return Object.isFrozen(value) && Object.keys(value).sort()
    .join() === [...keys].sort().join();
}

/** Whether a search answer holds nothing but frozen (table, origin pair, score) records. */
export function holdsOnlyReferences(answer: { readonly hits: readonly IndexSearchHit[] }): boolean {
  return frozenWithKeys(answer, RESULT_KEYS)
    && Object.isFrozen(answer.hits)
    && answer.hits.every((hit) => frozenWithKeys(hit, HIT_KEYS)
      && frozenWithKeys(hit.origin, ORIGIN_KEYS)
      && typeof hit.table === 'string'
      && typeof hit.origin.originStore === 'string'
      && Number.isInteger(hit.origin.originSeq)
      && typeof hit.score === 'number'
      && Number.isFinite(hit.score));
}
