/**
 * The append-only NDJSON store files of the effort collector, read at
 * their old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The code and its module note live in `src/effort/store/ndjson-files.ts`.
 * This file re-exports that file's names under the same names, so an
 * importer that names this path reads the same bindings.
 */
export type {
  AppendResult,
  EffortRowKind,
  EffortStore,
  StoreReadResult,
} from './store/ndjson-files.js';

export {
  appendRows,
  collectedKeys,
  EFFORT_STORE_DIR,
  effortStoreFileName,
  effortStorePath,
  keysOfRows,
  openEffortStore,
  parseStoreText,
  readStoreRows,
} from './store/ndjson-files.js';
