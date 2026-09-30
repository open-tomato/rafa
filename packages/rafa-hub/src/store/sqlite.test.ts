/**
 * The SQLite hub store (`sqlite.ts`): the port's contract suite, then
 * what is the adapter's own. That covers the refusal of a push naming a
 * migration the hub lacks, the files it keeps and the ones it leaves
 * behind, a push holding no row, and a store reopened over its
 * directory.
 *
 * Payloads here are built as the contract suite builds them. A real
 * store is opened under the temporary directory and given one commit,
 * then exported, and the row's key and origin pair are set by the case.
 */
import type { HubStore } from './port.js';
import type { CommitEffortRow, WirePayload, WireRow } from '@open-tomato/rafa/store';

import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeWirePayload, exportWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from '../config.js';

import { hubStoreContract } from './contract.js';
import { devicesFileName, HUB_PACKAGE, HUB_UPGRADE, HubUpgradeRequired, openSqliteHubStore } from './sqlite.js';

hubStoreContract('sqlite', (context) => openSqliteHubStore(context));

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const T0 = '2026-09-30T10:00:00.000Z';
const T1 = '2026-09-30T10:05:00.000Z';

/** A migration id no rafa has, as a newer store would name one. */
const FUTURE_MIGRATION = '9999-from-a-newer-rafa';

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
});
