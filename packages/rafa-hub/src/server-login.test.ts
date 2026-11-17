/**
 * The login routes (`server-login.ts`): the key page under the basic
 * login, listing each key's last use and its actions, with every string
 * from the store and the login HTML-escaped; the page's refusals; and
 * the OAuth start, callback and logout against the stand-in provider
 * (`login/testdata/stand-in-oauth.ts`), the callback's cookie serving
 * the next same-site request to `/login`.
 *
 * The server cases start `server.ts` on a free loopback port with the
 * routes handed in through its `login` and `keys` options, beside the
 * store-backed api-key identity over the same key store: a login's basic
 * credentials and its session cookie, each served on `/login` and
 * `/v1/keys`, are refused `unauthenticated` on `POST /v1/effort/push`,
 * where a store key is served.
 *
 * Every case opens its own key store and login store in `:memory:`, and
 * the OAuth cases a provider of their own, so no case reads another's
 * keys or session.
 */
import type { HubKey, HubKeyStore } from './identity/key-store.js';
import type { HubLoginStore } from './identity/login-store.js';
import type { HubLogin } from './login/basic.js';
import type { OAuthLogin } from './login/oauth.js';
import type { StandInOAuth } from './login/testdata/stand-in-oauth.js';
import type { LoginRouteAnswer } from './server-login.js';
import type { HubLogEntry, HubServer } from './server.js';

import { encodeWirePayload, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openApiKeyIdentity } from './identity/api-key.js';
import { openSqliteKeyStore } from './identity/key-store.js';
import { openSqliteLoginStore } from './identity/login-store.js';
import { BASIC_CHALLENGE, openBasicLogin } from './login/basic.js';
import { OAUTH_SESSION_COOKIE, openOAuthLogin } from './login/oauth.js';
import { startStandInOAuth } from './login/testdata/stand-in-oauth.js';
import { KEYS_ROUTE, openKeyRoutes } from './server-keys.js';
import {
  escapeHtml,
  isLoginPath,
  LOGIN_ROUTE,
  LOGOUT_ROUTE,
  OAUTH_CALLBACK_ROUTE,
  OAUTH_START_ROUTE,
  openLoginRoutes,
} from './server-login.js';
import { AUTH_CHALLENGE, HUB_ROUTES, INTERNAL_ERROR, startHubServer } from './server.js';
import { openMemoryHubStore } from './store/testdata/memory-store.js';

const HUB = 'http://127.0.0.1:7171';
const USER = 'ada';
const PASSWORD = 'correct horse battery staple';
const SIGNED_IN = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
const STAMPED = new Date('2026-11-17T10:00:00.000Z');
const CLIENT_ID = 'rafa-hub-login-routes-client';
const CLIENT_SECRET = 'stand-in-client-secret-0002';
const SECRET_VARIABLE = 'RAFA_HUB_LOGIN_ROUTES_SECRET';
const ALLOWED = { id: 583231, login: 'ada' };

/** A request to `path` on the hub. */
function hubRequest(path: string, init: { readonly method?: string; readonly headers?: Record<string, string> } = {}): Request {
  return new Request(`${HUB}${path}`, { method: init.method ?? 'GET', headers: init.headers ?? {} });
}

/** The page text an answer holds. */
async function textOf(answer: LoginRouteAnswer): Promise<string> {
  return await answer.response.text();
}

/** A store listing `keys` alone, for rows the real store would refuse to hold. */
function listingStore(keys: readonly HubKey[]): HubKeyStore {
  const unused = (): Promise<never> => Promise.reject(new Error('not called by the page'));
  return { create: unused, findByDigest: unused, pause: unused, delete: unused, stampUse: unused, list: () => Promise.resolve(keys), close: () => undefined };
}

let store: HubKeyStore;
let logins: HubLoginStore;
let logged: HubLogEntry[];
let now: Date;

/** The routes over this case's stores and log, behind `login`. */
function routes(login: HubLogin, keys: HubKeyStore = store) {
  return openLoginRoutes({ login, store: keys, log: (entry) => logged.push(entry) });
}

/** The basic login over this case's login store, its login set. */
async function basicLogin(user = USER): Promise<HubLogin> {
  await logins.setLogin(user, PASSWORD);
  return openBasicLogin({ store: logins });
}

beforeEach(() => {
  now = STAMPED;
  store = openSqliteKeyStore({ path: ':memory:', now: () => now });
  logins = openSqliteLoginStore({ path: ':memory:' });
  logged = [];
});

afterEach(() => {
  store.close();
  logins.close();
});

describe('isLoginPath and escapeHtml', () => {
  it('claims the page and every path below it, and nothing beside it', () => {
    expect(isLoginPath('/login')).toBe(true);
    expect(isLoginPath('/login/oauth/start')).toBe(true);
    expect(isLoginPath('/loginx')).toBe(false);
    expect(isLoginPath('/v1/keys')).toBe(false);
  });

  it('writes the five markup characters as entities and leaves the rest', () => {
    expect(escapeHtml('<a href="x" title=\'y\'>&</a> ok')).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt; ok');
  });
});

describe('GET /login under the basic login', () => {
  it('lists each key with its last use, its state and its actions', async () => {
    await store.create('ci', USER);
    await store.create('laptop', USER);
    await store.create('old', USER);
    now = new Date('2026-11-17T11:30:00.000Z');
    await store.stampUse('ci');
    await store.pause('laptop');
    await store.delete('old');

    const answer = await routes(await basicLogin()).serve(hubRequest(LOGIN_ROUTE, { headers: { authorization: SIGNED_IN } }));
    const html = await textOf(answer);

    expect(answer.response.status).toBe(200);
    expect(answer.user).toBe(USER);
    expect(answer.response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(answer.response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('<tr><td>ci</td><td>ada</td><td><time datetime="2026-11-17T10:00:00.000Z">2026-11-17T10:00:00.000Z</time></td><td><time datetime="2026-11-17T11:30:00.000Z">2026-11-17T11:30:00.000Z</time></td><td>active</td>');
    expect(html).toMatch(/<td>laptop<\/td>.*<td>never<\/td><td>paused<\/td><td><button type="button" data-action="delete" data-name="laptop">/);
    expect(html).toMatch(/<td>old<\/td>.*<td>deleted<\/td><td><\/td><\/tr>/);
    expect(html).toContain('data-action="pause" data-name="ci"');
    expect(html).not.toContain('data-name="laptop">Pause');
    expect(html).toContain('<form id="create">');
    expect(html).not.toContain(LOGOUT_ROUTE);
  });

  it('escapes a key name and a creator the store answers, in text and in attributes', async () => {
    const hostile: HubKey = {
      name: '<script>alert("name")</script>',
      createdBy: '"><img src=x onerror=alert(1)>',
      createdAt: STAMPED.toISOString(),
      lastUsedAt: null,
      paused: false,
      deleted: false,
    };
    const answer = await routes(await basicLogin(), listingStore([hostile])).serve(hubRequest(LOGIN_ROUTE, { headers: { authorization: SIGNED_IN } }));
    const html = await textOf(answer);

    expect(html).toContain('<td>&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;</td>');
    expect(html).toContain('data-name="&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;"');
    expect(html).toContain('<td>&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</td>');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
  });

  it('escapes the signed-in user', async () => {
    const user = '<b>ada</b>';
    const credentials = `Basic ${Buffer.from(`${user}:${PASSWORD}`).toString('base64')}`;
    const html = await textOf(await routes(await basicLogin(user)).serve(hubRequest(LOGIN_ROUTE, { headers: { authorization: credentials } })));

    expect(html).toContain('Signed in as <strong>&lt;b&gt;ada&lt;/b&gt;</strong>');
    expect(html).not.toContain('<b>ada</b>');
  });

  it('allows the page\'s own script and style alone, by a nonce per answer, and a script that parses', async () => {
    const login = await basicLogin();
    const first = await routes(login).serve(hubRequest(LOGIN_ROUTE, { headers: { authorization: SIGNED_IN } }));
    const second = await routes(login).serve(hubRequest(LOGIN_ROUTE, { headers: { authorization: SIGNED_IN } }));
    const policy = first.response.headers.get('content-security-policy') ?? '';
    const nonce = /script-src 'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    const html = await textOf(first);
    const script = /<script nonce="([^"]+)">\n([\s\S]*?)\n<\/script>/.exec(html);

    expect(policy).toContain('default-src \'none\'');
    expect(policy).toContain('connect-src \'self\'');
    expect(policy).toContain('frame-ancestors \'none\'');
    expect(nonce).toBeDefined();
    expect(script?.[1]).toBe(nonce);
    expect(second.response.headers.get('content-security-policy')).not.toBe(policy);
    expect(() => new Function(script?.[2] ?? 'syntax error here')).not.toThrow();
    expect(() => new Function('const broken = ;')).toThrow();
  });

  it('answers the challenge to a request carrying no credentials, and lists nothing', async () => {
    await store.create('ci', USER);
    const answer = await routes(await basicLogin()).serve(hubRequest(LOGIN_ROUTE));
    const html = await textOf(answer);

    expect(answer.response.status).toBe(401);
    expect(answer.refusal).toBe('unauthenticated');
    expect(answer.response.headers.get('www-authenticate')).toBe(BASIC_CHALLENGE);
    expect(html).not.toContain('<td>ci</td>');
    expect(html).not.toContain(OAUTH_START_ROUTE);
  });

  it('answers 503 for a login whose store did not answer', async () => {
    const down: HubLogin = { mode: 'basic', check: () => Promise.resolve({ served: false, refusal: { reason: 'unavailable', message: 'The login store did not answer.', headers: {} } }) };
    const answer = await routes(down).serve(hubRequest(LOGIN_ROUTE));

    expect(answer.response.status).toBe(503);
    expect(await textOf(answer)).toContain('The login store did not answer.');
  });

  it('answers 404 on the OAuth routes and on a path no route serves', async () => {
    const login = await basicLogin();
    for (const [method, path] of [['GET', OAUTH_START_ROUTE], ['GET', OAUTH_CALLBACK_ROUTE], ['POST', LOGOUT_ROUTE], ['GET', '/login/other']] as const) {
      const answer = await routes(login).serve(hubRequest(path, { method, headers: { authorization: SIGNED_IN } }));
      expect(answer.response.status).toBe(404);
    }
  });

  it('answers 405 with Allow for another method, and 400 for a query parameter', async () => {
    const login = await basicLogin();
    const posted = await routes(login).serve(hubRequest(LOGIN_ROUTE, { method: 'POST', headers: { authorization: SIGNED_IN } }));
    const queried = await routes(login).serve(hubRequest(`${LOGIN_ROUTE}?next=%3Cx%3E`, { headers: { authorization: SIGNED_IN } }));

    expect(posted.response.status).toBe(405);
    expect(posted.response.headers.get('allow')).toBe('GET');
    expect(queried.response.status).toBe(400);
    expect(await textOf(queried)).toContain('&quot;next&quot;');
  });
});

describe('the OAuth routes', () => {
  let provider: StandInOAuth;
  let login: OAuthLogin;

  beforeEach(() => {
    provider = startStandInOAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    provider.signIn(ALLOWED);
    login = openOAuthLogin({
      config: {
        authorizeUrl: provider.authorizeUrl,
        tokenUrl: provider.tokenUrl,
        userUrl: provider.userUrl,
        clientId: CLIENT_ID,
        clientSecretVariable: SECRET_VARIABLE,
        scope: null,
        allowed: ['583231'],
        callbackUrl: null,
      },
      env: { [SECRET_VARIABLE]: CLIENT_SECRET },
    });
  });

  afterEach(async () => {
    await provider.stop();
  });

  /** Starts a flow at the route, follows the stand-in's redirect and answers the callback request it names. */
  async function returnedFrom(): Promise<Request> {
    const started = await routes(login).serve(hubRequest(OAUTH_START_ROUTE));
    expect(started.response.status).toBe(303);
    const back = (await fetch(started.response.headers.get('location') ?? '', { redirect: 'manual' })).headers.get('location');
    if (back === null) throw new Error('the stand-in sent no redirect');
    return new Request(back);
  }

  /** The `name=value` a `Set-Cookie` opens with, as a browser sends it back. */
  function sentBack(answer: LoginRouteAnswer): string {
    return (answer.response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }

  it('links a signed-out page to the start, which sends the person to the provider', async () => {
    const page = await routes(login).serve(hubRequest(LOGIN_ROUTE));
    const started = await routes(login).serve(hubRequest(OAUTH_START_ROUTE));
    const location = new URL(started.response.headers.get('location') ?? '');

    expect(page.response.status).toBe(401);
    expect(await textOf(page)).toContain(`<a href="${OAUTH_START_ROUTE}">Sign in</a>`);
    expect(`${location.origin}${location.pathname}`).toBe(provider.authorizeUrl);
    expect(location.searchParams.get('redirect_uri')).toBe(`${HUB}${OAUTH_CALLBACK_ROUTE}`);
    expect(started.response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers the callback with the cookie and a same-site page, whose next request to /login is served', async () => {
    const answer = await routes(login).serve(await returnedFrom());
    const cookie = sentBack(answer);
    const next = await routes(login).serve(hubRequest(LOGIN_ROUTE, { headers: { cookie } }));
    const html = await textOf(next);

    expect(answer.response.status).toBe(200);
    expect(answer.response.headers.get('location')).toBeNull();
    expect(await textOf(answer)).toContain(`<a href="${LOGIN_ROUTE}">Continue to the keys</a>`);
    expect(cookie.startsWith(`${OAUTH_SESSION_COOKIE}=`)).toBe(true);
    expect(next.response.status).toBe(200);
    expect(next.user).toBe('583231');
    expect(html).toContain('Signed in as <strong>583231</strong>');
    expect(html).toContain(`<form method="post" action="${LOGOUT_ROUTE}">`);
    expect(logged).toEqual([{ level: 'info', event: 'login.signed-in', user: '583231' }]);
  });

  it('refuses a replayed callback 401 with a link to start again, logging no state or code', async () => {
    const returned = await returnedFrom();
    await routes(login).serve(new Request(returned.url));
    const replayed = await routes(login).serve(returned);
    const params = new URL(returned.url).searchParams;

    expect(replayed.response.status).toBe(401);
    expect(replayed.refusal).toBe('unauthenticated');
    expect(await textOf(replayed)).toContain(`<a href="${OAUTH_START_ROUTE}">Start again</a>`);
    expect(logged.at(-1)).toEqual({ level: 'warn', event: 'login.refused', reason: 'unauthenticated' });
    const lines = JSON.stringify(logged);
    expect(lines).not.toContain(params.get('state') ?? 'no state');
    expect(lines).not.toContain(params.get('code') ?? 'no code');
  });

  it('refuses a user outside allowed 403, the id escaped', async () => {
    provider.signIn({ id: '<i>mallory</i>' });
    const answer = await routes(login).serve(await returnedFrom());
    const html = await textOf(answer);

    expect(answer.response.status).toBe(403);
    expect(html).toContain('&lt;i&gt;mallory&lt;/i&gt;');
    expect(html).not.toContain('<i>mallory');
  });

  it('logs out a same-origin request, clearing the cookie, so the next page is refused', async () => {
    const cookie = sentBack(await routes(login).serve(await returnedFrom()));
    const out = await routes(login).serve(hubRequest(LOGOUT_ROUTE, { method: 'POST', headers: { cookie, origin: HUB } }));
    const after = await routes(login).serve(hubRequest(LOGIN_ROUTE, { headers: { cookie } }));

    expect(out.response.status).toBe(303);
    expect(out.response.headers.get('location')).toBe(LOGIN_ROUTE);
    expect(out.response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(out.user).toBe('583231');
    expect(after.response.status).toBe(401);
    expect(logged.at(-1)).toEqual({ level: 'info', event: 'login.signed-out', user: '583231' });
    expect(JSON.stringify(logged)).not.toContain(cookie.split('=')[1] ?? 'no session');
  });

  it('refuses a logout from another site 403, keeping the session', async () => {
    const cookie = sentBack(await routes(login).serve(await returnedFrom()));
    const out = await routes(login).serve(hubRequest(LOGOUT_ROUTE, { method: 'POST', headers: { cookie, origin: 'https://evil.example' } }));
    const after = await routes(login).serve(hubRequest(LOGIN_ROUTE, { headers: { cookie } }));

    expect(out.response.status).toBe(403);
    expect(out.refusal).toBe('forbidden');
    expect(after.response.status).toBe(200);
  });
});

describe('server.ts with the login and key routes', () => {
  const BOOT_VARIABLE = 'RAFA_HUB_LOGIN_ROUTES_BOOT_KEY';
  const BOOT_KEY = 'rafa_login-routes-bootstrap-key-0003';
  const DEVICE = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const PUSH = `${HUB_ROUTES.push}?device=${DEVICE}`;
  const BODY = encodeWirePayload({ format: WIRE_FORMAT, version: WIRE_VERSION, migrations: ['0001-base'], tables: {}, cursor: {} });

  let running: HubServer[] = [];
  let provider: StandInOAuth | undefined;

  afterEach(async () => {
    await Promise.all(running.map((server) => server.stop()));
    running = [];
    await provider?.stop();
    provider = undefined;
  });

  /** Starts a hub behind the api-key identity over this case's key store, `login` handed to both route modules unless left out. */
  function serve(login?: HubLogin, keys: HubKeyStore = store): HubServer {
    const log = (entry: HubLogEntry): void => {
      logged.push(entry);
    };
    const routed = login === undefined
      ? {}
      : { login: openLoginRoutes({ login, store: keys, log }), keys: openKeyRoutes({ login, store: keys, log }) };
    const server = startHubServer({
      port: 0,
      hostname: '127.0.0.1',
      version: '0.0.0-test',
      identity: openApiKeyIdentity({ variables: [BOOT_VARIABLE], env: { [BOOT_VARIABLE]: BOOT_KEY }, store: keys }),
      openStore: () => openMemoryHubStore({ directory: '', now: () => STAMPED }),
      log,
      ...routed,
    });
    running = [...running, server];
    return server;
  }

  /** Sends `method` to `path` on `server` with `headers`, and the wire body on a push. */
  function send(server: HubServer, method: string, path: string, headers: Record<string, string> = {}): Promise<Response> {
    const body = method === 'POST' && path.startsWith(HUB_ROUTES.push)
      ? BODY
      : undefined;
    return fetch(`${server.url}${path}`, { method, headers, body, redirect: 'manual' });
  }

  /** The `request` lines logged for `path`, oldest first. */
  function requestLines(path: string): HubLogEntry[] {
    return logged.filter((entry) => entry.event === 'request' && entry.path === path);
  }

  /** The session cookie an OAuth flow through `server`'s own routes ends with, as a browser sends it back. */
  async function signedInCookie(server: HubServer, flow: StandInOAuth): Promise<string> {
    flow.signIn(ALLOWED);
    const started = await send(server, 'GET', OAUTH_START_ROUTE);
    const authorized = await fetch(started.headers.get('location') ?? '', { redirect: 'manual' });
    const back = authorized.headers.get('location');
    if (back === null) throw new Error('the stand-in sent no redirect');
    const called = await fetch(back, { redirect: 'manual' });
    expect(called.status).toBe(200);
    return (called.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }

  it('answers 404 on the login and key paths when neither option is handed in', async () => {
    const server = serve();
    for (const [method, path] of [['GET', LOGIN_ROUTE], ['GET', OAUTH_START_ROUTE], ['GET', KEYS_ROUTE], ['POST', KEYS_ROUTE], ['POST', `${KEYS_ROUTE}/ci/pause`], ['DELETE', `${KEYS_ROUTE}/ci`]] as const) {
      const answered = await send(server, method, path, { authorization: SIGNED_IN, 'content-type': 'application/json' });
      expect({ path, status: answered.status }).toEqual({ path, status: 404 });
    }
  });

  it('serves the page and the key routes to basic credentials, naming the login\'s user in the request line', async () => {
    const server = serve(await basicLogin());
    const page = await send(server, 'GET', LOGIN_ROUTE, { authorization: SIGNED_IN });
    const created = await fetch(`${server.url}${KEYS_ROUTE}`, { method: 'POST', headers: { authorization: SIGNED_IN, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ci' }) });
    const listed = await send(server, 'GET', KEYS_ROUTE, { authorization: SIGNED_IN });
    const listing = await listed.json() as { data: { keys: { name: string; createdBy: string }[] } };

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(created.status).toBe(201);
    expect(listed.status).toBe(200);
    expect(listing.data.keys.map(({ name, createdBy }) => ({ name, createdBy }))).toEqual([{ name: 'ci', createdBy: USER }]);
    expect(logged).toContainEqual({ level: 'info', event: 'key.created', name: 'ci', user: USER });
    expect(requestLines(KEYS_ROUTE).at(-1)).toMatchObject({ method: 'GET', status: 200, user: USER });
    expect(requestLines(KEYS_ROUTE).at(-1)).not.toHaveProperty('caller');
  });

  it('refuses basic credentials unauthenticated on POST /v1/effort/push, where a store key is served', async () => {
    const server = serve(await basicLogin());
    const minted = await store.create('ci', USER);

    const served = await send(server, 'POST', PUSH, { authorization: `Bearer ${minted.plain}` });
    const refused = await send(server, 'POST', PUSH, { authorization: SIGNED_IN });
    const body = await refused.json() as { success: boolean; error: string };

    expect(served.status).toBe(200);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe(AUTH_CHALLENGE);
    expect(body.success).toBe(false);
    expect(body.error).not.toContain(PASSWORD);
    expect(requestLines(HUB_ROUTES.push).at(-1)).toMatchObject({ status: 401, refusal: 'unauthenticated' });
    expect(requestLines(HUB_ROUTES.push).at(-1)).not.toHaveProperty('user');
  });

  it('refuses basic credentials unauthenticated on /v1/status and /v1/effort/pull too', async () => {
    const server = serve(await basicLogin());
    const status = await send(server, 'GET', HUB_ROUTES.status, { authorization: SIGNED_IN });
    const pull = await send(server, 'GET', `${HUB_ROUTES.pull}?device=${DEVICE}`, { authorization: SIGNED_IN });

    expect([status.status, pull.status]).toEqual([401, 401]);
    expect(requestLines(HUB_ROUTES.status).at(-1)).toMatchObject({ refusal: 'unauthenticated' });
    expect(requestLines(HUB_ROUTES.pull).at(-1)).toMatchObject({ refusal: 'unauthenticated' });
  });

  it('refuses a store key on the key routes, so a key never manages keys', async () => {
    const minted = await store.create('ci', USER);
    const server = serve(await basicLogin());
    const listed = await send(server, 'GET', KEYS_ROUTE, { authorization: `Bearer ${minted.plain}` });

    expect(listed.status).toBe(401);
    expect(listed.headers.get('www-authenticate')).toBe(BASIC_CHALLENGE);
  });

  it('refuses the login cookie unauthenticated on POST /v1/effort/push, alone and beside basic credentials, the cookie serving /login', async () => {
    provider = startStandInOAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const login = openOAuthLogin({
      config: {
        authorizeUrl: provider.authorizeUrl,
        tokenUrl: provider.tokenUrl,
        userUrl: provider.userUrl,
        clientId: CLIENT_ID,
        clientSecretVariable: SECRET_VARIABLE,
        scope: null,
        allowed: ['583231'],
        callbackUrl: null,
      },
      env: { [SECRET_VARIABLE]: CLIENT_SECRET },
    });
    const server = serve(login);
    const cookie = await signedInCookie(server, provider);
    expect(cookie.startsWith(`${OAUTH_SESSION_COOKIE}=`)).toBe(true);

    const page = await send(server, 'GET', LOGIN_ROUTE, { cookie });
    const listed = await send(server, 'GET', KEYS_ROUTE, { cookie });
    const alone = await send(server, 'POST', PUSH, { cookie });
    const beside = await send(server, 'POST', PUSH, { cookie, authorization: SIGNED_IN });

    expect(page.status).toBe(200);
    expect(listed.status).toBe(200);
    expect([alone.status, beside.status]).toEqual([401, 401]);
    expect(requestLines(HUB_ROUTES.push).map((line) => line.refusal)).toEqual(['unauthenticated', 'unauthenticated']);
    expect(JSON.stringify(logged)).not.toContain(cookie.split('=')[1] ?? 'no session');
  });

  it('answers 500 when the key routes reject on a store error, logging it', async () => {
    const failing: HubKeyStore = { ...store, list: () => Promise.reject(new Error('SQLITE_BUSY: database is locked')) };
    const server = serve(await basicLogin(), failing);
    const listed = await send(server, 'GET', KEYS_ROUTE, { authorization: SIGNED_IN });

    expect(listed.status).toBe(500);
    expect(await listed.json()).toEqual({ success: false, error: INTERNAL_ERROR });
    expect(logged).toContainEqual(expect.objectContaining({ event: 'request.failed', path: KEYS_ROUTE, error: 'SQLITE_BUSY: database is locked' }));
  });
});
