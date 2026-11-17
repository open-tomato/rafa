/**
 * Tests for the reader of `hub.auth.login` (`config-login.ts`): its
 * defaults under each adapter, the `basic` and `oauth` modes, and one
 * case per refusal, each beside an accepting control of the same key so
 * a reader that refused everything fails here rather than passing.
 *
 * Every refusal is spelled out, never built from the module's own
 * constants. Most cases call {@link readLoginConfig} on a mapping; the
 * cases under "the hub config" go through `parseHubConfig`, so the
 * wiring into `config.ts` and its `AUTH_KEYS` is read as well.
 */
import type { HubLoginConfig, HubLoginOAuth } from './config-login.js';

import { describe, expect, it } from 'bun:test';

import { readLoginConfig } from './config-login.js';
import { HubConfigError, parseHubConfig } from './config.js';

/** The config file's path, as a refusal names it. */
const PATH = '/srv/hub/hub.yaml';

/** What `hub.auth.login.mode` says it expected. */
const MODE_EXPECTED = 'expected basic or oauth';

/** What a provider URL says it expected. */
const URL_EXPECTED = 'expected an absolute https URL, or http on localhost, 127.0.0.1 or [::1], holding no user name or password';

/** What `clientId` and `scope` say they expected. */
const TEXT_EXPECTED = 'expected non-empty text with no white space at either end';

/** What `clientSecretVariable` says it expected. */
const SECRET_EXPECTED = 'expected an environment variable name of A-Z, 0-9 and _, not opening with a digit, such as RAFA_HUB_OAUTH_SECRET; the value written is not repeated';

/** What `allowed` says it expected. */
const ALLOWED_EXPECTED = 'expected a non-empty list of the provider\'s user ids, such as [\'583231\']';

/** What an entry of `allowed` says it expected. */
const ALLOWED_ID_EXPECTED = 'expected a provider user id, as non-empty text with no white space at either end or a whole number';

/** A provider's settings every case starts from, all accepted. */
const OAUTH: Omit<HubLoginOAuth, 'scope'> = Object.freeze({
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userUrl: 'https://api.github.com/user',
  clientId: 'Iv1.8a61f9b3a7aba766',
  clientSecretVariable: 'RAFA_HUB_OAUTH_SECRET',
  allowed: ['583231'],
});

/** A login under `mode: oauth` holding {@link OAUTH} with `changes` over it. */
function oauthLogin(changes: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { mode: 'oauth', oauth: { ...OAUTH, ...changes } };
}

/** The problems a login of `raw` under `api-key` is refused with. */
function problems(raw: unknown): readonly string[] {
  return readLoginConfig(PATH, 'api-key', raw).problems;
}

/** The login a reading of `raw` under `api-key` resolves to; fails the case on any problem. */
function read(raw: unknown): unknown {
  const reading = readLoginConfig(PATH, 'api-key', raw);
  expect(reading.problems).toEqual([]);
  return reading.value;
}

describe('the adapter', () => {
  it('reads a basic login when left out under api-key, and null under github', () => {
    expect(read(undefined)).toEqual({ mode: 'basic', oauth: null });
    expect(readLoginConfig(PATH, 'github', undefined)).toEqual({ value: null, problems: [] });
  });

  it('refuses a login written under github, beside the same login read under api-key', () => {
    expect(read({ mode: 'basic' })).toEqual({ mode: 'basic', oauth: null });
    expect(readLoginConfig(PATH, 'github', { mode: 'basic' }).problems).toEqual([
      '/srv/hub/hub.yaml: hub.auth.login is set while hub.auth.adapter is github; expected hub.auth.adapter: api-key beside it, or no hub.auth.login',
    ]);
  });

  it('checks nothing when the adapter itself was refused', () => {
    expect(readLoginConfig(PATH, undefined, { mode: 'sso' })).toEqual({ value: null, problems: [] });
  });
});

describe('hub.auth.login', () => {
  it('refuses a login that is no mapping', () => {
    expect([problems('basic'), problems(null), problems(['basic'])]).toEqual([
      ['/srv/hub/hub.yaml: hub.auth.login is "basic", expected a mapping holding mode, oauth'],
      ['/srv/hub/hub.yaml: hub.auth.login is null, expected a mapping holding mode, oauth'],
      ['/srv/hub/hub.yaml: hub.auth.login is basic, expected a mapping holding mode, oauth'],
    ]);
  });

  it('refuses a key it does not read, beside a known-key control', () => {
    expect(read({})).toEqual({ mode: 'basic', oauth: null });
    expect(problems({ mdoe: 'basic' })).toEqual([
      '/srv/hub/hub.yaml: hub.auth.login.mdoe is not a key the hub reads; expected one of hub.auth.login.mode, hub.auth.login.oauth',
    ]);
  });

  it('refuses a mode other than basic or oauth, a capitalised one and a boolean included', () => {
    expect([problems({ mode: 'sso' }), problems({ mode: 'Basic' }), problems({ mode: true })]).toEqual([
      [`/srv/hub/hub.yaml: hub.auth.login.mode is "sso", ${MODE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.mode is "Basic", ${MODE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.mode is true, ${MODE_EXPECTED}`],
    ]);
  });

  it('refuses oauth settings under basic, the default mode included', () => {
    const expected = ['/srv/hub/hub.yaml: hub.auth.login.oauth is set while hub.auth.login.mode is basic; expected hub.auth.login.mode: oauth beside it, or no hub.auth.login.oauth'];

    expect([problems({ oauth: OAUTH }), problems({ mode: 'basic', oauth: OAUTH })]).toEqual([expected, expected]);
  });

  it('refuses oauth left out, or no mapping, under mode oauth', () => {
    expect([problems({ mode: 'oauth' }), problems({ mode: 'oauth', oauth: 'github' })]).toEqual([
      ['/srv/hub/hub.yaml: hub.auth.login.oauth is missing, expected a mapping holding authorizeUrl, tokenUrl, userUrl, clientId, clientSecretVariable, scope, allowed under hub.auth.login.mode: oauth'],
      ['/srv/hub/hub.yaml: hub.auth.login.oauth is "github", expected a mapping holding authorizeUrl, tokenUrl, userUrl, clientId, clientSecretVariable, scope, allowed'],
    ]);
  });
});

describe('hub.auth.login.oauth', () => {
  it('reads every setting written, scope null when left out, frozen', () => {
    const login = read(oauthLogin()) as HubLoginConfig;

    expect(login).toEqual({
      mode: 'oauth',
      oauth: { ...OAUTH, scope: null },
    });
    expect([Object.isFrozen(login), Object.isFrozen(login.oauth)]).toEqual([true, true]);
    expect(read(oauthLogin({ scope: 'read:user' }))).toEqual({ mode: 'oauth', oauth: { ...OAUTH, scope: 'read:user' } });
  });

  it('refuses each required setting left out, in key order', () => {
    expect(problems({ mode: 'oauth', oauth: {} })).toEqual([
      `/srv/hub/hub.yaml: hub.auth.login.oauth.authorizeUrl is missing, ${URL_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is missing, ${URL_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.userUrl is missing, ${URL_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.clientId is missing, ${TEXT_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.clientSecretVariable is missing, ${SECRET_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed is missing, ${ALLOWED_EXPECTED}`,
    ]);
  });

  it('refuses a key it does not read', () => {
    expect(problems(oauthLogin({ clientSecret: 'RAFA_HUB_OAUTH_SECRET' }))).toEqual([
      '/srv/hub/hub.yaml: hub.auth.login.oauth.clientSecret is not a key the hub reads; expected one of hub.auth.login.oauth.authorizeUrl, hub.auth.login.oauth.tokenUrl, hub.auth.login.oauth.userUrl, hub.auth.login.oauth.clientId, hub.auth.login.oauth.clientSecretVariable, hub.auth.login.oauth.scope, hub.auth.login.oauth.allowed',
    ]);
  });

  it('accepts http on a loopback host, beside the refused URLs', () => {
    const loopback = ['http://localhost:9000/authorize', 'http://127.0.0.1:9000/token', 'http://[::1]:9000/user'];

    expect(loopback.map((url) => problems(oauthLogin({ authorizeUrl: url })))).toEqual([[], [], []]);
  });

  it('refuses a URL in the clear off loopback, a relative one, one holding credentials, and no URL at all', () => {
    const refused = ['http://idp.example.com/token', '/login/oauth/access_token', 'https://hub:s3cret@idp.example.com/token', 'ftp://idp.example.com/token', ' https://idp.example.com/token', 7373];

    expect(refused.map((url) => problems(oauthLogin({ tokenUrl: url })))).toEqual([
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is "http://idp.example.com/token", ${URL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is "/login/oauth/access_token", ${URL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is "https://hub:s3cret@idp.example.com/token", ${URL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is "ftp://idp.example.com/token", ${URL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is " https://idp.example.com/token", ${URL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is 7373, ${URL_EXPECTED}`],
    ]);
  });

  it('refuses each of the three URLs by its own key', () => {
    const wrong = 'http://idp.example.com/x';

    expect(problems(oauthLogin({ authorizeUrl: wrong, tokenUrl: wrong, userUrl: wrong }))).toEqual([
      `/srv/hub/hub.yaml: hub.auth.login.oauth.authorizeUrl is "http://idp.example.com/x", ${URL_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.tokenUrl is "http://idp.example.com/x", ${URL_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.userUrl is "http://idp.example.com/x", ${URL_EXPECTED}`,
    ]);
  });

  it('refuses a clientId or a scope that is empty, padded or no text', () => {
    expect([
      problems(oauthLogin({ clientId: '' })),
      problems(oauthLogin({ clientId: ' Iv1 ' })),
      problems(oauthLogin({ clientId: 42 })),
      problems(oauthLogin({ scope: '' })),
      problems(oauthLogin({ scope: null })),
    ]).toEqual([
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.clientId is "", ${TEXT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.clientId is " Iv1 ", ${TEXT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.clientId is 42, ${TEXT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.scope is "", ${TEXT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.scope is null, ${TEXT_EXPECTED}`],
    ]);
  });

  it('refuses a clientSecretVariable that is no variable name, never repeating it', () => {
    const planted = 'gho_16C7e42F292c6912E7710c838347Ae178B4a';
    const refused = [planted, 'rafa_hub_secret', '1SECRET', ''];
    const expected = `/srv/hub/hub.yaml: hub.auth.login.oauth.clientSecretVariable is not an environment variable name, ${SECRET_EXPECTED}`;
    const found = refused.map((value) => problems(oauthLogin({ clientSecretVariable: value })));

    expect(found).toEqual([[expected], [expected], [expected], [expected]]);
    expect(found.flat().some((line) => line.includes(planted))).toBe(false);
    // Control: a refusal that repeats its value would show the planted one, as the URL refusal does.
    expect(problems(oauthLogin({ userUrl: planted })).some((line) => line.includes(planted))).toBe(true);
  });
});

describe('hub.auth.login.oauth.allowed', () => {
  /** The problems `allowed: raw` is refused with. */
  const allowedProblems = (raw: unknown) => problems(oauthLogin({ allowed: raw }));

  it('reads text ids and whole-number ids as their digits, in the order listed', () => {
    expect(read(oauthLogin({ allowed: ['octocat', 583_231, 0] }))).toEqual({
      mode: 'oauth',
      oauth: { ...OAUTH, scope: null, allowed: ['octocat', '583231', '0'] },
    });
  });

  it('refuses a list that is empty, a mapping or a scalar', () => {
    expect([allowedProblems([]), allowedProblems({ id: '583231' }), allowedProblems('583231')]).toEqual([
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.allowed is an empty list, ${ALLOWED_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.allowed is a mapping, ${ALLOWED_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.login.oauth.allowed is "583231", ${ALLOWED_EXPECTED}`],
    ]);
  });

  it('refuses each entry that is no user id by its position', () => {
    expect(allowedProblems(['583231', '', ' octocat', -1, 1.5, 2 ** 53, null, true])).toEqual([
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[1] is "", ${ALLOWED_ID_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[2] is " octocat", ${ALLOWED_ID_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[3] is -1, ${ALLOWED_ID_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[4] is 1.5, ${ALLOWED_ID_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[5] is 9007199254740992, ${ALLOWED_ID_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[6] is null, ${ALLOWED_ID_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[7] is true, ${ALLOWED_ID_EXPECTED}`,
    ]);
  });

  it('refuses an id listed twice, a number and its digits included, naming both positions', () => {
    expect(allowedProblems(['583231', 'octocat', 583_231])).toEqual([
      '/srv/hub/hub.yaml: hub.auth.login.oauth.allowed[2] is "583231", as hub.auth.login.oauth.allowed[0] is; expected each user id listed once',
    ]);
  });
});

describe('the hub config', () => {
  /** A config file's text: `hub.repository` and `hub.auth` holding `lines`. */
  const authYaml = (...lines: string[]) => ['hub:', '  repository: open-tomato/rafa', '  auth:', ...lines.map((line) => `    ${line}`)].join('\n');

  /** The problems parsing `text` is refused with; fails the case when it threw anything else. */
  const parseProblems = (text: string): readonly string[] => {
    try {
      parseHubConfig(text, PATH);
    } catch (error) {
      if (error instanceof HubConfigError) return error.problems;
      throw error;
    }
    throw new Error('expected a HubConfigError, and nothing was thrown');
  };

  it('sets login on the config: null under github, basic by default under api-key', () => {
    expect(parseHubConfig(authYaml('cacheFor: 10m'), PATH).login).toBeNull();
    expect(parseHubConfig(authYaml('adapter: api-key', 'apiKeys: [RAFA_HUB_KEY]'), PATH).login).toEqual({ mode: 'basic', oauth: null });
  });

  it('reads an oauth login written in YAML, a bare numeric id included', () => {
    const config = parseHubConfig(authYaml(
      'adapter: api-key',
      'apiKeys: [RAFA_HUB_KEY]',
      'login:',
      '  mode: oauth',
      '  oauth:',
      '    authorizeUrl: https://github.com/login/oauth/authorize',
      '    tokenUrl: https://github.com/login/oauth/access_token',
      '    userUrl: https://api.github.com/user',
      '    clientId: Iv1.8a61f9b3a7aba766',
      '    clientSecretVariable: RAFA_HUB_OAUTH_SECRET',
      '    scope: read:user',
      '    allowed: [583231]',
    ), PATH);

    expect(config.login).toEqual({ mode: 'oauth', oauth: { ...OAUTH, scope: 'read:user' } });
  });

  it('refuses a login under github through parseHubConfig, beside every other problem in key order', () => {
    expect(parseProblems(authYaml('cacheFor: 0m', 'login:', '  mode: basic'))).toEqual([
      '/srv/hub/hub.yaml: hub.auth.cacheFor is "0m", expected a duration of whole s, m or h from 1m to 24h, such as 10m, or false to ask GitHub on every request',
      '/srv/hub/hub.yaml: hub.auth.login is set while hub.auth.adapter is github; expected hub.auth.adapter: api-key beside it, or no hub.auth.login',
    ]);
  });

  it('names login among the keys hub.auth reads', () => {
    expect(parseProblems(authYaml('logins: {}'))).toEqual([
      '/srv/hub/hub.yaml: hub.auth.logins is not a key the hub reads; expected one of hub.auth.adapter, hub.auth.apiKeys, hub.auth.cacheFor, hub.auth.login',
    ]);
  });
});
