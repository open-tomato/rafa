/**
 * The rows a backend's `read` answers, as against the rows it stores.
 *
 * Both backends store a row's bytes as the collector wrote them and
 * never rewrite them: the store is append-only, and its bytes are what
 * `keys`, the merge and the wire read. What `read` hands a caller is
 * those rows passed through {@link answeredRows}, one function both
 * `sqlite.ts` and `ndjson.ts` call, so the two backends' answers cannot
 * drift apart.
 *
 * One rewrite lives here today. A session row written before the stored
 * form (#1489) holds its log's absolute path in `filePath`, the writing
 * machine's home directory included. Its `filePath` is answered through
 * `storedLogPathOf` (`session-log-path.ts`), so an absolute value under
 * a `/.claude/projects/` root, on a Linux or a macOS home alike, reads
 * as the `<folder>/<file>` form a fresh collect stores. Any other value
 * reads unchanged, and a row with no `filePath` at all, such as the hub
 * contract's template row, is answered as it is, with no key added.
 *
 * A row the rewrite leaves alone is answered as the same object the
 * backend parsed, and a rewritten one as a fresh copy, so no stored row
 * is mutated on its way out. Commit rows hold no path and pass through.
 *
 * `keys` reads the key column or the key projection, never this, so
 * the rewrite cannot change what a collector skips. The NDJSON
 * backend's `readRows`, the raw reading `move.ts` copies a store with,
 * does not pass through here either: a move carries the bytes it found.
 */
import type { EffortRow, EffortRowKind, SessionEffortRow } from './types.js';

import { storedLogPathOf } from '../session-log-path.js';

/**
 * One session row as `read` answers it.
 *
 * @param row - The row as the backend parsed it from its stored bytes.
 * @returns The row itself when its `filePath` is absent or already in
 *   its answered form, and a copy with `filePath` rewritten otherwise.
 */
function answeredSession(row: SessionEffortRow): SessionEffortRow {
  if (!('filePath' in row)) return row;
  const filePath = storedLogPathOf(row.filePath);
  return filePath === row.filePath
    ? row
    : { ...row, filePath };
}

/**
 * The rows one kind answers from `read`, given the rows it stores.
 *
 * @param kind - The kind the rows were read under.
 * @param rows - The rows as parsed from the store, in append order.
 * @returns A fresh array in the same order, each session row's old
 *   absolute `filePath` answered in its stored form.
 */
export function answeredRows<K extends EffortRowKind>(
  kind: K,
  rows: readonly EffortRow<K>[],
): EffortRow<K>[] {
  if (kind !== 'sessions') return [...rows];
  return (rows as readonly SessionEffortRow[])
    .map(answeredSession) as EffortRow<K>[];
}
