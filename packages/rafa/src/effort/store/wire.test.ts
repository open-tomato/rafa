/**
 * The sync wire codec over real store files under one temp directory:
 * a sending store exported past a cursor, the payload carried as JSON
 * text, and the materialised file merged by `mergeStore` into a
 * receiving store.
 *
 * Rows are planted as a production insert stamps them, `seq` and
 * `origin_seq` equal under the store's origin. Every merge runs as an
 * installed runtime and reads no git.
 *
 * Each refusal has a control beside it: the same planting less the one
 * fault, which exports or materialises. Each materialise refusal also
 * finds the scratch parent empty afterwards, and the success cases find
 * it holding the one directory, so an emptiness check that could not
 * see a directory would fail there.
 *
 * The last block holds `wire-contract.lock.json` against this build: each
 * shipped entry matches its pinned sha256, the highest version is
 * `WIRE_CONTRACT_VERSION` and its `wireVersion` is `WIRE_VERSION`, and each
 * entry's migration ids are a prefix of the `SQLITE_MIGRATIONS` ids and its
 * tables are tables of `row-fields.lock.json`. A table's value is the sha256
 * of its sorted row fields joined by newlines, as that lock held them when
 * the entry shipped. Its refusals run over in-memory fixture locks, never an
 * edited copy of the real one, and each expects its one fault alone, beside
 * a control fixture that holds.
 */
import type { MergeOptions } from './merge-store.js';
import type { MaterialiseOptions, WirePayload, WireRow } from './wire.js';
import type { RuntimeIdentity } from '../../core/runtime/index.js';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import { MERGE_RULES } from './merge-rules.js';
import { mergeStore } from './merge-store.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import ROW_FIELDS_LOCK from './row-fields.lock.json';
import WIRE_CONTRACT_LOCK from './wire-contract.lock.json';
import {
  decodeWirePayload,
  encodeWirePayload,
  exportWirePayload,
  materialiseWirePayload,
  WIRE_CONTRACT_VERSION,
  WIRE_FORMAT,
  WIRE_VERSION,
  WireExportRefusal,
  WireFormatError,
} from './wire.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-wire-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-09-30T12:00:00.000Z');

const COLLECTED_AT = '2026-09-30T10:00:00.000Z';

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.31.0/cli.js' };

/** The sending and receiving stores' origins. */
const SENDER = 'store-a';
const RECEIVER = 'store-b';

/** Every merged table, in `MERGE_RULES` order. */
const MERGED = Object.entries(MERGE_RULES)
  .filter(([, rule]) => rule.scope === 'merged')
  .map(([table]) => table);

/** Every migration id this build knows, in catalogue order. */
const ALL_IDS = SQLITE_MIGRATIONS.map(({ id }) => id);

let planted = 0;

/** A new directory under the suite's scope. */
function freshDir(name: string): string {
  planted += 1;
  const dir = join(scope, `${String(planted)}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs `use` on a store made at `path`, brought through `migrations` first. */
function withStore(path: string, use: (db: Database) => void, migrations = SQLITE_MIGRATIONS): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { identity: INSTALLED, migrations, builtAside: true });
    use(db);
  } finally {
    db.close();
  }
}

/** A store at a fresh path, brought through `migrations` and planted by `use`. */
function plantStore(name: string, use: (db: Database) => void = () => undefined, migrations = SQLITE_MIGRATIONS): string {
  const path = join(freshDir(name), 'effort.sqlite');
  withStore(path, use, migrations);
  return path;
}

/** The next `seq` of `table`. */
function nextSeq(db: Database, table: string): number {
  return db.query<{ n: number }, []>(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM ${table}`).get()?.n ?? 1;
}

/** Plants a finding for `key` under `origin`, stamped as a production insert stamps it. */
function plantFinding(db: Database, origin: string, key: string): void {
  const seq = nextSeq(db, 'findings');
  db.query(
    'INSERT INTO findings (seq, origin_store, origin_seq, id, session_id, task_line, kind, what, artifact, signal, outcome, collected_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, \'gotcha\', ?, ?, \'loud\', \'done\', ?)',
  ).run(seq, origin, seq, `id-${key}`, `session-${key}`, `task ${key}`, `what ${key}`, `artifact-${key}`, COLLECTED_AT);
}

/** Plants a commit under `origin`. */
function plantCommit(db: Database, origin: string, sha: string, timestamp: string): void {
  const seq = nextSeq(db, 'commits');
  db.query('INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (?, ?, ?, ?, ?)')
    .run(seq, origin, seq, sha, JSON.stringify({ sha, timestamp, minutesSincePrevious: null }));
}

/** The sending store: two findings and one commit under its own origin, one finding copied from the receiver. */
function plantSender(db: Database): void {
  plantFinding(db, SENDER, 'a1');
  plantFinding(db, SENDER, 'a2');
  plantFinding(db, RECEIVER, 'b1');
  plantCommit(db, SENDER, 'sha-a', '2026-09-30T10:00:00.000Z');
}

/** Rows `sql` answers on the store at `path`, read-only. */
function readRows<Row>(path: string, sql: string): Row[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<Row, []>(sql).all();
  } finally {
    db.close();
  }
}

/** The options of one merge of `otherPath` into `path`, as an installed runtime with no live loop. */
function mergeOptions(path: string, otherPath: string, stamp: string): MergeOptions {
  return {
    path,
    otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp,
    now: () => NOW,
    newMergeId: () => `merge-${stamp}`,
    readProject: () => ({ rootCommit: null, remote: null }),
    identity: INSTALLED,
    isAlive: () => false,
  };
}

/** Materialise options under a scratch parent of the case's own. */
function scratchOptions(name: string): MaterialiseOptions & { readonly tempDir: string } {
  return { tempDir: freshDir(name), identity: INSTALLED, now: () => NOW };
}

/** The rows the payload carries for `table`. */
function rowsOf(payload: WirePayload, table: string): readonly WireRow[] {
  return payload.tables[table] ?? [];
}

/** A valid payload with `change` laid over it, as untyped input. */
function payloadWith(change: Record<string, unknown>): WirePayload {
  return { ...exportWirePayload({ path: plantStore('base', plantSender) }), ...change } as unknown as WirePayload;
}

/** The error `attempt` throws, or null when it throws none. */
function thrownBy(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  return null;
}

describe('exportWirePayload', () => {
  it('carries every merged table with its rows, origin pairs, the migration log and the cursor', () => {
    const payload = exportWirePayload({ path: plantStore('export', plantSender) });

    expect(payload.format).toBe(WIRE_FORMAT);
    expect(payload.version).toBe(WIRE_VERSION);
    expect(payload.migrations).toEqual(ALL_IDS);
    expect(Object.keys(payload.tables)).toEqual(MERGED);
    expect(rowsOf(payload, 'findings').map((row) => [row.seq, row.origin_store, row.origin_seq, row.id])).toEqual([
      [1, SENDER, 1, 'id-a1'],
      [2, SENDER, 2, 'id-a2'],
      [3, RECEIVER, 3, 'id-b1'],
    ]);
    expect(rowsOf(payload, 'commits')).toHaveLength(1);
    expect(rowsOf(payload, 'sessions')).toEqual([]);
    expect(payload.cursor).toEqual({ ...Object.fromEntries(MERGED.map((table) => [table, 0])), findings: 3, commits: 1 });
  });

  it('carries every column of a row by name, seq included', () => {
    const payload = exportWirePayload({ path: plantStore('columns', plantSender) });
    const path = plantStore('columns-schema');
    const columns = readRows<{ name: string }>(path, 'PRAGMA table_info(findings)').map(({ name }) => name);

    expect(Object.keys(rowsOf(payload, 'findings')[0] ?? {}).sort()).toEqual([...columns].sort());
  });

  it('sends only the rows past the cursor, and keeps a table\'s cursor when nothing is new', () => {
    const path = plantStore('cursor', plantSender);
    const first = exportWirePayload({ path });
    withStore(path, (db) => plantFinding(db, SENDER, 'a3'));

    const second = exportWirePayload({ path, cursor: first.cursor });

    expect(rowsOf(second, 'findings').map((row) => row.id)).toEqual(['id-a3']);
    expect(rowsOf(second, 'commits')).toEqual([]);
    expect(second.cursor.findings).toBe(4);
    expect(second.cursor.commits).toBe(1);
  });

  it('sends every row again from an empty cursor, the control for the cursor case', () => {
    const path = plantStore('no-cursor', plantSender);
    exportWirePayload({ path });

    expect(rowsOf(exportWirePayload({ path, cursor: {} }), 'findings')).toHaveLength(3);
  });

  it('leaves the store file byte-identical', () => {
    const path = plantStore('read-only', plantSender);
    const before = readFileSync(path);

    exportWirePayload({ path });

    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it.each([
    ['a table that is not merged', { store_meta: 0 }, 'no merged table'],
    ['a negative seq', { findings: -1 }, 'expected a whole number of 0 or more'],
    ['a fraction', { findings: 1.5 }, 'expected a whole number of 0 or more'],
    ['a string', { findings: '3' }, 'expected a whole number of 0 or more'],
  ])('refuses a cursor naming %s', (_label, cursor, message) => {
    const path = plantStore('bad-cursor', plantSender);
    const error = thrownBy(() => exportWirePayload({ path, cursor: cursor as unknown as Record<string, number> }));

    expect(error).toBeInstanceOf(WireFormatError);
    expect((error as Error).message).toContain(message);
  });

  it('refuses a store file that is not there', () => {
    const path = join(freshDir('absent'), 'effort.sqlite');

    expect(() => exportWirePayload({ path })).toThrow(WireExportRefusal);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses a store with no migration log', () => {
    const path = join(freshDir('no-log'), 'effort.sqlite');
    new Database(path, { create: true }).close();

    expect(() => exportWirePayload({ path })).toThrow('has no migration log');
  });

  it('refuses a store whose rows carry no origin pair', () => {
    const beforeOrigins = SQLITE_MIGRATIONS.slice(0, ALL_IDS.indexOf('row-origins'));
    const path = plantStore('no-origins', () => undefined, beforeOrigins);

    expect(() => exportWirePayload({ path })).toThrow('so its rows carry no origin pair');
  });

  it('refuses an integer past what JSON carries exactly, and exports the largest one it does', () => {
    const past = plantStore('unsafe', (db) => {
      db.query('INSERT INTO blockers (seq, id, session_id, task_line, what, outcome, collected_at) VALUES (?, \'x\', \'s\', \'t\', \'w\', \'done\', ?)')
        .run(2n ** 53n + 1n, COLLECTED_AT);
    });
    const largest = plantStore('safe', (db) => {
      db.query('INSERT INTO blockers (seq, id, session_id, task_line, what, outcome, collected_at) VALUES (?, \'x\', \'s\', \'t\', \'w\', \'done\', ?)')
        .run(Number.MAX_SAFE_INTEGER, COLLECTED_AT);
    });

    expect(() => exportWirePayload({ path: past })).toThrow('past the whole numbers JSON carries exactly');
    expect(rowsOf(exportWirePayload({ path: largest }), 'blockers')[0]?.seq).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses a BLOB value', () => {
    const path = plantStore('blob', (db) => {
      db.query('INSERT INTO commits (seq, sha, row_json) VALUES (1, \'sha\', ?)').run(new Uint8Array([1, 2]));
    });

    expect(() => exportWirePayload({ path })).toThrow('holds a BLOB');
  });
});

describe('the payload as JSON text', () => {
  it('decodes what it encodes to an equal payload', () => {
    const payload = exportWirePayload({ path: plantStore('round-trip', plantSender) });

    expect(decodeWirePayload(encodeWirePayload(payload))).toEqual(payload);
  });

  it.each([
    ['text that is not JSON', '{', 'is not JSON'],
    ['a list', '[]', 'is not an object'],
    ['another format', JSON.stringify({ format: 'other', version: 1 }), 'format is "other"'],
    ['another version', JSON.stringify({ format: WIRE_FORMAT, version: 2 }), 'this rafa reads version 1'],
  ])('refuses %s', (_label, text, message) => {
    const error = thrownBy(() => decodeWirePayload(text));

    expect(error).toBeInstanceOf(WireFormatError);
    expect((error as Error).message).toContain(message);
  });

  it.each([
    ['migrations named twice', { migrations: ['kind-tables', 'kind-tables'] }, 'more than once'],
    ['an empty migration id', { migrations: [''] }, 'is not a name'],
    ['a table that is not merged', { tables: { store_meta: [] } }, 'which is no merged table'],
    ['the prototype key as a table', { tables: JSON.parse('{"__proto__": []}') as unknown }, 'which is no merged table'],
    ['rows that are not a list', { tables: { findings: {} } }, 'tables.findings is not a list'],
    ['a row holding an object', { tables: { findings: [{ seq: 1, what: {} }] } }, 'expected a string, a number or null'],
    ['a row with no seq', { tables: { findings: [{ what: 'w' }] } }, 'expected a whole number above 0'],
    ['a row with seq 0', { tables: { findings: [{ seq: 0 }] } }, 'expected a whole number above 0'],
  ])('refuses %s', (_label, change, message) => {
    const text = JSON.stringify(payloadWith(change));
    const error = thrownBy(() => decodeWirePayload(text));

    expect(error).toBeInstanceOf(WireFormatError);
    expect((error as Error).message).toContain(message);
  });
});

describe('materialiseWirePayload', () => {
  it('builds a store with the sender\'s migrations and rows as sent, seq and origin pair included', () => {
    const payload = exportWirePayload({ path: plantStore('sent', plantSender) });
    const options = scratchOptions('build');

    const built = materialiseWirePayload(payload, options);
    try {
      expect(readdirSync(options.tempDir)).toHaveLength(1);
      expect(readRows<{ id: string }>(built.path, 'SELECT id FROM schema_migrations ORDER BY seq').map(({ id }) => id))
        .toEqual(ALL_IDS);
      expect(readRows<{ seq: number; origin_store: string; origin_seq: number; id: string }>(
        built.path,
        'SELECT seq, origin_store, origin_seq, id FROM findings ORDER BY seq',
      )).toEqual(rowsOf(payload, 'findings').map((row) => ({
        seq: row.seq,
        origin_store: row.origin_store,
        origin_seq: row.origin_seq,
        id: row.id,
      })));
      expect(exportWirePayload({ path: built.path }).tables).toEqual(payload.tables);
    } finally {
      built.release();
    }
    expect(existsSync(built.directory)).toBe(false);
  });

  it('is merged by mergeStore as otherPath, and a second payload of the same rows adds nothing', () => {
    const sender = plantStore('sender', plantSender);
    const receiver = plantStore('receiver', (db) => plantFinding(db, RECEIVER, 'b1'));
    const text = encodeWirePayload(exportWirePayload({ path: sender }));

    const first = materialiseWirePayload(decodeWirePayload(text), scratchOptions('merge-1'));
    const merged = (() => {
      try {
        return mergeStore(mergeOptions(receiver, first.path, 'first'));
      } finally {
        first.release();
      }
    })();
    const again = materialiseWirePayload(decodeWirePayload(text), scratchOptions('merge-2'));
    const repeated = (() => {
      try {
        return mergeStore(mergeOptions(receiver, again.path, 'second'));
      } finally {
        again.release();
      }
    })();

    expect(merged.status).toBe('merged');
    expect(merged.rowsAdded).toBe(3);
    expect(merged.rowsSkipped).toBe(1);
    expect(repeated.rowsAdded).toBe(0);
    expect(readRows<{ origin_store: string; origin_seq: number; id: string }>(
      receiver,
      'SELECT origin_store, origin_seq, id FROM findings ORDER BY id',
    )).toEqual([
      { origin_store: SENDER, origin_seq: 1, id: 'id-a1' },
      { origin_store: SENDER, origin_seq: 2, id: 'id-a2' },
      { origin_store: RECEIVER, origin_seq: 1, id: 'id-b1' },
    ]);
  });

  it('builds an older sender\'s store at its own migrations, which the merge brings forward', () => {
    const older = SQLITE_MIGRATIONS.slice(0, -1);
    const lastId = ALL_IDS[ALL_IDS.length - 1];
    const payload = exportWirePayload({ path: plantStore('older', plantSender, older) });
    const receiver = plantStore('older-receiver');

    const built = materialiseWirePayload(payload, scratchOptions('older-build'));
    try {
      expect(payload.migrations).not.toContain(lastId);
      const merged = mergeStore(mergeOptions(receiver, built.path, 'older'));
      expect(merged.otherBroughtForward).toEqual([lastId]);
      expect(merged.rowsAdded).toBe(4);
    } finally {
      built.release();
    }
  });

  it.each([
    ['a migration this rafa does not know', { migrations: [...ALL_IDS, 'from-the-future'] }, 'from-the-future, which this rafa does not know'],
    ['a table its migrations do not make', { migrations: ALL_IDS.slice(0, 1), tables: { findings: [] } }, 'which its migrations do not make'],
    ['a row missing a column', { tables: { findings: [{ seq: 1, id: 'x' }] } }, 'its migrations make'],
    ['a row the table refuses', { tables: { findings: [{ ...rowsOfSender('findings')[0], kind: 'rumour' }] } }, 'is refused by the table'],
    ['two rows of one seq', { tables: { findings: [rowsOfSender('findings')[0], rowsOfSender('findings')[0]] } }, 'is refused by the table'],
    ['a payload that is not one', { format: 'other' }, 'format is "other"'],
  ])('refuses %s, leaving nothing behind', (_label, change, message) => {
    const options = scratchOptions('refused');
    const error = thrownBy(() => materialiseWirePayload(payloadWith(change), options));

    expect(error).toBeInstanceOf(WireFormatError);
    expect((error as Error).message).toContain(message);
    expect(readdirSync(options.tempDir)).toEqual([]);
  });

  it('builds the unchanged payload the refusals start from, the control for them', () => {
    const options = scratchOptions('control');

    const built = materialiseWirePayload(payloadWith({}), options);
    const made = readdirSync(options.tempDir);
    built.release();

    expect(made).toHaveLength(1);
    expect(readdirSync(options.tempDir)).toEqual([]);
  });
});

/** The sending store's rows of `table`, exported once for the refusal table above. */
function rowsOfSender(table: string): readonly WireRow[] {
  return rowsOf(exportWirePayload({ path: plantStore('sender-rows', plantSender) }), table);
}

/**
 * The sha256 of each shipped entry of `wire-contract.lock.json`, by
 * contract version, over the entry's JSON text as `JSON.stringify` writes
 * it. A shipped entry is never edited; a new contract version adds its
 * entry and its line here in one commit.
 */
const SHIPPED_CONTRACT_ENTRIES: Readonly<Record<string, string>> = {
  '1': '18b61381d6b33bc40199461e4d7f6bcb99ab50f6b8cf34b6b4c701625524c1a2',
};

/** What a lock is checked against: its pins, and the numbers, ids and row-field tables of a build. */
interface ContractSources {
  readonly pins: Readonly<Record<string, string>>;
  readonly contractVersion: number;
  readonly wireVersion: number;
  readonly migrationIds: readonly string[];
  readonly rowFieldTables: readonly string[];
}

/** One lock entry, its shape checked. */
interface ContractEntry {
  readonly wireVersion: number;
  readonly migrations: readonly string[];
  readonly tables: Readonly<Record<string, string>>;
}

/** This build's sources, the real lock's pins among them. */
const BUILD_SOURCES: ContractSources = {
  pins: SHIPPED_CONTRACT_ENTRIES,
  contractVersion: WIRE_CONTRACT_VERSION,
  wireVersion: WIRE_VERSION,
  migrationIds: ALL_IDS,
  rowFieldTables: Object.keys(ROW_FIELDS_LOCK),
};

/** The sha256 of `value`'s JSON text, as lowercase hex. */
function sha256OfJson(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

/** Whether `value` is a lowercase sha256 hex digest. */
function isDigest(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Whether `value` is a list of strings. */
function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** `value` as an entry, or the fault its shape holds. */
function readEntry(version: string, value: unknown): ContractEntry | string {
  if (!isPlainObject(value)) return `version ${version}: entry is not an object`;
  const { wireVersion, migrations, tables } = value;
  if (typeof wireVersion !== 'number' || !Number.isSafeInteger(wireVersion) || wireVersion < 1) {
    return `version ${version}: wireVersion is ${JSON.stringify(wireVersion)}, expected a whole number of 1 or more`;
  }
  if (!isStringList(migrations)) return `version ${version}: migrations is not a list of ids`;
  if (!isPlainObject(tables) || !Object.values(tables).every(isDigest)) {
    return `version ${version}: tables is not a sha256 per table`;
  }
  return { wireVersion, migrations, tables: tables as Readonly<Record<string, string>> };
}

/** Whether `value` is a plain JSON object. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Each entry against its pin, and each pin against an entry. */
function pinFaults(lock: Readonly<Record<string, unknown>>, pins: Readonly<Record<string, string>>): string[] {
  const entryFaults = Object.entries(lock).flatMap(([version, entry]) => {
    const pin = pins[version];
    const computed = sha256OfJson(entry);
    if (pin === undefined) return [`version ${version}: no pinned sha256, entry hashes to ${computed}`];
    return pin === computed
      ? []
      : [`version ${version}: entry hashes to ${computed}, pinned as ${pin}`];
  });
  const orphanFaults = Object.keys(pins)
    .filter((version) => !(version in lock))
    .map((version) => `version ${version}: pinned, but not in the lock`);
  return [...entryFaults, ...orphanFaults];
}

/** One entry's cut against the build: its migration ids a prefix of the catalogue, its tables row-field tables. */
function cutFaults(version: string, entry: ContractEntry, sources: ContractSources): string[] {
  const apart = entry.migrations.findIndex((id, index) => sources.migrationIds[index] !== id);
  const migrationFaults = apart === -1
    ? []
    : [`version ${version}: migrations are no prefix of SQLITE_MIGRATIONS, apart at ${JSON.stringify(entry.migrations[apart])}`];
  const tableFaults = Object.keys(entry.tables)
    .filter((table) => !sources.rowFieldTables.includes(table))
    .map((table) => `version ${version}: table ${JSON.stringify(table)} is not in row-fields.lock.json`);
  return [...migrationFaults, ...tableFaults];
}

/** The highest version against the build's contract and payload versions. */
function highestFaults(versions: readonly string[], entries: ReadonlyMap<string, ContractEntry>, sources: ContractSources): string[] {
  const highest = Math.max(...versions.map(Number));
  const entry = entries.get(String(highest));
  const versionFaults = highest === sources.contractVersion
    ? []
    : [`highest version is ${String(highest)}, WIRE_CONTRACT_VERSION is ${String(sources.contractVersion)}`];
  const wireFaults = entry === undefined || entry.wireVersion === sources.wireVersion
    ? []
    : [`version ${String(highest)}: wireVersion is ${String(entry.wireVersion)}, WIRE_VERSION is ${String(sources.wireVersion)}`];
  return [...versionFaults, ...wireFaults];
}

/**
 * Every way `lock` disagrees with `sources`: a version that is no whole
 * number, an entry of the wrong shape, an entry its pin does not match,
 * a cut past the build, and a highest version apart from the build's. An
 * empty answer means the lock holds.
 */
function contractLockFaults(lock: unknown, sources: ContractSources): string[] {
  if (!isPlainObject(lock)) return ['lock: not an object'];
  const versions = Object.keys(lock);
  if (versions.length === 0) return ['lock: holds no version'];
  const badVersions = versions
    .filter((version) => !/^[1-9][0-9]*$/.test(version))
    .map((version) => `version ${JSON.stringify(version)} is no whole number of 1 or more`);
  if (badVersions.length > 0) return badVersions;
  const read = versions.map((version): [string, ContractEntry | string] => [version, readEntry(version, lock[version])]);
  const shapeFaults = read.map(([, entry]) => entry).filter((entry) => typeof entry === 'string');
  const entries = new Map(read.filter((pair): pair is [string, ContractEntry] => typeof pair[1] !== 'string'));
  const cuts = [...entries].flatMap(([version, entry]) => cutFaults(version, entry, sources));
  return [...shapeFaults, ...pinFaults(lock, sources.pins), ...cuts, ...highestFaults(versions, entries, sources)];
}

/** A digest standing for one table's fields in the fixtures. */
const FIXTURE_DIGEST = 'a'.repeat(64);

/** A fixture build: three migrations and two row-field tables, at contract 2 and payload version 3. */
const FIXTURE_BUILD = {
  contractVersion: 2,
  wireVersion: 3,
  migrationIds: ['first', 'second', 'third'],
  rowFieldTables: ['sessions', 'commits'],
} as const;

/** A lock that holds against {@link FIXTURE_BUILD}: two versions, the older at fewer migrations. */
const FIXTURE_LOCK: Readonly<Record<string, unknown>> = {
  '1': { wireVersion: 1, migrations: ['first'], tables: { sessions: FIXTURE_DIGEST } },
  '2': { wireVersion: 3, migrations: ['first', 'second'], tables: { sessions: FIXTURE_DIGEST, commits: FIXTURE_DIGEST } },
};

/** The pins of every entry of `lock`, as shipping it would write them. */
function pinsOf(lock: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(lock).map(([version, entry]) => [version, sha256OfJson(entry)]));
}

/** {@link FIXTURE_LOCK} with version 2's entry laid over by `change`. */
function fixtureWith(change: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { ...FIXTURE_LOCK, '2': { ...(FIXTURE_LOCK['2'] as Readonly<Record<string, unknown>>), ...change } };
}

/** The fixture build's sources over `lock`, its pins those of `lock`, with `change` laid over them. */
function fixtureSources(lock: Readonly<Record<string, unknown>>, change: Partial<ContractSources> = {}): ContractSources {
  return { ...FIXTURE_BUILD, pins: pinsOf(lock), ...change };
}

describe('the wire contract lock', () => {
  const edited = { ...FIXTURE_LOCK, '1': { wireVersion: 1, migrations: ['first'], tables: { sessions: 'b'.repeat(64) } } };

  it.each<[string, unknown, ContractSources, string]>([
    ['a lock that is not an object', [], fixtureSources(FIXTURE_LOCK), 'lock: not an object'],
    ['a lock with no version', {}, fixtureSources({}), 'lock: holds no version'],
    ['a version that is no whole number', { ...FIXTURE_LOCK, v3: {} }, fixtureSources(FIXTURE_LOCK), 'version "v3" is no whole number of 1 or more'],
    ['an entry with no wireVersion', fixtureWith({ wireVersion: undefined }), fixtureSources(fixtureWith({ wireVersion: undefined })), 'version 2: wireVersion is undefined, expected a whole number of 1 or more'],
    ['an entry whose table holds no sha256', fixtureWith({ tables: { sessions: 'abc' } }), fixtureSources(fixtureWith({ tables: { sessions: 'abc' } })), 'version 2: tables is not a sha256 per table'],
    ['a shipped entry edited', edited, fixtureSources(FIXTURE_LOCK), `version 1: entry hashes to ${sha256OfJson(edited['1'])}, pinned as ${pinsOf(FIXTURE_LOCK)['1'] ?? ''}`],
    ['an entry with no pin', FIXTURE_LOCK, fixtureSources(FIXTURE_LOCK, { pins: { '1': pinsOf(FIXTURE_LOCK)['1'] ?? '' } }), `version 2: no pinned sha256, entry hashes to ${pinsOf(FIXTURE_LOCK)['2'] ?? ''}`],
    ['a pin with no entry', FIXTURE_LOCK, fixtureSources(FIXTURE_LOCK, { pins: { ...pinsOf(FIXTURE_LOCK), '3': FIXTURE_DIGEST } }), 'version 3: pinned, but not in the lock'],
    ['a highest version past WIRE_CONTRACT_VERSION', FIXTURE_LOCK, fixtureSources(FIXTURE_LOCK, { contractVersion: 1 }), 'highest version is 2, WIRE_CONTRACT_VERSION is 1'],
    ['a highest version short of WIRE_CONTRACT_VERSION', FIXTURE_LOCK, fixtureSources(FIXTURE_LOCK, { contractVersion: 3 }), 'highest version is 2, WIRE_CONTRACT_VERSION is 3'],
    ['a highest version whose wireVersion is not WIRE_VERSION', FIXTURE_LOCK, fixtureSources(FIXTURE_LOCK, { wireVersion: 4 }), 'version 2: wireVersion is 3, WIRE_VERSION is 4'],
    ['migration ids out of catalogue order', fixtureWith({ migrations: ['first', 'third'] }), fixtureSources(fixtureWith({ migrations: ['first', 'third'] })), 'version 2: migrations are no prefix of SQLITE_MIGRATIONS, apart at "third"'],
    ['migration ids past the catalogue', fixtureWith({ migrations: ['first', 'second', 'third', 'fourth'] }), fixtureSources(fixtureWith({ migrations: ['first', 'second', 'third', 'fourth'] })), 'version 2: migrations are no prefix of SQLITE_MIGRATIONS, apart at "fourth"'],
    ['a cut table not in row-fields.lock.json', fixtureWith({ tables: { sessions: FIXTURE_DIGEST, findings: FIXTURE_DIGEST } }), fixtureSources(fixtureWith({ tables: { sessions: FIXTURE_DIGEST, findings: FIXTURE_DIGEST } })), 'version 2: table "findings" is not in row-fields.lock.json'],
  ])('refuses %s, naming that one fault', (_label, lock, sources, fault) => {
    expect(contractLockFaults(lock, sources)).toEqual([fault]);
  });

  it('holds the fixture lock the refusals start from, the control for them', () => {
    expect(contractLockFaults(FIXTURE_LOCK, fixtureSources(FIXTURE_LOCK))).toEqual([]);
  });

  it('takes the highest version by number, 10 over 9', () => {
    const lock = { '9': FIXTURE_LOCK['1'], '10': FIXTURE_LOCK['2'] };

    expect(contractLockFaults(lock, fixtureSources(lock, { contractVersion: 10 }))).toEqual([]);
    expect(contractLockFaults(lock, fixtureSources(lock, { contractVersion: 9 }))).toEqual(['highest version is 10, WIRE_CONTRACT_VERSION is 9']);
  });

  it('holds the shipped lock against this build', () => {
    expect(contractLockFaults(WIRE_CONTRACT_LOCK, BUILD_SOURCES)).toEqual([]);
  });

  it('pins every shipped entry, version 1 among them', () => {
    expect(Object.keys(WIRE_CONTRACT_LOCK)).toEqual(Object.keys(SHIPPED_CONTRACT_ENTRIES));
    expect(Object.keys(WIRE_CONTRACT_LOCK)).toContain('1');
  });
});
