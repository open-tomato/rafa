/**
 * Tests for the `hub` section (`config-schema-hub.ts`): the readers of
 * `hub.url` and `hub.timeout`, the milliseconds a timeout spells, the
 * refusal of `effort.sync: service` with no `hub.url` in any layer, and
 * the context `selectSync` hands an adapter.
 *
 * Each refusal sits beside an accepting control of the same reader or
 * the same resolution, so a reader that refused everything, or a check
 * that never fired, fails here rather than passing. Every refusal is
 * SPELLED, never built from the module's own text. The refusal across
 * two settings is driven through `parseConfigText` and `resolveConfig`,
 * the path every command's config takes, with the project and user
 * files each naming one half.
 */
import type { ValueAt } from './config-sections.js';

import { describe, expect, it } from 'bun:test';

import { hubContextOf, hubTimeout, hubTimeoutMs, hubUrl } from './config-schema-hub.js';
import { ConfigError, parseConfigText, resolveConfig } from './config.js';

/** Where every reader case reads its value. */
const AT: ValueAt = { label: 'F: hub.x', key: 'hub.x' };

/** The project file's path, as a refusal names it. */
const PROJECT = '/repo/.rafa/config.yaml';

/** The user scope's file path, as a refusal names it. */
const USER = '/home/someone/.rafa/config.yaml';

/** What the timeout reader says it expected. */
const TIMEOUT_EXPECTED = 'expected a duration of whole seconds from 1s to 30s, such as 3s';

/** What the url reader says it expected. */
const URL_EXPECTED = 'expected an http or https URL with no user name or password, such as https://hub.example.org';

/** The refusal of `service` with no `hub.url`, opened by `label`. */
function missingUrl(label: string): string {
  return `${label}: effort.sync is "service" and no config file names hub.url;`
    + ' expected hub.url, the address of the hub, such as https://hub.example.org';
}

/** The `ConfigError` `attempt` threw; fails the case when it threw nothing else. */
function refusal(attempt: () => unknown): ConfigError {
  try {
    attempt();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and nothing was thrown');
}

describe('hub.timeout', () => {
  it('accepts whole seconds from 1s to 30s, kept as written', () => {
    expect(['1s', '3s', '30s'].map((raw) => hubTimeout(raw, AT))).toEqual([
      { value: '1s', problems: [], extras: [] },
      { value: '3s', problems: [], extras: [] },
      { value: '30s', problems: [], extras: [] },
    ]);
  });

  it('refuses 0, negative and out-of-range values, naming the range', () => {
    const refused = ['0s', '-1s', '31s', 0, -3].map((raw) => hubTimeout(raw, AT));

    expect(refused.map((reading) => reading.value)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(refused.map((reading) => reading.problems)).toEqual([
      [`F: hub.x is "0s", ${TIMEOUT_EXPECTED}`],
      [`F: hub.x is "-1s", ${TIMEOUT_EXPECTED}`],
      [`F: hub.x is "31s", ${TIMEOUT_EXPECTED}`],
      [`F: hub.x is 0, ${TIMEOUT_EXPECTED}`],
      [`F: hub.x is -3, ${TIMEOUT_EXPECTED}`],
    ]);
  });

  it('refuses a bare number, a fraction, another unit and a padded or capitalised spelling', () => {
    const spellings = [3, '3', '2.5s', '3000ms', '1m', '3S', ' 3s', '3s ', true, null];

    expect(spellings.filter((raw) => hubTimeout(raw, AT).value !== undefined)).toEqual([]);
  });

  it('answers the milliseconds a timeout spells, and null for one it refuses', () => {
    expect(['1s', '3s', '30s', '030s'].map(hubTimeoutMs)).toEqual([1000, 3000, 30_000, 30_000]);
    expect(['0s', '31s', '3', 3, undefined].map(hubTimeoutMs)).toEqual([null, null, null, null, null]);
  });
});

describe('hub.url', () => {
  it('accepts an http or https URL, kept as written', () => {
    const urls = ['https://hub.example.org', 'http://localhost:7373', 'https://hub.example.org/team/'];

    expect(urls.map((raw) => hubUrl(raw, AT).value)).toEqual(urls);
  });

  it('refuses a URL carrying a user name or password, so no token sits in the config', () => {
    expect(hubUrl('https://ghp_secret@hub.example.org', AT).problems).toEqual([
      `F: hub.x is "https://ghp_secret@hub.example.org", ${URL_EXPECTED}`,
    ]);
    expect(hubUrl('https://me:ghp_secret@hub.example.org', AT).value).toBeUndefined();
  });

  it('refuses another scheme, a bare host, padding and anything not a string', () => {
    const refused = ['ftp://hub.example.org', 'hub.example.org', '/v1', ' https://hub.example.org', '', 7373, null];

    expect(refused.filter((raw) => hubUrl(raw, AT).value !== undefined)).toEqual([]);
  });
});

describe('the defaults', () => {
  it('answer no url, no secret name and 3s when no layer names the section', () => {
    const { config, sources } = resolveConfig();

    expect([config.hubUrl, config.hubTokenSecret, config.hubTimeout]).toEqual([null, null, '3s']);
    expect([sources.hubUrl, sources.hubTokenSecret, sources.hubTimeout]).toEqual(['default', 'default', 'default']);
  });

  it('are not settings the command line can name', () => {
    const cli = { hubUrl: 'https://hub.example.org', hubTimeout: '9s' } as Record<string, string>;
    const { config } = resolveConfig({ cli });

    expect([config.hubUrl, config.hubTimeout]).toEqual([null, '3s']);
  });
});

describe('effort.sync: service with no hub.url', () => {
  it('is refused, naming the project file that chose service', () => {
    const file = parseConfigText('effort:\n  sync: service\n', PROJECT);

    expect(refusal(() => resolveConfig({ file })).problems).toEqual([missingUrl(PROJECT)]);
  });

  it('is resolved once the same file names hub.url, the control', () => {
    const file = parseConfigText('effort:\n  sync: service\nhub:\n  url: https://hub.example.org\n', PROJECT);
    const { config } = resolveConfig({ file });

    expect([config.effortSync, config.hubUrl]).toEqual(['service', 'https://hub.example.org']);
  });

  it('names the user file when that is the layer choosing service', () => {
    const user = parseConfigText('effort:\n  sync: service\n', USER);
    const file = parseConfigText('hub:\n  timeout: 5s\n', PROJECT);

    expect(refusal(() => resolveConfig({ file, user })).problems).toEqual([missingUrl(USER)]);
  });

  it('is resolved with the url in the user file and service in the project file', () => {
    const user = parseConfigText('hub:\n  url: https://hub.example.org\n', USER);
    const file = parseConfigText('effort:\n  sync: service\n', PROJECT);
    const { config, sources } = resolveConfig({ file, user });

    expect([config.effortSync, sources.effortSync]).toEqual(['service', 'file']);
    expect([config.hubUrl, sources.hubUrl]).toEqual(['https://hub.example.org', 'user']);
  });

  it('is judged on the resolution and not on one file, so parsing either half alone refuses nothing', () => {
    expect(parseConfigText('effort:\n  sync: service\n', PROJECT).values.effortSync).toBe('service');
  });

  it('leaves every other strategy free of hub.url', () => {
    const resolved = ['local', 'file', 'git', 'p2p'].map((strategy) => resolveConfig({
      file: parseConfigText(`effort:\n  sync: ${strategy}\n`, PROJECT),
    }).config.effortSync);

    expect(resolved).toEqual(['local', 'file', 'git', 'p2p']);
  });
});

describe('hubContextOf', () => {
  it('answers the url, the secret name and the timeout in milliseconds, frozen', () => {
    const context = hubContextOf({ hubUrl: 'https://hub.example.org', hubTokenSecret: 'rafa-hub-token', hubTimeout: '7s' });

    expect(context).toEqual({ url: 'https://hub.example.org', tokenSecret: 'rafa-hub-token', timeoutMs: 7000 });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('answers the resolved defaults for a url alone', () => {
    expect(hubContextOf({ hubUrl: 'https://hub.example.org' }))
      .toEqual({ url: 'https://hub.example.org', tokenSecret: null, timeoutMs: 3000 });
  });

  it('answers nothing with no url, whatever else is named', () => {
    expect(hubContextOf({ hubUrl: null, hubTokenSecret: 'rafa-hub-token', hubTimeout: '7s' })).toBeUndefined();
    expect(hubContextOf({})).toBeUndefined();
  });

  it('refuses a timeout no config accepts, which only a hand-built config can carry', () => {
    const attempt = (): unknown => hubContextOf({ hubUrl: 'https://hub.example.org', hubTimeout: '0s' });

    expect(attempt).toThrow(new TypeError('hub.timeout is "0s", which no config accepts'));
  });
});
