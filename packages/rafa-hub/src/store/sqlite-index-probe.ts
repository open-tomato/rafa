/**
 * The `sqlite` connector's probe for the hub index contract suite
 * (`index-contract.ts`), and the planter its `links` cases plant
 * `ref_links` with. Both read the two files the connector keeps in a
 * case's directory: the store file `DEFAULT_STORE_FILE` names, and the
 * index file beside it ({@link indexFileName}).
 *
 *   - `storeIdentity()` is the store file's sha256, so a rebuild that
 *     writes one byte of the store, a table or a row, changes it.
 *   - `indexIdentity()` is the index file's device and inode, so a
 *     rebuild that builds a file beside the index and renames it over
 *     the old one changes it.
 *
 * `contract.test.ts` hands both to the suite for `sqlite`, and so does
 * `testdata/broken-index.fixture.ts`, whose `index-in-store` fault is
 * the control that the store identity can change.
 */
import type { HubIndexLink, HubIndexLinkPlanter, HubIndexProbe } from './index-contract.js';
import type { HubStoreContext } from './port.js';

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';

import { DEFAULT_STORE_FILE } from '../config.js';

import { indexFileName } from './sqlite.js';

/** The store file the connector keeps in the context's directory. */
function storePathOf(context: HubStoreContext): string {
  return join(context.directory, DEFAULT_STORE_FILE);
}

/** The index file the connector keeps beside its store file. */
function indexPathOf(context: HubStoreContext): string {
  return join(context.directory, indexFileName(DEFAULT_STORE_FILE));
}

/** A file's device and inode, as one string. */
function inodeOf(path: string): string {
  const stats = statSync(path);
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

/** The sha256 of a file's bytes. */
function sha256Of(path: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(readFileSync(path))
    .digest('hex');
}

/** Runs `work` now, answering its value or its throw as a promise. */
function settle<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(work());
  });
}

/** The store file's sha256 and the index file's inode, read from the context's directory. */
export const SQLITE_INDEX_PROBE: HubIndexProbe = Object.freeze({
  storeIdentity: (context: HubStoreContext) => settle(() => sha256Of(storePathOf(context))),
  indexIdentity: (context: HubStoreContext) => settle(() => inodeOf(indexPathOf(context))),
});

/** Plants a `ref_links` table in the store file, holding the links given, each with the role `mentions`. */
export const plantSqliteRefLinks: HubIndexLinkPlanter = (context: HubStoreContext, links: readonly HubIndexLink[]) => settle(() => {
  const database = new Database(storePathOf(context));
  try {
    database.run('CREATE TABLE IF NOT EXISTS ref_links (from_kind TEXT NOT NULL, from_id TEXT NOT NULL, role TEXT NOT NULL, ref_kind TEXT NOT NULL, ref_text TEXT NOT NULL)');
    for (const [fromKind, fromId, refKind, refText] of links) {
      database.run('INSERT INTO ref_links VALUES (?, ?, \'mentions\', ?, ?)', [fromKind, fromId, refKind, refText]);
    }
  } finally {
    database.close();
  }
});
