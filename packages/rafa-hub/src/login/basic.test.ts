/**
 * The basic login (`basic.ts`): served for the login's pair, refused
 * `unauthenticated` with the challenge for no login, no header, another
 * scheme, a malformed token and wrong credentials, refused `unavailable`
 * without it when the store rejects, a login set after opening checked
 * from the next request, and no refusal repeating what the request sent.
 *
 * Every case opens its own store in `:memory:`, or a stand-in wrapping
 * one, so no case reads another's login.
 */
import type { LoginAnswer } from './basic.js';
import type { HubLoginStore } from '../identity/login-store.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openSqliteLoginStore } from '../identity/login-store.js';

import { BASIC_CHALLENGE, openBasicLogin } from './basic.js';

const USER = 'ada';
const PASSWORD = 'correct horse: battery staple';

/** `Authorization: Basic` for `user:password`, UTF-8 then base64. */
function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

/** A request to the key list carrying `authorization`, or none. */
function requestWith(authorization?: string): Request {
  const headers: Record<string, string> = authorization === undefined
    ? {}
    : { authorization };
  return new Request('http://127.0.0.1/v1/keys', { headers });
}

/** The refusal of `answer`, failing the case when it was served. */
function refusalOf(answer: LoginAnswer) {
  if (answer.served) throw new Error(`expected a refusal, was served as ${answer.user}`);
  return answer.refusal;
}

let store: HubLoginStore;

beforeEach(() => {
  store = openSqliteLoginStore({ path: ':memory:' });
});

afterEach(() => {
  store.close();
});

describe('openBasicLogin', () => {
  it('names its mode basic', () => {
    expect(openBasicLogin({ store }).mode).toBe('basic');
  });

  it('serves the login\'s user name and password, a colon in the password included', async () => {
    await store.setLogin(USER, PASSWORD);
    const answer = await openBasicLogin({ store }).check(requestWith(basic(USER, PASSWORD)));
    expect(answer).toEqual({ served: true, user: USER });
  });

  it('reads the scheme word in any case, and a user name beyond ASCII as UTF-8', async () => {
    await store.setLogin('zoë', PASSWORD);
    const login = openBasicLogin({ store });
    const token = basic('zoë', PASSWORD).slice('Basic '.length);
    expect(await login.check(requestWith(`BASIC ${token}`))).toEqual({ served: true, user: 'zoë' });
    expect(await login.check(requestWith(`basic ${token}`))).toEqual({ served: true, user: 'zoë' });
  });

  it('challenges with the realm when no login is set, saying how to set one, and asks no verify', async () => {
    let verifies = 0;
    const counting: HubLoginStore = {
      ...store,
      verifyLogin: async (user, password) => {
        verifies += 1;
        return await store.verifyLogin(user, password);
      },
    };
    const refusal = refusalOf(await openBasicLogin({ store: counting }).check(requestWith(basic(USER, PASSWORD))));
    expect(refusal.reason).toBe('unauthenticated');
    expect(refusal.headers).toEqual({ 'WWW-Authenticate': 'Basic realm="rafa-hub login"' });
    expect(refusal.message).toContain('rafa-hub login');
    expect(refusal.message).toContain('RAFA_HUB_LOGIN_USER');
    expect(verifies).toBe(0);
  });

  it('checks a login set after it was opened from the next request on', async () => {
    const login = openBasicLogin({ store });
    expect((await login.check(requestWith(basic(USER, PASSWORD)))).served).toBe(false);
    await store.setLogin(USER, PASSWORD);
    expect((await login.check(requestWith(basic(USER, PASSWORD)))).served).toBe(true);
  });

  const malformed: readonly (readonly [string, string | undefined])[] = [
    ['no header', undefined],
    ['another scheme', 'Bearer rafa_abc'],
    ['the scheme word alone', 'Basic'],
    ['a token that is not base64', 'Basic not*base64'],
    ['base64 of bytes that are not UTF-8', `Basic ${Buffer.from([0xff, 0xfe, 0x3a, 0x61]).toString('base64')}`],
    ['a pair with no colon', `Basic ${Buffer.from(`${USER}${PASSWORD}`).toString('base64')}`],
    ['an empty user name', basic('', PASSWORD)],
    ['an empty password', basic(USER, '')],
  ];

  for (const [what, authorization] of malformed) {
    it(`challenges ${what}, with the message any wrong pair gets`, async () => {
      await store.setLogin(USER, PASSWORD);
      const login = openBasicLogin({ store });
      const wrong = refusalOf(await login.check(requestWith(basic(USER, 'wrong'))));
      const refusal = refusalOf(await login.check(requestWith(authorization)));
      expect(refusal).toEqual({ reason: 'unauthenticated', message: wrong.message, headers: { 'WWW-Authenticate': BASIC_CHALLENGE } });
    });
  }

  it('answers a wrong password and a wrong user name alike, repeating neither', async () => {
    await store.setLogin(USER, PASSWORD);
    const login = openBasicLogin({ store });
    const wrongPassword = refusalOf(await login.check(requestWith(basic(USER, 'hunter2-guess'))));
    const wrongUser = refusalOf(await login.check(requestWith(basic('grace', PASSWORD))));
    expect(wrongPassword).toEqual(wrongUser);
    expect(wrongPassword.reason).toBe('unauthenticated');
    expect(wrongPassword.headers).toEqual({ 'WWW-Authenticate': BASIC_CHALLENGE });
    for (const sent of ['hunter2-guess', 'grace', PASSWORD, USER]) expect(wrongPassword.message).not.toContain(sent);
  });

  it('refuses a padded user name the store would never have set', async () => {
    await store.setLogin(USER, PASSWORD);
    const answer = await openBasicLogin({ store }).check(requestWith(basic(` ${USER}`, PASSWORD)));
    expect(refusalOf(answer).reason).toBe('unauthenticated');
  });

  it('answers unavailable with no challenge when the store rejects, naming nothing sent', async () => {
    await store.setLogin(USER, PASSWORD);
    const rejecting: HubLoginStore = {
      ...store,
      verifyLogin: async () => await Promise.reject(new Error(`disk gone under ${PASSWORD}`)),
    };
    const refusal = refusalOf(await openBasicLogin({ store: rejecting }).check(requestWith(basic(USER, PASSWORD))));
    expect(refusal.reason).toBe('unavailable');
    expect(refusal.headers).toEqual({});
    expect(refusal.message).toContain('login store');
    expect(refusal.message).not.toContain(PASSWORD);
  });

  it('answers unavailable when the store rejects asking whether a login is set', async () => {
    const rejecting: HubLoginStore = { ...store, hasLogin: async () => await Promise.reject(new Error('locked')) };
    const refusal = refusalOf(await openBasicLogin({ store: rejecting }).check(requestWith()));
    expect(refusal.reason).toBe('unavailable');
  });

  it('leaves the request body unread', async () => {
    await store.setLogin(USER, PASSWORD);
    const request = new Request('http://127.0.0.1/v1/keys', {
      method: 'POST',
      headers: { authorization: basic(USER, PASSWORD), 'content-type': 'application/json' },
      body: '{"name":"laptop"}',
    });
    expect((await openBasicLogin({ store }).check(request)).served).toBe(true);
    expect(request.bodyUsed).toBe(false);
  });
});
