/**
 * Tests for `planSchema` (`schema-plan.ts`): the use/refuse decision over
 * a store's migration log, its `user_version` and this build's catalogue.
 *
 * The function is pure, so no case opens a store: each passes the log
 * and the version a store would hold. The catalogue is the real history
 * with its checksums, and a synthetic tail is built here and passed as
 * an argument, never appended to `SQLITE_MIGRATIONS`. Every refusal is
 * checked by its whole message, so a text that loses its way out fails.
 */
import type { MigrationBreak } from './migrations.js';
import type { CatalogueEntry, LoggedMigration, SchemaPlan, StoreSchema } from './schema-plan.js';

import { describe, expect, it } from 'bun:test';

import { LEGACY_GATE_CLOSED, LEGACY_GATE_OPEN, migrationChecksum, SQLITE_MIGRATIONS } from './migrations.js';
import { planSchema, REFUSAL_REASONS, sqliteCatalogue } from './schema-plan.js';

const PATH = '/tmp/rafa-schema-plan/effort.sqlite';

/** This build's catalogue: the thirteen legacy entries with their checksums. */
const CATALOGUE = sqliteCatalogue(SQLITE_MIGRATIONS);

/** The legacy entries alone, whatever the real catalogue grows to. */
const LEGACY = CATALOGUE.slice(0, LEGACY_GATE_OPEN);

/** A synthetic catalogue entry, its checksum taken over `sql`. */
function entry(id: string, breaks: readonly MigrationBreak[] = [], sql = `-- ${id}`): CatalogueEntry {
  return {
    id,
    breaks,
    ...(breaks.length > 0 && { contract: { expand: null, why: 'a fixture' } }),
    sha256: migrationChecksum({ sql }),
  };
}

/** The log row a store holds once `migration` has run. */
function logged(
  migration: { readonly id: string; readonly sha256: string; readonly breaks: readonly string[] },
): LoggedMigration {
  return {
    id: migration.id,
    sha256: migration.sha256,
    breaks: migration.breaks,
    appliedAt: '2026-09-28T18:43:14.000Z',
    appliedBy: '0.25.0',
  };
}

/** A logged migration this build does not know. */
function unknownRow(id: string, breaks: readonly string[]): LoggedMigration {
  return { ...logged({ id, sha256: migrationChecksum({ sql: id }), breaks }), appliedBy: '0.26.0+dev:/src/rafa' };
}

/** A store with a log holding `rows`, at `userVersion`. */
function withLog(rows: readonly LoggedMigration[], userVersion = LEGACY_GATE_OPEN): StoreSchema {
  return { path: PATH, userVersion, log: rows };
}

/** A store no log-aware rafa has opened, at `userVersion`. */
function preLog(userVersion: number): StoreSchema {
  return { path: PATH, userVersion, log: null };
}

/** The ids of a list of migrations. */
function ids(migrations: readonly { readonly id: string }[]): string[] {
  return migrations.map(({ id }) => id);
}

/** The plan, narrowed to "use"; fails the case on a refusal. */
function expectUse(plan: SchemaPlan): Extract<SchemaPlan, { verdict: 'use' }> {
  if (plan.verdict === 'refuse') throw new Error(`expected use, got ${plan.message}`);
  return plan;
}

const LEGACY_LOG = LEGACY.map(logged);
const FIX = 'rafa effort fix-schema --dry-run';

describe('a fresh store', () => {
  it('applies the whole catalogue, adopts nothing, and opens the gate', () => {
    const plan = expectUse(planSchema(preLog(0), CATALOGUE, 'write', 'open'));

    expect(plan.adopted).toEqual([]);
    expect(ids(plan.pending)).toEqual(ids(CATALOGUE));
    expect(plan.unknown).toEqual([]);
    expect(plan.gate).toBe(LEGACY_GATE_OPEN);
  });

  it('applies an additive tail with the legacy entries and keeps the gate open', () => {
    const catalogue = [...LEGACY, entry('synthetic-note')];
    const plan = expectUse(planSchema(preLog(0), catalogue, 'read', 'open'));

    expect(ids(plan.pending)).toEqual(ids(catalogue));
    expect(plan.gate).toBe(LEGACY_GATE_OPEN);
  });
});

describe('adoption of a store no log-aware rafa has opened', () => {
  for (let version = 1; version <= LEGACY_GATE_OPEN; version += 1) {
    it(`at user_version ${String(version)} logs the first ${String(version)} entries and applies the rest`, () => {
      const plan = expectUse(planSchema(preLog(version), CATALOGUE, 'read', 'open'));

      expect(plan.adopted).toEqual(CATALOGUE.slice(0, version));
      expect(plan.pending).toEqual(CATALOGUE.slice(version));
      expect(plan.unknown).toEqual([]);
      expect(plan.gate).toBe(LEGACY_GATE_OPEN);
    });
  }

  it('throws on a catalogue shorter than the legacy entries the version counts', () => {
    expect(() => planSchema(preLog(3), LEGACY.slice(0, 2), 'read', 'open'))
      .toThrow('schema plan: the catalogue holds 2 migrations, fewer than the 3 legacy entries');
  });
});

describe('pre-log-unreleased', () => {
  for (const version of [LEGACY_GATE_OPEN + 1, LEGACY_GATE_OPEN + 2]) {
    it(`refuses a store at ${String(version)} with no log, for a read as for a write`, () => {
      const expected = {
        verdict: 'refuse',
        reason: 'pre-log-unreleased',
        message: `effort store: ${PATH} is at schema version ${String(version)} with no migration log;`
          + ' no released rafa wrote that. Refusing to read or write it.'
          + ` Next safe step: ${FIX}`,
        nextStep: FIX,
      };

      expect(planSchema(preLog(version), CATALOGUE, 'read', 'open')).toEqual(expected);
      expect(planSchema(preLog(version), CATALOGUE, 'write', 'migrate')).toEqual(expected);
    });
  }

  it('refuses a negative version, which no rafa writes', () => {
    expect(planSchema(preLog(-1), CATALOGUE, 'read', 'open'))
      .toMatchObject({ verdict: 'refuse', reason: 'pre-log-unreleased' });
  });

  it('refuses the closed gate with no log, since only a log-aware rafa closes it', () => {
    expect(planSchema(preLog(LEGACY_GATE_CLOSED), CATALOGUE, 'read', 'open'))
      .toMatchObject({ verdict: 'refuse', reason: 'pre-log-unreleased' });
  });
});

describe('gate-mismatch', () => {
  it('refuses a logged store whose version is neither the open nor the closed gate', () => {
    expect(planSchema(withLog(LEGACY_LOG, 14), CATALOGUE, 'read', 'open')).toEqual({
      verdict: 'refuse',
      reason: 'gate-mismatch',
      message: `effort store: ${PATH} has a migration log and schema version 14; a build older than`
        + ' the log migrated it after the log was made. Refusing to read or write it.'
        + ` Next safe step: ${FIX}`,
      nextStep: FIX,
    });
  });

  it('accepts the same log at the open gate and at the closed gate (control)', () => {
    expect(planSchema(withLog(LEGACY_LOG, LEGACY_GATE_OPEN), CATALOGUE, 'write', 'open').verdict).toBe('use');
    expect(planSchema(withLog(LEGACY_LOG, LEGACY_GATE_CLOSED), CATALOGUE, 'write', 'open').verdict).toBe('use');
  });

  it('refuses a version a pre-log release could count to, below the open gate', () => {
    expect(planSchema(withLog(LEGACY_LOG, 12), CATALOGUE, 'read', 'open'))
      .toMatchObject({ reason: 'gate-mismatch' });
  });
});

describe('a store holding exactly this build\'s catalogue', () => {
  it('has nothing to adopt or apply, for a read and for a write', () => {
    for (const access of ['read', 'write'] as const) {
      const plan = expectUse(planSchema(withLog(LEGACY_LOG), LEGACY, access, 'open'));

      expect(plan).toEqual({ verdict: 'use', adopted: [], pending: [], unknown: [], gate: LEGACY_GATE_OPEN });
    }
  });
});

describe('edited', () => {
  it('refuses a known id recorded with another checksum, naming both', () => {
    const recorded = 'f'.repeat(64);
    const log = LEGACY_LOG.map((row) => (
      row.id === 'plan-ci'
        ? { ...row, sha256: recorded }
        : row
    ));
    const holds = LEGACY.find(({ id }) => id === 'plan-ci')?.sha256 ?? '';
    const expected = {
      verdict: 'refuse',
      reason: 'edited',
      message: `effort store: ${PATH} recorded migration plan-ci as sha256 ${recorded}, and this rafa`
        + ` holds it as ${holds}; one was edited after it ran. Refusing to read or write the store.`
        + ` Next safe step: ${FIX}`,
      nextStep: FIX,
    };

    expect(planSchema(withLog(log), CATALOGUE, 'read', 'open')).toEqual(expected);
    expect(planSchema(withLog(log), CATALOGUE, 'write', 'migrate')).toEqual(expected);
  });
});

describe('an unknown additive migration', () => {
  const row = unknownRow('other-branch-table', []);
  const store = withLog([...LEGACY_LOG, row]);

  it('is used as it is for a read, and listed as unknown', () => {
    expect(planSchema(store, LEGACY, 'read', 'open'))
      .toEqual({ verdict: 'use', adopted: [], pending: [], unknown: [row], gate: LEGACY_GATE_OPEN });
  });

  it('is used as it is for a write, and listed as unknown', () => {
    expect(planSchema(store, LEGACY, 'write', 'open'))
      .toEqual({ verdict: 'use', adopted: [], pending: [], unknown: [row], gate: LEGACY_GATE_OPEN });
  });
});

/** The refusal text for an unknown row, ending as `ending` says. */
function unknownMessage(id: string, ending: string): string {
  return `effort store: ${PATH} holds migration ${id} (applied by 0.26.0+dev:/src/rafa on 2026-09-28),`
    + ` which this rafa does not know and ${ending}`
    + ` Next safe step: install a rafa that knows ${id}, or ${FIX}`;
}

describe('unknown-breaks-readers', () => {
  it('refuses an unknown migration that breaks readers, for a read as for a write', () => {
    const store = withLog([...LEGACY_LOG, unknownRow('drop-scope', ['readers', 'writers'])], LEGACY_GATE_CLOSED);
    const expected = {
      verdict: 'refuse',
      reason: 'unknown-breaks-readers',
      message: unknownMessage('drop-scope', 'which breaks older readers; refusing to read or write it.'),
      nextStep: `install a rafa that knows drop-scope, or ${FIX}`,
    };

    expect(planSchema(store, LEGACY, 'read', 'open')).toEqual(expected);
    expect(planSchema(store, LEGACY, 'write', 'open')).toEqual(expected);
  });

  it('refuses an unknown migration that carries a word this rafa does not know', () => {
    const store = withLog([...LEGACY_LOG, unknownRow('new-word', ['exporters'])], LEGACY_GATE_CLOSED);

    expect(planSchema(store, LEGACY, 'read', 'open')).toEqual({
      verdict: 'refuse',
      reason: 'unknown-breaks-readers',
      message: unknownMessage('new-word', 'which breaks older readers; refusing to read or write it.'),
      nextStep: `install a rafa that knows new-word, or ${FIX}`,
    });
  });

  it('shows the stored applied_at whole when it is not an ISO timestamp', () => {
    const row = { ...unknownRow('odd-date', ['readers']), appliedAt: 'yesterday' };
    const plan = planSchema(withLog([...LEGACY_LOG, row], LEGACY_GATE_CLOSED), LEGACY, 'read', 'open');

    expect(plan).toMatchObject({ verdict: 'refuse' });
    expect(plan.verdict === 'refuse' && plan.message).toContain('(applied by 0.26.0+dev:/src/rafa on yesterday)');
  });
});

describe('unknown-breaks-writers', () => {
  const row = unknownRow('new-unique-key', ['writers']);
  const store = withLog([...LEGACY_LOG, row], LEGACY_GATE_CLOSED);

  it('lets a read with nothing to apply use the store, and keeps the gate closed', () => {
    expect(planSchema(store, LEGACY, 'read', 'open'))
      .toEqual({ verdict: 'use', adopted: [], pending: [], unknown: [row], gate: LEGACY_GATE_CLOSED });
  });

  it('refuses a write', () => {
    expect(planSchema(store, LEGACY, 'write', 'open')).toEqual({
      verdict: 'refuse',
      reason: 'unknown-breaks-writers',
      message: unknownMessage('new-unique-key', 'which breaks older writers; refusing to write it.'),
      nextStep: `install a rafa that knows new-unique-key, or ${FIX}`,
    });
  });

  it('refuses a read that has a migration to apply, since applying it writes', () => {
    expect(planSchema(store, [...LEGACY, entry('synthetic-note')], 'read', 'open'))
      .toMatchObject({ verdict: 'refuse', reason: 'unknown-breaks-writers' });
  });
});

describe('an additive migration applied out of order', () => {
  it('applies an earlier additive entry after a later one the store already holds', () => {
    const early = entry('synthetic-early');
    const late = entry('synthetic-late');
    const plan = expectUse(planSchema(withLog([...LEGACY_LOG, logged(late)]), [...LEGACY, early, late], 'write', 'open'));

    expect(plan.pending).toEqual([early]);
    expect(plan.gate).toBe(LEGACY_GATE_OPEN);
  });
});

describe('breaking-out-of-order', () => {
  const breaking = entry('synthetic-rename', ['readers', 'writers']);
  const late = entry('synthetic-late');
  const store = withLog([...LEGACY_LOG, logged(late)]);
  const expected = {
    verdict: 'refuse',
    reason: 'breaking-out-of-order',
    message: `effort store: ${PATH} needs migration synthetic-rename ahead of synthetic-late, which is`
      + ' already applied; a migration that breaks older runtimes applies only in order.'
      + ' Refusing to read or write the store. Next safe step: rafa effort schema',
    nextStep: 'rafa effort schema',
  };

  it('refuses a pending breaking entry that sorts before an applied one, on an open', () => {
    expect(planSchema(store, [...LEGACY, breaking, late], 'read', 'open')).toEqual(expected);
  });

  it('refuses it from rafa effort migrate too', () => {
    expect(planSchema(store, [...LEGACY, breaking, late], 'write', 'migrate')).toEqual(expected);
  });
});

describe('breaking-pending', () => {
  const breaking = entry('synthetic-rename', ['writers']);
  const catalogue = [...LEGACY, entry('synthetic-note'), breaking];

  it('refuses a pending breaking entry on an ordinary open', () => {
    expect(planSchema(withLog(LEGACY_LOG), catalogue, 'read', 'open')).toEqual({
      verdict: 'refuse',
      reason: 'breaking-pending',
      message: `effort store: ${PATH} needs migration synthetic-rename, which breaks older runtimes`
        + ' and is applied only by \'rafa effort migrate\'; refusing to read or write the store'
        + ' until then. Next safe step: rafa effort migrate --dry-run',
      nextStep: 'rafa effort migrate --dry-run',
    });
  });

  it('refuses it on a fresh store too, which an open would build in full', () => {
    expect(planSchema(preLog(0), catalogue, 'write', 'open')).toMatchObject({ reason: 'breaking-pending' });
  });

  it('lets rafa effort migrate apply it in order, and closes the gate', () => {
    const plan = expectUse(planSchema(withLog(LEGACY_LOG), catalogue, 'write', 'migrate'));

    expect(ids(plan.pending)).toEqual(['synthetic-note', 'synthetic-rename']);
    expect(plan.gate).toBe(LEGACY_GATE_CLOSED);
  });

  it('keeps the gate closed once the breaking entry is held', () => {
    const plan = expectUse(planSchema(
      withLog([...LEGACY_LOG, logged(breaking)], LEGACY_GATE_CLOSED),
      [...LEGACY, breaking],
      'write',
      'open',
    ));

    expect(plan.pending).toEqual([]);
    expect(plan.gate).toBe(LEGACY_GATE_CLOSED);
  });
});

describe('two branches that each append a migration', () => {
  const a = entry('branch-a-table', [], 'CREATE TABLE a (seq INTEGER PRIMARY KEY);');
  const b = entry('branch-b-column', [], 'ALTER TABLE sessions ADD COLUMN b TEXT;');
  /** Main after both merge, A first as the repair keeps them. */
  const merged = [...LEGACY, a, b];

  it('applies both in order to a fresh store', () => {
    expect(ids(expectUse(planSchema(preLog(0), merged, 'write', 'open')).pending)).toEqual([...ids(LEGACY), a.id, b.id]);
  });

  it('applies B to the live store, which already holds A', () => {
    const plan = expectUse(planSchema(withLog([...LEGACY_LOG, logged(a)]), merged, 'write', 'open'));

    expect(plan.pending).toEqual([b]);
    expect(plan.gate).toBe(LEGACY_GATE_OPEN);
  });

  it('applies A late to a copy B\'s tasks migrated, which holds B and not A', () => {
    const plan = expectUse(planSchema(withLog([...LEGACY_LOG, logged(b)]), merged, 'write', 'open'));

    expect(plan.pending).toEqual([a]);
  });

  it('lets B\'s own build, which knows no A, use the live store and list A as unknown', () => {
    const plan = expectUse(planSchema(withLog([...LEGACY_LOG, logged(a)]), [...LEGACY, b], 'write', 'open'));

    expect(plan.pending).toEqual([b]);
    expect(ids(plan.unknown)).toEqual([a.id]);
  });

  it('refuses as edited when both branches chose the same id for different SQL', () => {
    const sameIdOnB = { ...b, id: a.id };
    const plan = planSchema(withLog([...LEGACY_LOG, logged(a)]), [...LEGACY, sameIdOnB], 'read', 'open');

    expect(plan).toMatchObject({ verdict: 'refuse', reason: 'edited' });
  });
});

describe('the reasons and their ways out', () => {
  it('holds seven reasons, in the order they are tried', () => {
    expect(REFUSAL_REASONS).toEqual([
      'pre-log-unreleased',
      'gate-mismatch',
      'edited',
      'unknown-breaks-readers',
      'unknown-breaks-writers',
      'breaking-out-of-order',
      'breaking-pending',
    ]);
  });

  it('decides by the first row that matches: an edited entry before an unknown breaking one', () => {
    const log = [
      ...LEGACY_LOG.map((row) => (
        row.id === 'kind-tables'
          ? { ...row, sha256: '0'.repeat(64) }
          : row
      )),
      unknownRow('drop-scope', ['readers']),
    ];

    expect(planSchema(withLog(log), LEGACY, 'write', 'open')).toMatchObject({ reason: 'edited' });
  });

  it('ends every refusal with its next step', () => {
    const breaking = entry('synthetic-rename', ['writers']);
    const late = entry('synthetic-late');
    const refusals = [
      planSchema(preLog(14), LEGACY, 'read', 'open'),
      planSchema(withLog(LEGACY_LOG, 14), LEGACY, 'read', 'open'),
      planSchema(withLog([{ ...logged(late), id: 'plan-ci' }]), LEGACY, 'read', 'open'),
      planSchema(withLog([unknownRow('x', ['readers'])]), [], 'read', 'open'),
      planSchema(withLog([unknownRow('x', ['writers'])]), [], 'write', 'open'),
      planSchema(withLog([logged(late)]), [breaking, late], 'read', 'open'),
      planSchema(withLog([]), [breaking], 'read', 'open'),
    ];

    expect(refusals.map((plan) => plan.verdict === 'refuse' && plan.reason)).toEqual([...REFUSAL_REASONS]);
    for (const plan of refusals) {
      if (plan.verdict === 'use') throw new Error('expected a refusal');
      expect(plan.message.endsWith(` Next safe step: ${plan.nextStep}`)).toBe(true);
    }
  });
});
