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
 */
import type { HubIdentity, IdentityRefusalReason } from './identity/port.js';
import type { HubLogEntry, HubServer, HubServerOptions } from './server.js';
import type { HubStore } from './store/port.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { encodeWirePayload, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, describe, expect, it } from 'bun:test';

import { HUB_ACTIONS } from './identity/port.js';
import { openMemoryIdentity } from './identity/testdata/memory-identity.js';
import { AUTH_CHALLENGE, HUB_ROUTES, INTERNAL_ERROR, jsonLineLog, startHubServer, STORE_UNAVAILABLE } from './server.js';
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
  const calls: Calls = { push: 0, pull: 0, status: 0, close: 0 };
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
        migrations: ['0001-base'],
        rows: { commits: 3 },
        devices: [{ device: A, lastPushAt: T0 }, { device: B, lastPushAt: T0 }],
      },
    });
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
    const { success, error } = await envelope(response);
    expect(success).toBe(false);
    expect(error).toContain('9999-from-a-newer-rafa');
    expect(error).toContain(HUB_UPGRADE);
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
    ['a parameter the route does not read', `${HUB_ROUTES.push}?device=${A}&since={}`, encodeWirePayload(payload([commit(A, 1)])), 'The query names "since"; expected device.'],
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
    ['a misspelt parameter', `${HUB_ROUTES.pull}?device=${A}&cursor={}`, 'The query names "cursor"; expected device, since.'],
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
