/**
 * The `postgres` connector's setup for the hub index contract suite
 * (`index-contract.ts`), behind the `POSTGRES_URL` gate as the row suite
 * is (`postgres-gate.ts`).
 *
 * Each case's schemas take a prefix read off the case's directory, which
 * no other case or run holds, so the connector, the probe and the planter
 * of one case name the same project schema, across the close and reopen
 * the `links` cases make. A close therefore drops nothing: the test file
 * calls {@link PostgresIndexSetup.dropMade} after each case.
 *
 * The suite's `holdExtensionOff` maps to no embedder given, which the
 * connector measures as `vector: false`.
 */
import type { HubIndexConnector, HubIndexLink, HubIndexLinkPlanter, HubIndexProbe, HubIndexSetup } from '../index-contract.js';
import type { HubStoreContext } from '../port.js';

import { connectPostgresHub, postgresIndexProbe } from '@open-tomato/rafa-hub-postgres';
import { SQL } from 'bun';

import { dropSchemas, POSTGRES_GATE } from './postgres-gate.js';

/** The project id a context listing no projects is served as. */
const PROJECT_ID = 'default';

/** The hex digits of a case's prefix taken from its directory's sha256. */
const PREFIX_DIGITS = 8;

/** How the index suite opens `postgres`, reads its identities, plants its links and cleans up. */
export interface PostgresIndexSetup {
  readonly connect: HubIndexConnector;
  readonly probe: HubIndexProbe;
  readonly plantLinks: HubIndexLinkPlanter;
  /** Drops every schema made through this setup since the last call. */
  readonly dropMade: () => Promise<void>;
}

/** The schema prefix of the case `context` belongs to, the same at every call. */
export function casePrefix(context: HubStoreContext): string {
  const digest = new Bun.CryptoHasher('sha256')
    .update(context.directory)
    .digest('hex');
  return `test_hix_${digest.slice(0, PREFIX_DIGITS)}`;
}

/** The schema the connector keeps the case's rows in. */
function caseSchema(context: HubStoreContext): string {
  return `${casePrefix(context)}_${PROJECT_ID}`;
}

/** The setup over the database at `url`; nothing connects until a case does. */
export function postgresIndexSetup(url: string): PostgresIndexSetup {
  const made = new Set<string>();

  const open = (context: HubStoreContext, setup?: HubIndexSetup): ReturnType<HubIndexConnector> => {
    const schemaPrefix = casePrefix(context);
    made.add(schemaPrefix);
    return connectPostgresHub(context, {
      urlVariable: POSTGRES_GATE,
      env: { [POSTGRES_GATE]: url },
      schemaPrefix,
      embedder: setup === undefined || setup.holdExtensionOff
        ? undefined
        : setup.embedder,
    });
  };

  /** Plants a `ref_links` table in the case's project schema, then rebuilds, since a walk reads the serving build's copy. */
  const plantLinks = async (context: HubStoreContext, links: readonly HubIndexLink[]): Promise<void> => {
    const table = `"${caseSchema(context)}".ref_links`;
    const admin = new SQL(url);
    try {
      await admin.unsafe(`CREATE TABLE IF NOT EXISTS ${table} (from_kind text NOT NULL, from_id text NOT NULL, role text NOT NULL, ref_kind text NOT NULL, ref_text text NOT NULL)`);
      for (const link of links) {
        await admin.unsafe(`INSERT INTO ${table} (from_kind, from_id, role, ref_kind, ref_text) VALUES ($1, $2, 'mentions', $3, $4)`, [...link]);
      }
    } finally {
      await admin.close();
    }
    const { store, index } = await open(context);
    try {
      await index.rebuild({ project: PROJECT_ID });
    } finally {
      await store.close();
    }
  };

  return Object.freeze({
    connect: open,
    probe: postgresIndexProbe({ url, schemaOf: caseSchema }),
    plantLinks,
    dropMade: async () => {
      for (const prefix of made) {
        await dropSchemas(url, prefix);
        made.delete(prefix);
      }
    },
  });
}
