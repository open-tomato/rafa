/**
 * Which kind of rafa build is running, read at its old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The code and its module note live in `src/core/runtime/identity.ts`,
 * behind the barrel `src/core/runtime/index.ts`. This file re-exports
 * that barrel's names under the same names, so an importer that names
 * this path reads the same bindings.
 */
export type { DevelopmentIdentity, InstalledIdentity, RuntimeIdentity } from '../core/runtime/index.js';

export { readRuntimeIdentity } from '../core/runtime/index.js';
