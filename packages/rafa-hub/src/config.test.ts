/**
 * Tests for the hub's config reader (`config.ts`): the four server keys,
 * their defaults, the refusal of `0`, negative and out-of-range values,
 * and the file `RAFA_HUB_CONFIG` names.
 *
 * Each refusal sits beside an accepting control of the same key, so a
 * reader that refused everything, or a check that never fired, fails
 * here rather than passing. Every refusal is SPELLED, never built from
 * the module's own constants. Files are written under a fresh `tmpdir`
 * directory per case, and the environment is handed in, never read
 * from `process.env`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { cacheForMs, HubConfigError, parseHubConfig, readHubConfig } from './config.js';

/** The config file's path, as a refusal names it. */
const PATH = '/srv/hub/hub.yaml';

/** What `hub.port` says it expected. */
const PORT_EXPECTED = 'expected a whole number from 1 to 65535, such as 7373';

/** What `hub.auth.cacheFor` says it expected. */
const CACHE_EXPECTED = 'expected a duration of whole s, m or h from 1m to 24h, such as 10m, or false to ask GitHub on every request';

/** What `hub.repository` says it expected. */
const REPOSITORY_EXPECTED = 'expected a GitHub repository as owner/name, such as open-tomato/rafa';

/** A config file's text: `hub.repository` set, then `lines` under `hub`. */
function hubYaml(...lines: string[]): string {
  return ['hub:', '  repository: open-tomato/rafa', ...lines.map((line) => `  ${line}`)].join('\n');
}

/** The problems `attempt` was refused with; fails the case when it threw anything else. */
function problemsOf(attempt: () => unknown): readonly string[] {
  try {
    attempt();
  } catch (error) {
    if (error instanceof HubConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected a HubConfigError, and nothing was thrown');
}

describe('defaults', () => {
  it('fills port, storePath and cacheFor when only hub.repository is written', () => {
    expect(parseHubConfig(hubYaml(), PATH)).toEqual({
      repository: 'open-tomato/rafa',
      port: 7373,
      storePath: '/srv/hub/rafa-hub.sqlite',
      cacheForMs: 600_000,
    });
  });

  it('keeps every value written over its default', () => {
    const config = parseHubConfig(hubYaml('port: 8080', 'storePath: /data/hub.sqlite', 'auth:', '  cacheFor: 1h'), PATH);

    expect(config).toEqual({
      repository: 'open-tomato/rafa',
      port: 8080,
      storePath: '/data/hub.sqlite',
      cacheForMs: 3_600_000,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('hub.repository', () => {
  it('accepts owner/name with the characters GitHub allows', () => {
    const names = ['open-tomato/rafa', 'a/b', 'Org-1/repo.name_2', 'x/.github'];

    expect(names.map((name) => parseHubConfig(`hub:\n  repository: ${name}`, PATH).repository)).toEqual(names);
  });

  it('refuses a missing repository', () => {
    expect(problemsOf(() => parseHubConfig('hub:\n  port: 7373', PATH))).toEqual([
      `/srv/hub/hub.yaml: hub.repository is missing, ${REPOSITORY_EXPECTED}`,
    ]);
  });

  it('refuses a bare name, a URL, a third segment, a reserved name and a non-string', () => {
    const cases = ['rafa', 'https://github.com/open-tomato/rafa', 'a/b/c', 'owner/..', '-owner/rafa', '42'];

    expect(cases.map((raw) => problemsOf(() => parseHubConfig(`hub:\n  repository: ${raw}`, PATH)))).toEqual([
      [`/srv/hub/hub.yaml: hub.repository is "rafa", ${REPOSITORY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.repository is "https://github.com/open-tomato/rafa", ${REPOSITORY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.repository is "a/b/c", ${REPOSITORY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.repository is "owner/..", ${REPOSITORY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.repository is "-owner/rafa", ${REPOSITORY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.repository is 42, ${REPOSITORY_EXPECTED}`],
    ]);
  });
});

describe('hub.port', () => {
  it('accepts whole numbers from 1 to 65535', () => {
    expect(['1', '7373', '65535'].map((raw) => parseHubConfig(hubYaml(`port: ${raw}`), PATH).port))
      .toEqual([1, 7373, 65_535]);
  });

  it('refuses 0, negative and out-of-range values, naming the range', () => {
    expect(['0', '-1', '65536'].map((raw) => problemsOf(() => parseHubConfig(hubYaml(`port: ${raw}`), PATH)))).toEqual([
      [`/srv/hub/hub.yaml: hub.port is 0, ${PORT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.port is -1, ${PORT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.port is 65536, ${PORT_EXPECTED}`],
    ]);
  });

  it('refuses a fraction, a quoted number and a boolean without coercing', () => {
    expect(['80.5', '\'7373\'', 'true'].map((raw) => problemsOf(() => parseHubConfig(hubYaml(`port: ${raw}`), PATH)))).toEqual([
      [`/srv/hub/hub.yaml: hub.port is 80.5, ${PORT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.port is "7373", ${PORT_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.port is true, ${PORT_EXPECTED}`],
    ]);
  });
});

describe('hub.storePath', () => {
  it('resolves a relative path against the config file directory, not the working directory', () => {
    expect(parseHubConfig(hubYaml('storePath: data/hub.sqlite'), PATH).storePath).toBe('/srv/hub/data/hub.sqlite');
    expect(parseHubConfig(hubYaml('storePath: ../hub.sqlite'), PATH).storePath).toBe('/srv/hub.sqlite');
  });

  it('refuses an empty, padded or non-string path', () => {
    const expected = 'expected a file path, such as /data/rafa-hub.sqlite';

    expect(['\'\'', '\' /data/x\'', '7'].map((raw) => problemsOf(() => parseHubConfig(hubYaml(`storePath: ${raw}`), PATH)))).toEqual([
      [`/srv/hub/hub.yaml: hub.storePath is "", ${expected}`],
      [`/srv/hub/hub.yaml: hub.storePath is " /data/x", ${expected}`],
      [`/srv/hub/hub.yaml: hub.storePath is 7, ${expected}`],
    ]);
  });
});

describe('hub.auth.cacheFor', () => {
  it('accepts whole s, m or h from 1m to 24h, in milliseconds', () => {
    const spellings = ['60s', '1m', '10m', '90m', '24h'];

    expect(spellings.map((raw) => parseHubConfig(hubYaml('auth:', `  cacheFor: ${raw}`), PATH).cacheForMs))
      .toEqual([60_000, 60_000, 600_000, 5_400_000, 86_400_000]);
  });

  it('reads false as asking GitHub on every request', () => {
    expect(parseHubConfig(hubYaml('auth:', '  cacheFor: false'), PATH).cacheForMs).toBeNull();
  });

  it('reads an auth section without cacheFor as the default', () => {
    expect(parseHubConfig(hubYaml('auth: {}'), PATH).cacheForMs).toBe(600_000);
  });

  it('refuses 0, negative and out-of-range values, naming the range', () => {
    const spellings = ['0', '0m', '-1m', '59s', '25h', '1441m'];

    expect(spellings.map((raw) => problemsOf(() => parseHubConfig(hubYaml('auth:', `  cacheFor: ${raw}`), PATH)))).toEqual([
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is 0, ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "0m", ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "-1m", ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "59s", ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "25h", ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "1441m", ${CACHE_EXPECTED}`],
    ]);
  });

  it('refuses true, a fraction, another unit, a capital unit and a bare number', () => {
    const spellings = ['true', '1.5h', '1d', '10M', '600'];

    expect(spellings.map((raw) => problemsOf(() => parseHubConfig(hubYaml('auth:', `  cacheFor: ${raw}`), PATH)))).toEqual([
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is true, ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "1.5h", ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "1d", ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is "10M", ${CACHE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.auth.cacheFor is 600, ${CACHE_EXPECTED}`],
    ]);
  });

  it('answers cacheForMs for a padded spelling as undefined, beside its unpadded control', () => {
    expect([cacheForMs('10m'), cacheForMs(' 10m'), cacheForMs('10m ')]).toEqual([600_000, undefined, undefined]);
  });
});

describe('the document', () => {
  it('refuses unknown keys under hub and hub.auth, beside a known-key control', () => {
    expect(parseHubConfig(hubYaml('port: 7373', 'auth:', '  cacheFor: 10m'), PATH).port).toBe(7373);
    expect(problemsOf(() => parseHubConfig(hubYaml('prot: 7373', 'auth:', '  cachefor: 10m'), PATH))).toEqual([
      '/srv/hub/hub.yaml: hub.prot is not a key the hub reads; expected one of hub.repository, hub.port, hub.storePath, hub.auth',
      '/srv/hub/hub.yaml: hub.auth.cachefor is not a key the hub reads; expected one of hub.auth.cacheFor',
    ]);
  });

  it('refuses an auth section that is not a mapping', () => {
    expect(problemsOf(() => parseHubConfig(hubYaml('auth: 10m'), PATH))).toEqual([
      '/srv/hub/hub.yaml: hub.auth is "10m", expected a mapping holding cacheFor',
    ]);
  });

  it('reports every problem at once, in key order', () => {
    expect(problemsOf(() => parseHubConfig('hub:\n  port: 0\n  auth:\n    cacheFor: 0m', PATH))).toEqual([
      `/srv/hub/hub.yaml: hub.repository is missing, ${REPOSITORY_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.port is 0, ${PORT_EXPECTED}`,
      `/srv/hub/hub.yaml: hub.auth.cacheFor is "0m", ${CACHE_EXPECTED}`,
    ]);
  });

  it('refuses a file with no hub mapping, an empty file included', () => {
    expect(problemsOf(() => parseHubConfig('', PATH))).toEqual([
      '/srv/hub/hub.yaml: hub is undefined, expected a mapping holding hub.repository',
    ]);
    expect(problemsOf(() => parseHubConfig('hub: open-tomato/rafa', PATH))).toEqual([
      '/srv/hub/hub.yaml: hub is "open-tomato/rafa", expected a mapping holding hub.repository',
    ]);
  });

  it('refuses text that is not YAML, naming the file', () => {
    const problems = problemsOf(() => parseHubConfig('hub: [unclosed', PATH));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith('/srv/hub/hub.yaml: not valid YAML: ');
  });
});

describe('readHubConfig', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rafa-hub-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the file RAFA_HUB_CONFIG names, resolving the store beside it', async () => {
    const path = join(dir, 'hub.yaml');
    await writeFile(path, hubYaml('port: 9000'));

    expect(await readHubConfig({ RAFA_HUB_CONFIG: path })).toEqual({
      repository: 'open-tomato/rafa',
      port: 9000,
      storePath: join(dir, 'rafa-hub.sqlite'),
      cacheForMs: 600_000,
    });
  });

  it('refuses an unset or empty RAFA_HUB_CONFIG', async () => {
    const expected = ['RAFA_HUB_CONFIG is not set; expected the path of the hub\'s YAML config file'];

    for (const env of [{}, { RAFA_HUB_CONFIG: '' }, { RAFA_HUB_CONFIG: '  ' }]) {
      const error = await readHubConfig(env).then(() => null, (thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(HubConfigError);
      expect((error as HubConfigError).problems).toEqual(expected);
    }
  });

  it('refuses a file that cannot be read, naming its path', async () => {
    const path = join(dir, 'absent.yaml');
    const error = await readHubConfig({ RAFA_HUB_CONFIG: path }).then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HubConfigError);
    expect((error as HubConfigError).problems[0]).toStartWith(`${path}: the hub's config file could not be read: `);
  });

  it('refuses the problems of a file it read', async () => {
    const path = join(dir, 'hub.yaml');
    await writeFile(path, hubYaml('port: -1'));
    const error = await readHubConfig({ RAFA_HUB_CONFIG: path }).then(() => null, (thrown: unknown) => thrown);

    expect((error as HubConfigError).problems).toEqual([`${path}: hub.port is -1, ${PORT_EXPECTED}`]);
  });
});
