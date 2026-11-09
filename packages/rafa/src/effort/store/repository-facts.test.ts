/**
 * Tests for the repository facts registry, the reading key, the
 * supersede writer and the fact reader.
 *
 * Every store is a real file under a fresh temporary repo root, created
 * through `withSqliteStore` so it stands at the last migration, and then
 * written and read on a `bun:sqlite` connection of its own: the readings
 * are planted by raw SQL with the origin each case names, and every
 * supersede row is read back by raw SQL too, so the keys, the columns
 * and the rule's name are spelled here rather than read off the module.
 *
 * Each case that expects no row sits beside one that varies a single
 * value and expects a row, so a writer that writes nothing reddens.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import {
  readingKey,
  readRepositoryFacts,
  REPOSITORY_FACTS,
  SAME_FACT_RULE,
  writeSupersedes,
} from './repository-facts.js';
import { sqliteStorePath, withSqliteStore } from './sqlite.js';

const scope = mkdtempSync(join(tmpdir(), 'rafa-repository-facts-'));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let planted = 0;

/** One `plan_ci` reading to plant, with the origin its row holds. */
interface Reading {
  readonly pr?: number;
  readonly headSha?: string;
  readonly verdict?: 'green' | 'red' | 'none';
  readonly failing?: string;
  readonly readAt: string;
  readonly origin?: string | null;
}

/** A supersede row as the table holds it. */
interface StoredSupersede {
  readonly table_name: string;
  readonly canonical_key: string;
  readonly superseded_key: string;
  readonly rule: string;
}

/** A store at the last migration under a fresh root, open on a connection of its own. */
function freshStore(): Database {
  planted += 1;
  const path = sqliteStorePath(join(scope, String(planted)));
  withSqliteStore(path, 'write', true, () => undefined);
  return new Database(path, { readwrite: true });
}

/** Plants `readings` into `db`'s `plan_ci`, red ones failing `lint`. */
function plant(db: Database, ...readings: readonly Reading[]): void {
  for (const reading of readings) {
    const verdict = reading.verdict ?? 'red';
    const failing = reading.failing ?? (verdict === 'red'
      ? '["lint"]'
      : '[]');
    const origin = reading.origin ?? null;
    db.query<unknown, [number, string, string, string, string, string | null, string | null]>(
      'INSERT INTO plan_ci (plan_stub, pr, head_sha, verdict, failing, read_at, origin_store, origin_seq)'
      + ' VALUES (\'phase-1\', ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE (SELECT COALESCE(MAX(seq), 0) + 1 FROM plan_ci) END)',
    ).run(reading.pr ?? 7, reading.headSha ?? 'sha-a', verdict, failing, reading.readAt, origin, origin);
  }
}

/** The key of the `plan_ci` reading of pr 7 on `headSha` at `readAt`, spelled by hand. */
function keyOf(readAt: string, headSha = 'sha-a', pr = 7): string {
  return `[${String(pr)},"${headSha}","${readAt}"]`;
}

/** Every supersede row, in append order. */
function supersedesOf(db: Database): StoredSupersede[] {
  return db.query<StoredSupersede, []>('SELECT table_name, canonical_key, superseded_key, rule FROM reading_supersedes ORDER BY seq').all();
}

/** A supersede row of `plan_ci` under the rule. */
function supersede(canonicalKey: string, supersededKey: string): StoredSupersede {
  return { table_name: 'plan_ci', canonical_key: canonicalKey, superseded_key: supersededKey, rule: 'same-fact@1' };
}

/** Plants a supersede row by raw SQL, as another store's merged row would arrive. */
function plantSupersede(db: Database, canonicalKey: string, supersededKey: string, rule = 'same-fact@1'): void {
  db.query<unknown, [string, string, string]>('INSERT INTO reading_supersedes (table_name, canonical_key, superseded_key, rule) VALUES (\'plan_ci\', ?, ?, ?)')
    .run(canonicalKey, supersededKey, rule);
}

const T1 = '2026-11-08T09:00:00.000Z';
const T2 = '2026-11-08T10:00:00.000Z';
const T3 = '2026-11-08T11:00:00.000Z';
const T4 = '2026-11-08T12:00:00.000Z';

describe('the registry and the rule', () => {
  it('lists plan_ci with its four fact columns and its reading time', () => {
    expect(REPOSITORY_FACTS).toEqual({ plan_ci: { facts: ['pr', 'head_sha', 'verdict', 'failing'], time: 'read_at' } });
  });

  it('names the rule same-fact@1', () => {
    expect(SAME_FACT_RULE).toBe('same-fact@1');
  });
});

describe('readingKey', () => {
  it('names a plan_ci reading by pr, head_sha and read_at, as a JSON array in that order', () => {
    const row = { read_at: T1, verdict: 'green', head_sha: 'sha-a', failing: '[]', pr: 7, plan_stub: 'phase-1' };

    expect(readingKey('plan_ci', row)).toBe('[7,"sha-a","2026-11-08T09:00:00.000Z"]');
  });

  it('spells a NULL identity value as null, and refuses a row lacking an identity column', () => {
    expect(readingKey('plan_ci', { pr: 7, head_sha: null, read_at: T1 })).toBe('[7,null,"2026-11-08T09:00:00.000Z"]');
    expect(() => readingKey('plan_ci', { pr: 7, read_at: T1 })).toThrow('cannot name a reading by head_sha');
  });

  it('refuses a table with no entry, though MERGE_RULES has one', () => {
    expect(() => readingKey('stale_docs', { id: 'd-1' })).toThrow('repository facts of stale_docs are not read: the table has no REPOSITORY_FACTS entry');
  });

  it('refuses an identity value JSON does not spell back', () => {
    expect(() => readingKey('plan_ci', { pr: 7, head_sha: new Uint8Array([1]), read_at: T1 })).toThrow('cannot name a reading by head_sha');
    expect(() => readingKey('plan_ci', { pr: Number.NaN, head_sha: 'sha-a', read_at: T1 })).toThrow('cannot name a reading by pr');
  });
});

describe('writeSupersedes', () => {
  it('supersedes the later of two readings of one fact by the earlier, whichever was touched', () => {
    const db = freshStore();
    plant(db, { readAt: T2 }, { readAt: T1 });

    const added = writeSupersedes(db, 'plan_ci', [keyOf(T2)]);

    expect(added).toBe(1);
    expect(supersedesOf(db)).toEqual([supersede(keyOf(T1), keyOf(T2))]);
  });

  // `verdict` is varied between green and none, since the table's CHECK ties a red verdict to a failing check.
  it.each([
    ['pr', { pr: 8 }, keyOf(T2, 'sha-a', 8)],
    ['head_sha', { headSha: 'sha-b' }, keyOf(T2, 'sha-b')],
    ['verdict', { verdict: 'none' as const }, keyOf(T2)],
    ['failing', { failing: '["test"]' }, keyOf(T2)],
  ])('writes no row for two readings that differ in %s alone', (column, varied, key) => {
    const db = freshStore();
    const base = column === 'verdict'
      ? { verdict: 'green' as const }
      : {};
    plant(db, { ...base, readAt: T1 }, { ...base, ...varied, readAt: T2 });

    expect(writeSupersedes(db, 'plan_ci', [key, keyOf(T1)])).toBe(0);
    expect(supersedesOf(db)).toEqual([]);
  });

  it('writes nothing for a fact read once', () => {
    const db = freshStore();
    plant(db, { readAt: T1 });

    expect(writeSupersedes(db, 'plan_ci', [keyOf(T1)])).toBe(0);
    expect(supersedesOf(db)).toEqual([]);
  });

  it('writes a fact\'s rows once for every key of it it is handed, and nothing on a second call', () => {
    const db = freshStore();
    plant(db, { readAt: T1 }, { readAt: T2 }, { readAt: T3 });

    expect(writeSupersedes(db, 'plan_ci', [keyOf(T3), keyOf(T2), keyOf(T3), keyOf(T1)])).toBe(2);
    expect(writeSupersedes(db, 'plan_ci', [keyOf(T2)])).toBe(0);
    expect(supersedesOf(db)).toEqual([supersede(keyOf(T1), keyOf(T2)), supersede(keyOf(T1), keyOf(T3))]);
  });

  it('supersedes the old canonical reading by a late earlier one, leaving the rows it canonicalised', () => {
    const db = freshStore();
    plant(db, { readAt: T2 }, { readAt: T3 });
    writeSupersedes(db, 'plan_ci', [keyOf(T3)]);
    plant(db, { readAt: T1 });

    expect(writeSupersedes(db, 'plan_ci', [keyOf(T1)])).toBe(1);
    expect(supersedesOf(db)).toEqual([supersede(keyOf(T2), keyOf(T3)), supersede(keyOf(T1), keyOf(T2))]);
  });

  it('absorbs a row whose identity is held under another rule', () => {
    const db = freshStore();
    plant(db, { readAt: T1 }, { readAt: T2 });
    plantSupersede(db, keyOf(T1), keyOf(T2), 'other@1');

    expect(writeSupersedes(db, 'plan_ci', [keyOf(T2)])).toBe(0);
    expect(supersedesOf(db)).toEqual([{ ...supersede(keyOf(T1), keyOf(T2)), rule: 'other@1' }]);
  });

  it('writes the row a rule of another name leaves unheld (control for the case above)', () => {
    const db = freshStore();
    plant(db, { readAt: T1 }, { readAt: T2 }, { readAt: T3 });
    plantSupersede(db, keyOf(T1), keyOf(T2), 'other@1');

    expect(writeSupersedes(db, 'plan_ci', [keyOf(T3)])).toBe(1);
    expect(supersedesOf(db).map(({ superseded_key: key, rule }) => [key, rule])).toEqual([[keyOf(T2), 'other@1'], [keyOf(T3), 'same-fact@1']]);
  });

  it('stamps no origin on a store with none, and counts seq on', () => {
    const db = freshStore();
    plant(db, { readAt: T1 }, { readAt: T2 }, { readAt: T3 });

    writeSupersedes(db, 'plan_ci', [keyOf(T1)]);

    expect(db.query('SELECT seq, origin_store, origin_seq FROM reading_supersedes ORDER BY seq').all()).toEqual([
      { seq: 1, origin_store: null, origin_seq: null },
      { seq: 2, origin_store: null, origin_seq: null },
    ]);
  });

  it('refuses a key naming no reading, a key that is no identity array, and a table with no entry', () => {
    const db = freshStore();
    plant(db, { readAt: T1 });

    expect(() => writeSupersedes(db, 'plan_ci', [keyOf(T2)])).toThrow(`repository facts of plan_ci name no reading by key ${keyOf(T2)}`);
    expect(() => writeSupersedes(db, 'plan_ci', ['[7,"sha-a"]'])).toThrow('not a JSON array of 3 identity values');
    expect(() => writeSupersedes(db, 'plan_ci', ['not json'])).toThrow('not a JSON array of 3 identity values');
    expect(() => writeSupersedes(db, 'commits', [])).toThrow('the table has no REPOSITORY_FACTS entry');
    expect(writeSupersedes(db, 'plan_ci', [keyOf(T1)])).toBe(0);
  });
});

describe('readRepositoryFacts', () => {
  it('answers a reading no row supersedes as a fact with no sighting', () => {
    const db = freshStore();
    plant(db, { readAt: T1, origin: 'store-a' });

    expect(readRepositoryFacts(db, 'plan_ci')).toEqual([{
      table: 'plan_ci',
      canonical: { key: keyOf(T1), fact: { pr: 7, head_sha: 'sha-a', verdict: 'red', failing: '["lint"]' }, time: T1, origin: 'store-a' },
      sightings: 0,
      origins: ['store-a'],
      lastSighting: T1,
    }]);
  });

  it('counts two readings of one fact, read by two stores, once', () => {
    const db = freshStore();
    plant(db, { readAt: T2, origin: 'store-b' }, { readAt: T1, origin: 'store-a' });
    writeSupersedes(db, 'plan_ci', [keyOf(T2)]);

    const facts = readRepositoryFacts(db, 'plan_ci');

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ canonical: { key: keyOf(T1), time: T1 }, sightings: 1, origins: ['store-a', 'store-b'], lastSighting: T2 });
  });

  it('answers the same two readings as two facts while no row supersedes either (control)', () => {
    const db = freshStore();
    plant(db, { readAt: T2, origin: 'store-b' }, { readAt: T1, origin: 'store-a' });

    expect(readRepositoryFacts(db, 'plan_ci').map(({ canonical, sightings }) => [canonical.key, sightings])).toEqual([[keyOf(T1), 0], [keyOf(T2), 0]]);
  });

  it('follows a chain to the earliest reading, its last sighting the latest of all', () => {
    const db = freshStore();
    plant(db, { readAt: T2 }, { readAt: T4, origin: 'store-a' });
    writeSupersedes(db, 'plan_ci', [keyOf(T4)]);
    plant(db, { readAt: T1, origin: 'store-b' });
    writeSupersedes(db, 'plan_ci', [keyOf(T1)]);

    expect(readRepositoryFacts(db, 'plan_ci')).toEqual([{
      table: 'plan_ci',
      canonical: { key: keyOf(T1), fact: { pr: 7, head_sha: 'sha-a', verdict: 'red', failing: '["lint"]' }, time: T1, origin: 'store-b' },
      sightings: 2,
      origins: ['store-a', 'store-b'],
      lastSighting: T4,
    }]);
  });

  it('keeps two facts of one head apart, ordered by their canonical time', () => {
    const db = freshStore();
    plant(db, { readAt: T3, verdict: 'green' }, { readAt: T1 }, { readAt: T2 }, { readAt: T4, verdict: 'green' });
    writeSupersedes(db, 'plan_ci', [keyOf(T1), keyOf(T3)]);

    expect(readRepositoryFacts(db, 'plan_ci').map(({ canonical, sightings, lastSighting }) => [canonical.fact.verdict, sightings, lastSighting])).toEqual([
      ['red', 1, T2],
      ['green', 1, T4],
    ]);
  });

  it('follows a row with no origin pair as every row, and a reading with none adds no origin', () => {
    const db = freshStore();
    plant(db, { readAt: T1 }, { readAt: T2, origin: 'store-a' });
    plantSupersede(db, keyOf(T1), keyOf(T2));

    expect(readRepositoryFacts(db, 'plan_ci')).toMatchObject([{ canonical: { key: keyOf(T1), origin: null }, sightings: 1, origins: ['store-a'] }]);
  });

  it('follows no row naming a reading the store does not hold, nor a row of another rule', () => {
    const db = freshStore();
    plant(db, { readAt: T2 }, { readAt: T3 });
    plantSupersede(db, keyOf(T1), keyOf(T2));
    plantSupersede(db, keyOf(T2), keyOf(T3), 'other@1');

    expect(readRepositoryFacts(db, 'plan_ci').map(({ canonical, sightings }) => [canonical.key, sightings])).toEqual([[keyOf(T2), 0], [keyOf(T3), 0]]);
  });

  it('ends both readings of a loop at the earlier one', () => {
    const db = freshStore();
    plant(db, { readAt: T1 }, { readAt: T2 });
    plantSupersede(db, keyOf(T2), keyOf(T1));
    plantSupersede(db, keyOf(T1), keyOf(T2));

    expect(readRepositoryFacts(db, 'plan_ci').map(({ canonical, sightings, lastSighting }) => [canonical.key, sightings, lastSighting])).toEqual([[keyOf(T1), 1, T2]]);
  });

  it('takes the earliest of two targets, and a chain coming back ends at its loop\'s earliest reading', () => {
    const db = freshStore();
    plant(db, { readAt: T1 }, { readAt: T2 }, { readAt: T3 });
    plantSupersede(db, keyOf(T2), keyOf(T3));
    plantSupersede(db, keyOf(T1), keyOf(T3));
    plantSupersede(db, keyOf(T3), keyOf(T1));

    const facts = readRepositoryFacts(db, 'plan_ci');

    expect(facts.map(({ canonical, sightings }) => [canonical.key, sightings])).toEqual([[keyOf(T1), 1], [keyOf(T2), 0]]);
  });

  it('answers no fact for an empty table and refuses a table with no entry', () => {
    const db = freshStore();

    expect(readRepositoryFacts(db, 'plan_ci')).toEqual([]);
    expect(() => readRepositoryFacts(db, 'sessions')).toThrow('the table has no REPOSITORY_FACTS entry');
  });
});
