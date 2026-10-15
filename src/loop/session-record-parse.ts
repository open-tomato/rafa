/**
 * The reading of a session record, now
 * `src/core/loop/session-record-parse.ts`, whose names a caller reads
 * through the loop barrel.
 *
 * Re-export kept for importers outside core; the third step of core's move
 * into its package (#1090) removes it.
 */
export { isPositiveWhole, RECORD_EXTENSION } from '../core/loop/index.js';
