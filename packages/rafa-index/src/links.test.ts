/**
 * The graph walk (`links.ts`), its refusals first: a start node with
 * an empty kind or id, a depth that is not a whole number from 1
 * to 10, a schema that is no identifier or no attached database, and a
 * link table lacking a column the walk reads. Then a store with no
 * `ref_links` table answering `graph: false` with no links, and the walk
 * over a planted table whose reached nodes and hops the test spells:
 * the depth bound, a cycle answering each node once, two roles over one
 * pair of ends answering one hop, a kind keeping two equal ids apart,
 * the start node never answered, and the same walk over a store
 * attached as another schema. Controls show that the raw CTE does
 * revisit a node through the cycle, so the once-only answer is the
 * walk's work, and that a store holding the table answers `graph: true`
 * even when the start node has no links.
 *
 * The store is planted with `bun:sqlite`. No store migration creates
 * `ref_links` yet, so the planted table takes the columns the backfill
 * spec's `ref-links` migration (#1436) names: the four the walk reads,
 * then `role`, the extractor pair and the origin pair it leaves alone.
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

/** A planted link: from kind, from id, role, ref kind, ref text. */
type PlantedLink = readonly [string, string, string, string, string];

/**
 * The planted graph. From commit:c1, issue:#1 (1 hop, under two roles),
 * issue:#2 (2 hops) and path:src/a.ts (3 hops), a cycle back from
 * issue:#2 to commit:c1, and path:src/a.ts back to issue:#1. pr:#2
 * shares issue:#2's id under another kind and links to issue:#9, which
 * no walk from commit:c1 reaches. commit:c9 links nowhere.
 */
const LINKS: readonly PlantedLink[] = [
  ['commit', 'c1', 'mentions', 'issue', '#1'],
  ['commit', 'c1', 'fixes', 'issue', '#1'],
  ['issue', '#1', 'blocked-by', 'issue', '#2'],
  ['issue', '#2', 'mentions', 'commit', 'c1'],
  ['issue', '#2', 'artifact', 'path', 'src/a.ts'],
  ['path', 'src/a.ts', 'mentions', 'issue', '#1'],
  ['pr', '#2', 'mentions', 'issue', '#9'],
];

/** The planted start node. */
const START: IndexLinksRequest = { id: 'c1', kind: 'commit' };

/** Create the link table in a schema of the database, with #1436's columns, and plant the links. */
function plantLinks(database: Database, schema = 'main', planted: readonly PlantedLink[] = LINKS): void {
  database.run(`CREATE TABLE ${schema}.${REF_LINKS_TABLE} (
    from_kind TEXT NOT NULL, from_id TEXT NOT NULL, role TEXT NOT NULL, ref_kind TEXT NOT NULL, ref_text TEXT NOT NULL,
    extractor TEXT, extractor_version INTEGER, origin_store TEXT, origin_seq INTEGER
  )`);
  for (const [fromKind, fromId, role, refKind, refText] of planted) {
    database.run(
      `INSERT INTO ${schema}.${REF_LINKS_TABLE} (from_kind, from_id, role, ref_kind, ref_text, extractor, extractor_version)
       VALUES (?, ?, ?, ?, ?, 'commit-issue', 1)`,
      [fromKind, fromId, role, refKind, refText],
    );
  }
}

/** A target over a planted in-memory store. */
function plantedTarget(planted: readonly PlantedLink[] = LINKS): LinksTarget {
  const database = new Database(':memory:');
  plantLinks(database, 'main', planted);
  return { database };
}

/** The links as `kind:id@depth` keys, in order. */
function keys(reached: readonly IndexLink[]): readonly string[] {
  return reached.map((link) => `${link.kind}:${link.id}@${String(link.depth)}`);
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
  it('refuses a start node with an empty or non-string kind or id', async () => {
    const target = plantedTarget();
    expect((await refusal(target, { ...START, kind: '' })).message).toBe('index links: kind must be a reference kind, got ""');
    expect((await refusal(target, { ...START, id: '' })).message).toBe('index links: id must be a reference id, got ""');
    expect((await refusal(target, { ...START, id: 7 as unknown as string })).message)
      .toBe('index links: id must be a reference id, got 7');
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
    expect(keys((await links(target, START)).links)).toEqual(['issue:#1@1']);
    expect(keys((await links(target, { ...START, depth: 1 })).links)).toEqual(['issue:#1@1']);
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
    database.run(`CREATE TABLE ${REF_LINKS_TABLE} (from_kind TEXT, role TEXT, ref_kind TEXT, origin_store TEXT, origin_seq INTEGER)`);
    expect((await refusal({ database }, START)).message).toBe('index links: the ref_links table has no from_id, ref_text column');
  });

  it('control: reads the four columns #1436 names, and an older table keyed by origin pairs is refused', async () => {
    expect(REF_LINK_COLUMNS).toEqual(['from_kind', 'from_id', 'ref_kind', 'ref_text']);
    const database = new Database(':memory:');
    database.run(`CREATE TABLE ${REF_LINKS_TABLE} (from_table TEXT, from_origin_store TEXT, from_origin_seq INTEGER,
      to_table TEXT, to_origin_store TEXT, to_origin_seq INTEGER)`);
    expect((await refusal({ database }, START)).message)
      .toBe('index links: the ref_links table has no from_kind, from_id, ref_kind, ref_text column');
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
    const lonely: IndexLinksRequest = { depth: 3, id: 'c9', kind: 'commit' };
    expect(await links(target, lonely)).toEqual({ graph: true, links: [] });
    expect(await links(plantedTarget([]), START)).toEqual({ graph: true, links: [] });
  });
});

describe('links, the walk', () => {
  it('answers the nodes reached within the depth, nearest first, each a kind, an id and its hops', async () => {
    const target = plantedTarget();
    expect(keys((await links(target, { ...START, depth: 2 })).links)).toEqual(['issue:#1@1', 'issue:#2@2']);
    const result = await links(target, { ...START, depth: 3 });
    expect(keys(result.links)).toEqual(['issue:#1@1', 'issue:#2@2', 'path:src/a.ts@3']);
    expect(result.graph).toBe(true);
    for (const link of result.links) {
      expect(Object.keys(link).sort()).toEqual(['depth', 'id', 'kind']);
      expect(Object.isFrozen(link)).toBe(true);
    }
  });

  it('follows a link from its from end to its ref end, never back', async () => {
    const target = plantedTarget();
    expect(keys((await links(target, { depth: 1, id: 'src/a.ts', kind: 'path' })).links)).toEqual(['issue:#1@1']);
  });

  it('keeps two equal ids of two kinds apart', async () => {
    const target = plantedTarget();
    expect(keys((await links(target, { depth: 1, id: '#2', kind: 'pr' })).links)).toEqual(['issue:#9@1']);
    const fromIssue = keys((await links(target, { depth: 1, id: '#2', kind: 'issue' })).links);
    expect(fromIssue).toEqual(['commit:c1@1', 'path:src/a.ts@1']);
  });

  it('answers each node of a cycle once, at its fewest hops, never the start node', async () => {
    const result = await links(plantedTarget(), { ...START, depth: MAX_DEPTH });
    expect(keys(result.links)).toEqual(['issue:#1@1', 'issue:#2@2', 'path:src/a.ts@3']);
  });

  it('control: the raw walk does reach the start node and issue:#1 again through the cycle, each (node, depth) once', () => {
    const { database } = plantedTarget();
    const rows = database
      .query<{ readonly node_kind: string; readonly node_id: string; readonly depth: number }, [string, string, number]>(
        `${walkSql('main')} SELECT node_kind, node_id, depth FROM walk ORDER BY depth, node_kind, node_id`,
      )
      .all('commit', 'c1', 4);
    expect(rows.filter((row) => row.node_kind === 'commit').map((row) => row.depth)).toEqual([0, 3]);
    expect(rows.filter((row) => row.node_id === '#1').map((row) => row.depth)).toEqual([1, 4]);
  });

  it('walks a store attached as another schema', async () => {
    const database = new Database(':memory:');
    database.run('ATTACH DATABASE \':memory:\' AS store');
    plantLinks(database, 'store');
    expect(holdsRefLinks({ database })).toBe(false);
    const result = await links({ database, schema: 'store' }, { ...START, depth: 2 });
    expect(keys(result.links)).toEqual(['issue:#1@1', 'issue:#2@2']);
  });
});
