/**
 * The graph walk (`links.ts`), its refusals first: a start row that is
 * no table and origin pair, a depth that is not a whole number from 1
 * to 10, a schema that is no identifier or no attached database, and a
 * link table lacking a column the walk reads. Then a store with no
 * `ref_links` table answering `graph: false` with no links, and the walk
 * over a planted table whose reached rows and hops the test spells: the
 * depth bound, a cycle answering each row once, the start row never
 * answered, and the same walk over a store attached as another schema.
 * Controls show that the raw CTE does revisit a row through the cycle,
 * so the once-only answer is the walk's work, and that a store holding
 * the table answers `graph: true` even when the start row has no links.
 *
 * The store is planted with `bun:sqlite`; the link table's columns are
 * the walk's own, since no store migration creates `ref_links` yet.
 */
import type { IndexLink, IndexLinksRequest, LinksTarget } from './links.js';

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_DEPTH,
  holdsRefLinks,
  IndexLinksRefusal,
  links,
  MAX_DEPTH,
  REF_LINK_COLUMNS,
  REF_LINKS_TABLE,
  walkSql,
} from './links.js';

/** A planted link: from table, store, seq, then to table, store, seq. */
type PlantedLink = readonly [string, string, number, string, string, number];

/**
 * The planted graph. From tasks:a:1, a chain to bugs:b:1 (1 hop),
 * findings:a:7 (2 hops) and tasks:a:2 (3 hops), a cycle back from
 * findings:a:7 to tasks:a:1, and a shortcut tasks:a:1 to tasks:a:2 that
 * makes tasks:a:2 one hop away too. tasks:a:9 links nowhere.
 */
const LINKS: readonly PlantedLink[] = [
  ['tasks', 'store-a', 1, 'bugs', 'store-b', 1],
  ['bugs', 'store-b', 1, 'findings', 'store-a', 7],
  ['findings', 'store-a', 7, 'tasks', 'store-a', 1],
  ['findings', 'store-a', 7, 'commits', 'store-a', 3],
  ['commits', 'store-a', 3, 'bugs', 'store-b', 1],
];

/** The planted start row. */
const START: IndexLinksRequest = { origin: { originSeq: 1, originStore: 'store-a' }, table: 'tasks' };

/** A link column's SQL type: a sequence number is an integer, the rest text. */
function columnType(column: string): string {
  return column.endsWith('_seq')
    ? 'INTEGER'
    : 'TEXT';
}

/** Create the link table in a schema of the database and plant the links. */
function plantLinks(database: Database, schema = 'main', planted: readonly PlantedLink[] = LINKS): void {
  database.run(`CREATE TABLE ${schema}.${REF_LINKS_TABLE} (
    ${REF_LINK_COLUMNS.map((column) => `${column} ${columnType(column)} NOT NULL`).join(', ')},
    origin_store TEXT, origin_seq INTEGER
  )`);
  for (const link of planted) {
    database.run(`INSERT INTO ${schema}.${REF_LINKS_TABLE} (${REF_LINK_COLUMNS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?)`, [...link]);
  }
}

/** A target over a planted in-memory store. */
function plantedTarget(planted: readonly PlantedLink[] = LINKS): LinksTarget {
  const database = new Database(':memory:');
  plantLinks(database, 'main', planted);
  return { database };
}

/** The links as `table:store:seq@depth` keys, in order. */
function keys(reached: readonly IndexLink[]): readonly string[] {
  return reached.map((link) => `${link.table}:${link.origin.originStore}:${String(link.origin.originSeq)}@${String(link.depth)}`);
}

/** The refusal a walk rejects with. */
async function refusal(target: LinksTarget, request: IndexLinksRequest): Promise<IndexLinksRefusal> {
  try {
    await links(target, request);
  } catch (error) {
    expect(error).toBeInstanceOf(IndexLinksRefusal);
    return error as IndexLinksRefusal;
  }
  throw new Error('the walk was answered, not refused');
}

describe('links, a request refused', () => {
  it('refuses a start row that is no table and origin pair', async () => {
    const target = plantedTarget();
    expect((await refusal(target, { ...START, table: '' })).message).toBe('index links: table must be a table name, got ""');
    expect((await refusal(target, { ...START, origin: { originSeq: 1, originStore: '' } })).message)
      .toBe('index links: origin store must be a store id, got ""');
    expect((await refusal(target, { ...START, origin: { originSeq: 1.5, originStore: 'store-a' } })).message)
      .toBe('index links: origin seq must be a whole number, got 1.5');
  });

  it('refuses a depth that is not a whole number from 1 to 10', async () => {
    const target = plantedTarget();
    const depths = [0, -1, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2' as unknown as number];
    for (const depth of depths) {
      expect((await refusal(target, { ...START, depth })).message)
        .toStartWith('index links: depth must be a whole number from 1 to 10, got ');
    }
  });

  it('control: takes a depth of 1 and of 10, and 1 when left out', async () => {
    const target = plantedTarget();
    expect(MAX_DEPTH).toBe(10);
    expect(DEFAULT_DEPTH).toBe(1);
    expect(keys((await links(target, START)).links)).toEqual(['bugs:store-b:1@1']);
    expect(keys((await links(target, { ...START, depth: 1 })).links)).toEqual(['bugs:store-b:1@1']);
    expect((await links(target, { ...START, depth: MAX_DEPTH })).links).toHaveLength(3);
  });

  it('refuses a schema that is no identifier or no attached database', async () => {
    const { database } = plantedTarget();
    expect((await refusal({ database, schema: 'store' }, START)).message).toBe('index links: no database is attached as store');
    expect((await refusal({ database, schema: 'x; DROP' }, START)).message)
      .toBe('index links: schema "x; DROP" is not an SQL identifier');
  });

  it('refuses a link table lacking a column the walk reads, naming each', async () => {
    const database = new Database(':memory:');
    database.run(`CREATE TABLE ${REF_LINKS_TABLE} (from_kind TEXT, from_id TEXT, ref_kind TEXT, ref_text TEXT, from_table TEXT)`);
    expect((await refusal({ database }, START)).message).toBe(
      'index links: the ref_links table has no from_origin_store, from_origin_seq, to_table, to_origin_store, to_origin_seq column',
    );
  });
});

describe('links, a store holding no ref_links table', () => {
  it('answers graph: false with no links, frozen', async () => {
    const target: LinksTarget = { database: new Database(':memory:') };
    expect(holdsRefLinks(target)).toBe(false);
    const result = await links(target, { ...START, depth: 3 });
    expect(result).toEqual({ graph: false, links: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.links)).toBe(true);
  });

  it('control: a store holding the table answers graph: true, even for a start row with no links', async () => {
    const target = plantedTarget();
    expect(holdsRefLinks(target)).toBe(true);
    const lonely: IndexLinksRequest = { depth: 3, origin: { originSeq: 9, originStore: 'store-a' }, table: 'tasks' };
    expect(await links(target, lonely)).toEqual({ graph: true, links: [] });
    expect(await links(plantedTarget([]), START)).toEqual({ graph: true, links: [] });
  });
});

describe('links, the walk', () => {
  it('answers the rows reached within the depth, nearest first, each a table, an origin pair and its hops', async () => {
    const target = plantedTarget();
    expect(keys((await links(target, { ...START, depth: 2 })).links)).toEqual(['bugs:store-b:1@1', 'findings:store-a:7@2']);
    const result = await links(target, { ...START, depth: 3 });
    expect(keys(result.links)).toEqual(['bugs:store-b:1@1', 'findings:store-a:7@2', 'commits:store-a:3@3']);
    expect(result.graph).toBe(true);
    for (const link of result.links) {
      expect(Object.keys(link).sort()).toEqual(['depth', 'origin', 'table']);
      expect(Object.keys(link.origin).sort()).toEqual(['originSeq', 'originStore']);
      expect(Object.isFrozen(link)).toBe(true);
    }
  });

  it('follows a link from its from row to its to row, never back', async () => {
    const target = plantedTarget();
    const fromCommit: IndexLinksRequest = { depth: 1, origin: { originSeq: 3, originStore: 'store-a' }, table: 'commits' };
    expect(keys((await links(target, fromCommit)).links)).toEqual(['bugs:store-b:1@1']);
  });

  it('answers each row of a cycle once, at its fewest hops, never the start row', async () => {
    const result = await links(plantedTarget(), { ...START, depth: MAX_DEPTH });
    expect(keys(result.links)).toEqual(['bugs:store-b:1@1', 'findings:store-a:7@2', 'commits:store-a:3@3']);
  });

  it('control: the raw walk does reach the start row and bugs:b:1 again through the cycle', () => {
    const { database } = plantedTarget();
    const rows = database
      .query<{ readonly row_table: string; readonly depth: number }, [string, string, number, number]>(
        `${walkSql('main')} SELECT row_table, depth FROM walk ORDER BY depth, row_table`,
      )
      .all('tasks', 'store-a', 1, 4);
    expect(rows.filter((row) => row.row_table === 'tasks').map((row) => row.depth)).toEqual([0, 3]);
    expect(rows.filter((row) => row.row_table === 'bugs').map((row) => row.depth)).toEqual([1, 4]);
  });

  it('walks a store attached as another schema', async () => {
    const database = new Database(':memory:');
    database.run('ATTACH DATABASE \':memory:\' AS store');
    plantLinks(database, 'store');
    expect(holdsRefLinks({ database })).toBe(false);
    const result = await links({ database, schema: 'store' }, { ...START, depth: 2 });
    expect(keys(result.links)).toEqual(['bugs:store-b:1@1', 'findings:store-a:7@2']);
  });
});
