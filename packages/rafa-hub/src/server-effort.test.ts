/**
 * The payload cap on the effort routes (`server-effort.ts`), served by
 * the hub server over the in-memory store opened with a small
 * `maxPayloadRows`: a push one row under, at and one row over the cap,
 * a pull of a project holding as many rows, and `/v1/status` answering
 * the cap.
 *
 * Each refusal is read beside a served control: the over-cap push counts
 * no store push while the at-cap push counts one, and a hub whose store
 * caps nothing serves the payload the capped one refuses, so a refusal
 * that fired on every push, or a count that could never move, fails
 * here. The refusal's text is spelled, never built from the module's
 * own message.
 */
import type { HubServer } from './server.js';
import type { HubPullRequest, HubStore } from './store/port.js';
import type { WireCursor, WirePayload, WireRow } from '@open-tomato/rafa/store';

import { encodeWirePayload, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, describe, expect, it } from 'bun:test';

import { HUB_ACTIONS } from './identity/port.js';
import { openMemoryIdentity } from './identity/testdata/memory-identity.js';
import { HUB_ROUTES, startHubServer } from './server.js';
import { openMemoryHubStore } from './store/testdata/memory-store.js';

const T0 = '2026-11-26T09:00:00.000Z';
const WRITER = 'hub-effort-writer-token-0001';
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

/** The cap every capped case's store is opened with. */
const CAP = 4;

/** One row under, at and one row over {@link CAP}, by name. */
const AROUND_CAP: readonly (readonly [string, number])[] = [
  ['one row under the cap', CAP - 1],
  ['exactly the cap', CAP],
  ['one row over the cap', CAP + 1],
];

/** What the store was asked, counted and recorded through {@link recorded}. */
interface Asked {
  pushes: number;
  readonly pulls: HubPullRequest[];
}

/** `store` with each push counted and each pull request recorded into `asked`. */
function recorded(store: HubStore, asked: Asked): HubStore {
  return {
    ...store,
    push: (request) => {
      asked.pushes += 1;
      return store.push(request);
    },
    pull: (request) => {
      asked.pulls.push(request);
      return store.pull(request);
    },
  };
}

let running: HubServer[] = [];

afterEach(async () => {
  await Promise.all(running.map((server) => server.stop()));
  running = [];
});

/** A hub over the in-memory store capped at `cap`, `null` for none, with what its store was asked. */
function start(cap: number | null): { readonly server: HubServer; readonly asked: Asked; readonly lines: string[] } {
  const asked: Asked = { pushes: 0, pulls: [] };
  const lines: string[] = [];
  const server = startHubServer({
    port: 0,
    hostname: '127.0.0.1',
    version: '1.2.3',
    identity: openMemoryIdentity({ [WRITER]: { id: 'writer', may: HUB_ACTIONS } }),
    openStore: () => recorded(openMemoryHubStore({ directory: '', now: () => new Date(T0), maxPayloadRows: cap }), asked),
    log: (entry) => {
      lines.push(JSON.stringify(entry));
    },
  });
  running = [...running, server];
  return { server, asked, lines };
}

/** `count` commits created by `origin`, numbered from 1. */
function commits(origin: string, count: number): WireRow[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    sha: `${origin}-${String(index + 1)}`,
    row_json: '{}',
    origin_store: origin,
    origin_seq: index + 1,
  }));
}

/** A payload carrying `tables`. */
function payload(tables: Readonly<Record<string, readonly WireRow[]>>): WirePayload {
  const cursor = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]));
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: ['0001-base'], tables, cursor };
}

/** The envelope a response holds. */
interface Envelope {
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: string;
}

/** Pushes `tables` as `device` with the writer's token, answering the status and the envelope. */
async function push(server: HubServer, device: string, tables: Readonly<Record<string, readonly WireRow[]>>): Promise<{ readonly status: number; readonly body: Envelope }> {
  const response = await fetch(`${server.url}${HUB_ROUTES.push}?device=${device}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${WRITER}` },
    body: encodeWirePayload(payload(tables)),
  });
  return { status: response.status, body: await response.json() as Envelope };
}

/** Pulls as `device` past `since`, answering the status and the payload's tables and cursor. */
async function pull(server: HubServer, device: string, since?: WireCursor): Promise<{ readonly status: number; readonly tables: Record<string, WireRow[]>; readonly cursor: WireCursor }> {
  const query = since === undefined
    ? ''
    : `&since=${encodeURIComponent(JSON.stringify(since))}`;
  const response = await fetch(`${server.url}${HUB_ROUTES.pull}?device=${device}${query}`, { headers: { authorization: `Bearer ${WRITER}` } });
  const body = await response.json() as { readonly data: { readonly tables: Record<string, WireRow[]>; readonly cursor: WireCursor } };
  return { status: response.status, tables: body.data.tables, cursor: body.data.cursor };
}

/** The rows across every table of `tables`. */
function rowsIn(tables: Readonly<Record<string, readonly WireRow[]>>): number {
  return Object.values(tables).reduce((total, rows) => total + rows.length, 0);
}

describe('POST /v1/effort/push under dangerous.hub.maxPayloadRows', () => {
  for (const [what, rows] of AROUND_CAP.slice(0, 2)) {
    it(`takes a push of ${what}, reaching the store`, async () => {
      const { server, asked } = start(CAP);

      const { status, body } = await push(server, A, { commits: commits(A, rows) });

      expect(status).toBe(200);
      expect(body.data).toEqual({ received: rows, added: rows, at: T0 });
      expect(asked.pushes).toBe(1);
    });
  }

  it('refuses a push of one row over the cap 413 naming the key, reaching no store', async () => {
    const { server, asked } = start(CAP);

    const { status, body } = await push(server, A, { commits: commits(A, CAP + 1) });

    expect(status).toBe(413);
    expect(body).toEqual({
      success: false,
      error: 'The push carries 5 rows, more than this hub\'s dangerous.hub.maxPayloadRows of 4; nothing was taken. Next step: push at most 4 rows a payload.',
    });
    expect(body.error).not.toContain('--batch');
    expect(asked.pushes).toBe(0);
  });

  it('counts rows across every table, refusing two tables that hold one row over the cap between them', async () => {
    const { server, asked } = start(CAP);

    const over = await push(server, A, { commits: commits(A, 2), sessions: commits(A, CAP - 1) });
    const at = await push(server, A, { commits: commits(A, 2), sessions: commits(A, CAP - 2) });

    expect(over.status).toBe(413);
    expect(at.status).toBe(200);
    expect(asked.pushes).toBe(1);
  });

  it('takes nothing of a refused push: the status counts no row of it, then the rows of a push at the cap', async () => {
    const { server } = start(CAP);
    const rowsHeld = async (): Promise<unknown> => {
      const response = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${WRITER}` } });
      return (await response.json() as Envelope).data?.['rows'];
    };

    await push(server, A, { commits: commits(A, CAP + 1) });
    const afterRefused = await rowsHeld();
    await push(server, A, { commits: commits(A, CAP) });

    expect(afterRefused).toEqual({});
    expect(await rowsHeld()).toEqual({ commits: CAP });
  });

  it('takes the payload a capped hub refuses on a hub whose store caps nothing', async () => {
    const { server, asked } = start(null);

    const { status } = await push(server, A, { commits: commits(A, CAP + 1) });

    expect(status).toBe(200);
    expect(asked.pushes).toBe(1);
  });

  it('logs the refusal at warn with its error, the request line holding no row', async () => {
    const { server, lines } = start(CAP);

    await push(server, A, { commits: commits(A, CAP + 1) });
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry['event'] === 'request');

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'warn', status: 413, path: HUB_ROUTES.push });
    expect(String(logged[0]?.['error'])).toContain('dangerous.hub.maxPayloadRows of 4');
  });
});

describe('GET /v1/effort/pull under dangerous.hub.maxPayloadRows', () => {
  for (const [what, rows] of AROUND_CAP) {
    it(`answers a project holding ${what} in pages of at most the cap, the cursor resuming past each`, async () => {
      const { server, asked } = start(CAP);
      // Two pushes, each under the cap, so the push refusal never fires here.
      await push(server, B, { commits: commits(B, rows).slice(0, 2) });
      await push(server, B, { commits: commits(B, rows).slice(2) });

      const first = await pull(server, A);
      const second = await pull(server, A, first.cursor);

      expect(first.status).toBe(200);
      expect(rowsIn(first.tables)).toBe(Math.min(rows, CAP));
      expect(rowsIn(second.tables)).toBe(rows - Math.min(rows, CAP));
      expect([...first.tables['commits'] ?? [], ...second.tables['commits'] ?? []].map(({ sha }) => sha)).toEqual(commits(B, rows).map(({ sha }) => sha));
      expect(asked.pulls.map(({ limit }) => limit)).toEqual([CAP, CAP]);
    });
  }

  it('hands a store that caps nothing no limit, answering every row in one pull', async () => {
    const { server, asked } = start(null);
    await push(server, B, { commits: commits(B, CAP + 1) });

    const { tables } = await pull(server, A);

    expect(rowsIn(tables)).toBe(CAP + 1);
    expect(asked.pulls).toHaveLength(1);
    expect('limit' in (asked.pulls[0] ?? {})).toBe(false);
  });
});

describe('GET /v1/status and the cap', () => {
  it('answers the store\'s cap as maxPayloadRows, and null for a store that caps nothing', async () => {
    const capped = start(CAP).server;
    const uncapped = start(null).server;
    const read = async (server: HubServer): Promise<unknown> => {
      const response = await fetch(`${server.url}${HUB_ROUTES.status}`, { headers: { authorization: `Bearer ${WRITER}` } });
      return (await response.json() as Envelope).data?.['maxPayloadRows'];
    };

    expect(await read(capped)).toBe(CAP);
    expect(await read(uncapped)).toBeNull();
  });
});
