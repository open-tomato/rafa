/**
 * The `text` Output adapter, read at its old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The code and its module note live in `src/core/output/text.ts`,
 * behind the barrel `src/core/output/index.ts`. This file re-exports
 * that barrel's names under the same names, so an importer that names
 * this path reads the same bindings.
 */
export type { CreateTextOutputOptions } from '../../core/output/index.js';

export { createTextOutput } from '../../core/output/index.js';
