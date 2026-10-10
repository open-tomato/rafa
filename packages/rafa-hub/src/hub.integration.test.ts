/**
 * The hub wired whole: the real SQLite store (`store/sqlite.ts`) behind
 * the real repository-permission identity (`identity/github.ts`), served
 * by the real hub server (`server.ts`), over a stand-in GitHub
 * (`identity/testdata/stand-in-github.ts`) with `Bun.serve` on a free
 * port. `server.test.ts` covers the routes over stand-in adapters, and
 * `identity/github.test.ts` and `store/sqlite.test.ts` cover each
 * adapter alone; this file is the seam between the three, reached only
 * through HTTP requests to a running hub, never by calling an adapter
 * directly. No case reaches api.github.com.
 */
import type { StandInGitHub } from './identity/testdata/stand-in-github.js';
import type { HubServer } from './server.js';
import type { WirePayload } from '@open-tomato/rafa/store';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeWirePayload, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openGitHubIdentity } from './identity/github.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { HUB_ROUTES, startHubServer } from './server.js';
import { HUB_UPGRADE, openSqliteHubStore } from './store/sqlite.js';

const VERSION = '0.0.0-integration';
const REPOSITORY = 'open-tomato/rafa';
const OTHER_REPOSITORY = 'open-tomato/elsewhere';

/** `hub.auth.cacheFor` at its default, `10m`. */
const TEN_MINUTES = 600_000;

const WRITER = 'ghp_hub_integration_writer_0001';
const READER = 'ghp_hub_integration_reader_0002';
const STRANGER = 'ghp_hub_integration_stranger_03';

/** The pushing device's origin, an effort store's `origin_store`. */
const DEVICE = 'aaaaaaaa-0000-4000-8000-00000000000a';

/** A migration id no rafa build has, as a newer store's push would name. */
const FUTURE_MIGRATION = '9999-from-a-newer-rafa';

/** Sends `method` to `path` on `server`, with `token` as a bearer and `headers` beside it. */
function send(server: HubServer, method: string, path: string, token?: string, body?: string, headers: Readonly<Record<string, string>> = {}): Promise<Response> {
  const combined: Record<string, string> = { ...headers };
  if (token !== undefined) combined['authorization'] = `Bearer ${token}`;
  return fetch(`${server.url}${path}`, { method, headers: combined, body });
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

describe('the hub wired whole: SQLite behind GitHub, over a stand-in GitHub', () => {
  let directory = '';
  let github: StandInGitHub;
  let clock = 1_000_000;
  let running: HubServer[] = [];

  /** A server over the real SQLite store and the real GitHub identity, `cacheForMs` and the case's clock applied. */
  const startHub = (cacheForMs: number | null = TEN_MINUTES): HubServer => {
    const server = startHubServer({
      port: 0,
      hostname: '127.0.0.1',
      version: VERSION,
      identity: openGitHubIdentity({ repository: REPOSITORY, cacheForMs, apiBase: github.url, now: () => clock }),
      openStore: () => openSqliteHubStore({ directory, now: () => new Date() }),
    });
    running = [...running, server];
    return server;
  };

  /** Requests the stand-in has been sent about a repository, `/user` left out. */
  const repositoriesAsked = (): string[] => github.asked()
    .filter((asked) => asked.path !== '/user')
    .map((asked) => asked.path);

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-integration-')));
    clock = 1_000_000;
    github = startStandInGitHub({
      [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } },
      [READER]: { login: 'reader', roles: { [REPOSITORY]: 'read' } },
      [STRANGER]: { login: 'stranger', roles: { [OTHER_REPOSITORY]: 'admin' } },
    });
  });

  afterEach(async () => {
    await Promise.all(running.map((server) => server.stop()));
    running = [];
    await github.stop();
    rmSync(directory, { recursive: true, force: true });
  });

  it('refuses a read token as forbidden and serves a write token', async () => {
    const server = startHub();

    const refused = await send(server, 'GET', HUB_ROUTES.status, READER);
    const served = await send(server, 'GET', HUB_ROUTES.status, WRITER);

    expect(refused.status).toBe(403);
    expect((await envelope(refused)).error).toContain(REPOSITORY);
    expect(served.status).toBe(200);
    expect((await envelope(served)).success).toBe(true);
  });

  it('does not ask GitHub again about a served token within hub.auth.cacheFor', async () => {
    const server = startHub(TEN_MINUTES);
    await send(server, 'GET', HUB_ROUTES.status, WRITER);
    const askedOnce = github.asked().length;
    clock += TEN_MINUTES - 1;

    const again = await send(server, 'GET', HUB_ROUTES.status, WRITER);

    expect(again.status).toBe(200);
    expect(github.asked().length).toBe(askedOnce);
  });

  it('asks GitHub again about a token it refused', async () => {
    const server = startHub(TEN_MINUTES);
    const first = await send(server, 'GET', HUB_ROUTES.status, READER);
    const askedOnce = github.asked().length;

    const second = await send(server, 'GET', HUB_ROUTES.status, READER);

    expect([first.status, second.status]).toEqual([403, 403]);
    expect(github.asked().length).toBeGreaterThan(askedOnce);
  });

  it('checks a request naming another repository against hub.repository', async () => {
    const server = startHub();

    const response = await send(server, 'GET', HUB_ROUTES.status, STRANGER, undefined, { 'x-rafa-repository': OTHER_REPOSITORY });

    expect(response.status).toBe(403);
    expect((await envelope(response)).error).toContain(REPOSITORY);
    expect(new Set(repositoriesAsked())).toEqual(new Set([`/repos/${REPOSITORY}`]));
  });

  it('refuses a push from a newer store, naming the upgrade', async () => {
    const server = startHub();
    const payload: WirePayload = { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: [FUTURE_MIGRATION], tables: {}, cursor: {} };

    const response = await send(server, 'POST', `${HUB_ROUTES.push}?device=${DEVICE}`, WRITER, encodeWirePayload(payload));

    expect(response.status).toBe(409);
    const { success, error } = await envelope(response);
    expect(success).toBe(false);
    expect(error).toContain(FUTURE_MIGRATION);
    expect(error).toContain(HUB_UPGRADE);
  });
});
