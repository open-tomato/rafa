/**
 * The SQLite hub store (`sqlite.ts`): what is the adapter's own, the
 * port's contract suites running over it by name in `contract.test.ts`.
 * That covers the refusal of a push naming a migration the hub lacks,
 * the files it keeps and the ones it leaves behind, a push holding no
 * row, a store reopened over its directory, and the projects it serves:
 * one store, devices and index file per listed project under that
 * project's `storePath`, each project's store file hashed before and
 * after a push to the other, and the single-project hub of before
 * serving every project in its one file.
 *
 * Payloads here are built as the contract suite builds them. A real
 * store is opened under the temporary directory and given one commit,
 * then exported, and the row's key and origin pair are set by the case.
 */
import type { HubServedProject, HubStore, HubStoreContext } from './port.js';
import type { SqliteHub, SqliteHubStoreFile } from './sqlite.js';
import type { CommitEffortRow, WirePayload, WireRow } from '@open-tomato/rafa/store';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeWirePayload, exportWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { createLoaderState } from '@open-tomato/rafa-index/loader';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_PROJECT_ID, DEFAULT_STORE_FILE } from '../config.js';

import {
  connectSqliteHub,
  devicesFileName,
  HUB_PACKAGE,
  HUB_UPGRADE,
  HubProjectNotServed,
  HubUpgradeRequired,
  indexFileName,
  openSqliteHubStore,
} from './sqlite.js';

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

/** Two listed projects' root commit shas, and one no hub lists. */
const P = '1'.repeat(40);
const Q = '2'.repeat(40);
const UNLISTED = '3'.repeat(40);

/** The refusal of a request naming {@link UNLISTED}. */
const NOT_SERVED = `rafa-hub: project ${UNLISTED} is not served here; add it under hub.projects`;

/** The two projects as `hub.projects` would list them. */
const TWO: readonly HubServedProject[] = [{ id: P, name: 'team/parser' }, { id: Q, name: 'team/cache' }];

/** The sha256 of the file at `path`. */
function hashOf(path: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(readFileSync(path))
    .digest('hex');
}

/** What a refused promise threw, or `null` when it resolved. */
function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error);
}

describe('the SQLite hub store serving projects', () => {
  let directory = '';
  let files: readonly SqliteHubStoreFile[] = [];
  let opened: HubStore[] = [];
  const now = (): Date => new Date(T0);

  /** The store file of `id`, in a folder of its own, `team.sqlite` in each so only the folder tells them apart. */
  const storeOf = (id: string): string => join(directory, id === P
    ? 'parser'
    : 'cache', 'team.sqlite');

  const context = (projects?: readonly HubServedProject[]): HubStoreContext => ({ directory, now, projects });

  const hub = (projects: readonly HubServedProject[] = TWO): HubStore => {
    const store = openSqliteHubStore(context(projects), { storeFiles: files });
    opened.push(store);
    return store;
  };

  const connect = async (projects: readonly HubServedProject[] = TWO): Promise<SqliteHub> => {
    const connected = await connectSqliteHub(context(projects), { storeFiles: files, loader: { state: createLoaderState() } });
    opened.push(connected.store);
    return connected;
  };

  beforeAll(() => {
    template = readTemplate();
  });
  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-sqlite-projects-')));
    mkdirSync(join(directory, 'parser'));
    mkdirSync(join(directory, 'cache'));
    files = [{ id: P, storePath: storeOf(P) }, { id: Q, storePath: storeOf(Q) }];
  });
  afterEach(async () => {
    await Promise.all(opened.map((store) => store.close()));
    opened = [];
    rmSync(directory, { recursive: true, force: true });
  });

  describe('a request naming a project not listed', () => {
    it('is refused on push, pull and status with the line naming hub.projects, leaving both store files as they were', async () => {
      const store = hub();
      await store.status({ project: Q });
      const before = [hashOf(storeOf(P)), hashOf(storeOf(Q))];

      const refused = await Promise.all([
        refusal(store.push({ device: A, project: UNLISTED, payload: payload([commit(A, 1)]) })),
        refusal(store.pull({ device: A, project: UNLISTED, since: {} })),
        refusal(store.status({ project: UNLISTED })),
      ]);

      expect(refused.map((error) => (error as Error | null)?.message)).toEqual([NOT_SERVED, NOT_SERVED, NOT_SERVED]);
      expect(refused[0]).toBeInstanceOf(HubProjectNotServed);
      expect(refused[0]).toMatchObject({ project: UNLISTED });
      expect([hashOf(storeOf(P)), hashOf(storeOf(Q))]).toEqual(before);
      expect(readdirSync(directory).sort()).toEqual(['cache', 'parser']);
    });

    it('is refused on rebuild too, the connector naming the same line', async () => {
      const { index } = await connect();

      const refused = await refusal(index.rebuild({ project: UNLISTED }));

      expect((refused as Error).message).toBe(NOT_SERVED);
    });
  });

  describe('two listed projects over one store file', () => {
    it('are refused at open, naming one store file per project', () => {
      files = [{ id: P, storePath: storeOf(P) }, { id: Q, storePath: storeOf(P) }];

      expect(() => openSqliteHubStore(context(TWO), { storeFiles: files })).toThrow('expected one store file per project');
    });
  });

  describe('one store file per project', () => {
    it('leaves the other project\'s store file byte for byte after a push to one, each way', async () => {
      const store = hub();
      await store.status({ project: Q });

      const parserBefore = hashOf(storeOf(P));
      const cacheBefore = hashOf(storeOf(Q));
      await store.push({ device: A, project: P, payload: payload([commit(A, 1)]) });
      const parserAfterOwn = hashOf(storeOf(P));
      const cacheAfterOther = hashOf(storeOf(Q));
      await store.push({ device: B, project: Q, payload: payload([commit(B, 1)]) });
      const parserAfterOther = hashOf(storeOf(P));
      const cacheAfterOwn = hashOf(storeOf(Q));

      expect(cacheAfterOther).toBe(cacheBefore);
      expect(parserAfterOther).toBe(parserAfterOwn);
      // The controls: each push did rewrite its own project's file, so the hashes above could have moved.
      expect(parserAfterOwn).not.toBe(parserBefore);
      expect(cacheAfterOwn).not.toBe(cacheBefore);
    });

    it('answers a pull from one project none of the other\'s rows, and each project\'s own rows and devices on status', async () => {
      const store = hub();
      await store.push({ device: A, project: P, payload: payload([commit(A, 1)]) });
      await store.push({ device: B, project: Q, payload: payload([commit(B, 1), commit(B, 2)]) });

      const fromParser = await store.pull({ device: 'cccccccc-0000-4000-8000-00000000000c', project: P, since: {} });
      const fromCache = await store.pull({ device: 'cccccccc-0000-4000-8000-00000000000c', project: Q, since: {} });
      const parser = await store.status({ project: P });
      const cache = await store.status({ project: Q });

      expect(fromParser.tables['commits']?.map((row) => row['origin_store'])).toEqual([A]);
      expect(fromCache.tables['commits']?.map((row) => row['origin_store'])).toEqual([B, B]);
      expect([parser.rows['commits'], parser.devices.map(({ device }) => device)]).toEqual([1, [A]]);
      expect([cache.rows['commits'], cache.devices.map(({ device }) => device)]).toEqual([2, [B]]);
    });

    it('serves a push, a pull and a status naming no project in the first listed project', async () => {
      const store = hub();
      await store.push({ device: A, payload: payload([commit(A, 1)]) });

      const pulled = await store.pull({ device: B, since: {} });
      const first = await store.status();
      const second = await store.status({ project: Q });

      expect(pulled.tables['commits']?.map((row) => row['origin_store'])).toEqual([A]);
      expect([first.rows['commits'], first.devices.map(({ device }) => device)]).toEqual([1, [A]]);
      expect([second.rows['commits'] ?? 0, second.devices]).toEqual([0, []]);
    });

    it('answers every project\'s id and name from status, in the order listed', async () => {
      const store = hub();

      const { projects } = await store.status({ project: Q });

      expect(projects).toEqual([{ id: P, name: 'team/parser' }, { id: Q, name: 'team/cache' }]);
    });

    it('keeps each project\'s store, devices and index files under its own storePath', async () => {
      const { store, index } = await connect();
      await store.push({ device: A, project: P, payload: payload([commit(A, 1)]) });
      await store.push({ device: B, project: Q, payload: payload([commit(B, 1)]) });
      await index.rebuild({ project: Q });

      const expected = ['team.sqlite', devicesFileName('team.sqlite'), indexFileName('team.sqlite')].sort();
      expect(readdirSync(join(directory, 'parser')).sort()).toEqual(expected);
      expect(readdirSync(join(directory, 'cache')).sort()).toEqual(expected);
      expect(readdirSync(directory).sort()).toEqual(['cache', 'parser']);
    });

    it('rebuilds the index of the project a rebuild names, leaving the other\'s index file as it was', async () => {
      const { store, index } = await connect();
      await store.push({ device: A, project: P, payload: payload([commit(A, 1)]) });
      await store.push({ device: B, project: Q, payload: payload([commit(B, 1), commit(B, 2)]) });
      await index.rebuild({ project: P });
      const parserIndex = hashOf(indexFileName(storeOf(P)));

      const cache = await index.rebuild({ project: Q });
      const parserAfter = hashOf(indexFileName(storeOf(P)));
      const parser = await index.rebuild({ project: P });

      expect([cache.project, cache.rows]).toEqual([Q, 2]);
      expect([parser.project, parser.rows]).toEqual([P, 1]);
      expect(parserAfter).toBe(parserIndex);
    });
  });

  describe('with hub.projects left out', () => {
    it('serves every project a request names, or none, in the default project\'s one file', async () => {
      const store = hub([{ id: DEFAULT_PROJECT_ID, name: 'team/repo' }]);
      await store.push({ device: A, project: P, payload: payload([commit(A, 1)]) });
      await store.push({ device: B, project: UNLISTED, payload: payload([commit(B, 1)]) });

      const pulled = await store.pull({ device: 'cccccccc-0000-4000-8000-00000000000c', project: Q, since: {} });
      const status = await store.status({ project: UNLISTED });
      const unnamed = await store.status();

      expect(pulled.tables['commits']?.map((row) => row['origin_store'])).toEqual([A, B]);
      expect([status.rows['commits'], status.projects]).toEqual([2, [{ id: DEFAULT_PROJECT_ID, name: 'team/repo' }]]);
      expect(unnamed.rows['commits']).toBe(2);
      expect(readdirSync(directory).sort()).toEqual(['cache', devicesFileName(DEFAULT_STORE_FILE), 'parser', DEFAULT_STORE_FILE].sort());
    });

    it('serves the same in one file when the context lists no project, answering no projects', async () => {
      const store = openSqliteHubStore({ directory, now });
      opened.push(store);
      await store.push({ device: A, project: P, payload: payload([commit(A, 1)]) });
      await store.push({ device: B, project: Q, payload: payload([commit(B, 1)]) });

      const status = await store.status({ project: UNLISTED });

      expect([status.rows['commits'], status.projects]).toEqual([2, undefined]);
      expect(existsSync(join(directory, DEFAULT_STORE_FILE))).toBe(true);
    });
  });
});
