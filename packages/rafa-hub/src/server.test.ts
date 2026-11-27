/**
 * The hub server (`server.ts`) over stand-in adapters: the in-memory
 * store (`store/testdata/memory-store.ts`) and the in-memory identity
 * (`identity/testdata/memory-identity.ts`), each wrapped where a case
 * needs a store that fails or an identity that counts. Every case
 * starts a server on `port: 0` and collects its log lines in memory.
 *
 * A refusal case holds that the store was not reached by counting the
 * store's calls, and each such count has a served case beside it that
 * reads it nonzero, so a count that could never move proves nothing.
 *
 * The rebuild cases hand the server a stand-in index whose rebuilds end
 * when the case says, and count the rebuilds it was asked for; every
 * case reading that count at zero or one has one beside it reading it
 * higher. A rebuild that ends at once has ended, its log line written,
 * before the push that started it is answered, since nothing but
 * microtasks runs between them.
 */
import type { HubIdentity, IdentityRefusalReason } from './identity/port.js';
import type { HubLogEntry, HubServer, HubServerOptions } from './server.js';
import type { HubIndex, HubPullRequest, HubServedProject, HubStore, IndexRebuildRequest, IndexRebuildResult } from './store/port.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { encodeWirePayload, WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, describe, expect, it } from 'bun:test';

import { HUB_ACTIONS } from './identity/port.js';
import { openMemoryIdentity } from './identity/testdata/memory-identity.js';
import { AUTH_CHALLENGE, CONTRACT_UNSUPPORTED, HUB_ROUTES, INTERNAL_ERROR, jsonLineLog, startHubServer, STORE_UNAVAILABLE } from './server.js';
import { HUB_UPGRADE, HubUpgradeRequired } from './store/sqlite.js';
import { openMemoryHubStore } from './store/testdata/memory-store.js';

const VERSION = '9.8.7';
const T0 = '2026-10-01T09:00:00.000Z';

const WRITER = 'hub-writer-token-0001';
const READER = 'hub-reader-token-0002';
const PULLER = 'hub-puller-token-0003';
const UNKNOWN = 'hub-unknown-token-0004';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

/** Every route behind the identity port, with the method it answers. */
const GUARDED: readonly (readonly [string, string])[] = [
  ['GET', HUB_ROUTES.status],
  ['POST', `${HUB_ROUTES.push}?device=${A}`],
  ['GET', `${HUB_ROUTES.pull}?device=${A}`],
];

/** A stand-in identity knowing a writer, a reader who may not sync and a puller. */
function identity(): HubIdentity {
  return openMemoryIdentity({
    [WRITER]: { id: 'writer', may: HUB_ACTIONS },
    [READER]: { id: 'reader', may: [] },
    [PULLER]: { id: 'puller', may: ['effort.pull'] },
  });
}

/** How many times each store method was called. */
interface Calls {
  push: number;
  pull: number;
  status: number;
  close: number;
  contract: number;
}

/** `store` with each call counted into `calls`. */
function counted(store: HubStore, calls: Calls): HubStore {
  return {
    push: (request) => {
      calls.push += 1;
      return store.push(request);
    },
    pull: (request) => {
      calls.pull += 1;
      return store.pull(request);
    },
    status: () => {
      calls.status += 1;
      return store.status();
    },
    close: () => {
      calls.close += 1;
      return store.close();
    },
    contract: () => {
      calls.contract += 1;
      return store.contract();
    },
  };
}

/** A fresh in-memory store stamped at {@link T0}. */
function memoryStore(): HubStore {
  return openMemoryHubStore({ directory: '', now: () => new Date(T0) });
}

/** A commit created by `origin` as its `originSeq`th row. */
function commit(origin: string, originSeq: number): WireRow {
  return { seq: originSeq, sha: `${origin}-${String(originSeq)}`, row_json: '{}', origin_store: origin, origin_seq: originSeq };
}

/** A payload carrying `rows` as commits. */
function payload(rows: readonly WireRow[]): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: ['0001-base'], tables: { commits: rows }, cursor: { commits: rows.length } };
}

let running: HubServer[] = [];

afterEach(async () => {
  await Promise.all(running.map((server) => server.stop()));
  running = [];
});

/** A started hub, the lines it logged and the store calls it made. */
interface Started {
  readonly server: HubServer;
  readonly lines: string[];
  readonly calls: Calls;
}

/** Starts a hub over stand-ins, `overrides` replacing any option. */
function start(overrides: Partial<HubServerOptions> = {}): Started {
  const lines: string[] = [];
  const calls: Calls = { push: 0, pull: 0, status: 0, close: 0, contract: 0 };
  const server = startHubServer({
    port: 0,
    hostname: '127.0.0.1',
    version: VERSION,
    identity: identity(),
    openStore: () => counted(memoryStore(), calls),
    log: jsonLineLog((line) => {
      lines.push(line);
    }),
    ...overrides,
  });
  running = [...running, server];
  return { server, lines, calls };
}

/** Sends `method` to `path` on `server`, with `token` as a bearer when given. */
function send(server: HubServer, method: string, path: string, token?: string, body?: string): Promise<Response> {
  const headers: Record<string, string> = token === undefined
    ? {}
    : { authorization: `Bearer ${token}` };
  return fetch(`${server.url}${path}`, { method, headers, body });
}

/** The envelope a response holds. */
interface Envelope {
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: string;
  readonly code?: string;
  readonly missing?: readonly string[];
}

async function envelope(response: Response): Promise<Envelope> {
  return await response.json() as Envelope;
}

/** Every line logged, parsed. */
function entries(lines: readonly string[]): HubLogEntry[] {
  return lines.map((line) => JSON.parse(line) as HubLogEntry);
}

/** The `request` lines logged. */
function requestLines(lines: readonly string[]): HubLogEntry[] {
  return entries(lines).filter((entry) => entry.event === 'request');
}

/** Pushes `rows` as device `device` with the writer's token. */
function push(server: HubServer, device: string, rows: readonly WireRow[]): Promise<Response> {
  return send(server, 'POST', `${HUB_ROUTES.push}?device=${device}`, WRITER, encodeWirePayload(payload(rows)));
}

describe('GET /health', () => {
  it('answers 200 once the store opens, asking no identity', async () => {
    let asked = 0;
    const { server } = start({
      identity: {
        identify: (request) => {
          asked += 1;
          return identity().identify(request);
        },
      },
    });

    const response = await send(server, 'GET', HUB_ROUTES.health);

    expect(response.status).toBe(200);
    expect(await envelope(response)).toEqual({ success: true, data: { status: 'ok', version: VERSION } });
    expect(asked).toBe(0);
    await send(server, 'GET', HUB_ROUTES.status, WRITER);
    expect(asked).toBe(1);
  });

  it('answers 503 when the store does not open, logging why', async () => {
    const { server, lines } = start({
      openStore: () => {
        throw new Error('disk image is malformed');
      },
    });

    const response = await send(server, 'GET', HUB_ROUTES.health);

    expect(response.status).toBe(503);
    expect(await envelope(response)).toEqual({ success: false, error: STORE_UNAVAILABLE });
    const unavailable = entries(lines).filter((entry) => entry.event === 'store.unavailable');
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable[0]).toMatchObject({ level: 'error', error: 'disk image is malformed' });
  });

  it('answers 503 when the store rejects as it opens', async () => {
    const { server } = start({ openStore: () => Promise.reject(new Error('no such volume')) });

    expect((await send(server, 'GET', HUB_ROUTES.health)).status).toBe(503);
  });

  it('tries the store again after a failed open and answers 200 once it opens', async () => {
    let attempts = 0;
    const { server } = start({
      openStore: () => {
        // The first attempt is the server's own as it starts, the second the first request's.
        attempts += 1;
        if (attempts <= 2) throw new Error('not mounted yet');
        return memoryStore();
      },
    });

    const statuses = [
      (await send(server, 'GET', HUB_ROUTES.health)).status,
      (await send(server, 'GET', HUB_ROUTES.health)).status,
      (await send(server, 'GET', HUB_ROUTES.health)).status,
    ];

    expect(statuses).toEqual([503, 200, 200]);
    expect(attempts).toBe(3);
  });

  it('opens the store once however many requests arrive together', async () => {
    let attempts = 0;
    const { server } = start({
      openStore: async () => {
        attempts += 1;
        await Bun.sleep(20);
        return memoryStore();
      },
    });

    const statuses = await Promise.all([1, 2, 3, 4].map(async () => (await send(server, 'GET', HUB_ROUTES.health)).status));

    expect(statuses).toEqual([200, 200, 200, 200]);
    expect(attempts).toBe(1);
  });
});

describe('the identity port', () => {
  for (const [method, path] of GUARDED) {
    it(`answers 401 with a challenge for ${method} ${path} with no token, reaching no store`, async () => {
      const { server, calls } = start();

      const response = await send(server, method, path);

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(AUTH_CHALLENGE);
      expect(await envelope(response)).toEqual({ success: false, error: 'Send a bearer token the hub knows.' });
      expect(calls.push + calls.pull + calls.status).toBe(0);
    });

    it(`answers 401 for ${method} ${path} with a token the identity does not know`, async () => {
      const { server } = start();

      expect((await send(server, method, path, UNKNOWN)).status).toBe(401);
    });

    it(`answers 403 for ${method} ${path} with a token the identity forbids`, async () => {
      const { server, calls } = start();

      const response = await send(server, method, path, READER);

      expect(response.status).toBe(403);
      expect(response.headers.get('www-authenticate')).toBeNull();
      expect(await envelope(response)).toEqual({ success: false, error: 'reader may not sync with this hub.' });
      expect(calls.push + calls.pull + calls.status).toBe(0);
    });
  }

  it('answers 503 with the identity\'s message when it could not decide', async () => {
    const message = 'GitHub did not answer the permission check for open-tomato/rafa: HTTP 502; try again.';
    const { server, calls } = start({
      identity: { identify: () => Promise.resolve({ served: false, refusal: { reason: 'unavailable', message } }) },
    });

    const response = await send(server, 'GET', HUB_ROUTES.status, WRITER);

    expect(response.status).toBe(503);
    expect(await envelope(response)).toEqual({ success: false, error: message });
    expect(calls.status).toBe(0);
  });

  it('answers 403 for a served caller whose actions leave the route\'s out, and serves the one it holds', async () => {
    const { server, calls } = start();

    const refused = await send(server, 'GET', HUB_ROUTES.status, PULLER);
    const pulled = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}`, PULLER);

    expect(refused.status).toBe(403);
    expect(await envelope(refused)).toEqual({ success: false, error: 'puller may not take status.read on this hub.' });
    expect(calls.status).toBe(0);
    expect(pulled.status).toBe(200);
    expect(calls.pull).toBe(1);
  });

  it('answers 500 when the identity rejects, which is an adapter bug, and logs it', async () => {
    const { server, lines } = start({ identity: { identify: () => Promise.reject(new Error('adapter exploded')) } });

    const response = await send(server, 'GET', HUB_ROUTES.status, WRITER);

    expect(response.status).toBe(500);
    expect(await envelope(response)).toEqual({ success: false, error: INTERNAL_ERROR });
    expect(entries(lines).find((entry) => entry.event === 'request.failed')).toMatchObject({ level: 'error', error: 'adapter exploded' });
  });

  it('answers 503 for a served caller while the store has not opened', async () => {
    const { server } = start({ openStore: () => Promise.reject(new Error('locked')) });

    const response = await send(server, 'GET', HUB_ROUTES.status, WRITER);

    expect(response.status).toBe(503);
    expect(await envelope(response)).toEqual({ success: false, error: STORE_UNAVAILABLE });
  });
});

describe('paths and methods', () => {
  it('answers 404 for a path no route serves, the second plan\'s locked settings included', async () => {
    const { server } = start();

    for (const path of ['/', '/v1', '/v1/settings/locked', '/v1/effort/push/']) {
      const response = await send(server, 'GET', path, WRITER);
      expect(response.status).toBe(404);
      expect((await envelope(response)).success).toBe(false);
    }
  });

  it('answers 405 naming the method a route answers, asking no identity', async () => {
    let asked = 0;
    const { server } = start({
      identity: {
        identify: () => {
          asked += 1;
          return Promise.resolve({ served: false, refusal: { reason: 'unauthenticated', message: 'no' } });
        },
      },
    });

    const cases: readonly (readonly [string, string, string])[] = [
      ['POST', HUB_ROUTES.health, 'GET'],
      ['DELETE', HUB_ROUTES.status, 'GET'],
      ['GET', HUB_ROUTES.push, 'POST'],
      ['POST', HUB_ROUTES.pull, 'GET'],
    ];
    for (const [method, path, allowed] of cases) {
      const response = await send(server, method, path, WRITER);
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe(allowed);
    }
    expect(asked).toBe(0);
  });
});

describe('GET /v1/status', () => {
  it('answers the version, the schema, the rows and each device\'s last push', async () => {
    const { server } = start();
    await push(server, B, [commit(B, 1)]);
    await push(server, A, [commit(A, 1), commit(A, 2)]);

    const response = await send(server, 'GET', HUB_ROUTES.status, WRITER);

    expect(response.status).toBe(200);
    expect(await envelope(response)).toEqual({
      success: true,
      data: {
        version: VERSION,
        contractVersion: WIRE_CONTRACT_VERSION,
        migrations: ['0001-base'],
        capabilities: { fts: false, vector: false, graph: false, projection: false },
        maxPayloadRows: null,
        embedding: { model: null, hash: null, dimension: null },
        rows: { commits: 3 },
        devices: [{ device: A, lastPushAt: T0 }, { device: B, lastPushAt: T0 }],
      },
    });
  });

  it('answers each embedding field as null while the serving store has vectors off', async () => {
    const base = memoryStore();
    const { server } = start({ openStore: () => ({ ...base, contract: () => ({ ...base.contract(), embedding: null }) }) });

    const { data } = await envelope(await send(server, 'GET', HUB_ROUTES.status, WRITER));

    expect(data?.embedding).toEqual({ model: null, hash: null, dimension: null });
  });

  it('answers the serving store\'s embedding model, hash and dimension, never its precision', async () => {
    const embedding = { model: 'nomic-embed-text', hash: 'sha256-abc', dimension: 768 };
    const base = memoryStore();
    const { server } = start({
      openStore: () => ({
        ...base,
        contract: () => ({ ...base.contract(), capabilities: { ...base.contract().capabilities, vector: true }, embedding }),
      }),
    });

    const { data } = await envelope(await send(server, 'GET', HUB_ROUTES.status, WRITER));

    expect(data?.embedding).toEqual(embedding);
    expect((data?.capabilities as Record<string, unknown>).vector).toBe(true);
  });

  it('refuses a query parameter, as it reads none', async () => {
    const { server, calls } = start();

    const response = await send(server, 'GET', `${HUB_ROUTES.status}?device=${A}`, WRITER);

    expect(response.status).toBe(400);
    expect((await envelope(response)).error).toBe('The query names "device"; this route takes none.');
    expect(calls.status).toBe(0);
  });
});

describe('POST /v1/effort/push', () => {
  it('takes a device\'s rows and answers what it received and added, adding nothing on a repeat', async () => {
    const { server, calls } = start();

    const first = await push(server, A, [commit(A, 1), commit(A, 2)]);
    const again = await push(server, A, [commit(A, 1), commit(A, 2)]);

    expect(first.status).toBe(200);
    expect(await envelope(first)).toEqual({ success: true, data: { received: 2, added: 2, at: T0 } });
    expect(await envelope(again)).toEqual({ success: true, data: { received: 2, added: 0, at: T0 } });
    expect(calls.push).toBe(2);
  });

  it('answers 409 naming the upgrade when the store refuses a newer store\'s push', async () => {
    const { server } = start({
      openStore: () => ({
        ...memoryStore(),
        push: () => Promise.reject(new HubUpgradeRequired(['9999-from-a-newer-rafa'])),
      }),
    });

    const response = await push(server, A, [commit(A, 1)]);

    expect(response.status).toBe(409);
    const { success, error, missing } = await envelope(response);
    expect(success).toBe(false);
    expect(error).toContain('9999-from-a-newer-rafa');
    expect(error).toContain(HUB_UPGRADE);
    expect(missing).toEqual(['9999-from-a-newer-rafa']);
  });

  it('answers 500 without the cause when the store fails, and logs the cause', async () => {
    const { server, lines } = start({
      openStore: () => ({ ...memoryStore(), push: () => Promise.reject(new Error('SQLITE_FULL: database or disk is full')) }),
    });

    const response = await push(server, A, [commit(A, 1)]);

    expect(response.status).toBe(500);
    expect(await envelope(response)).toEqual({ success: false, error: INTERNAL_ERROR });
    expect(entries(lines).find((entry) => entry.event === 'request.failed')).toMatchObject({ error: 'SQLITE_FULL: database or disk is full' });
  });

  const refusals: readonly (readonly [string, string, string | undefined, string])[] = [
    ['no device', HUB_ROUTES.push, encodeWirePayload(payload([commit(A, 1)])), 'The query names no device'],
    ['an empty device', `${HUB_ROUTES.push}?device=`, encodeWirePayload(payload([commit(A, 1)])), 'device is not a store origin'],
    ['a device holding a space', `${HUB_ROUTES.push}?device=a%20b`, encodeWirePayload(payload([commit(A, 1)])), 'device is not a store origin'],
    ['a device given twice', `${HUB_ROUTES.push}?device=${A}&device=${B}`, encodeWirePayload(payload([commit(A, 1)])), 'names device more than once'],
    ['a parameter the route does not read', `${HUB_ROUTES.push}?device=${A}&since={}`, encodeWirePayload(payload([commit(A, 1)])), 'The query names "since"; expected device, project, contractVersion.'],
    ['no body', `${HUB_ROUTES.push}?device=${A}`, undefined, 'wire: the payload is not JSON'],
    ['a body that is not JSON', `${HUB_ROUTES.push}?device=${A}`, 'rows please', 'wire: the payload is not JSON'],
    ['a payload of another format', `${HUB_ROUTES.push}?device=${A}`, JSON.stringify({ ...payload([]), format: 'csv' }), 'wire: format is "csv"'],
    ['a table that is not merged', `${HUB_ROUTES.push}?device=${A}`, JSON.stringify({ ...payload([]), tables: { store_meta: [] } }), 'which is no merged table'],
  ];
  for (const [what, path, body, says] of refusals) {
    it(`answers 400 for ${what}, reaching no store`, async () => {
      const { server, calls } = start();

      const response = await send(server, 'POST', path, WRITER, body);

      expect(response.status).toBe(400);
      expect((await envelope(response)).error).toContain(says);
      expect(calls.push).toBe(0);
    });
  }
});

describe('GET /v1/effort/pull', () => {
  it('answers the rows other devices created past the cursor, never the caller\'s own', async () => {
    const { server } = start();
    await push(server, A, [commit(A, 1)]);
    await push(server, B, [commit(B, 1), commit(B, 2)]);

    const response = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}`, WRITER);
    const { success, data } = await envelope(response);
    const pulled = data as unknown as WirePayload;

    expect(response.status).toBe(200);
    expect(success).toBe(true);
    expect(pulled.format).toBe(WIRE_FORMAT);
    expect((pulled.tables['commits'] ?? []).map((row) => row['origin_store'])).toEqual([B, B]);
    expect(pulled.cursor).toEqual({ commits: 3 });
  });

  it('answers nothing past the cursor a pull answered, then what was pushed since', async () => {
    const { server } = start();
    await push(server, B, [commit(B, 1)]);
    const first = (await envelope(await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}`, WRITER))).data as unknown as WirePayload;
    const since = encodeURIComponent(JSON.stringify(first.cursor));

    const empty = (await envelope(await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&since=${since}`, WRITER))).data as unknown as WirePayload;
    await push(server, B, [commit(B, 2)]);
    const later = (await envelope(await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&since=${since}`, WRITER))).data as unknown as WirePayload;

    expect(first.tables['commits']).toHaveLength(1);
    expect(empty.tables['commits']).toEqual([]);
    expect((later.tables['commits'] ?? []).map((row) => row['origin_seq'])).toEqual([2]);
  });

  const refusals: readonly (readonly [string, string, string])[] = [
    ['no device', HUB_ROUTES.pull, 'The query names no device'],
    ['a since that is not JSON', `${HUB_ROUTES.pull}?device=${A}&since=twelve`, 'since is not JSON'],
    ['a since that is not an object', `${HUB_ROUTES.pull}?device=${A}&since=12`, 'wire: cursor is not an object'],
    ['a negative cursor', `${HUB_ROUTES.pull}?device=${A}&since=${encodeURIComponent('{"commits":-1}')}`, 'wire: cursor for commits is -1'],
    ['a fractional cursor', `${HUB_ROUTES.pull}?device=${A}&since=${encodeURIComponent('{"commits":1.5}')}`, 'wire: cursor for commits is 1.5'],
    ['a cursor naming a table that is not merged', `${HUB_ROUTES.pull}?device=${A}&since=${encodeURIComponent('{"merges":1}')}`, 'which is no merged table'],
    ['a misspelt parameter', `${HUB_ROUTES.pull}?device=${A}&cursor={}`, 'The query names "cursor"; expected device, project, since, contractVersion, migrations.'],
    ['an empty migrations', `${HUB_ROUTES.pull}?device=${A}&migrations=`, 'migrations names ""'],
    ['an empty id between commas', `${HUB_ROUTES.pull}?device=${A}&migrations=0001-base,,0002-next`, 'migrations names ""'],
    ['a trailing comma', `${HUB_ROUTES.pull}?device=${A}&migrations=0001-base,`, 'migrations names ""'],
    ['an id holding a space', `${HUB_ROUTES.pull}?device=${A}&migrations=0001%20base`, 'migrations names "0001 base"'],
    ['an id named twice', `${HUB_ROUTES.pull}?device=${A}&migrations=0001-base,0001-base`, 'migrations names 0001-base more than once'],
    ['migrations given twice', `${HUB_ROUTES.pull}?device=${A}&migrations=0001-base&migrations=0002-next`, 'names migrations more than once'],
  ];
  for (const [what, path, says] of refusals) {
    it(`answers 400 for ${what}, reaching no store`, async () => {
      const { server, calls } = start();

      const response = await send(server, 'GET', path, WRITER);

      expect(response.status).toBe(400);
      expect((await envelope(response)).error).toContain(says);
      expect(calls.pull).toBe(0);
    });
  }
});

/** A store answering `projection: true` that records each pull it is handed, delegating to the memory store. */
function projectingStore(pulls: HubPullRequest[]): HubStore {
  const store = memoryStore();
  return {
    ...store,
    pull: (request) => {
      pulls.push(request);
      return store.pull(request);
    },
    contract: () => {
      const contract = store.contract();
      return { ...contract, capabilities: { ...contract.capabilities, projection: true } };
    },
  };
}

describe('migrations on GET /v1/effort/pull', () => {
  it('answers 409 with missing for a device lacking an id a store without projection holds, reaching no pull', async () => {
    const { server, calls, lines } = start();
    await push(server, B, [commit(B, 1)]);

    const response = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&migrations=0000-older`, WRITER);
    const { success, error, missing, code } = await envelope(response);

    expect(response.status).toBe(409);
    expect(success).toBe(false);
    expect(missing).toEqual(['0001-base']);
    expect(code).toBeUndefined();
    expect(error).toContain('0001-base');
    expect(error).toContain('rafa self-update, then rafa effort sync');
    expect(calls.pull).toBe(0);
    expect(requestLines(lines).at(-1)).toMatchObject({ level: 'warn', status: 409 });
  });

  it('answers a device naming every id a store without projection holds whole, handing the store no migrations', async () => {
    const pulls: HubPullRequest[] = [];
    const store = memoryStore();
    const { server } = start({
      openStore: () => ({
        ...store,
        pull: (request) => {
          pulls.push(request);
          return store.pull(request);
        },
      }),
    });
    await push(server, B, [commit(B, 1)]);

    const named = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&migrations=0001-base,0002-ahead`, WRITER);
    const plain = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}`, WRITER);

    expect(named.status).toBe(200);
    expect(plain.status).toBe(200);
    expect((await envelope(named)).data).toEqual((await envelope(plain)).data);
    expect(pulls).toEqual([{ device: A, since: {} }, { device: A, since: {} }]);
  });

  it('hands a store with projection the migrations, in their order, and none when the query leaves them out', async () => {
    const pulls: HubPullRequest[] = [];
    const { server } = start({ openStore: () => projectingStore(pulls) });
    await push(server, B, [commit(B, 1)]);

    const named = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&migrations=0000-older,0001-base`, WRITER);
    const plain = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}`, WRITER);

    expect(named.status).toBe(200);
    expect(plain.status).toBe(200);
    expect(pulls).toEqual([{ device: A, since: {}, migrations: ['0000-older', '0001-base'] }, { device: A, since: {} }]);
  });
});

describe('the log', () => {
  it('writes one JSON line per request with its method, path, status, caller and device, never the token or the query', async () => {
    const { server, lines } = start();
    await push(server, A, [commit(A, 1)]);
    await send(server, 'GET', `${HUB_ROUTES.pull}?device=${B}&since=${encodeURIComponent('{"commits":0}')}`, WRITER);
    await send(server, 'GET', HUB_ROUTES.status, READER);
    await send(server, 'GET', HUB_ROUTES.health);

    expect(lines.every((line) => line.endsWith('\n') && line.indexOf('\n') === line.length - 1)).toBe(true);
    expect(requestLines(lines).map(({ level, method, path, status, caller, refusal, device, received, added, rows }) => ({
      level, method, path, status, caller, refusal, device, received, added, rows,
    }))).toEqual([
      { level: 'info', method: 'POST', path: HUB_ROUTES.push, status: 200, caller: 'writer', refusal: undefined, device: A, received: 1, added: 1, rows: undefined },
      { level: 'info', method: 'GET', path: HUB_ROUTES.pull, status: 200, caller: 'writer', refusal: undefined, device: B, received: undefined, added: undefined, rows: 1 },
      { level: 'warn', method: 'GET', path: HUB_ROUTES.status, status: 403, caller: undefined, refusal: 'forbidden', device: undefined, received: undefined, added: undefined, rows: undefined },
      { level: 'info', method: 'GET', path: HUB_ROUTES.health, status: 200, caller: undefined, refusal: undefined, device: undefined, received: undefined, added: undefined, rows: undefined },
    ]);
    const whole = lines.join('');
    for (const secret of [WRITER, READER, 'since', '?device']) expect(whole).not.toContain(secret);
    expect(whole).toContain('writer');
  });

  it('stamps each line with the time first, then its level and event', () => {
    const lines: string[] = [];
    const log = jsonLineLog((line) => {
      lines.push(line);
    }, () => new Date(T0));

    log({ level: 'warn', event: 'probe', detail: 'two\nlines' });

    expect(lines).toEqual([`{"time":"${T0}","level":"warn","event":"probe","detail":"two\\nlines"}\n`]);
  });

  it('logs the start with the port and version, and the store as it opens', () => {
    const { server, lines } = start();

    const logged = entries(lines);

    expect(logged.find((entry) => entry.event === 'listening')).toMatchObject({ level: 'info', port: server.port, version: VERSION });
    expect(server.port).toBeGreaterThan(0);
  });

  it('logs a refused route\'s error at warn', async () => {
    const { server, lines } = start();

    await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&since=twelve`, WRITER);

    const [line] = requestLines(lines);
    expect(line).toMatchObject({ level: 'warn', status: 400, caller: 'writer' });
    expect(String(line?.['error'])).toContain('since is not JSON');
  });
});

describe('stop', () => {
  it('closes the store and stops answering', async () => {
    const { server, calls } = start();
    expect((await send(server, 'GET', HUB_ROUTES.health)).status).toBe(200);

    await server.stop();
    running = running.filter((held) => held !== server);

    expect(calls.close).toBe(1);
    await expect(send(server, 'GET', HUB_ROUTES.health)).rejects.toThrow();
  });

  it('closes a store still opening once it opens', async () => {
    let closed = 0;
    const { server } = start({
      openStore: async () => {
        await Bun.sleep(30);
        return { ...memoryStore(), close: () => {
          closed += 1;
          return Promise.resolve();
        } };
      },
    });

    await server.stop();
    running = running.filter((held) => held !== server);

    expect(closed).toBe(1);
  });
});

/** The status each identity refusal reason is answered with; a `Record`, so a reason added to the port fails `check-types` here. */
const REFUSAL_STATUSES: Readonly<Record<IdentityRefusalReason, number>> = { unauthenticated: 401, forbidden: 403, unavailable: 503 };

describe('refusal statuses', () => {
  for (const [reason, status] of Object.entries(REFUSAL_STATUSES) as [IdentityRefusalReason, number][]) {
    it(`answers ${String(status)} for a refusal of reason ${reason}`, async () => {
      const { server } = start({ identity: { identify: () => Promise.resolve({ served: false, refusal: { reason, message: `refused: ${reason}` } }) } });

      const response = await send(server, 'GET', HUB_ROUTES.status, WRITER);

      expect(response.status).toBe(status);
      expect((await envelope(response)).error).toBe(`refused: ${reason}`);
    });
  }
});

describe('contractVersion on push and pull', () => {
  /** A push and a pull of `query` appended to the device, each with its route's call count. */
  const routes: readonly (readonly [string, (server: HubServer, query: string) => Promise<Response>, (calls: Calls) => number])[] = [
    [
      'a push',
      (server, query) => send(server, 'POST', `${HUB_ROUTES.push}?device=${A}${query}`, WRITER, encodeWirePayload(payload([commit(A, 1)]))),
      (calls) => calls.push,
    ],
    [
      'a pull',
      (server, query) => send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}${query}`, WRITER),
      (calls) => calls.pull,
    ],
  ];

  for (const [what, call, reached] of routes) {
    it(`serves ${what} naming no version as version 1`, async () => {
      const { server, calls } = start();

      const response = await call(server, '');

      expect(WIRE_CONTRACT_VERSION).toBe(1);
      expect(response.status).toBe(200);
      expect((await envelope(response)).success).toBe(true);
      expect(reached(calls)).toBe(1);
    });

    it(`serves ${what} naming version 1`, async () => {
      const { server, calls } = start();

      const response = await call(server, '&contractVersion=1');

      expect(response.status).toBe(200);
      expect(reached(calls)).toBe(1);
    });

    it(`answers 409 with ${CONTRACT_UNSUPPORTED} for ${what} naming version 2, reaching no store`, async () => {
      const { server, calls, lines } = start();

      const response = await call(server, '&contractVersion=2');

      expect(response.status).toBe(409);
      expect(await envelope(response)).toEqual({
        success: false,
        error: 'The request speaks wire contract version 2; this hub speaks version 1.',
        code: CONTRACT_UNSUPPORTED,
      });
      expect(reached(calls) + calls.contract).toBe(0);
      expect(requestLines(lines)[0]).toMatchObject({ level: 'warn', status: 409 });
    });

    const malformed: readonly (readonly [string, string])[] = [
      ['0', '"0"'],
      ['1.5', '"1.5"'],
      ['abc', '"abc"'],
      ['', '""'],
      ['01', '"01"'],
    ];
    for (const [value, quoted] of malformed) {
      it(`answers 400 for ${what} naming version ${quoted}, reaching no store`, async () => {
        const { server, calls } = start();

        const response = await call(server, `&contractVersion=${value}`);

        expect(response.status).toBe(400);
        expect(await envelope(response)).toEqual({
          success: false,
          error: `contractVersion is ${quoted}; expected a whole number above zero, such as 1.`,
        });
        expect(reached(calls)).toBe(0);
      });
    }

    it(`answers 400 for ${what} naming the version twice`, async () => {
      const { server, calls } = start();

      const response = await call(server, '&contractVersion=1&contractVersion=1');

      expect(response.status).toBe(400);
      expect((await envelope(response)).error).toBe('The query names contractVersion more than once.');
      expect(reached(calls)).toBe(0);
    });
  }

  it('refuses another version before the body is decoded', async () => {
    const { server, calls } = start();

    const response = await send(server, 'POST', `${HUB_ROUTES.push}?device=${A}&contractVersion=2`, WRITER, 'rows please');

    expect(response.status).toBe(409);
    expect((await envelope(response)).code).toBe(CONTRACT_UNSUPPORTED);
    expect(calls.push).toBe(0);
  });
});

/** The project a rebuild records in these cases. */
const PROJECT = 'open-tomato/rafa';

/** What a stand-in rebuild answers. */
const REBUILT: IndexRebuildResult = Object.freeze({
  project: PROJECT,
  stamp: T0,
  rows: 3,
  vectors: 0,
  tables: Object.freeze([Object.freeze({ table: 'effort_fts', rows: 3 })]),
  vector: false,
  why: 'sqlite-vec did not load',
});

/** A promise with its resolve and reject held outside it. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A stand-in index, the rebuilds it was asked for, and a promise per rebuild resolving once it starts. */
interface StandInIndex {
  readonly index: HubIndex;
  readonly asked: IndexRebuildRequest[];
  readonly started: (call: number) => Promise<void>;
}

/** A stand-in index whose `call`th rebuild (from 0) answers what `outcome(call)` does. */
function standInIndex(outcome: (call: number) => Promise<IndexRebuildResult> = () => Promise.resolve(REBUILT)): StandInIndex {
  const asked: IndexRebuildRequest[] = [];
  const starts: Deferred<void>[] = [];
  const startOf = (call: number): Deferred<void> => {
    starts[call] ??= deferred<void>();
    return starts[call];
  };
  const index: HubIndex = {
    rebuild: (request) => {
      const call = asked.length;
      asked.push(request);
      startOf(call).resolve();
      return outcome(call);
    },
    search: () => Promise.resolve({ hits: [] }),
    links: () => Promise.resolve({ graph: false, links: [] }),
    capabilities: () => ({ fts: true, vector: false, graph: false }),
  };
  return { index, asked, started: (call) => startOf(call).promise };
}

/** Starts a hub over `index` through `openConnected`, rebuilding after a push, `overrides` replacing any option. */
function startConnected(index: HubIndex, overrides: Partial<HubServerOptions> = {}): Started {
  const calls: Calls = { push: 0, pull: 0, status: 0, close: 0, contract: 0 };
  const started = start({
    openStore: () => {
      throw new Error('openStore is not used beside openConnected');
    },
    openConnected: () => Promise.resolve({ store: counted(memoryStore(), calls), index }),
    rebuildAfterPush: true,
    project: PROJECT,
    ...overrides,
  });
  return { ...started, calls };
}

/** Stops `server` and lets the `afterEach` hook skip it. */
async function stopped(server: HubServer): Promise<void> {
  await server.stop();
  running = running.filter((held) => held !== server);
}

/** The `index.*` lines logged, by event. */
function indexLines(lines: readonly string[]): HubLogEntry[] {
  return entries(lines).filter((entry) => entry.event.startsWith('index.'));
}

describe('index rebuild after a push', () => {
  it('starts one rebuild naming the project after a push adding rows, answering the push before it ends', async () => {
    const gate = deferred<IndexRebuildResult>();
    const { index, asked } = standInIndex(() => gate.promise);
    const { server, lines, calls } = startConnected(index);

    const response = await push(server, A, [commit(A, 1)]);

    expect(response.status).toBe(200);
    expect(await envelope(response)).toEqual({ success: true, data: { received: 1, added: 1, at: T0 } });
    expect(asked).toEqual([{ project: PROJECT }]);
    expect(indexLines(lines)).toEqual([]);

    gate.resolve(REBUILT);
    await stopped(server);

    expect(calls.push).toBe(1);
    expect(indexLines(lines)).toEqual([expect.objectContaining({
      level: 'info',
      event: 'index.rebuilt',
      project: PROJECT,
      rows: 3,
      vectors: 0,
      vector: false,
      tables: [{ table: 'effort_fts', rows: 3 }],
    }) as HubLogEntry]);
  });

  const failures: readonly (readonly [string, () => Promise<IndexRebuildResult>])[] = [
    ['rejects', () => Promise.reject(new Error('SQLITE_IOERR: disk I/O error'))],
    ['throws', () => {
      throw new Error('SQLITE_IOERR: disk I/O error');
    }],
  ];
  for (const [how, fail] of failures) {
    it(`logs index.rebuild-failed when the rebuild ${how}, answering the push unchanged and rebuilding on the next push`, async () => {
      const { index, asked } = standInIndex((call) => call === 0
        ? fail()
        : Promise.resolve(REBUILT));
      const { server, lines } = startConnected(index);

      const first = await push(server, A, [commit(A, 1)]);
      const second = await push(server, A, [commit(A, 2)]);

      expect(first.status).toBe(200);
      expect(await envelope(first)).toEqual({ success: true, data: { received: 1, added: 1, at: T0 } });
      expect(second.status).toBe(200);
      await stopped(server);

      expect(asked).toHaveLength(2);
      expect(indexLines(lines).map(({ level, event, project, error }) => ({ level, event, project, error }))).toEqual([
        { level: 'error', event: 'index.rebuild-failed', project: PROJECT, error: 'SQLITE_IOERR: disk I/O error' },
        { level: 'info', event: 'index.rebuilt', project: PROJECT, error: undefined },
      ]);
      expect(requestLines(lines).map(({ level, status }) => ({ level, status }))).toEqual([
        { level: 'info', status: 200 },
        { level: 'info', status: 200 },
      ]);
      expect(entries(lines).some((entry) => entry.event === 'request.failed')).toBe(false);
    });
  }

  const quiet: readonly (readonly [string, Partial<HubServerOptions>])[] = [
    ['false', { rebuildAfterPush: false }],
    ['left out', { rebuildAfterPush: undefined, project: undefined }],
  ];
  for (const [what, overrides] of quiet) {
    it(`starts no rebuild with rebuildAfterPush ${what}, serving the store openConnected opened`, async () => {
      const { index, asked } = standInIndex();
      const { server, lines, calls } = startConnected(index, overrides);

      const response = await push(server, A, [commit(A, 1), commit(A, 2)]);
      await stopped(server);

      expect(await envelope(response)).toEqual({ success: true, data: { received: 2, added: 2, at: T0 } });
      expect(calls.push).toBe(1);
      expect(calls.close).toBe(1);
      expect(asked).toEqual([]);
      expect(indexLines(lines)).toEqual([]);
    });
  }

  it('starts no rebuild after a push adding nothing, a repeat or an empty payload', async () => {
    const { index, asked } = standInIndex();
    const { server, lines } = startConnected(index);

    await push(server, A, [commit(A, 1), commit(A, 2)]);
    expect(asked).toHaveLength(1);

    const repeat = await push(server, A, [commit(A, 1), commit(A, 2)]);
    const empty = await push(server, A, []);
    await stopped(server);

    expect(await envelope(repeat)).toEqual({ success: true, data: { received: 2, added: 0, at: T0 } });
    expect(await envelope(empty)).toEqual({ success: true, data: { received: 0, added: 0, at: T0 } });
    expect(asked).toHaveLength(1);
    expect(indexLines(lines).map(({ event }) => event)).toEqual(['index.rebuilt']);
  });

  it('queues one rebuild for two pushes during one, starting it once the running one ends', async () => {
    const gates = [deferred<IndexRebuildResult>(), deferred<IndexRebuildResult>()];
    const { index, asked, started } = standInIndex((call) => gates[call]?.promise ?? Promise.reject(new Error(`rebuild ${String(call)} was not expected`)));
    const { server, lines } = startConnected(index);

    await push(server, A, [commit(A, 1)]);
    const during = await Promise.all([push(server, A, [commit(A, 2)]), push(server, B, [commit(B, 1)])]);

    expect(during.map((response) => response.status)).toEqual([200, 200]);
    expect(await Promise.all(during.map(envelope))).toEqual([
      { success: true, data: { received: 1, added: 1, at: T0 } },
      { success: true, data: { received: 1, added: 1, at: T0 } },
    ]);
    expect(asked).toHaveLength(1);

    gates[0]?.resolve(REBUILT);
    await started(1);
    expect(asked).toHaveLength(2);

    gates[1]?.resolve({ ...REBUILT, rows: 4 });
    await stopped(server);

    expect(asked).toEqual([{ project: PROJECT }, { project: PROJECT }]);
    expect(indexLines(lines).map(({ event, rows }) => ({ event, rows }))).toEqual([
      { event: 'index.rebuilt', rows: 3 },
      { event: 'index.rebuilt', rows: 4 },
    ]);
  });

  it('stops by awaiting the running rebuild before closing the store, dropping the queued one', async () => {
    const order: string[] = [];
    const gate = deferred<IndexRebuildResult>();
    const { index, asked } = standInIndex(() => gate.promise.then((built) => {
      order.push('rebuild ended');
      return built;
    }));
    const { server } = startConnected(index, {
      openConnected: () => Promise.resolve({
        store: { ...memoryStore(), close: () => {
          order.push('store closed');
          return Promise.resolve();
        } },
        index,
      }),
    });
    await push(server, A, [commit(A, 1)]);
    await push(server, A, [commit(A, 2)]);

    setTimeout(() => {
      gate.resolve(REBUILT);
    }, 30);
    await stopped(server);

    expect(order).toEqual(['rebuild ended', 'store closed']);
    expect(asked).toHaveLength(1);
  });

  it('refuses at start rebuildAfterPush with no openConnected or no project, and options opening no store', () => {
    const base = { port: 0, hostname: '127.0.0.1', version: VERSION, identity: identity(), log: () => undefined };

    expect(() => startHubServer({ ...base, openStore: memoryStore, rebuildAfterPush: true, project: PROJECT }))
      .toThrow('rebuildAfterPush needs openConnected');
    expect(() => startHubServer({ ...base, openConnected: () => Promise.resolve({ store: memoryStore(), index: standInIndex().index }), rebuildAfterPush: true }))
      .toThrow('rebuildAfterPush needs project');
    expect(() => startHubServer(base)).toThrow('startHubServer needs openStore or openConnected');
  });
});

/** The first of two listed projects, where a request naming none is served. */
const ONE: HubServedProject = Object.freeze({ id: '1'.repeat(40), name: 'open-tomato/one' });

/** The second of two listed projects. */
const TWO: HubServedProject = Object.freeze({ id: '2'.repeat(40), name: 'open-tomato/two' });

/** A root commit sha neither listed project has. */
const UNLISTED = '3'.repeat(40);

/** The two projects the server and its store are handed, in listed order. */
const LISTED: readonly HubServedProject[] = Object.freeze([ONE, TWO]);

/** The refusal of a request naming {@link UNLISTED}. */
const NOT_SERVED = `rafa-hub: project ${UNLISTED} is not served here; add it under hub.projects`;

/** A fresh in-memory store serving {@link LISTED}, stamped at {@link T0}. */
function listedStore(): HubStore {
  return openMemoryHubStore({ directory: '', now: () => new Date(T0), projects: LISTED });
}

/** Starts a hub over a store serving {@link LISTED}, handed `projects` (both by default), `overrides` replacing any option. */
function startListed(overrides: Partial<HubServerOptions> = {}): Started {
  const calls: Calls = { push: 0, pull: 0, status: 0, close: 0, contract: 0 };
  const started = start({ openStore: () => counted(listedStore(), calls), projects: LISTED, ...overrides });
  return { ...started, calls };
}

/** The query naming `project`, none when it is undefined. */
function projectQuery(project: string | undefined): string {
  return project === undefined
    ? ''
    : `&project=${project}`;
}

/** Pushes `rows` as `device` to `project`, naming none when it is undefined. */
function pushTo(server: HubServer, device: string, project: string | undefined, rows: readonly WireRow[]): Promise<Response> {
  return send(server, 'POST', `${HUB_ROUTES.push}?device=${device}${projectQuery(project)}`, WRITER, encodeWirePayload(payload(rows)));
}

/** The origins of the commits `device` pulls from `project`, naming none when it is undefined. */
async function pulledFrom(server: HubServer, device: string, project: string | undefined): Promise<unknown[]> {
  const response = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${device}${projectQuery(project)}`, WRITER);
  expect(response.status).toBe(200);
  const pulled = (await envelope(response)).data as unknown as WirePayload;
  return (pulled.tables['commits'] ?? []).map((row) => row['origin_seq']);
}

describe('project on push and pull', () => {
  it('answers 404 with the hub.projects line for a push naming an unlisted project, before the body is read', async () => {
    const { server, calls, lines } = startListed();

    const refused = await send(server, 'POST', `${HUB_ROUTES.push}?device=${A}&project=${UNLISTED}`, WRITER, 'rows please');
    const read = await send(server, 'POST', `${HUB_ROUTES.push}?device=${A}&project=${TWO.id}`, WRITER, 'rows please');

    expect(refused.status).toBe(404);
    expect(await envelope(refused)).toEqual({ success: false, error: NOT_SERVED });
    expect(read.status).toBe(400);
    expect((await envelope(read)).error).toContain('wire: the payload is not JSON');
    expect(calls.push).toBe(0);
    expect(requestLines(lines)[0]).toMatchObject({ level: 'warn', status: 404, error: NOT_SERVED });
  });

  it('answers 404 with the hub.projects line for a pull naming an unlisted project, reaching no store', async () => {
    const { server, calls } = startListed();

    const refused = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&project=${UNLISTED}`, WRITER);
    const served = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&project=${TWO.id}`, WRITER);

    expect(refused.status).toBe(404);
    expect(await envelope(refused)).toEqual({ success: false, error: NOT_SERVED });
    expect(served.status).toBe(200);
    expect(calls.pull).toBe(1);
  });

  it('answers the store\'s own refusal of an unlisted project 404 with its line, on a hub handed no projects', async () => {
    const { server, calls } = startListed({ projects: undefined });

    const response = await pushTo(server, A, UNLISTED, [commit(A, 1)]);

    expect(response.status).toBe(404);
    expect(await envelope(response)).toEqual({ success: false, error: NOT_SERVED });
    expect(calls.push).toBe(1);
  });

  const malformed: readonly (readonly [string, string])[] = [
    ['an empty project', ''],
    ['a project in capitals', 'A'.repeat(40)],
    ['a project one character short', '1'.repeat(39)],
    ['a project one character long', '1'.repeat(41)],
    ['the default project\'s id', 'default'],
    ['a repository', 'open-tomato%2Fone'],
  ];
  for (const [what, spelt] of malformed) {
    for (const [route, method] of [[HUB_ROUTES.push, 'POST'], [HUB_ROUTES.pull, 'GET']] as const) {
      it(`answers 400 for ${what} on ${method} ${route}, reaching no store`, async () => {
        const { server, calls } = startListed();

        const response = await send(server, method, `${route}?device=${A}&project=${spelt}`, WRITER, method === 'POST'
          ? encodeWirePayload(payload([commit(A, 1)]))
          : undefined);

        expect(response.status).toBe(400);
        expect((await envelope(response)).error).toBe('project is not a root commit sha; expected 40 lowercase hex characters, as git rev-list --max-parents=0 HEAD prints.');
        expect(calls.push + calls.pull).toBe(0);
      });
    }
  }

  it('answers 400 for a project given twice, reaching no store', async () => {
    const { server, calls } = startListed();

    const response = await send(server, 'POST', `${HUB_ROUTES.push}?device=${A}&project=${ONE.id}&project=${TWO.id}`, WRITER, encodeWirePayload(payload([commit(A, 1)])));

    expect(response.status).toBe(400);
    expect((await envelope(response)).error).toBe('The query names project more than once.');
    expect(calls.push).toBe(0);
  });

  it('answers 400 for a malformed project on a single-project hub too', async () => {
    const { server, calls } = start();

    const response = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${A}&project=default`, WRITER);

    expect(response.status).toBe(400);
    expect(calls.pull).toBe(0);
  });

  it('lands a push naming none in the first listed project, and a pull naming none reads it', async () => {
    const { server } = startListed();

    const pushed = await pushTo(server, A, undefined, [commit(A, 1)]);
    await pushTo(server, A, TWO.id, [commit(A, 2), commit(A, 3)]);

    expect(await envelope(pushed)).toEqual({ success: true, data: { received: 1, added: 1, at: T0 } });
    expect(await pulledFrom(server, B, undefined)).toEqual([1]);
    expect(await pulledFrom(server, B, ONE.id)).toEqual([1]);
    expect(await pulledFrom(server, B, TWO.id)).toEqual([2, 3]);
  });

  it('serves every project a request names on a single-project hub, in its one project', async () => {
    const { server } = start();

    const pushed = await pushTo(server, A, ONE.id, [commit(A, 1)]);

    expect(pushed.status).toBe(200);
    expect(await pulledFrom(server, B, TWO.id)).toEqual([1]);
    expect(await pulledFrom(server, B, UNLISTED)).toEqual([1]);
    expect(await pulledFrom(server, B, undefined)).toEqual([1]);
  });

  it('logs the project a push or a pull named, and none for one naming none', async () => {
    const { server, lines } = startListed();

    await pushTo(server, A, TWO.id, [commit(A, 1)]);
    await pulledFrom(server, B, undefined);

    expect(requestLines(lines).map(({ path, project }) => ({ path, project }))).toEqual([
      { path: HUB_ROUTES.push, project: TWO.id },
      { path: HUB_ROUTES.pull, project: undefined },
    ]);
  });
});

describe('GET /v1/status over two projects', () => {
  it('answers each project\'s id and name in listed order, beside the first project\'s rows', async () => {
    const { server } = startListed();
    await pushTo(server, A, TWO.id, [commit(A, 1), commit(A, 2)]);
    await pushTo(server, B, ONE.id, [commit(B, 1)]);

    const response = await send(server, 'GET', HUB_ROUTES.status, WRITER);

    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data?.['projects']).toEqual([{ id: ONE.id, name: ONE.name }, { id: TWO.id, name: TWO.name }]);
    expect(data?.['rows']).toEqual({ commits: 1 });
    expect(data?.['devices']).toEqual([{ device: B, lastPushAt: T0 }]);
  });

  it('names no projects over a store answering none', async () => {
    const { server } = start();

    const { data } = await envelope(await send(server, 'GET', HUB_ROUTES.status, WRITER));

    expect(data).not.toHaveProperty('projects');
  });
});

/** Starts a hub over `index` and a store serving {@link LISTED}, rebuilding after a push, `overrides` replacing any option. */
function startListedConnected(index: HubIndex, overrides: Partial<HubServerOptions> = {}): Started {
  const calls: Calls = { push: 0, pull: 0, status: 0, close: 0, contract: 0 };
  const started = startConnected(index, {
    openConnected: () => Promise.resolve({ store: counted(listedStore(), calls), index }),
    projects: LISTED,
    project: undefined,
    ...overrides,
  });
  return { ...started, calls };
}

describe('index rebuild after a push, per project', () => {
  it('starts no rebuild for a push refused as naming an unlisted project', async () => {
    const { index, asked } = standInIndex();
    const { server } = startListedConnected(index);

    const refused = await pushTo(server, A, UNLISTED, [commit(A, 1)]);
    const served = await pushTo(server, A, ONE.id, [commit(A, 1)]);
    await stopped(server);

    expect(refused.status).toBe(404);
    expect(served.status).toBe(200);
    expect(asked).toEqual([{ project: ONE.id }]);
  });

  it('rebuilds the pushed project\'s index, and the first listed project\'s for a push naming none', async () => {
    const { index, asked } = standInIndex();
    const { server, lines } = startListedConnected(index);

    await pushTo(server, A, TWO.id, [commit(A, 1)]);
    await pushTo(server, A, undefined, [commit(A, 2)]);
    await stopped(server);

    expect(asked).toEqual([{ project: TWO.id }, { project: ONE.id }]);
    expect(indexLines(lines).map(({ event, project }) => ({ event, project }))).toEqual([
      { event: 'index.rebuilt', project: TWO.id },
      { event: 'index.rebuilt', project: ONE.id },
    ]);
  });

  it('rebuilds the hub\'s repository on a single-project hub, whatever project the push names', async () => {
    const { index, asked } = standInIndex();
    const { server } = startConnected(index);

    await pushTo(server, A, ONE.id, [commit(A, 1)]);
    await stopped(server);

    expect(asked).toEqual([{ project: PROJECT }]);
  });

  it('runs two projects\' rebuilds side by side, and queues one per project', async () => {
    const gates = [deferred<IndexRebuildResult>(), deferred<IndexRebuildResult>(), deferred<IndexRebuildResult>()];
    const { index, asked, started } = standInIndex((call) => gates[call]?.promise ?? Promise.reject(new Error(`rebuild ${String(call)} was not expected`)));
    const { server } = startListedConnected(index);

    await pushTo(server, A, ONE.id, [commit(A, 1)]);
    await pushTo(server, A, TWO.id, [commit(A, 1)]);
    await pushTo(server, A, ONE.id, [commit(A, 2)]);
    await pushTo(server, A, ONE.id, [commit(A, 3)]);

    expect(asked).toEqual([{ project: ONE.id }, { project: TWO.id }]);

    gates[0]?.resolve(REBUILT);
    await started(2);
    gates[1]?.resolve(REBUILT);
    gates[2]?.resolve(REBUILT);
    await stopped(server);

    expect(asked).toEqual([{ project: ONE.id }, { project: TWO.id }, { project: ONE.id }]);
  });

  it('starts with rebuildAfterPush and no project when projects are listed', () => {
    const { index } = standInIndex();

    expect(() => startListedConnected(index)).not.toThrow();
  });
});
