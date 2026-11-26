/**
 * The connector's link walk. Without a database, the refusals made
 * before the transaction opens run over a stand-in database that counts
 * the transactions asked of it, and the walk's text is read for its
 * placeholders. Where `POSTGRES_URL` is set, each case opens its store
 * under a schema prefix no other case or run holds, plants a `ref_links`
 * table in the project's schema, rebuilds, and walks the build; it drops
 * only the project schemas that prefix made and the build schemas its
 * rebuilds named.
 *
 * The planted links, each with the backfill run that found it:
 *
 * | From | To | Run |
 * | --- | --- | --- |
 * | commit abc123 | issue #1 | run-1 |
 * | issue #1 | pr #2 | run-1 |
 * | pr #2 | issue #3 | run-1 |
 * | issue #3 | commit abc123 | run-1 |
 * | commit abc123 | pr #2 | run-2 |
 */
import type { PostgresHubStoreParts } from './hub-store.js';
import type { HubDatabase } from './hub-tables.js';
import type { IndexLinksOptions } from './index-links.js';
import type { IndexLinksRequest, IndexLinksResult } from '@open-tomato/rafa-hub-port';

import { IndexLinksRefusal } from '@open-tomato/rafa-index';
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';

import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { openPostgresHubStoreParts } from './hub-store.js';
import { LINKS_TABLE, rebuildProjectIndex } from './index-build.js';
import { walkProjectLinks, walkSql } from './index-links.js';

const T0 = '2026-11-26T10:00:00.000Z';

/** One planted link: from kind and id, ref kind and text, and its run. */
type Planted = readonly [string, string, string, string, string];

/** The chain of the module note, run-1's, which closes a cycle back to its start. */
const CHAIN: readonly Planted[] = [
  ['commit', 'abc123', 'issue', '#1', 'run-1'],
  ['issue', '#1', 'pr', '#2', 'run-1'],
  ['pr', '#2', 'issue', '#3', 'run-1'],
  ['issue', '#3', 'commit', 'abc123', 'run-1'],
];

/** run-2's shortcut from the start to `pr #2`. */
const SHORTCUT: Planted = ['commit', 'abc123', 'pr', '#2', 'run-2'];

/** A link as the walk answers it. */
function link(kind: string, id: string, depth: number): { readonly kind: string; readonly id: string; readonly depth: number } {
  return { kind, id, depth };
}

describe('walkSql', () => {
  it('names the build\'s link table and binds the request only through $1, $2 and $3', () => {
    const text = walkSql('index_default_abc');

    expect(text).toContain('"index_default_abc"."ref_links"');
    expect(text.match(/\$\d+/g)).toEqual(['$1', '$2', '$3', '$1', '$2']);
    expect(text).toStartWith('WITH RECURSIVE walk');
  });
});

describe('walkProjectLinks, before it opens a transaction', () => {
  /** Options over a database that counts the transactions asked of it and opens none. */
  function standIn(request: IndexLinksRequest): { readonly options: IndexLinksOptions; readonly opened: () => number } {
    let transactions = 0;
    const db = { transaction: async () => { transactions += 1; throw new Error('the stand-in opens no transaction'); } } as unknown as HubDatabase;
    return { options: { db, place: { id: DEFAULT_PROJECT_ID, schema: 'p_default' }, request }, opened: () => transactions };
  }

  it('refuses an empty kind or id and a depth that is no whole number from 1 to 10', async () => {
    const requests: IndexLinksRequest[] = [
      { id: 'abc123', kind: '' },
      { id: '', kind: 'commit' },
      { depth: 0, id: 'abc123', kind: 'commit' },
      { depth: 1.5, id: 'abc123', kind: 'commit' },
      { depth: 11, id: 'abc123', kind: 'commit' },
    ];
    const cases = requests.map(standIn);

    const refused = await Promise.all(cases.map(({ options }) => walkProjectLinks(options).catch((error: unknown) => error)));

    expect(refused.every((error) => error instanceof IndexLinksRefusal)).toBe(true);
    expect(refused.map((error) => (error as Error).message)).toEqual([
      'index links: kind must be a reference kind, got ""',
      'index links: id must be a reference id, got ""',
      'index links: depth must be a whole number from 1 to 10, got 0',
      'index links: depth must be a whole number from 1 to 10, got 1.5',
      'index links: depth must be a whole number from 1 to 10, got 11',
    ]);
    expect(cases.map(({ opened }) => opened())).toEqual([0, 0, 0, 0, 0]);
  });

  it('opens a transaction for a request it can run, as the control', async () => {
    const { options, opened } = standIn({ depth: 10, id: 'abc123', kind: 'commit' });

    await expect(walkProjectLinks(options)).rejects.toThrow('the stand-in opens no transaction');
    expect(opened()).toBe(1);
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('walkProjectLinks, live on POSTGRES_URL', () => {
  let admin: SQL;
  let parts: PostgresHubStoreParts | undefined;
  let db: HubDatabase;
  const projectSchemas: string[] = [];
  const builds: string[] = [];

  /** Opens a store under a fresh prefix, recording the schema its project makes for the drop; answers that schema. */
  async function open(): Promise<string> {
    const prefix = `test_idxlinks_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    const schema = projectSchemaName(prefix, DEFAULT_PROJECT_ID);
    projectSchemas.push(schema);
    const client = new SQL(url);
    db = drizzle({ client });
    parts = await openPostgresHubStoreParts({ directory: '/nonexistent', now: () => new Date(T0) }, { client, schemaPrefix: prefix });
    return schema;
  }

  /** Makes the project's `ref_links`, with a run column beside the four the walk reads, holding `links`. */
  async function plant(schema: string, links: readonly Planted[]): Promise<void> {
    await admin.unsafe(`CREATE TABLE "${schema}".${LINKS_TABLE} (from_kind text, from_id text, ref_kind text, ref_text text, run_id text)`);
    await insert(schema, links);
  }

  /** Adds `links` to the project's `ref_links`. */
  async function insert(schema: string, links: readonly Planted[]): Promise<void> {
    for (const row of links) {
      await admin.unsafe(`INSERT INTO "${schema}".${LINKS_TABLE} (from_kind, from_id, ref_kind, ref_text, run_id) VALUES ($1, $2, $3, $4, $5)`, [...row]);
    }
  }

  /** Rebuilds the project, recording the build it made for the drop. */
  async function rebuild(): Promise<void> {
    const place = await (parts as PostgresHubStoreParts).placeOf(undefined);
    const built = await rebuildProjectIndex({ db, place, request: { project: place.id }, now: () => new Date(T0) });
    builds.push(built.schema);
  }

  /** Walks the project's serving build with `request`. */
  async function walk(request: IndexLinksRequest): Promise<IndexLinksResult> {
    const place = await (parts as PostgresHubStoreParts).placeOf(undefined);
    return walkProjectLinks({ db, place, request });
  }

  beforeAll(() => {
    admin = new SQL(url);
  });

  afterEach(async () => {
    await parts?.store.close();
    parts = undefined;
    for (const name of [...builds.splice(0), ...projectSchemas.splice(0)]) await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  });

  afterAll(async () => {
    await admin.close();
  });

  describe('depth', () => {
    it('walks one hop when no depth is named', async () => {
      await plant(await open(), CHAIN);
      await rebuild();

      expect(await walk({ id: 'abc123', kind: 'commit' })).toEqual({ graph: true, links: [link('issue', '#1', 1)] });
    });

    it('walks to the depth named, nearest first, and no further', async () => {
      await plant(await open(), CHAIN);
      await rebuild();

      const two = await walk({ depth: 2, id: 'abc123', kind: 'commit' });
      const three = await walk({ depth: 3, id: 'abc123', kind: 'commit' });

      expect(two.links).toEqual([link('issue', '#1', 1), link('pr', '#2', 2)]);
      expect(three.links).toEqual([link('issue', '#1', 1), link('pr', '#2', 2), link('issue', '#3', 3)]);
    });

    it('ends a cycle at the depth bound and never answers the start node, though the cycle reaches it', async () => {
      await plant(await open(), CHAIN);
      await rebuild();

      const walked = await walk({ depth: 10, id: 'abc123', kind: 'commit' });

      expect(walked.links).toEqual([link('issue', '#1', 1), link('pr', '#2', 2), link('issue', '#3', 3)]);
    });

    it('answers each node once, at its fewest hops, the key breaking a tie in depth', async () => {
      await plant(await open(), [...CHAIN, SHORTCUT, ['commit', 'abc123', 'issue', '#1', 'run-2']]);
      await rebuild();

      const walked = await walk({ depth: 3, id: 'abc123', kind: 'commit' });

      expect(walked.links).toEqual([link('issue', '#1', 1), link('pr', '#2', 1), link('issue', '#3', 2)]);
    });

    it('answers no link from a node nothing links from', async () => {
      await plant(await open(), CHAIN);
      await rebuild();

      expect(await walk({ depth: 3, id: 'unknown', kind: 'commit' })).toEqual({ graph: true, links: [] });
    });
  });

  describe('a link whose run the build does not hold', () => {
    it('is never reached until a rebuild copies it: the walk reads the build, never the project\'s ref_links', async () => {
      const schema = await open();
      await plant(schema, CHAIN);
      await rebuild();
      await insert(schema, [SHORTCUT]);

      const before = await walk({ id: 'abc123', kind: 'commit' });
      await rebuild();
      const after = await walk({ id: 'abc123', kind: 'commit' });

      expect(before.links).toEqual([link('issue', '#1', 1)]);
      expect(after.links).toEqual([link('issue', '#1', 1), link('pr', '#2', 1)]);
    });

    it('is still reached once the rows drop it, until a rebuild copies the rows without it', async () => {
      const schema = await open();
      await plant(schema, [...CHAIN, SHORTCUT]);
      await rebuild();
      await admin.unsafe(`DELETE FROM "${schema}".${LINKS_TABLE} WHERE run_id = 'run-2'`);

      const before = await walk({ id: 'abc123', kind: 'commit' });
      await rebuild();
      const after = await walk({ id: 'abc123', kind: 'commit' });

      expect(before.links).toEqual([link('issue', '#1', 1), link('pr', '#2', 1)]);
      expect(after.links).toEqual([link('issue', '#1', 1)]);
    });

    it('answers graph false and no link over a build copied before the project held ref_links', async () => {
      const schema = await open();
      await rebuild();
      await plant(schema, CHAIN);

      expect(await walk({ id: 'abc123', kind: 'commit' })).toEqual({ graph: false, links: [] });
    });
  });

  describe('answers and refusals over a build', () => {
    it('answers frozen records holding only the kind, the id and the depth of each node', async () => {
      await plant(await open(), CHAIN);
      await rebuild();

      const walked = await walk({ depth: 2, id: 'abc123', kind: 'commit' });

      expect(Object.isFrozen(walked) && Object.isFrozen(walked.links)).toBe(true);
      expect(walked.links.every((found) => Object.isFrozen(found))).toBe(true);
      expect(walked.links.map((found) => Object.keys(found).sort())).toEqual([['depth', 'id', 'kind'], ['depth', 'id', 'kind']]);
    });

    it('refuses a walk of a project with no build yet, naming the rebuild', async () => {
      await open();

      await expect(walk({ id: 'abc123', kind: 'commit' })).rejects.toThrow(`project ${DEFAULT_PROJECT_ID} has no index built yet; rebuild the index`);
    });

    it('refuses a build whose link table lacks a column the walk reads, naming each', async () => {
      const schema = await open();
      await admin.unsafe(`CREATE TABLE "${schema}".${LINKS_TABLE} (from_kind text, ref_kind text)`);
      await rebuild();

      await expect(walk({ id: 'abc123', kind: 'commit' })).rejects.toThrow('the serving build\'s ref_links table has no from_id, ref_text column');
    });
  });
});
