/**
 * The mapping from a schema's Drizzle log to the wire migration ids it
 * mirrors: each applied Drizzle migration answers the ids
 * `DRIZZLE_WIRE_MIGRATIONS` covers it with, in journal order, one that
 * covers none answers nothing, and a logged migration the journal or the
 * table does not know is refused rather than read as mirroring nothing.
 * The shipped journal is read too, so the ids a fully migrated schema
 * answers are exactly the covered ones.
 */
import type { DrizzleWireCoverage, JournalEntry } from './wire-migrations.js';

import { describe, expect, it } from 'bun:test';

import { readFolderMigrations, SHIPPED_MIGRATIONS_FOLDER } from './migrator.js';
import { DRIZZLE_WIRE_MIGRATIONS, wireMigrationIds } from './wire-migrations.js';

const JOURNAL: readonly JournalEntry[] = [
  { tag: '0000_first', when: 10 },
  { tag: '0001_local', when: 20 },
  { tag: '0002_third', when: 30 },
];

const COVERAGE: readonly DrizzleWireCoverage[] = [
  { tag: '0000_first', wire: ['kind-tables', 'findings'] },
  { tag: '0001_local', wire: [] },
  { tag: '0002_third', wire: ['changes'] },
];

/** A log holding the migrations logged at `whens`. */
function logOf(...whens: number[]): { createdAt: number }[] {
  return whens.map((createdAt) => ({ createdAt }));
}

describe('wireMigrationIds', () => {
  it('answers no id for a schema with no migration logged', () => {
    expect(wireMigrationIds(JOURNAL, [], COVERAGE)).toEqual([]);
  });

  it('answers the ids of each applied migration, in journal order, whatever order the log reads', () => {
    expect(wireMigrationIds(JOURNAL, logOf(30, 10, 20), COVERAGE)).toEqual(['kind-tables', 'findings', 'changes']);
  });

  it('answers only the applied migrations\' ids, so a schema behind claims none it lacks', () => {
    expect(wireMigrationIds(JOURNAL, logOf(10), COVERAGE)).toEqual(['kind-tables', 'findings']);
    expect(wireMigrationIds(JOURNAL, logOf(10, 20), COVERAGE)).toEqual(['kind-tables', 'findings']);
  });

  it('refuses a logged migration no journal entry holds, naming when it was logged', () => {
    expect(() => wireMigrationIds(JOURNAL, logOf(10, 99), COVERAGE)).toThrow('logged at 99, which no journal entry holds');
  });

  it('refuses an applied migration the table maps to no ids, naming its tag', () => {
    const lacking = COVERAGE.filter(({ tag }) => tag !== '0002_third');
    expect(() => wireMigrationIds(JOURNAL, logOf(10, 30), lacking)).toThrow('0002_third is applied but wire-migrations.ts maps it to no wire ids');
    expect(wireMigrationIds(JOURNAL, logOf(10), lacking)).toEqual(['kind-tables', 'findings']);
  });
});

describe('wireMigrationIds over the shipped journal', () => {
  const journal = readFolderMigrations(SHIPPED_MIGRATIONS_FOLDER);

  it('answers every covered id, in order, for a schema that applied every shipped migration', () => {
    const logged = journal.map(({ when }) => ({ createdAt: when }));
    expect(wireMigrationIds(journal, logged)).toEqual(DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire));
  });

  it('answers the same ids without the devices migration, which covers no wire id', () => {
    const devices = journal.find(({ tag }) => tag === '0001_hub_devices');
    const logged = journal.filter((entry) => entry !== devices).map(({ when }) => ({ createdAt: when }));
    expect(devices).toBeDefined();
    expect(wireMigrationIds(journal, logged)).toEqual(DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire));
  });
});
