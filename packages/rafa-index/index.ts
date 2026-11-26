/**
 * The facade of `rafa-index`: every name a file outside the package
 * imports from it, re-exported from where it lives under `./src/`. The
 * hub's `sqlite` connector (`packages/rafa-hub/src/store/sqlite.ts` and
 * `sqlite-index.ts`) and its `postgres` connector
 * (`packages/rafa-hub-postgres`) are the outside importers so far. The
 * facade grows as outside files import names, and a name no outside file
 * imports stays a subpath (`@open-tomato/rafa-index/<file>`).
 */

export { holdsRefLinks, links } from './src/links.js';

export type { LoaderState, PrepareOptions, VectorAnswer } from './src/loader.js';
export { loadVector, openDatabase, prepareSqlite } from './src/loader.js';

export type { IndexEmbedder, RebuildIndexResult } from './src/rebuild.js';
export { IndexRebuildRefusal, NO_EMBEDDER, rebuildIndex } from './src/rebuild.js';

export { fusionSql } from './src/fusion.js';

export type { SearchMode } from './src/search.js';
export { DEFAULT_LIMIT, IndexSearchRefusal, MAX_LIMIT, search, SEARCH_MODES } from './src/search.js';
