/**
 * The key routes (`server-keys.ts`): the list, the create answering the
 * plain key once, the pause and the delete, each behind the login; the
 * same-origin and JSON-body checks refusing before the login is asked;
 * the body, name, query, path and method refusals; the store's
 * refusals by status; and no log line holding a key or its digest.
 *
 * Every case opens its own key store in `:memory:` and a stand-in login
 * serving `Authorization: Basic ok` as {@link USER}, counting its checks;
 * the challenge case opens the real basic login over a `:memory:` login
 * store.
 */
import type { HubKeyStore } from './identity/key-store.js';
import type { HubLogin, LoginAnswer } from './login/basic.js';
import type { KeyRouteAnswer } from './server-keys.js';
import type { HubLogEntry } from './server.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { keyDigest, openSqliteKeyStore } from './identity/key-store.js';
import { openSqliteLoginStore } from './identity/login-store.js';
import { BASIC_CHALLENGE, openBasicLogin } from './login/basic.js';
import { isKeyPath, KEYS_ROUTE, MAX_KEY_BODY_BYTES, openKeyRoutes } from './server-keys.js';

const HUB = 'http://hub.test';
const USER = 'ada';
const SIGNED_IN = 'Basic ok';
const JSON_TYPE = 'application/json';
const FIXED_NOW = new Date('2026-11-17T10:00:00.000Z');

/** A request to `path` on the hub, signed in unless `headers` says otherwise. */
function hubRequest(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const sent: Record<string, string> = { authorization: SIGNED_IN, ...headers };
  if (body !== undefined && !('content-type' in sent)) sent['content-type'] = JSON_TYPE;
  const text = body === undefined || typeof body === 'string'
    ? body
    : JSON.stringify(body);
  return new Request(`${HUB}${path}`, { method, headers: sent, body: text });
}

/** The JSON body an answer holds. */
async function bodyOf(answer: KeyRouteAnswer): Promise<Record<string, unknown>> {
  return await answer.response.json() as Record<string, unknown>;
}

let store: HubKeyStore;
let logged: HubLogEntry[];
let checks: number;

/** A login serving {@link SIGNED_IN} as {@link USER}, counting each check. */
const standIn: HubLogin = {
  mode: 'basic',
  check: (request) => {
    checks += 1;
    const answer: LoginAnswer = request.headers.get('authorization') === SIGNED_IN
      ? { served: true, user: USER }
      : { served: false, refusal: { reason: 'unauthenticated', message: 'Sign in.', headers: { 'WWW-Authenticate': BASIC_CHALLENGE } } };
    return Promise.resolve(answer);
  },
};

/** The routes over this case's store, log and login. */
function routes(login: HubLogin = standIn, origins?: readonly string[]) {
  return openKeyRoutes({ login, store, log: (entry) => logged.push(entry), ...origins === undefined
    ? {}
    : { origins } });
}

/** Creates `name` through the routes, answering the plain key. */
async function created(name: string): Promise<string> {
  const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name }));
  expect(answer.response.status).toBe(201);
  const { data } = await bodyOf(answer) as { data: { plain: string } };
  return data.plain;
}

beforeEach(() => {
  store = openSqliteKeyStore({ path: ':memory:', now: () => FIXED_NOW, reservedNames: ['reserved'] });
  logged = [];
  checks = 0;
});

afterEach(() => {
  store.close();
});

describe('isKeyPath', () => {
  it('claims the key list and every path below it, and nothing beside it', () => {
    expect(isKeyPath('/v1/keys')).toBe(true);
    expect(isKeyPath('/v1/keys/ci')).toBe(true);
    expect(isKeyPath('/v1/keys/ci/pause')).toBe(true);
    expect(isKeyPath('/v1/keysmith')).toBe(false);
    expect(isKeyPath('/v1/effort/push')).toBe(false);
  });
});

describe('GET /v1/keys', () => {
  it('lists every key with its name, creator, creation, last use and paused or deleted', async () => {
    await created('ci');
    await created('laptop');
    await store.stampUse('ci');
    await routes().serve(hubRequest('POST', '/v1/keys/laptop/pause', {}));
    await created('old');
    await routes().serve(hubRequest('DELETE', '/v1/keys/old', {}));

    const answer = await routes().serve(hubRequest('GET', KEYS_ROUTE));
    expect(answer.response.status).toBe(200);
    expect(answer.user).toBe(USER);
    const at = FIXED_NOW.toISOString();
    expect(await bodyOf(answer)).toEqual({
      success: true,
      data: {
        keys: [
          { name: 'ci', createdBy: USER, createdAt: at, lastUsedAt: at, paused: false, deleted: false },
          { name: 'laptop', createdBy: USER, createdAt: at, lastUsedAt: null, paused: true, deleted: false },
          { name: 'old', createdBy: USER, createdAt: at, lastUsedAt: null, paused: false, deleted: true },
        ],
      },
    });
  });

  it('answers an empty list on a hub with no key, never cached', async () => {
    const answer = await routes().serve(hubRequest('GET', KEYS_ROUTE));
    expect(await bodyOf(answer)).toEqual({ success: true, data: { keys: [] } });
    expect(answer.response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('POST /v1/keys', () => {
  it('answers 201 with the plain key once, the one the store serves by digest, created by the login user', async () => {
    const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name: 'ci' }));
    expect(answer.response.status).toBe(201);
    expect(answer.response.headers.get('cache-control')).toBe('no-store');
    const { data } = await bodyOf(answer) as { data: { key: { name: string; createdBy: string }; plain: string } };
    expect(data.plain).toMatch(/^rafa_[A-Za-z0-9_-]{43}$/);
    expect(data.key).toMatchObject({ name: 'ci', createdBy: USER, paused: false, deleted: false });
    expect((await store.findByDigest(keyDigest(data.plain)))?.name).toBe('ci');

    const listed = await (await routes().serve(hubRequest('GET', KEYS_ROUTE))).response.text();
    expect(listed).not.toContain(data.plain);
    expect(listed).not.toContain(keyDigest(data.plain));
  });

  it('logs key.created with the name and the login user alone', async () => {
    await created('ci');
    expect(logged).toEqual([{ level: 'info', event: 'key.created', name: 'ci', user: USER }]);
  });

  it('refuses a name a key holds, a deleted one included, with 409', async () => {
    await created('ci');
    await created('gone');
    await routes().serve(hubRequest('DELETE', '/v1/keys/gone', {}));
    for (const name of ['ci', 'gone']) {
      const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name }));
      expect(answer.response.status).toBe(409);
      expect(answer.fields).toMatchObject({ name });
    }
  });

  it('refuses a name off the pattern with 400, never repeating it, and creates nothing', async () => {
    for (const name of ['CI', 'rafa_Secret-Pasted+Key', '', '-ci', 'a'.repeat(65), 7, null]) {
      const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name }));
      expect(answer.response.status).toBe(400);
      const text = await answer.response.text();
      if (typeof name === 'string' && name !== '') expect(text).not.toContain(name);
      expect(JSON.stringify(answer.fields)).not.toContain('Secret');
    }
    expect(await store.list()).toEqual([]);
  });

  it('refuses a name hub.auth.apiKeys holds with 400', async () => {
    const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name: 'reserved' }));
    expect(answer.response.status).toBe(400);
    expect(await store.list()).toEqual([]);
  });

  it('refuses a body with no name, or naming another field, with 400', async () => {
    expect((await routes().serve(hubRequest('POST', KEYS_ROUTE, {}))).response.status).toBe(400);
    const extra = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name: 'ci', createdBy: 'mallory' }));
    expect(extra.response.status).toBe(400);
    expect(await bodyOf(extra)).toEqual({ success: false, error: 'The body names "createdBy"; expected name.' });
    expect(await store.list()).toEqual([]);
  });
});

describe('POST /v1/keys/<name>/pause', () => {
  it('pauses the key, answering its row, and logs key.paused with the name and user alone', async () => {
    await created('ci');
    logged = [];
    const answer = await routes().serve(hubRequest('POST', '/v1/keys/ci/pause', {}));
    expect(answer.response.status).toBe(200);
    expect(await bodyOf(answer)).toMatchObject({ success: true, data: { key: { name: 'ci', paused: true, deleted: false } } });
    expect(answer.fields).toEqual({ name: 'ci' });
    expect(logged).toEqual([{ level: 'info', event: 'key.paused', name: 'ci', user: USER }]);
  });

  it('answers 404 for an unknown key and 409 for a deleted one, logging no pause', async () => {
    await created('gone');
    await routes().serve(hubRequest('DELETE', '/v1/keys/gone', {}));
    logged = [];
    expect((await routes().serve(hubRequest('POST', '/v1/keys/nobody/pause', {}))).response.status).toBe(404);
    expect((await routes().serve(hubRequest('POST', '/v1/keys/gone/pause', {}))).response.status).toBe(409);
    expect(logged).toEqual([]);
  });

  it('refuses a body naming any field with 400, pausing nothing', async () => {
    await created('ci');
    const answer = await routes().serve(hubRequest('POST', '/v1/keys/ci/pause', { name: 'ci' }));
    expect(answer.response.status).toBe(400);
    expect((await store.list())[0]?.paused).toBe(false);
  });
});

describe('DELETE /v1/keys/<name>', () => {
  it('marks the key deleted, keeping it listed with its last use, and logs key.deleted', async () => {
    await created('ci');
    await store.stampUse('ci');
    logged = [];
    const answer = await routes().serve(hubRequest('DELETE', '/v1/keys/ci', {}));
    expect(answer.response.status).toBe(200);
    expect(await bodyOf(answer)).toMatchObject({ data: { key: { name: 'ci', deleted: true, lastUsedAt: FIXED_NOW.toISOString() } } });
    expect(logged).toEqual([{ level: 'info', event: 'key.deleted', name: 'ci', user: USER }]);
    expect(await store.list()).toHaveLength(1);
  });

  it('answers 404 for an unknown key, and 400 for a path name off the pattern', async () => {
    expect((await routes().serve(hubRequest('DELETE', '/v1/keys/nobody', {}))).response.status).toBe(404);
    expect((await routes().serve(hubRequest('DELETE', '/v1/keys/NoBody', {}))).response.status).toBe(400);
    expect((await routes().serve(hubRequest('DELETE', '/v1/keys/%E0%A4%A', {}))).response.status).toBe(400);
  });
});

describe('the same-origin check', () => {
  const mutating: readonly [string, string, unknown][] = [
    ['POST', KEYS_ROUTE, { name: 'ci' }],
    ['POST', '/v1/keys/kept/pause', {}],
    ['DELETE', '/v1/keys/kept', {}],
  ];

  const crossSite: readonly Record<string, string>[] = [
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ];

  it('refuses each mutating route from another site with 403 before the login is asked', async () => {
    await created('kept');
    checks = 0;
    for (const [method, path, body] of mutating) {
      for (const headers of crossSite) {
        const answer = await routes().serve(hubRequest(method, path, body, headers));
        expect(answer.response.status).toBe(403);
        expect(answer.refusal).toBe('forbidden');
      }
    }
    expect(checks).toBe(0);
    expect(await store.list()).toMatchObject([{ name: 'kept', paused: false, deleted: false }]);
  });

  it('serves the hub\'s own origin, no Origin (the CLI) and an origin the opener lists', async () => {
    const proxied = routes(standIn, ['https://hub.example/login/oauth/callback']);
    const own = await proxied.serve(hubRequest('POST', KEYS_ROUTE, { name: 'own' }, { origin: HUB, 'sec-fetch-site': 'same-origin' }));
    const cli = await proxied.serve(hubRequest('POST', KEYS_ROUTE, { name: 'cli' }));
    const listed = await proxied.serve(hubRequest('POST', KEYS_ROUTE, { name: 'listed' }, { origin: 'https://hub.example' }));
    expect([own.response.status, cli.response.status, listed.response.status]).toEqual([201, 201, 201]);
  });

  it('control: the listed origin is refused by routes opened without it', async () => {
    const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name: 'listed' }, { origin: 'https://hub.example' }));
    expect(answer.response.status).toBe(403);
  });

  it('throws at open for an origin that is not a URL', () => {
    expect(() => routes(standIn, ['hub.example'])).toThrow(TypeError);
  });
});

describe('the JSON-body check', () => {
  it('refuses a mutating route sent as a form or text with 415 before the login is asked', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x']) {
      const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, '{"name":"ci"}', { 'content-type': type }));
      expect(answer.response.status).toBe(415);
    }
    const none = new Request(`${HUB}/v1/keys/ci`, { method: 'DELETE', headers: { authorization: SIGNED_IN } });
    expect((await routes().serve(none)).response.status).toBe(415);
    expect(checks).toBe(0);
    expect(await store.list()).toEqual([]);
  });

  it('takes application/json with parameters, in any case', async () => {
    const answer = await routes().serve(hubRequest('POST', KEYS_ROUTE, { name: 'ci' }, { 'content-type': 'Application/JSON; charset=utf-8' }));
    expect(answer.response.status).toBe(201);
  });

  it('refuses a body that is not JSON, not an object, or over the cap with 400', async () => {
    for (const body of ['{"name":', '["ci"]', 'null', '"ci"', '']) {
      expect((await routes().serve(hubRequest('POST', KEYS_ROUTE, body))).response.status).toBe(400);
    }
    const big = JSON.stringify({ name: 'ci', pad: 'x'.repeat(MAX_KEY_BODY_BYTES) });
    expect((await routes().serve(hubRequest('POST', KEYS_ROUTE, big))).response.status).toBe(400);
    expect(await store.list()).toEqual([]);
  });
});

describe('the login', () => {
  it('answers 401 with the basic login\'s challenge for a request it does not serve', async () => {
    const logins = openSqliteLoginStore({ path: ':memory:' });
    try {
      await logins.setLogin(USER, 'right password');
      const login = openBasicLogin({ store: logins });
      const wrong = `Basic ${Buffer.from(`${USER}:wrong`).toString('base64')}`;
      const answer = await routes(login).serve(hubRequest('POST', KEYS_ROUTE, { name: 'ci' }, { authorization: wrong }));
      expect(answer.response.status).toBe(401);
      expect(answer.refusal).toBe('unauthenticated');
      expect(answer.response.headers.get('www-authenticate')).toBe(BASIC_CHALLENGE);
      expect(await store.list()).toEqual([]);

      const right = `Basic ${Buffer.from(`${USER}:right password`).toString('base64')}`;
      expect((await routes(login).serve(hubRequest('GET', KEYS_ROUTE, undefined, { authorization: right }))).response.status).toBe(200);
    } finally {
      logins.close();
    }
  });

  it('answers 503 when the login is unavailable', async () => {
    const down: HubLogin = {
      mode: 'basic',
      check: () => Promise.resolve({ served: false, refusal: { reason: 'unavailable', message: 'Down.', headers: {} } }),
    };
    const answer = await routes(down).serve(hubRequest('GET', KEYS_ROUTE));
    expect(answer.response.status).toBe(503);
    expect(answer.refusal).toBe('unavailable');
  });
});

describe('paths, methods and queries', () => {
  it('answers 404 for a path below /v1/keys no route serves', async () => {
    for (const path of ['/v1/keys/', '/v1/keys/ci/resume', '/v1/keys/ci/pause/now']) {
      expect((await routes().serve(hubRequest('POST', path, {}))).response.status).toBe(404);
    }
  });

  it('answers 405 with Allow for another method, asking no login', async () => {
    const list = await routes().serve(hubRequest('PUT', KEYS_ROUTE, {}));
    expect(list.response.status).toBe(405);
    expect(list.response.headers.get('allow')).toBe('GET, POST');
    expect((await routes().serve(hubRequest('GET', '/v1/keys/ci'))).response.headers.get('allow')).toBe('DELETE');
    expect((await routes().serve(hubRequest('GET', '/v1/keys/ci/pause'))).response.headers.get('allow')).toBe('POST');
    expect(checks).toBe(0);
  });

  it('refuses any query parameter with 400', async () => {
    const answer = await routes().serve(hubRequest('GET', `${KEYS_ROUTE}?deleted=false`));
    expect(answer.response.status).toBe(400);
    expect(checks).toBe(0);
  });
});

describe('store errors and logs', () => {
  it('rejects on a store error no route expects, for the server to answer 500', async () => {
    store = { ...store, list: () => Promise.reject(new Error('disk gone')) };
    await expect(routes().serve(hubRequest('GET', KEYS_ROUTE))).rejects.toThrow('disk gone');
  });

  it('logs no key and no digest over a create, pause and delete', async () => {
    const plain = await created('ci');
    await routes().serve(hubRequest('POST', '/v1/keys/ci/pause', {}));
    await routes().serve(hubRequest('DELETE', '/v1/keys/ci', {}));
    expect(logged.map(({ event }) => event)).toEqual(['key.created', 'key.paused', 'key.deleted']);
    const lines = logged.map((entry) => JSON.stringify(entry)).join('\n');
    expect(lines).not.toContain(plain);
    expect(lines).not.toContain(keyDigest(plain));
    expect(lines).not.toContain('rafa_');
  });
});
