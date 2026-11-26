/**
 * The connector's capabilities, measured once at open and never assumed:
 * {@link measureCapabilities} reads them off what the open found, and
 * {@link holdsRefLinksTable} reads the one fact it asks the database.
 *
 *   - `fts` is `true` when `pg_search` is loaded. The connection refuses
 *     a database without it (`connection.ts`), so an open connector
 *     answers `true`.
 *   - `graph` is `true` when the first served project's schema holds a
 *     `ref_links` table at open, `false` otherwise. A table planted after
 *     the open is read by the next one.
 *   - `vector` is `true` only when `pgvector` (`vector` in `pg_extension`)
 *     is loaded and an embedder was given. Off, the why is
 *     {@link NO_PGVECTOR} when the extension is missing, else `NO_EMBEDDER`.
 *   - `projection` is `false`: projecting rows for a device behind the
 *     hub is another member's, so the connector's `contract()` answers it
 *     `false` beside the index's three.
 *
 * Nothing here is exported from the package's entry: the reader takes the
 * `Bun.sql` client the leak rule keeps inside the connector.
 */
import type { SearchVectorState } from './index-search.js';
import type { HubIndexCapabilities } from '@open-tomato/rafa-hub-port';
import type { SQL } from 'bun';

import { NO_EMBEDDER } from '@open-tomato/rafa-index';

import { LINKS_TABLE } from './index-build.js';

/** Why vector search is off on a database without pgvector loaded. */
export const NO_PGVECTOR = 'pgvector is not loaded';

/** `pg_search`'s name in `pg_extension`. */
const SEARCH_EXTENSION = 'pg_search';

/** pgvector's name in `pg_extension`. */
const VECTOR_EXTENSION = 'vector';

/** What the open found, which the capabilities are read from. */
export interface CapabilityReadings {
  /** The `extname` of every extension the database has loaded. */
  readonly extensions: readonly string[];
  /** Whether the connector was given an embedder. */
  readonly embedder: boolean;
  /** Whether the first served project's schema holds `ref_links`. */
  readonly refLinks: boolean;
}

/** The index's capabilities and the vector answer its search and rebuild work under. */
export interface MeasuredIndex {
  /** The index's three, frozen. */
  readonly capabilities: HubIndexCapabilities;
  /** Whether vector search is on, and why not, frozen. */
  readonly vector: SearchVectorState;
}

/** The vector answer of `readings`: on only with pgvector loaded and an embedder given. */
function vectorOf(readings: CapabilityReadings): SearchVectorState {
  if (!readings.extensions.includes(VECTOR_EXTENSION)) return Object.freeze({ vector: false, why: NO_PGVECTOR });
  if (!readings.embedder) return Object.freeze({ vector: false, why: NO_EMBEDDER });
  return Object.freeze({ vector: true, why: null });
}

/** The capabilities `readings` measure; see the module note. */
export function measureCapabilities(readings: CapabilityReadings): MeasuredIndex {
  const vector = vectorOf(readings);
  return Object.freeze({
    capabilities: Object.freeze({
      fts: readings.extensions.includes(SEARCH_EXTENSION),
      graph: readings.refLinks,
      vector: vector.vector,
    }),
    vector,
  });
}

/** Whether `schema` holds a `ref_links` table, read from `information_schema.tables`. */
export async function holdsRefLinksTable(client: SQL, schema: string): Promise<boolean> {
  const rows = await client.unsafe<{ found: number }[]>(
    'SELECT 1 AS found FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
    [schema, LINKS_TABLE],
  );
  return rows.length > 0;
}
