/**
 * The facade of `rafa-index`: every name a file outside the package
 * imports from it, re-exported from where it lives under `./src/`. The
 * hub's `sqlite` connector (`packages/rafa-hub/src/store/sqlite.ts` and
 * `sqlite-index.ts`) is the one outside importer so far. The facade grows
 * as outside files import names, and a name no outside file imports
 * stays a subpath (`@open-tomato/rafa-index/<file>`).
 */

export { holdsRefLinks, links } from './src/links.js';

export type { LoaderState, PrepareOptions, VectorAnswer } from './src/loader.js';
export { loadVector, openDatabase, prepareSqlite } from './src/loader.js';

export type { IndexEmbedder, RebuildIndexResult } from './src/rebuild.js';
export { IndexRebuildRefusal, NO_EMBEDDER, rebuildIndex } from './src/rebuild.js';

export { search } from './src/search.js';
