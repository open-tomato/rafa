/**
 * The learning library's entry: everything `src/learning/` offers a
 * caller, published as the package's `./learning` subpath.
 *
 * The library settles lessons pushed from task reports: {@link merge}
 * folds one source's payload into the held set by fixed rules,
 * {@link bless} picks the records a task may use, and
 * {@link promotable} names the ones that recurred enough to promote.
 * {@link actionHash} and {@link triggerKey} are the identities the rules
 * compare by, and {@link GAP}, {@link SOURCE_STEP},
 * {@link CONFIDENCE_MIN} and {@link CONFIDENCE_MAX} the constants they
 * read.
 *
 * The record and result types are declared in `./types.js` and
 * re-exported here as types, so importing the entry adds no value for
 * them. `src/ports/index.ts` re-exports the same declarations, so a
 * service typing a `Learning` adapter against `./ports` and one calling
 * the library through `./learning` read one declaration.
 *
 * Like the rest of `src/learning/`, the entry imports nothing from the
 * rest of `src/`: it needs no `bun:` module, only `node:crypto`, and
 * importing it runs nothing.
 */
export type { BlessOptions, PromoteOptions } from './bless.js';
export type {
  BlessedBundle,
  InstinctRecord,
  MergeDecision,
  MergeResult,
  MergeRule,
  SyncPayload,
} from './types.js';

export { bless, promotable } from './bless.js';
export {
  actionHash,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  GAP,
  SOURCE_STEP,
  triggerKey,
} from './identity.js';
export { merge } from './merge.js';
