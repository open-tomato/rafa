/**
 * The SQLite hub store (`sqlite.ts`): what is the adapter's own, the
 * port's contract suites running over it by name in `contract.test.ts`.
 * That covers the refusal of a push naming a migration the hub lacks,
 * the files it keeps and the ones it leaves behind, a push holding no
 * row, its capabilities, a store reopened over its directory, the
 * projected pull, and a catalogue handed down in place of this build's.
 *
 * Payloads here are built as the contract suite builds them. A real
 * store is opened under the temporary directory and given one commit,
 * then exported, and the row's key and origin pair are set by the case.
 * A device behind the hub names a prefix of this build's migration ids;
 * a hub ahead of this build is handed this build's catalogue with one
 * fixture migration after it, adding a column to `commits`.
 */
import type { HubStore } from './port.js';
import type { HubMigrationCatalogue } from './sqlite.js';
import type { CommitEffortRow, WirePayload, WireRow } from '@open-tomato/rafa/store';

import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeWirePayload,
  encodeWirePayload,
  exportWirePayload,
  materialiseWirePayload,
  openSqliteStore,
  WIRE_FORMAT,
  WIRE_VERSION,
} from '@open-tomato/rafa/store';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';
import { createLoaderState } from '@open-tomato/rafa-index/loader';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from '../config.js';

import { connectSqliteHub, devicesFileName, HUB_PACKAGE, HUB_UPGRADE, HubUpgradeRequired, openSqliteHubStore } from './sqlite.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const T0 = '2026-09-30T10:00:00.000Z';
const T1 = '2026-09-30T10:05:00.000Z';

/** A migration id no rafa has, as a newer store would name one. */
const FUTURE_MIGRATION = '9999-from-a-newer-rafa';

/** The fixture migration a hub ahead of this build holds: one column added to `commits`. */
const NOTE_MIGRATION = 'fixture-commit-note';

/** This build's catalogue with {@link NOTE_MIGRATION} after it. */
const AHEAD: HubMigrationCatalogue = [
  ...SQLITE_MIGRATIONS,
  { id: NOTE_MIGRATION, breaks: [], sql: 'ALTER TABLE commits ADD COLUMN fixture_note TEXT;' },
];

/** The first of this build's migrations a device behind it lacks: it adds `sessions.worktree`. */
const BEHIND_FROM = 'session-worktree';

/** A real export of one commit: its migrations and the row every case's rows are built from. */
interface Template {
  readonly migrations: readonly string[];
  readonly commit: WireRow;
}

function readTemplate(): Template {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-sqlite-template-')));
  try {
    const store = openSqliteStore(root);
    store.append('commits', [{ sha: 'f'.repeat(40), timestamp: T0 } as CommitEffortRow]);
    const exported = exportWirePayload({ path: store.path('commits') });
    const commit = exported.tables['commits']?.[0];
    if (commit === undefined) throw new Error('the template export holds no commit');
    return { migrations: exported.migrations, commit };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let template: Template | undefined;

function held(): Template {
  if (template === undefined) throw new Error('the template was not read');
  return template;
}

/** A commit created by `origin` as its `originSeq`th row, sent as the sender's `seq`. */
function commit(origin: string, originSeq: number, seq = originSeq): WireRow {
  const sha = new Bun.CryptoHasher('sha1')
    .update(`${origin}:${String(originSeq)}`)
    .digest('hex');
  return { ...held().commit, seq, sha, row_json: JSON.stringify({ sha, timestamp: T0 }), origin_store: origin, origin_seq: originSeq };
}

/** A payload of `commits`, naming the template's migrations and `extra` after them. */
function payload(commits: readonly WireRow[], extra: readonly string[] = []): WirePayload {
  const cursor = commits.length === 0
    ? {}
    : { commits: Math.max(...commits.map((row) => Number(row.seq))) };
  const built = { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: [...held().migrations, ...extra], tables: { commits }, cursor };
  return decodeWirePayload(JSON.stringify(built));
}

describe('the SQLite hub store', () => {
  let directory = '';
  let reading = T0;
  let open: HubStore | undefined;
  const now = (): Date => new Date(reading);
  const hub = (fileName?: string): HubStore => {
    open = openSqliteHubStore({ directory, now }, { fileName });
    return open;
  };
  /** The store a hub one migration ahead of this build keeps. */
  const aheadHub = (): HubStore => {
    open = openSqliteHubStore({ directory, now }, { migrations: AHEAD });
    return open;
  };
  /** This build's migration ids up to `BEHIND_FROM`, as a device behind it names them. */
  const behind = (): readonly string[] => held().migrations.slice(0, held().migrations.indexOf(BEHIND_FROM));
  /** The commits the hub is pushed, from A, for B to pull. */
  const seed = async (store: HubStore): Promise<void> => {
    await store.push({ device: A, payload: payload([commit(A, 1), commit(A, 2)]) });
  };

  beforeAll(() => {
    template = readTemplate();
  });
  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-sqlite-')));
    reading = T0;
  });
  afterEach(async () => {
    await open?.close();
    open = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  describe('a push naming a migration the hub lacks', () => {
    it('is refused with the missing id and the hub upgrade named, leaving the hub as it was', async () => {
      const store = hub();
      const before = readFileSync(join(directory, DEFAULT_STORE_FILE));

      const refused = await store.push({ device: A, payload: payload([commit(A, 1)], [FUTURE_MIGRATION]) }).catch((error: unknown) => error);
      const status = await store.status();

      expect(refused).toBeInstanceOf(HubUpgradeRequired);
      expect(refused).toMatchObject({ missing: [FUTURE_MIGRATION], nextStep: HUB_UPGRADE });
      expect((refused as Error).message).toContain(FUTURE_MIGRATION);
      expect((refused as Error).message).toContain(HUB_PACKAGE);
      expect([status.rows['commits'] ?? 0, status.devices]).toEqual([0, []]);
      expect(status.migrations).not.toContain(FUTURE_MIGRATION);
      expect(readFileSync(join(directory, DEFAULT_STORE_FILE)).equals(before)).toBe(true);
    });

    it('takes the same rows naming only migrations the hub holds, as the control', async () => {
      const store = hub();

      const taken = await store.push({ device: A, payload: payload([commit(A, 1)]) });

      expect([taken.received, taken.added]).toEqual([1, 1]);
    });
  });

  describe('its files', () => {
    it('makes the store file on open, holding every migration this build knows', async () => {
      const store = hub();
      const { migrations } = await store.status();

      expect(existsSync(join(directory, DEFAULT_STORE_FILE))).toBe(true);
      expect(held().migrations.filter((id) => !migrations.includes(id))).toEqual([]);
    });

    it('names the store and devices files from the file name it is given', async () => {
      const store = hub('team.sqlite');
      await store.push({ device: A, payload: payload([commit(A, 1)]) });

      expect(devicesFileName('team.sqlite')).toBe('team.devices.sqlite');
      expect(readdirSync(directory).sort()).toEqual(['team.devices.sqlite', 'team.sqlite']);
    });

    it('leaves no merge backup or scratch file beside the store after pushes that merged rows', async () => {
      const store = hub();
      const first = await store.push({ device: A, payload: payload([commit(A, 1)]) });
      const second = await store.push({ device: B, payload: payload([commit(B, 1), commit(A, 1, 2)]) });

      expect([first.added, second.added]).toEqual([1, 1]);
      expect(readdirSync(directory).sort()).toEqual([devicesFileName(DEFAULT_STORE_FILE), DEFAULT_STORE_FILE].sort());
    });

    it('refuses to open in a directory that is not there', () => {
      const missing = join(directory, 'absent');

      expect(() => openSqliteHubStore({ directory: missing, now })).toThrow();
      expect(existsSync(missing)).toBe(false);
    });
  });

  describe('a push holding no row', () => {
    it('leaves the store file\'s bytes as they were and still stamps the device', async () => {
      const store = hub();
      await store.push({ device: A, payload: payload([commit(A, 1)]) });
      const before = readFileSync(join(directory, DEFAULT_STORE_FILE));
      reading = T1;

      const empty = await store.push({ device: B, payload: payload([]) });
      const { devices } = await store.status();

      expect(empty).toEqual({ received: 0, added: 0, at: T1 });
      expect(readFileSync(join(directory, DEFAULT_STORE_FILE)).equals(before)).toBe(true);
      expect(devices).toEqual([{ device: A, lastPushAt: T0 }, { device: B, lastPushAt: T1 }]);
    });
  });

  describe('its capabilities', () => {
    it('answers projection true, frozen, beside fts, vector and graph false, since it has no index', () => {
      const capabilities = hub().contract().capabilities;

      expect(capabilities).toEqual({ fts: false, graph: false, projection: true, vector: false });
      expect(Object.isFrozen(capabilities)).toBe(true);
    });
  });

  describe('reopened over its directory', () => {
    it('keeps the rows, the hub seq cursor and each device\'s last push', async () => {
      const first = hub();
      await first.push({ device: A, payload: payload([commit(A, 1)]) });
      const pulled = await first.pull({ device: B, since: {} });
      await first.close();

      const again = hub();
      await again.push({ device: A, payload: payload([commit(A, 2)]) });
      const since = await again.pull({ device: B, since: pulled.cursor });
      const status = await again.status();

      expect(pulled.tables['commits']?.map((row) => row['origin_seq'])).toEqual([1]);
      expect(since.tables['commits']?.map((row) => row['origin_seq'])).toEqual([2]);
      expect([status.rows['commits'], status.devices]).toEqual([2, [{ device: A, lastPushAt: T0 }]]);
    });
  });

  describe('a projected pull', () => {
    it('answers whole, with no projected, to a device naming every id the hub holds or more', async () => {
      const store = hub();
      await seed(store);
      const { migrations } = await store.status();

      const plain = await store.pull({ device: B, since: {} });
      const every = await store.pull({ device: B, since: {}, migrations });
      const more = await store.pull({ device: B, since: {}, migrations: [...migrations, FUTURE_MIGRATION] });

      expect(plain.projected).toBeUndefined();
      expect(every).toEqual(plain);
      expect(more).toEqual(plain);
    });

    it('leaves out the tables a device behind lacks, names each table it cut and answers its own ids', async () => {
      const store = hub();
      await seed(store);
      const whole = await store.pull({ device: B, since: {} });

      const projected = await store.pull({ device: B, since: {}, migrations: [...behind(), FUTURE_MIGRATION] });

      expect(projected.migrations).toEqual(behind());
      expect(projected.projected).toEqual({ sessions: [BEHIND_FROM] });
      const left = Object.keys(whole.tables).filter((table) => !(table in projected.tables));
      expect(left.sort()).toEqual(['bug_routes', 'reading_supersedes', 'stale_docs']);
      expect(Object.keys(projected.cursor).sort()).toEqual(Object.keys(projected.tables).sort());
      expect(projected.tables['commits']).toEqual(whole.tables['commits']);
      expect(projected.cursor['commits']).toBe(whole.cursor['commits']);
    });

    it('is built by a device behind through its own migrations, as the whole answer is not', async () => {
      const store = hub();
      await seed(store);
      const device = { migrations: SQLITE_MIGRATIONS.filter(({ id }) => behind().includes(id)) };
      const whole = await store.pull({ device: B, since: {} });
      const projected = await store.pull({ device: B, since: {}, migrations: behind() });

      const built = materialiseWirePayload(decodeWirePayload(encodeWirePayload(projected)), device);
      built.release();

      expect(() => materialiseWirePayload(whole, device)).toThrow('which this rafa does not know');
    });

    it('cuts the columns a migration the device lacks adds, under a catalogue handed down', async () => {
      const store = aheadHub();
      await store.push({ device: A, payload: payload([{ ...commit(A, 1), fixture_note: 'kept on the hub' }], [NOTE_MIGRATION]) });

      const projected = await store.pull({ device: B, since: {}, migrations: held().migrations });
      const whole = await store.pull({ device: B, since: {}, migrations: [...held().migrations, NOTE_MIGRATION] });

      expect(projected.projected).toEqual({ commits: [NOTE_MIGRATION] });
      expect(projected.migrations).toEqual(held().migrations);
      expect(projected.tables['commits']?.map((row) => 'fixture_note' in row)).toEqual([false]);
      expect(whole.projected).toBeUndefined();
      expect(whole.tables['commits']?.map((row) => row['fixture_note'])).toEqual(['kept on the hub']);
      expect(projected.tables['commits']).toEqual(whole.tables['commits']?.map((row) => Object.fromEntries(Object.entries(row)
        .filter(([column]) => column !== 'fixture_note'))));
    });

    it('answers the same projection to a device pulling again', async () => {
      const store = hub();
      await seed(store);

      const first = await store.pull({ device: B, since: {}, migrations: behind() });
      const again = await store.pull({ device: B, since: {}, migrations: behind() });

      expect(first.projected).toEqual({ sessions: [BEHIND_FROM] });
      expect(again).toEqual(first);
    });
  });

  describe('a catalogue handed down', () => {
    it('keeps the store at it and takes a push naming its migration, which this build\'s own refuses', async () => {
      const store = aheadHub();
      const note = payload([{ ...commit(A, 1), fixture_note: 'n' }], [NOTE_MIGRATION]);

      const taken = await store.push({ device: A, payload: note });
      const { migrations } = await store.status();

      expect([taken.received, taken.added]).toEqual([1, 1]);
      expect(migrations.at(-1)).toBe(NOTE_MIGRATION);
      expect(store.contract().migrations).toEqual(migrations);
    });

    it('reaches the connector\'s store too', async () => {
      const connected = await connectSqliteHub({ directory, now }, { loader: { state: createLoaderState() }, migrations: AHEAD });
      open = connected.store;

      expect(connected.store.contract().migrations.at(-1)).toBe(NOTE_MIGRATION);
      expect((await connected.store.status()).migrations.at(-1)).toBe(NOTE_MIGRATION);
    });
  });
});
