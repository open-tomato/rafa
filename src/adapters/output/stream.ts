/**
 * Where an Output adapter writes, read at its old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The type and its module note live in `src/core/output/stream.ts`,
 * behind the barrel `src/core/output/index.ts`. This file re-exports
 * that barrel's name under the same name, so an importer that names
 * this path reads the same type.
 */
export type { OutputStream } from '../../core/output/index.js';
