/**
 * The index contract suite run against the `sqlite` connector with one
 * rule broken, the fault {@link FAULT_ENV} names, so `contract.test.ts`
 * can hold that the suite fails a connector breaking that rule. Named
 * without `.test` so the full suite never runs it, as
 * `broken-store.fixture.ts` is: `contract.test.ts` spawns `bun test` on
 * this file's path once per fault and once with `none` as the control
 * that the harness itself passes.
 *
 * Each fault wraps the working connector rather than forking it, so the
 * one rule it breaks is the only difference. The suite is registered
 * twice, as `contract.test.ts` registers it for a real connector: once
 * as configured and once with the extension held off.
 */
import type { HubIndexConnector } from '../index-contract.js';
import type { HubConnector, HubIndex, IndexSearchRequest, IndexSearchResult } from '../port.js';

import { join } from 'node:path';

import { createLoaderState } from '@open-tomato/rafa-index/loader';
import { Database } from 'bun:sqlite';

import { DEFAULT_STORE_FILE } from '../../config.js';
import { hubIndexContract, INDEX_CONTRACT_EMBEDDER } from '../index-contract.js';
import { connectSqliteHub, indexFileName } from '../sqlite.js';

/** The environment variable naming the fault to plant. */
export const FAULT_ENV = 'RAFA_HUB_INDEX_FAULT';

/** The table `index-in-store` keeps its index rows in, inside the store file. */
const STAMP_TABLE = 'hub_index_stamps';

/** What a fault changes in an opened connector: the store and index it answers. */
type Plant = (hub: Awaited<ReturnType<HubConnector>>, storePath: string) => Awaited<ReturnType<HubConnector>>;

/** `hub` with its index replaced by `change` of it. */
function withIndex(hub: Awaited<ReturnType<HubConnector>>, change: (index: HubIndex) => HubIndex): Awaited<ReturnType<HubConnector>> {
  return { ...hub, index: change(hub.index) };
}

/** The row `table`, `originStore` and `originSeq` name, read from the store file; a copy of its columns. */
function readRow(storePath: string, table: string, originStore: string, originSeq: number): Record<string, unknown> | null {
  const database = new Database(storePath, { readonly: true });
  try {
    return database
      .query<Record<string, unknown>, [string, number]>(`SELECT * FROM ${table} WHERE origin_store = ? AND origin_seq = ?`)
      .get(originStore, originSeq);
  } finally {
    database.close();
  }
}

/**
 * Each fault, as a change to the working connector. `index-in-store`
 * writes its rebuild's stamp into a table of the store file. `answers-bodies`
 * adds the row's columns to each hit of a search. `vector-without-load`
 * is told to hold the extension off, as no load is made, and answers
 * `vector: true` all the same.
 */
const FAULTS: Readonly<Record<string, Plant>> = {
  'none': (hub) => hub,
  'index-in-store': (hub, storePath) => withIndex(hub, (index) => ({
    ...index,
    rebuild: async (request) => {
      const built = await index.rebuild(request);
      const database = new Database(storePath);
      try {
        database.run(`CREATE TABLE IF NOT EXISTS ${STAMP_TABLE} (stamp TEXT NOT NULL)`);
        database.run(`INSERT INTO ${STAMP_TABLE} VALUES (?)`, [built.stamp]);
      } finally {
        database.close();
      }
      return built;
    },
  })),
  'answers-bodies': (hub, storePath) => withIndex(hub, (index) => ({
    ...index,
    search: async (request: IndexSearchRequest): Promise<IndexSearchResult> => {
      const found = await index.search(request);
      return Object.freeze({
        hits: Object.freeze(found.hits.map((hit) => Object.freeze({
          ...hit,
          row: readRow(storePath, hit.table, hit.origin.originStore, hit.origin.originSeq),
        }))),
      });
    },
  })),
  'vector-without-load': (hub) => withIndex(hub, (index) => ({
    ...index,
    capabilities: () => Object.freeze({ ...index.capabilities(), vector: true }),
  })),
};

const fault = process.env[FAULT_ENV] ?? '';
const plant = FAULTS[fault];
if (plant === undefined) throw new Error(`${FAULT_ENV} is ${JSON.stringify(fault)}; expected one of ${Object.keys(FAULTS).join(', ')}`);

/** Whether the fault opens the connector with no load, whatever the run asks. */
const NEVER_LOADS = fault === 'vector-without-load';

const files = { index: indexFileName(DEFAULT_STORE_FILE), store: DEFAULT_STORE_FILE };
const options = { embedder: INDEX_CONTRACT_EMBEDDER, files };

/** The `sqlite` connector with the fault planted, as `contract.test.ts` opens the real one. */
const connect: HubIndexConnector = async (context, setup) => {
  const holdOff = setup.holdExtensionOff || NEVER_LOADS;
  const hub = await connectSqliteHub(context, {
    embedder: setup.embedder,
    loader: holdOff
      ? { library: null, platform: 'darwin', state: createLoaderState() }
      : { state: createLoaderState() },
  });
  const planted = plant(hub, join(context.directory, DEFAULT_STORE_FILE));
  return {
    index: planted.index,
    store: Object.freeze({
      ...hub.store,
      contract: () => Object.freeze({ ...hub.store.contract(), capabilities: planted.index.capabilities() }),
    }),
  };
};

hubIndexContract(fault, connect, options);
hubIndexContract(`${fault}, extension off`, connect, { ...options, holdExtensionOff: true });
