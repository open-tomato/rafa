/**
 * The OAuth login (`oauth.ts`) against a stand-in provider
 * (`testdata/stand-in-oauth.ts`) on a free loopback port. The state is
 * held first: a replayed and an expired state are refused before the
 * provider is asked, each beside a control the same flow serves. Then
 * the start's authorize URL, the code exchange and user lookup with
 * every refusal they answer, the `allowed` check, the session cookie,
 * `check` over it, its expiry and the logout.
 *
 * Every case opens its own login over a provider of its own, and moves
 * the login's clock by hand, so no case reads another's state or
 * session, and none waits ten minutes.
 */
import type { OAuthCallbackAnswer, OAuthLogin, OAuthLoginOptions } from './oauth.js';
import type { HubLoginOAuth } from '../config-login.js';
import type { StandInOAuth } from './testdata/stand-in-oauth.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  DEFAULT_OAUTH_SESSION_TTL_MS,
  MAX_PENDING_OAUTH_STATES,
  OAUTH_CALLBACK_PATH,
  OAUTH_SESSION_COOKIE,
  OAUTH_STATE_TTL_MS,
  openOAuthLogin,
} from './oauth.js';
import { startStandInOAuth } from './testdata/stand-in-oauth.js';

const CLIENT_ID = 'rafa-hub-test-client';
const CLIENT_SECRET = 'stand-in-client-secret-0001';
const SECRET_VARIABLE = 'RAFA_HUB_OAUTH_TEST_SECRET';

/** The allowed user, numeric as GitHub's ids are. */
const ALLOWED = { id: 583231, login: 'ada' };

/** A user the provider knows and `allowed` does not list. */
const STRANGER = { id: 999001, login: 'mallory' };

/** Where the hub listens in these cases; nothing is served there. */
const HUB = 'http://127.0.0.1:7171';

let provider: StandInOAuth;
let clock: number;

beforeEach(() => {
  provider = startStandInOAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  provider.signIn(ALLOWED);
  clock = 1_700_000_000_000;
});

afterEach(async () => {
  await provider.stop();
});

/** The provider settings for the running stand-in. */
function configFor(overrides: Partial<HubLoginOAuth> = {}): HubLoginOAuth {
  return {
    authorizeUrl: provider.authorizeUrl,
    tokenUrl: provider.tokenUrl,
    userUrl: provider.userUrl,
    clientId: CLIENT_ID,
    clientSecretVariable: SECRET_VARIABLE,
    scope: 'read:user',
    allowed: ['583231', 'grace'],
    callbackUrl: null,
    ...overrides,
  };
}

/** A login over the stand-in, on the case's clock. */
function openLogin(options: Partial<OAuthLoginOptions> = {}): OAuthLogin {
  return openOAuthLogin({
    config: configFor(),
    env: { [SECRET_VARIABLE]: CLIENT_SECRET },
    now: () => clock,
    ...options,
  });
}

/** A request to the hub at `path`, carrying `cookie` when given. */
function hubRequest(path: string, cookie?: string): Request {
  const headers: Record<string, string> = cookie === undefined
    ? {}
    : { cookie };
  return new Request(new URL(path, HUB).href, { headers });
}

/** Starts a flow and answers the state it holds. */
function startFlow(login: OAuthLogin): string {
  const state = new URL(login.start(hubRequest('/login/oauth/start')).location).searchParams.get('state');
  if (state === null) throw new Error('the authorize URL held no state');
  return state;
}

/** The callback request the provider would send back for `params`. */
function callbackRequest(params: Readonly<Record<string, string>>): Request {
  return hubRequest(`${OAUTH_CALLBACK_PATH}?${new URLSearchParams(params).toString()}`);
}

/** A code the stand-in granted `profile`, for the hub's derived callback URL. */
function codeFor(profile: Readonly<Record<string, unknown>> = ALLOWED): string {
  return provider.grant(profile, `${HUB}${OAUTH_CALLBACK_PATH}`);
}

/** Starts a flow, follows the stand-in's authorize redirect and answers the callback request it names. */
async function authorizeThrough(login: OAuthLogin): Promise<Request> {
  const { location } = login.start(hubRequest('/login/oauth/start'));
  const response = await fetch(location, { redirect: 'manual' });
  const back = response.headers.get('location');
  if (response.status !== 302 || back === null) throw new Error(`the stand-in answered ${String(response.status)} with no redirect`);
  return new Request(back);
}

/** The refusal of `answer`, failing the case when it was served. */
function refusalOf(answer: OAuthCallbackAnswer) {
  if (answer.served) throw new Error(`expected a refusal, was served as ${answer.user}`);
  return answer.refusal;
}

/** The `Set-Cookie` of a served `answer`, failing the case when it was refused. */
function cookieOf(answer: OAuthCallbackAnswer): string {
  if (!answer.served) throw new Error(`expected a session, was refused: ${answer.refusal.message}`);
  const cookie = answer.headers['Set-Cookie'];
  if (cookie === undefined) throw new Error('the served callback set no cookie');
  return cookie;
}

/** The `name=value` pair a `Set-Cookie` value opens with, as a browser sends it back. */
function sentBack(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}

/** How many code exchanges the stand-in was sent. */
function exchanges(): number {
  return provider.asked().filter((asked) => asked.path === '/token').length;
}

describe('the state, checked first', () => {
  it('refuses a replayed state, asking the provider nothing the second time', async () => {
    const login = openLogin();
    const state = startFlow(login);
    const params = { state, code: codeFor() };

    expect((await login.callback(callbackRequest(params))).served).toBe(true);
    expect(exchanges()).toBe(1);

    const replayed = refusalOf(await login.callback(callbackRequest({ state, code: codeFor() })));
    expect(replayed.reason).toBe('unauthenticated');
    expect(replayed.message).toContain('finished already');
    expect(exchanges()).toBe(1);
  });

  it('refuses a state ten minutes old without asking the provider, and serves one a millisecond younger', async () => {
    const login = openLogin();
    const fresh = startFlow(login);
    const stale = startFlow(login);

    clock += OAUTH_STATE_TTL_MS;
    const expired = refusalOf(await login.callback(callbackRequest({ state: stale, code: codeFor() })));
    expect(expired.reason).toBe('unauthenticated');
    expect(expired.message).toContain('more than ten minutes ago');
    expect(provider.asked()).toEqual([]);

    clock -= 1;
    expect((await login.callback(callbackRequest({ state: fresh, code: codeFor() })))).toMatchObject({ served: true, user: '583231' });
  });

  it('spends a state on a refused callback, so it cannot be tried again', async () => {
    const login = openLogin();
    const state = startFlow(login);

    expect(refusalOf(await login.callback(callbackRequest({ state, error: 'access_denied' }))).message).toContain('did not grant');
    expect(refusalOf(await login.callback(callbackRequest({ state, code: codeFor() }))).message).toContain('finished already');
    expect(provider.asked()).toEqual([]);
  });

  it('refuses no state, a malformed one and one it never started, before reading the code', async () => {
    const login = openLogin();
    startFlow(login);

    const answers = [
      await login.callback(callbackRequest({ code: codeFor() })),
      await login.callback(callbackRequest({ state: 'short', code: codeFor() })),
      await login.callback(callbackRequest({ state: 'A'.repeat(43), code: codeFor() })),
      await login.callback(callbackRequest({ state: startFlow(openLogin()), code: codeFor() })),
    ];
    for (const answer of answers) {
      expect(refusalOf(answer)).toEqual({ reason: 'unauthenticated', message: expect.stringContaining('not one the hub started') as unknown as string });
    }
    expect(provider.asked()).toEqual([]);
  });

  it('mints a new 32-byte base64url state per flow', () => {
    const login = openLogin();
    const states = Array.from({ length: 20 }, () => startFlow(login));

    expect(new Set(states).size).toBe(20);
    for (const state of states) {
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(state, 'base64url').length).toBe(32);
    }
  });

  it('drops the oldest pending state once the cap is reached, and keeps the newest', async () => {
    const login = openLogin();
    const first = startFlow(login);
    const second = startFlow(login);
    for (let started = 2; started < MAX_PENDING_OAUTH_STATES; started += 1) startFlow(login);
    const last = startFlow(login);

    expect(refusalOf(await login.callback(callbackRequest({ state: first, code: codeFor() }))).message).toContain('not one the hub started');
    expect((await login.callback(callbackRequest({ state: second, code: codeFor() }))).served).toBe(true);
    expect((await login.callback(callbackRequest({ state: last, code: codeFor() }))).served).toBe(true);
  });
});

describe('openOAuthLogin and start', () => {
  it('names its mode oauth', () => {
    expect(openLogin().mode).toBe('oauth');
  });

  it('throws naming the secret\'s variable when it is unset or empty, and repeats no value', () => {
    for (const env of [{}, { [SECRET_VARIABLE]: '' }, { OTHER: CLIENT_SECRET }]) {
      expect(() => openLogin({ env })).toThrow(`hub.auth.login.oauth.clientSecretVariable names ${SECRET_VARIABLE}, which is not set`);
    }
  });

  it('sends the person to the authorize URL with the client, the callback on the hub\'s origin, the state and the scope', () => {
    const location = new URL(openLogin().start(hubRequest('/login/oauth/start')).location);

    expect(`${location.origin}${location.pathname}`).toBe(provider.authorizeUrl);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(`${HUB}${OAUTH_CALLBACK_PATH}`);
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('client_secret')).toBeNull();
  });

  it('sends the callback URL it was opened with, and no scope when none is written', () => {
    const login = openLogin({ config: configFor({ scope: null }), callbackUrl: 'https://hub.example.org/login/oauth/callback' });
    const location = new URL(login.start(hubRequest('/login/oauth/start')).location);

    expect(location.searchParams.get('redirect_uri')).toBe('https://hub.example.org/login/oauth/callback');
    expect(location.searchParams.has('scope')).toBe(false);
  });

  it('sends the callbackUrl the config writes over the start request\'s origin, and the opener\'s over both', () => {
    const written = 'https://hub.example.org/login/oauth/callback';
    const passed = 'https://other.example.org/login/oauth/callback';
    const redirectOf = (login: OAuthLogin): string | null => new URL(login.start(hubRequest('/login/oauth/start')).location).searchParams.get('redirect_uri');

    expect([
      redirectOf(openLogin({ config: configFor({ callbackUrl: written }) })),
      redirectOf(openLogin({ config: configFor({ callbackUrl: written }), callbackUrl: passed })),
      redirectOf(openLogin()),
    ]).toEqual([written, passed, `${HUB}${OAUTH_CALLBACK_PATH}`]);
  });
});

describe('the callback', () => {
  it('serves an allowed user through the stand-in\'s redirect, exchanging the code with the client\'s secret', async () => {
    const login = openLogin();
    const elsewhere = refusalOf(await openLogin().callback(await authorizeThrough(login)));
    expect(elsewhere.message).toContain('not one the hub started');

    const served = await login.callback(await authorizeThrough(login));
    expect(served).toMatchObject({ served: true, user: '583231' });

    const token = provider.asked().find((asked) => asked.path === '/token');
    expect(token?.method).toBe('POST');
    expect(token?.params).toMatchObject({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: `${HUB}${OAUTH_CALLBACK_PATH}`,
    });
    const user = provider.asked().find((asked) => asked.path === '/user');
    expect(user?.authorization).toMatch(/^Bearer \S+$/);
  });

  it('sets the session cookie HttpOnly, SameSite=Strict and lasting the session, Secure only under https', async () => {
    const login = openLogin();
    const cookie = cookieOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor() })));
    const attributes = cookie.split('; ').slice(1);

    expect(cookie).toMatch(new RegExp(`^${OAUTH_SESSION_COOKIE}=[A-Za-z0-9_-]{43}; `));
    expect(attributes).toEqual(['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${String(DEFAULT_OAUTH_SESSION_TTL_MS / 1000)}`]);

    const callbackUrl = 'https://hub.example.org/login/oauth/callback';
    const secure = openLogin({ callbackUrl });
    const state = startFlow(secure);
    const code = provider.grant(ALLOWED, callbackUrl);
    expect(cookieOf(await secure.callback(callbackRequest({ state, code }))).split('; ')).toContain('Secure');
  });

  it('sets the cookie Secure behind a TLS terminator when the config writes an https callbackUrl, the start arriving over http', async () => {
    const callbackUrl = 'https://hub.example.org/login/oauth/callback';
    const proxied = openLogin({ config: configFor({ callbackUrl }) });
    const state = startFlow(proxied);
    const code = provider.grant(ALLOWED, callbackUrl);
    const served = await proxied.callback(callbackRequest({ state, code }));

    expect(cookieOf(served).split('; ')).toContain('Secure');
    expect(provider.asked().find((asked) => asked.path === '/token')?.params).toMatchObject({ redirect_uri: callbackUrl });
  });

  it('reads the user id from sub when the lookup holds no id, and a text id as written', async () => {
    const login = openLogin();
    expect(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor({ sub: 'grace' }) }))).toMatchObject({ served: true, user: 'grace' });
    expect(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor({ id: 'grace', sub: '583231' }) }))).toMatchObject({ served: true, user: 'grace' });
  });

  it('refuses forbidden a user allowed does not list, naming the id and setting no cookie', async () => {
    const login = openLogin();
    const answer = await login.callback(callbackRequest({ state: startFlow(login), code: codeFor(STRANGER) }));

    expect(answer).toEqual({
      served: false,
      refusal: {
        reason: 'forbidden',
        message: 'The provider\'s user "999001" may not sign in to this hub; whoever runs it can add the id to hub.auth.login.oauth.allowed.',
      },
    });
  });

  it('refuses unauthenticated a denied grant, no code and a code the provider does not accept', async () => {
    const login = openLogin();
    provider.signIn(null);
    expect(refusalOf(await login.callback(await authorizeThrough(login)))).toEqual({ reason: 'unauthenticated', message: expect.stringContaining('did not grant') as unknown as string });
    expect(refusalOf(await login.callback(callbackRequest({ state: startFlow(login) })))).toEqual({ reason: 'unauthenticated', message: expect.stringContaining('no code') as unknown as string });
    expect(exchanges()).toBe(0);

    const refusal = refusalOf(await login.callback(callbackRequest({ state: startFlow(login), code: 'not-a-granted-code' })));
    expect(refusal).toEqual({ reason: 'unauthenticated', message: expect.stringContaining('did not accept the sign-in code') as unknown as string });
    expect(exchanges()).toBe(1);

    provider.failWith({ status: 200, body: '{"error":"bad_verification_code"}' });
    const github = refusalOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor() })));
    expect(github).toEqual({ reason: 'unauthenticated', message: expect.stringContaining('did not accept the sign-in code') as unknown as string });
  });

  it('refuses unavailable a provider that refuses the hub\'s client secret', async () => {
    const login = openLogin({ env: { [SECRET_VARIABLE]: 'a-secret-the-provider-never-issued' } });
    const refusal = refusalOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor() })));

    expect(refusal.reason).toBe('unavailable');
    expect(refusal.message).toContain('did not accept the hub\'s client id or secret');
    expect(refusal.message).not.toContain('a-secret-the-provider-never-issued');
  });

  it('refuses unavailable a provider answering 500, one stopped and one too slow, naming the step', async () => {
    const login = openLogin({ timeoutMs: 50 });

    provider.failWith({ status: 500, body: '{"error":"server_error","detail":"leaked provider text"}' });
    const failed = refusalOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor() })));
    expect(failed).toEqual({ reason: 'unavailable', message: expect.stringContaining('the code exchange: HTTP 500') as unknown as string });
    expect(failed.message).not.toContain('leaked');

    provider.failWith({ status: 200, delayMs: 500 });
    const slow = refusalOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor() })));
    expect(slow.message).toContain('no answer within 50ms');

    provider.failWith(null);
    const state = startFlow(login);
    const code = codeFor();
    await provider.stop();
    expect(refusalOf(await login.callback(callbackRequest({ state, code }))).message).toContain('could not be reached');
  });

  it('refuses unavailable a token answer with no token, and a user lookup naming no id', async () => {
    const login = openLogin();
    provider.failWith({ status: 200, body: '{"token_type":"bearer"}' });
    expect(refusalOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor() }))).message).toContain('held no access token');

    provider.failWith(null);
    const refusal = refusalOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor({ login: 'ada', id: -1 }) })));
    expect(refusal).toEqual({ reason: 'unavailable', message: expect.stringContaining('the user lookup: its answer named no user id') as unknown as string });
  });

  it('repeats no state, code, token or secret in any refusal', async () => {
    const login = openLogin({ timeoutMs: 50 });
    const sent: string[] = [CLIENT_SECRET];
    const messages: string[] = [];
    const tryOnce = async (params: Record<string, string>) => {
      sent.push(...Object.values(params));
      messages.push(refusalOf(await login.callback(callbackRequest(params))).message);
    };

    const used = startFlow(login);
    await login.callback(callbackRequest({ state: used, code: codeFor() }));
    await tryOnce({ state: used, code: codeFor() });
    await tryOnce({ state: startFlow(login), code: 'not-a-granted-code' });
    await tryOnce({ state: startFlow(login), code: codeFor(STRANGER) });
    await tryOnce({ state: startFlow(login), error: 'access_denied', error_description: 'provider prose' });
    provider.failWith({ status: 503 });
    await tryOnce({ state: startFlow(login), code: codeFor() });

    expect(messages).toHaveLength(5);
    const tokens = provider.asked()
      .map((asked) => asked.authorization?.replace('Bearer ', '') ?? '')
      .filter((token) => token !== '');
    for (const message of messages) {
      for (const value of [...sent, ...tokens]) expect(message).not.toContain(value);
    }
  });
});

describe('check, sessions and logout', () => {
  /** A cookie header for a fresh session of the allowed user on `login`. */
  async function signedIn(login: OAuthLogin): Promise<string> {
    return sentBack(cookieOf(await login.callback(callbackRequest({ state: startFlow(login), code: codeFor() }))));
  }

  it('serves the session\'s user from its cookie among others', async () => {
    const login = openLogin();
    const cookie = await signedIn(login);

    expect(await login.check(hubRequest('/v1/keys', cookie))).toEqual({ served: true, user: '583231' });
    expect(await login.check(hubRequest('/v1/keys', `theme=dark; ${cookie}; other=1`))).toEqual({ served: true, user: '583231' });
  });

  it('refuses unauthenticated, with no headers, no cookie, a malformed one and one it never issued', async () => {
    const login = openLogin();
    const issuedElsewhere = await signedIn(openLogin());
    const refusal = { reason: 'unauthenticated' as const, message: 'Sign in at /login through the hub\'s OAuth provider.', headers: {} };

    for (const cookie of [undefined, `${OAUTH_SESSION_COOKIE}=short`, `${OAUTH_SESSION_COOKIE}=${'A'.repeat(43)}`, issuedElsewhere]) {
      expect(await login.check(hubRequest('/v1/keys', cookie))).toEqual({ served: false, refusal });
    }
  });

  it('ends a session once its life is over, and serves it a millisecond before', async () => {
    const login = openLogin({ sessionTtlMs: 60_000 });
    const cookie = await signedIn(login);

    clock += 59_999;
    expect((await login.check(hubRequest('/v1/keys', cookie))).served).toBe(true);
    clock += 1;
    expect((await login.check(hubRequest('/v1/keys', cookie))).served).toBe(false);
    clock -= 1;
    expect((await login.check(hubRequest('/v1/keys', cookie))).served).toBe(false);
  });

  it('logs out the session its cookie names, clearing the cookie, and leaves another session served', async () => {
    const login = openLogin();
    const leaving = await signedIn(login);
    const staying = await signedIn(login);

    const { headers } = login.logout(hubRequest('/login/logout', leaving));
    expect(headers).toEqual({ 'Set-Cookie': `${OAUTH_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
    expect((await login.check(hubRequest('/v1/keys', leaving))).served).toBe(false);
    expect((await login.check(hubRequest('/v1/keys', staying))).served).toBe(true);
  });
});
