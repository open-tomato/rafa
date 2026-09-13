/**
 * The effort store's NDJSON backend: the sibling's append-only store
 * behind the kind-parameterised port.
 *
 * Its behaviour is the sibling's by construction, not by copy. Every
 * read and every write goes through the functions of `effort/store.ts`,
 * the sibling's own module, which this repo holds byte-identical to the
 * sibling's `tools/ralph/effort/store.ts` (measured with `diff` when
 * this backend was added). All this module adds is routing: which file
 * a kind lives in, and which key it is deduplicated by. The sibling's
 * rules hold here because they are the same code, and the suite beside
 * that module is a suite over the code this backend runs. Retiring
 * `effort/store.ts` therefore means moving those functions here, not
 * deleting them.
 *
 * ## Layout
 *
 * One file per kind under `.ralph/effort/`, named `sessions.ndjson` and
 * `commits.ndjson` as the sibling's collector already names them. That
 * is what lets the sibling, at cutover, point this package at the store
 * it already holds, rather than at an empty one that would collect
 * everything again. The directory is the sibling's `EFFORT_STORE_DIR`,
 * spelled once over there, and the root `.gitignore` ignores it.
 *
 * The file names are the sibling's closed record too, so a kind added
 * to the port's row map compiles here only once that record names its
 * file. Until then this module is a type error, not a store writing a
 * kind to a path nobody chose.
 *
 * ## The sibling's rules, as they come out here
 *
 *   - Append-only. An append adds lines at the end of one kind's file,
 *     and nothing a file holds is rewritten or removed.
 *   - A partial last line, which is what a run killed mid-write leaves
 *     behind, is tolerated. It is counted as unparsed and left in
 *     place: the row it half held carries no key, so the next collect
 *     reads that row's source again, and the next append that adds a
 *     row writes a newline ahead of it rather than gluing it onto the
 *     fragment. {@link NdjsonEffortStore.readRows} reports the count
 *     and {@link NdjsonAppendResult} reports the newline.
 *   - The whole batch is key-validated before a byte is written. A
 *     refused batch leaves the kind's file byte-identical, and on a
 *     store that does not exist yet it leaves no file and no directory.
 *   - Duplicate suppression covers the batch as well as the disk. The
 *     held keys are read once, before the write, and each accepted
 *     row's key is folded in as it is accepted, so a key repeated
 *     within one batch is written once.
 *
 * ## The key is the kind's, never the caller's
 *
 * The sibling bound one projection to each store it opened. Here each
 * call names a kind, and `keys` and `append` alike read that kind's
 * entry in {@link EFFORT_KEY_PROJECTIONS}; no method takes a
 * projection. The two kinds' key fields are disjoint, since a session
 * row carries no `sha` and a commit row no `sessionId`, so a row
 * appended under the wrong kind is keyless there and refuses its whole
 * batch. A mismatch that got past the caller's types still writes
 * nothing.
 */
import type { StoreReadResult } from '../store.js';
import type {
  AppendResult,
  EffortRow,
  EffortRowKind,
  EffortStore,
} from './types.js';

import {
  appendRows,
  collectedKeys,
  effortStorePath,
  readStoreRows,
} from '../store.js';

import { EFFORT_KEY_PROJECTIONS } from './types.js';

export type { StoreReadResult } from '../store.js';

/**
 * What one NDJSON append did: the port's answer, plus the one reading
 * only a line-oriented file can make.
 */
export interface NdjsonAppendResult extends AppendResult {
  /**
   * True when the kind's file did not end in a newline and this append
   * wrote one ahead of its first row. The partial line stays where it
   * is and reads as unparsed from then on. Never true for an append
   * that added no row, because that append writes nothing at all.
   */
  separatedPartialLine: boolean;
}

/**
 * The NDJSON backend's surface: the port, with `append` answering the
 * wider {@link NdjsonAppendResult}, plus the two readings the port
 * leaves out because only a file per kind can make them.
 */
export interface NdjsonEffortStore extends EffortStore {
  append: <K extends EffortRowKind>(
    kind: K,
    rows: readonly EffortRow<K>[],
  ) => NdjsonAppendResult;
  /** The file one kind lives in, whether or not it exists yet. */
  path: (kind: EffortRowKind) => string;
  /**
   * Every row one kind holds, with the file's line arithmetic:
   * `rows.length + unparsedLineCount === lineCount`. A partial last
   * line is one of the unparsed, as is a blank line, a malformed one,
   * and one that parses to anything but a plain object. The row type
   * is the port's assertion, as the sibling's was: a line is checked
   * only for being a plain JSON object.
   */
  readRows: <K extends EffortRowKind>(
    kind: K,
  ) => StoreReadResult<EffortRow<K>>;
}

/** One kind's rows and line arithmetic, read whole. */
function readKind<K extends EffortRowKind>(
  repoRoot: string,
  kind: K,
): StoreReadResult<EffortRow<K>> {
  return readStoreRows<EffortRow<K>>(effortStorePath(repoRoot, kind));
}

/** The keys one kind holds, by that kind's projection. */
function keysOfKind<K extends EffortRowKind>(
  repoRoot: string,
  kind: K,
): Set<string> {
  const path = effortStorePath(repoRoot, kind);
  return collectedKeys<EffortRow<K>>(path, EFFORT_KEY_PROJECTIONS[kind]);
}

/** Appends one kind's batch, deduplicated by that kind's projection. */
function appendKind<K extends EffortRowKind>(
  repoRoot: string,
  kind: K,
  rows: readonly EffortRow<K>[],
): NdjsonAppendResult {
  const path = effortStorePath(repoRoot, kind);
  return appendRows<EffortRow<K>>(path, rows, EFFORT_KEY_PROJECTIONS[kind]);
}

/**
 * Opens the NDJSON store under one repo root.
 *
 * Opening touches nothing on disk. Each call names its kind, resolves
 * that kind's file afresh, and holds nothing once it returns, which is
 * why the port has no `close` for this backend to need.
 */
export function openNdjsonStore(repoRoot: string): NdjsonEffortStore {
  return {
    append: (kind, rows) => appendKind(repoRoot, kind, rows),
    keys: (kind) => keysOfKind(repoRoot, kind),
    read: (kind) => readKind(repoRoot, kind).rows,
    path: (kind) => effortStorePath(repoRoot, kind),
    readRows: (kind) => readKind(repoRoot, kind),
  };
}
