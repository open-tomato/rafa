/**
 * The plan marker the loop stamps onto every prompt, read at its old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The code and its module note live in `src/core/plan/plan-stamp.ts`,
 * behind the barrel `src/core/plan/index.ts`. This file re-exports
 * that barrel's names under the same names, so an importer that names
 * this path reads the same bindings.
 */
export {
  isStampableStub,
  planStampLine,
  planStubFromPath,
  planStubFromPrompt,
  stampPrompt,
} from '../core/plan/index.js';
