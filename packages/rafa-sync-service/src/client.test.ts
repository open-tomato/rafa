/**
 * Tests for the hub HTTP client (`client.ts`), each against a
 * `Bun.serve` stand-in on a free port rather than the real hub: what
 * each call sends and reads, and which of unreachable, refused and
 * malformed each failure is, the one status read a client keeps for
 * its push and pull, the project it sends only to a hub naming
 * `projects`, the projected pull's `migrations` field and the `missing`
 * a `409` names. Every unreachable reading is paired with a
 * control on the same client that proves the call could have succeeded.
 */
import type { HubClient, HubClientOptions } from './client.js';
import type { WirePayload } from '@open-tomato/rafa/store';

import { WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, describe, expect, it } from 'bun:test';

import { createHubClient, HUB_UNREACHABLE, HubAnswerMalformed, HubRefused, HubUnreachable, projectNameOf, UNNAMED_CONTRACT_VERSION } from './client.js';

const TOKEN = 'ghp_client_test_token';

/** Short enough to keep the suite quick, long enough for a local answer. */
const TIMEOUT_MS = 200;

const PAYLOAD: WirePayload = {
  format: WIRE_FORMAT,
  version: WIRE_VERSION,
  migrations: ['0001-init'],
  tables: { commits: [{ seq: 1, origin_store: 'dev-b', origin_seq: 1, row_json: '{}' }] },
  cursor: { commits: 1 },
};

/** A status answer of a hub one release behind: no contractVersion, no capabilities. */
const STATUS = {
  version: '0.0.0',
  migrations: ['0001-init'],
  rows: { commits: 3 },
  devices: [{ device: 'dev-a', lastPushAt: '2026-10-01T00:00:00.000Z' }],
};

/** The project fields a status answer naming no `projects` reads as. */
const NO_PROJECTS = { projects: [], projectsNamed: false };

/** What {@link STATUS} reads as: version 1, no capability, the version unnamed. */
const STATUS_READ = { ...STATUS, contractVersion: UNNAMED_CONTRACT_VERSION, capabilities: {}, contractNamed: false, ...NO_PROJECTS };

const CAPABILITIES = { fts: false, vector: false, graph: false, projection: true };

/** A status answer of a hub naming its contract. */
const CONTRACT_STATUS = { ...STATUS, contractVersion: WIRE_CONTRACT_VERSION, capabilities: CAPABILITIES };

/** What {@link CONTRACT_STATUS} reads as. */
const CONTRACT_STATUS_READ = { ...CONTRACT_STATUS, contractNamed: true, ...NO_PROJECTS };

/** A project's root commit sha, as a port names it. */
const PROJECT = 'a'.repeat(40);

/** The projects a hub serving two names on its status. */
const PROJECTS = [{ id: PROJECT, name: 'octo/one' }, { id: 'b'.repeat(40), name: 'octo/two' }];

/** A status answer of a hub naming its contract and the projects it serves. */
const PROJECTS_STATUS = { ...CONTRACT_STATUS, projects: PROJECTS };

/** One request a stand-in saw. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly authorization: string | null;
  readonly body: string;
}

/** A running stand-in, with the requests it saw. */
interface StandIn {
  readonly url: string;
  readonly seen: Seen[];
}

const servers: { stop: (force?: boolean) => unknown }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) void server.stop(true);
});

/** Starts a stand-in answering every request with `answer`, recording each. */
function standIn(answer: (request: Request) => Response | Promise<Response>): StandIn {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authorization: request.headers.get('authorization'),
        body: await request.text(),
      });
      return answer(request);
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${String(server.port)}`, seen };
}

/** Answers `/v1/status` with `status` and every other route with `answer`. */
function behind(answer: (request: Request) => Response | Promise<Response>, status: unknown = STATUS) {
  return (request: Request): Response | Promise<Response> => (new URL(request.url).pathname.endsWith('/v1/status')
    ? success(status)
    : answer(request));
}

/** The requests `hub` saw past its status reads. */
function pastStatus(hub: StandIn): Seen[] {
  return hub.seen.filter(({ path }) => !path.endsWith('/v1/status'));
}

/** A success envelope holding `data`. */
function success(data: unknown): Response {
  return Response.json({ success: true, data });
}

/** A failure envelope of `status` saying `error`. */
function failure(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status });
}

/** A client of the hub at `url`. */
function clientOf(url: string, options: Partial<HubClientOptions> = {}): HubClient {
  return createHubClient({ url, token: TOKEN, timeoutMs: TIMEOUT_MS, ...options });
}

/** What `call` rejected with. */
async function rejectionOf(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-error: ${String(error)}`);
  }
  throw new Error('the call resolved');
}

/** A port nothing listens on: one a stand-in held and gave back. */
async function closedPort(): Promise<number> {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = server.port ?? 0;
  await server.stop(true);
  return port;
}

describe('push', () => {
  it('posts the encoded payload under device with the bearer token, answering the push', async () => {
    const hub = standIn(behind(() => success({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' })));
    const answer = await clientOf(hub.url).push('dev-a', PAYLOAD);
    expect(answer).toEqual({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' });
    expect(pastStatus(hub)).toEqual([{
      method: 'POST',
      path: '/v1/effort/push',
      query: { device: 'dev-a' },
      authorization: `Bearer ${TOKEN}`,
      body: JSON.stringify(PAYLOAD),
    }]);
  });

  it('refuses a push answer missing a count as malformed', async () => {
    const hub = standIn(behind(() => success({ received: 1, at: 'now' })));
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe('the hub\'s answer to push holds no received, added and at');
  });
});

describe('pull', () => {
  it('leaves since out for an empty cursor and answers the decoded payload', async () => {
    const hub = standIn(behind(() => success(PAYLOAD)));
    const payload = await clientOf(hub.url).pull('dev-a', {});
    expect(payload).toEqual(PAYLOAD);
    expect(pastStatus(hub).map(({ method, path, query }) => ({ method, path, query })))
      .toEqual([{ method: 'GET', path: '/v1/effort/pull', query: { device: 'dev-a' } }]);
  });

  it('sends a cursor as JSON in since', async () => {
    const hub = standIn(behind(() => success(PAYLOAD)));
    await clientOf(hub.url).pull('dev-a', { commits: 12, sessions: 3 });
    expect(pastStatus(hub)[0]?.query).toEqual({ device: 'dev-a', since: '{"commits":12,"sessions":3}' });
  });

  it('refuses an answer the wire codec cannot read as malformed, naming the codec\'s fault', async () => {
    const hub = standIn(behind(() => success({ ...PAYLOAD, version: 99 })));
    const error = await rejectionOf(clientOf(hub.url).pull('dev-a', {}));
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe('the hub\'s answer to pull is not a wire payload: wire: version is 99; this rafa reads version 1');
  });
});

describe('status', () => {
  it('gets the status route and answers the hub\'s status', async () => {
    const hub = standIn(() => success(CONTRACT_STATUS));
    expect(await clientOf(hub.url).status()).toEqual(CONTRACT_STATUS_READ);
    expect(hub.seen.map(({ method, path, query }) => ({ method, path, query })))
      .toEqual([{ method: 'GET', path: '/v1/status', query: {} }]);
  });

  it('refuses a status answer whose devices are not devices as malformed', async () => {
    const hub = standIn(() => success({ ...STATUS, devices: ['dev-a'] }));
    await expect(clientOf(hub.url).status()).rejects.toBeInstanceOf(HubAnswerMalformed);
  });

  it('reads an answer naming no contractVersion or capabilities as version 1 with none, where a named one is kept', async () => {
    const behindHub = standIn(() => success(STATUS));
    const naming = standIn(() => success({ ...STATUS, contractVersion: 2, capabilities: CAPABILITIES }));
    expect(await clientOf(behindHub.url).status()).toEqual(STATUS_READ);
    expect(await clientOf(naming.url).status())
      .toEqual({ ...STATUS, contractVersion: 2, capabilities: CAPABILITIES, contractNamed: true, ...NO_PROJECTS });
  });

  it('keeps a version 0 the hub names, for the caller to judge', async () => {
    const hub = standIn(() => success({ ...STATUS, contractVersion: 0 }));
    expect(await clientOf(hub.url).status()).toMatchObject({ contractVersion: 0, contractNamed: true, capabilities: {} });
  });

  it.each([
    ['a contractVersion that is not a whole number', { contractVersion: 1.5 }],
    ['a contractVersion spelt as text', { contractVersion: '1' }],
    ['capabilities that are not booleans', { contractVersion: 1, capabilities: { fts: 'yes' } }],
  ])('refuses a status answer with %s as malformed', async (_label: string, fields: Record<string, unknown>) => {
    const hub = standIn(() => success({ ...STATUS, ...fields }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe('the hub\'s answer to status holds a contractVersion that is not a whole number or capabilities that are not booleans');
  });
});

describe('the contract version', () => {
  /** A hub answering `status` on the status route and a push or pull answer on the others. */
  function syncHub(status: unknown): StandIn {
    return standIn(behind((request) => (request.method === 'POST'
      ? success({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' })
      : success(PAYLOAD)), status));
  }

  it('reads the status once over a push then a pull, sending this rafa\'s contractVersion on both', async () => {
    const hub = syncHub(CONTRACT_STATUS);
    const client = clientOf(hub.url);
    await client.push('dev-a', PAYLOAD);
    await client.pull('dev-a', { commits: 1 });
    expect(await client.status()).toEqual(CONTRACT_STATUS_READ);
    expect(hub.seen.map(({ path, query }) => ({ path, query }))).toEqual([
      { path: '/v1/status', query: {} },
      { path: '/v1/effort/push', query: { device: 'dev-a', contractVersion: String(WIRE_CONTRACT_VERSION) } },
      { path: '/v1/effort/pull', query: { device: 'dev-a', since: '{"commits":1}', contractVersion: String(WIRE_CONTRACT_VERSION) } },
    ]);
  });

  it('reads the status again on a second client, so the answer is kept per client', async () => {
    const hub = syncHub(CONTRACT_STATUS);
    await clientOf(hub.url).push('dev-a', PAYLOAD);
    await clientOf(hub.url).pull('dev-a', {});
    expect(hub.seen.filter(({ path }) => path === '/v1/status')).toHaveLength(2);
  });

  it('sends no contractVersion on push or pull to a hub naming none', async () => {
    const hub = syncHub(STATUS);
    const client = clientOf(hub.url);
    await client.push('dev-a', PAYLOAD);
    await client.pull('dev-a', {});
    expect(hub.seen.map(({ path, query }) => ({ path, query }))).toEqual([
      { path: '/v1/status', query: {} },
      { path: '/v1/effort/push', query: { device: 'dev-a' } },
      { path: '/v1/effort/pull', query: { device: 'dev-a' } },
    ]);
  });

  it('sends no push when the status read fails, and reads the status again on the next call', async () => {
    let up = false;
    const hub = standIn((request) => (up || !new URL(request.url).pathname.endsWith('/v1/status')
      ? behind(() => success({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' }), CONTRACT_STATUS)(request)
      : failure(503, 'down')));
    const client = clientOf(hub.url);
    const error = await rejectionOf(client.push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toBe('the hub answered status with HTTP 503: down');
    expect(pastStatus(hub)).toEqual([]);

    up = true;
    await client.push('dev-a', PAYLOAD);
    expect(hub.seen.map(({ path }) => path)).toEqual(['/v1/status', '/v1/status', '/v1/effort/push']);
  });
});

describe('the projected pull', () => {
  const MIGRATIONS = ['0001-init', '0002-sessions'];

  /** A payload a hub projected: `sessions` cut to a schema lacking `0003-worktree`. */
  const PROJECTED: WirePayload = { ...PAYLOAD, projected: { sessions: ['0003-worktree'] } };

  it('sends this store\'s migrations, comma-separated, to a hub whose status answered projection: true', async () => {
    const hub = standIn(behind(() => success(PAYLOAD), CONTRACT_STATUS));
    await clientOf(hub.url).pull('dev-a', { commits: 1 }, { migrations: MIGRATIONS });
    expect(pastStatus(hub)[0]?.query).toEqual({
      device: 'dev-a',
      since: '{"commits":1}',
      contractVersion: String(WIRE_CONTRACT_VERSION),
      migrations: '0001-init,0002-sessions',
    });
  });

  it.each([
    ['a hub one release behind', STATUS],
    ['a hub answering projection: false', { ...CONTRACT_STATUS, capabilities: { ...CAPABILITIES, projection: false } }],
    ['a hub naming no projection capability', { ...CONTRACT_STATUS, capabilities: { fts: true } }],
  ])('sends no migrations to %s', async (_label: string, status: unknown) => {
    const hub = standIn(behind(() => success(PAYLOAD), status));
    await clientOf(hub.url).pull('dev-a', {}, { migrations: MIGRATIONS });
    expect(pastStatus(hub)[0]?.query).not.toHaveProperty('migrations');
    expect(pastStatus(hub)).toHaveLength(1);
  });

  it('sends no migrations on a pull that does not ask for projection, to a hub that projects', async () => {
    const hub = standIn(behind(() => success(PAYLOAD), CONTRACT_STATUS));
    await clientOf(hub.url).pull('dev-a', {});
    expect(pastStatus(hub)[0]?.query).toEqual({ device: 'dev-a', contractVersion: String(WIRE_CONTRACT_VERSION) });
  });

  it('reads the answer\'s projected map, and a whole answer as holding none', async () => {
    const projecting = standIn(behind(() => success(PROJECTED), CONTRACT_STATUS));
    const whole = standIn(behind(() => success(PAYLOAD), CONTRACT_STATUS));
    const projected = await clientOf(projecting.url).pull('dev-a', {}, { migrations: MIGRATIONS });
    const unprojected = await clientOf(whole.url).pull('dev-a', {}, { migrations: MIGRATIONS });
    expect(projected.projected).toEqual({ sessions: ['0003-worktree'] });
    expect(unprojected.projected).toBeUndefined();
  });

  it('refuses a projected map naming an id the payload holds as malformed', async () => {
    const hub = standIn(behind(() => success({ ...PAYLOAD, projected: { sessions: ['0001-init'] } }), CONTRACT_STATUS));
    const error = await rejectionOf(clientOf(hub.url).pull('dev-a', {}, { migrations: MIGRATIONS }));
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toStartWith('the hub\'s answer to pull is not a wire payload: wire: projected.sessions names 0001-init');
  });
});

describe('the migration refusal', () => {
  const SAID = 'The hub lacks migration 0002-x; upgrade the hub.';

  /** A hub refusing every push or pull with a `409` whose envelope adds `fields`. */
  function refusing(fields: Record<string, unknown>): StandIn {
    return standIn(behind(() => Response.json({ success: false, error: SAID, ...fields }, { status: 409 }), CONTRACT_STATUS));
  }

  it('reads missing off a 409 into the refusal, its message as it stands', async () => {
    const hub = refusing({ missing: ['0002-x', '0003-y'] });
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubRefused);
    expect((error as HubRefused).missing).toEqual(['0002-x', '0003-y']);
    expect(error.message).toBe(`the hub refused push: HTTP 409: ${SAID}`);
  });

  it('reads missing off a 409 refusing a projected pull', async () => {
    const hub = refusing({ missing: ['0003-y'] });
    const error = await rejectionOf(clientOf(hub.url).pull('dev-a', {}, { migrations: ['0001-init'] }));
    expect((error as HubRefused).missing).toEqual(['0003-y']);
  });

  it.each([
    ['names no missing', {}],
    ['names a missing that is not a list of ids', { missing: '0002-x' }],
    ['names a missing holding an empty id', { missing: [''] }],
  ])('carries no missing for a 409 that %s, its message as it stands', async (_label: string, fields: Record<string, unknown>) => {
    const hub = refusing(fields);
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubRefused);
    expect((error as HubRefused).missing).toBeUndefined();
    expect(error.message).toBe(`the hub refused push: HTTP 409: ${SAID}`);
  });

  it('reads no missing off a refusal that is not a 409', async () => {
    const hub = standIn(behind(() => Response.json({ success: false, error: 'no', missing: ['0002-x'] }, { status: 400 })));
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect((error as HubRefused).status).toBe(400);
    expect((error as HubRefused).missing).toBeUndefined();
  });
});

describe('the project', () => {
  /** A hub answering `status` on the status route and a push or pull answer on the others. */
  function syncHub(status: unknown): StandIn {
    return standIn(behind((request) => (request.method === 'POST'
      ? success({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' })
      : success(PAYLOAD)), status));
  }

  /** The path and query of each request `hub` saw past its status reads. */
  function queries(hub: StandIn): { path: string; query: Record<string, string> }[] {
    return pastStatus(hub).map(({ path, query }) => ({ path, query }));
  }

  it('reads the projects a status answer names, by id and name in its order', async () => {
    const hub = standIn(() => success(PROJECTS_STATUS));
    expect(await clientOf(hub.url).status()).toEqual({ ...CONTRACT_STATUS_READ, projects: PROJECTS, projectsNamed: true });
  });

  it('reads an empty projects list as named, where an answer naming none reads as unnamed', async () => {
    const empty = standIn(() => success({ ...CONTRACT_STATUS, projects: [] }));
    const none = standIn(() => success(CONTRACT_STATUS));
    expect(await clientOf(empty.url).status()).toMatchObject({ projects: [], projectsNamed: true });
    expect(await clientOf(none.url).status()).toMatchObject({ projects: [], projectsNamed: false });
  });

  it('keeps only the id and name of each project', async () => {
    const hub = standIn(() => success({ ...CONTRACT_STATUS, projects: [{ id: PROJECT, name: 'octo/one', storePath: '/srv/one' }] }));
    expect((await clientOf(hub.url).status()).projects).toEqual([{ id: PROJECT, name: 'octo/one' }]);
  });

  it.each([
    ['an object', { id: PROJECT, name: 'octo/one' }],
    ['a list of ids', [PROJECT]],
    ['an entry with no name', [{ id: PROJECT }]],
    ['an entry whose id is a number', [{ id: 1, name: 'octo/one' }]],
    ['an entry whose name is null', [{ id: PROJECT, name: null }]],
    ['null', null],
  ])('refuses a status answer whose projects is %s as malformed', async (_label: string, projects: unknown) => {
    const hub = standIn(() => success({ ...CONTRACT_STATUS, projects }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe('the hub\'s answer to status holds projects that are not a list of id and name strings');
  });

  it('sends project on push and pull to a hub naming projects, the status read once', async () => {
    const hub = syncHub(PROJECTS_STATUS);
    const client = clientOf(hub.url, { project: PROJECT });
    await client.push('dev-a', PAYLOAD);
    await client.pull('dev-a', { commits: 1 });
    const contractVersion = String(WIRE_CONTRACT_VERSION);
    expect(hub.seen.filter(({ path }) => path === '/v1/status')).toHaveLength(1);
    expect(queries(hub)).toEqual([
      { path: '/v1/effort/push', query: { device: 'dev-a', project: PROJECT, contractVersion } },
      { path: '/v1/effort/pull', query: { device: 'dev-a', since: '{"commits":1}', project: PROJECT, contractVersion } },
    ]);
  });

  it('sends project to a hub naming an empty projects list', async () => {
    const hub = syncHub({ ...CONTRACT_STATUS, projects: [] });
    await clientOf(hub.url, { project: PROJECT }).pull('dev-a', {});
    expect(queries(hub)[0]?.query).toMatchObject({ project: PROJECT });
  });

  it('sends no project on push or pull to a hub naming no projects, where one naming them is sent it', async () => {
    const hub = syncHub(CONTRACT_STATUS);
    const client = clientOf(hub.url, { project: PROJECT });
    await client.push('dev-a', PAYLOAD);
    await client.pull('dev-a', {});
    const contractVersion = String(WIRE_CONTRACT_VERSION);
    expect(queries(hub)).toEqual([
      { path: '/v1/effort/push', query: { device: 'dev-a', contractVersion } },
      { path: '/v1/effort/pull', query: { device: 'dev-a', contractVersion } },
    ]);

    const naming = syncHub(PROJECTS_STATUS);
    await clientOf(naming.url, { project: PROJECT }).push('dev-a', PAYLOAD);
    expect(queries(naming)[0]?.query).toMatchObject({ project: PROJECT });
  });

  it('sends no project from a client made with none, even to a hub naming projects', async () => {
    const hub = syncHub(PROJECTS_STATUS);
    const client = clientOf(hub.url);
    await client.push('dev-a', PAYLOAD);
    await client.pull('dev-a', {});
    expect(queries(hub).map(({ query }) => 'project' in query)).toEqual([false, false]);
  });

  it('sends no push when the status answer\'s projects are malformed', async () => {
    const hub = syncHub({ ...CONTRACT_STATUS, projects: [PROJECT] });
    const error = await rejectionOf(clientOf(hub.url, { project: PROJECT }).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(pastStatus(hub)).toEqual([]);
  });
});

describe('the project name', () => {
  /** The status reads `hub` saw. */
  function statusReads(hub: StandIn): Seen[] {
    return hub.seen.filter(({ path }) => path === '/v1/status');
  }

  it('answers the name of the client\'s project among the two a hub serves', async () => {
    const hub = standIn(() => success(PROJECTS_STATUS));
    expect(await clientOf(hub.url, { project: PROJECT }).projectName()).toBe('octo/one');
    expect(await clientOf(hub.url, { project: 'b'.repeat(40) }).projectName()).toBe('octo/two');
  });

  it('answers null for a project the hub does not serve, where a served one is named', async () => {
    const hub = standIn(() => success(PROJECTS_STATUS));
    expect(await clientOf(hub.url, { project: 'c'.repeat(40) }).projectName()).toBeNull();
    expect(await clientOf(hub.url, { project: PROJECT }).projectName()).toBe('octo/one');
  });

  it('answers null from a hub naming no projects and from a client made with none', async () => {
    const none = standIn(() => success(CONTRACT_STATUS));
    const serving = standIn(() => success(PROJECTS_STATUS));
    expect(await clientOf(none.url, { project: PROJECT }).projectName()).toBeNull();
    expect(await clientOf(serving.url).projectName()).toBeNull();
  });

  it('reads the kept status answer: one status request across status, projectName, push and pull', async () => {
    const hub = standIn(behind((request) => (request.method === 'POST'
      ? success({ received: 1, added: 1, at: '2026-10-01T00:00:00.000Z' })
      : success(PAYLOAD)), PROJECTS_STATUS));
    const client = clientOf(hub.url, { project: PROJECT });
    expect(await client.projectName()).toBe('octo/one');
    await client.push('dev-a', PAYLOAD);
    await client.pull('dev-a', {});
    await client.status();
    expect(await client.projectName()).toBe('octo/one');
    expect(statusReads(hub)).toHaveLength(1);
    expect(pastStatus(hub)).toHaveLength(2);
  });

  it('reads the status again after a failed read, as status does', async () => {
    let reads = 0;
    const hub = standIn(() => (++reads === 1
      ? failure(500, 'down')
      : success(PROJECTS_STATUS)));
    const client = clientOf(hub.url, { project: PROJECT });
    expect(await rejectionOf(client.projectName())).toBeInstanceOf(HubUnreachable);
    expect(await client.projectName()).toBe('octo/one');
    expect(statusReads(hub)).toHaveLength(2);
  });
});

describe('projectNameOf', () => {
  const answer = { ...CONTRACT_STATUS_READ, projects: PROJECTS, projectsNamed: true };

  it('picks the entry whose id is the project, and null for an unknown or absent one', () => {
    expect(projectNameOf(answer, 'b'.repeat(40))).toBe('octo/two');
    expect(projectNameOf(answer, 'c'.repeat(40))).toBeNull();
    expect(projectNameOf(answer, undefined)).toBeNull();
    expect(projectNameOf(CONTRACT_STATUS_READ, PROJECT)).toBeNull();
  });
});

describe('the address', () => {
  it.each(['/rafa', '/rafa/'])('keeps the path prefix of a hub.url ending %s', async (suffix: string) => {
    const hub = standIn(() => success(STATUS));
    await clientOf(`${hub.url}${suffix}`).status();
    expect(hub.seen[0]?.path).toBe('/rafa/v1/status');
  });
});

describe('unreachable', () => {
  it('rejects a connect failure as HubUnreachable, where a listening hub on the same client answers', async () => {
    const port = await closedPort();
    const error = await rejectionOf(clientOf(`http://127.0.0.1:${String(port)}`).status());
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.name).toBe(HUB_UNREACHABLE);
    expect(error.message).toStartWith('could not reach the hub for status: ');

    const hub = standIn(() => success(STATUS));
    expect(await clientOf(hub.url).status()).toEqual(STATUS_READ);
  });

  it('aborts a hub that never answers once hub.timeout passes', async () => {
    const hub = standIn(() => new Promise<Response>(() => {}));
    const started = performance.now();
    const error = await rejectionOf(clientOf(hub.url).status());
    const elapsed = performance.now() - started;
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toBe(`the hub did not answer status within ${String(TIMEOUT_MS)} ms`);
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 5);
    expect(elapsed).toBeLessThan(TIMEOUT_MS * 10);
  });

  it('aborts a hub that sends its headers and then stalls the body', async () => {
    const stalled = new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode('{"success":')) });
    const hub = standIn(() => new Response(stalled, { headers: { 'content-type': 'application/json' } }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toBe(`the hub did not answer status within ${String(TIMEOUT_MS)} ms`);
  });

  it('lets a slow hub answer within a longer hub.timeout', async () => {
    const hub = standIn(async () => {
      await Bun.sleep(TIMEOUT_MS / 2);
      return success(STATUS);
    });
    expect(await clientOf(hub.url).status()).toEqual(STATUS_READ);
  });

  it.each([500, 502, 503])('rejects a %i as HubUnreachable, quoting the hub\'s line', async (status: number) => {
    const hub = standIn(behind(() => failure(status, 'The hub\'s store did not open.')));
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toBe(`the hub answered push with HTTP ${String(status)}: The hub's store did not open.`);
  });

  it('names the status alone for a 5xx with no envelope', async () => {
    const hub = standIn(() => new Response('Bad Gateway', { status: 502 }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error.message).toBe('the hub answered status with HTTP 502');
  });
});

describe('refused', () => {
  it.each([
    [401, 'Send a GitHub token as Authorization: Bearer.'],
    [403, 'octocat may not take effort.push on this hub.'],
    [409, 'The hub lacks migration 0002-x; upgrade the hub.'],
    [400, 'The query names "cursor"; expected device, since.'],
  ])('rejects a %i as HubRefused, never HubUnreachable, quoting the hub\'s line', async (status: number, said: string) => {
    const hub = standIn(behind(() => failure(status, said)));
    const error = await rejectionOf(clientOf(hub.url).push('dev-a', PAYLOAD));
    expect(error).toBeInstanceOf(HubRefused);
    expect(error.name).not.toBe(HUB_UNREACHABLE);
    expect((error as HubRefused).status).toBe(status);
    expect(error.message).toBe(`the hub refused push: HTTP ${String(status)}: ${said}`);
  });

  it('refuses a redirect without following it, so the token never reaches its target', async () => {
    const target = standIn(() => success(STATUS));
    const hub = standIn(() => new Response(null, { status: 307, headers: { location: `${target.url}/v1/status` } }));
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubRefused);
    expect(error.message).toBe(`the hub answered status with a redirect (HTTP 307) to ${target.url}/v1/status;`
      + ' set hub.url to the address the hub serves');
    expect(target.seen).toEqual([]);

    await clientOf(target.url).status();
    expect(target.seen).toHaveLength(1);
  });
});

describe('malformed', () => {
  it.each([
    ['not JSON', () => new Response('<html>ok</html>'), 'the hub\'s answer to status is not JSON'],
    ['a failure envelope under 200', () => Response.json({ success: false, error: 'x' }), 'the hub\'s answer to status is not a success envelope'],
    ['an envelope with no data', () => Response.json({ success: true }), 'the hub\'s answer to status is not a success envelope'],
  ])('rejects %s as HubAnswerMalformed', async (_label: string, answer: () => Response, message: string) => {
    const hub = standIn(answer);
    const error = await rejectionOf(clientOf(hub.url).status());
    expect(error).toBeInstanceOf(HubAnswerMalformed);
    expect(error.message).toBe(message);
  });
});

describe('the token', () => {
  it('reaches no message of any failure', async () => {
    const port = await closedPort();
    const refusing = standIn(() => failure(401, 'no'));
    const failing = standIn(() => failure(503, 'down'));
    const errors = await Promise.all([
      rejectionOf(clientOf(`http://127.0.0.1:${String(port)}`).status()),
      rejectionOf(clientOf(refusing.url).status()),
      rejectionOf(clientOf(failing.url).status()),
    ]);
    expect(errors.map((error) => error.message.includes(TOKEN))).toEqual([false, false, false]);
    expect(refusing.seen[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });
});
