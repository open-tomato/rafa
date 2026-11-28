/**
 * Tests for the hub config file's top level (`config-top-level.ts`):
 * the refuse mode beside `hub` and under `dangerous`, each refusal
 * naming where its key belongs, the refusal of a function value naming
 * its key path, and both reaching `readHubDocument` and
 * `parseHubConfig` beside the readers' own problems.
 *
 * Each refusal sits beside an accepting control, so a rule that refused
 * everything, or one that never fired, fails here rather than passing.
 * Every refusal is spelled, never built from the module's own
 * constants. A `.ts` module's default export is stood in for by the
 * object it would hold, so nothing here loads a file.
 */
import type { HubConfigFile } from './config-top-level.js';

import { describe, expect, it } from 'bun:test';

import { readFunctionValues, readTopLevel } from './config-top-level.js';
import { HubConfigError, parseHubConfig, readHubDocument } from './config.js';

/** The config file's path, as a refusal names it. */
const PATH = '/srv/hub/rafa-hub.config.ts';

/** Where a project key belongs, as a refusal says it. */
const PROJECT = 'expected it in the project\'s rafa.config.ts, which the hub never reads';

/** Where a served-project key belongs, as a refusal says it. */
const SERVED = 'expected the projects the hub serves under hub.projects, each holding id, name, repository and storePath';

/** What the top level takes, as a refusal says it. */
const TOP_LEVEL = 'expected only hub and dangerous at the top level';

/** What `dangerous` takes, as a refusal says it. */
const DANGEROUS = 'expected only dangerous.hub under dangerous';

/** What a key holding a function takes, as a refusal says it. */
const FUNCTION = 'expected a value written out; the hub\'s config declares no extension point, so it runs no function';

/** The refusal of `key` as no key of the hub's config, naming `expected`. */
function notAKey(key: string, expected: string): string {
  return `${PATH}: ${key} is not a key of the hub's config; ${expected}`;
}

/** The refusal of a function at `key`. */
function aFunction(key: string): string {
  return `${PATH}: ${key} is a function, ${FUNCTION}`;
}

/** A root commit sha, as git prints it. */
const SHA = 'a'.repeat(40);

/** The smallest config the hub reads, as a `.ts` module exports it. */
const MINIMAL = { hub: { repository: 'open-tomato/rafa' } } satisfies HubConfigFile;

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

describe('readTopLevel', () => {
  it('accepts hub and dangerous holding hub, keeping both as written', () => {
    const document = { hub: { port: 7373 }, dangerous: { hub: { maxPayloadRows: 10 } } };

    expect(readTopLevel(PATH, document)).toEqual({ sections: document, problems: [] });
    expect(readTopLevel(PATH, { hub: {} }).problems).toEqual([]);
  });

  it('refuses a key other than hub and dangerous, a misspelt dangerous among them', () => {
    expect(readTopLevel(PATH, { hub: {}, dangerus: { hub: {} }, port: 7373 }).problems).toEqual([
      notAKey('dangerus', TOP_LEVEL),
      notAKey('port', TOP_LEVEL),
    ]);
  });

  it('names a project\'s rafa.config.ts for a project key, beside a control that is none', () => {
    expect(readTopLevel(PATH, { loop: {}, triage: {}, store: {}, lop: {} }).problems).toEqual([
      notAKey('loop', PROJECT),
      notAKey('triage', PROJECT),
      notAKey('store', PROJECT),
      notAKey('lop', TOP_LEVEL),
    ]);
  });

  it('names hub.projects for a served-project key', () => {
    expect(readTopLevel(PATH, { projects: [], id: SHA, name: 'rafa', repository: 'open-tomato/rafa', storePath: '/data/a.sqlite' }).problems)
      .toEqual(['projects', 'id', 'name', 'repository', 'storePath'].map((key) => notAKey(key, SERVED)));
  });

  it('names rafa-hub install for an install key', () => {
    expect(readTopLevel(PATH, { install: { dataDir: '/data' } }).problems).toEqual([
      notAKey('install', 'expected the install\'s values in the install record, written by rafa-hub install'),
    ]);
  });

  it('refuses a key under dangerous other than hub, naming the project\'s file for a project one, and keeps only hub', () => {
    const reading = readTopLevel(PATH, { dangerous: { hub: { maxPayloadRows: 10 }, acceptStaleRefs: true, store: {} } });

    expect(reading.problems).toEqual([
      notAKey('dangerous.acceptStaleRefs', PROJECT),
      notAKey('dangerous.store', DANGEROUS),
    ]);
    expect(reading.sections).toEqual({ dangerous: { hub: { maxPayloadRows: 10 } } });
  });

  it('keeps the sections the readers take and leaves the refused keys out', () => {
    expect(readTopLevel(PATH, { loop: {}, hub: { port: 1 }, install: {} }).sections).toEqual({ hub: { port: 1 } });
  });

  it('judges nothing of a document that is no mapping, nor of a dangerous that is none', () => {
    expect(readTopLevel(PATH, null)).toEqual({ sections: {}, problems: [] });
    expect(readTopLevel(PATH, ['hub'])).toEqual({ sections: {}, problems: [] });
    expect(readTopLevel(PATH, { hub: {}, dangerous: 'yes' })).toEqual({ sections: { hub: {}, dangerous: 'yes' }, problems: [] });
  });
});

describe('readFunctionValues', () => {
  it('finds none in a document without one, and hands it back equal', () => {
    const document = { hub: { repository: 'open-tomato/rafa', projects: [{ id: SHA }], auth: { apiKeys: ['A', 'B'] } } };

    expect(readFunctionValues(PATH, document)).toEqual({ document, keys: [], problems: [] });
  });

  it('refuses a function at any depth, naming its key path, and leaves it out of the document', () => {
    const values = readFunctionValues(PATH, {
      hub: {
        port: () => 7373,
        projects: [{ id: SHA, name: () => 'rafa' }],
        auth: { apiKeys: ['A', () => 'B', 'C'] },
      },
    });

    expect(values.problems).toEqual([
      aFunction('hub.port'),
      aFunction('hub.projects[0].name'),
      aFunction('hub.auth.apiKeys[1]'),
    ]);
    expect(values.keys).toEqual(['hub.port', 'hub.projects[0].name', 'hub.auth.apiKeys[1]']);
    expect(values.document).toEqual({ hub: { projects: [{ id: SHA }], auth: { apiKeys: ['A', undefined, 'C'] } } });
  });

  it('never repeats the function\'s source in its refusal', () => {
    const [problem] = readFunctionValues(PATH, { hub: { repository: () => 'secret-owner/secret-name' } }).problems;

    expect(problem).toBe(aFunction('hub.repository'));
    expect(problem).not.toContain('secret-owner');
  });

  it('refuses a function standing for the whole document or for hub', () => {
    expect(readFunctionValues(PATH, () => MINIMAL).problems).toEqual([aFunction('the top level')]);
    expect(readFunctionValues(PATH, { hub: () => ({}) }).problems).toEqual([aFunction('hub')]);
  });

  it('ends on a cyclic object and keeps a class instance as written', () => {
    const cyclic: Record<string, unknown> = { port: 7373 };
    cyclic['self'] = cyclic;
    const url = new URL('https://example.com');

    expect(readFunctionValues(PATH, { hub: cyclic }).problems).toEqual([]);
    expect((readFunctionValues(PATH, { hub: { url } }).document as { hub: { url: unknown } }).hub.url).toBe(url);
  });
});

describe('readHubDocument', () => {
  it('reads a .ts module\'s object to the HubConfig its YAML reads to', () => {
    const yaml = 'hub:\n  repository: open-tomato/rafa\n  port: 7400\ndangerous:\n  hub:\n    maxPayloadRows: 1000';
    const document = { hub: { repository: 'open-tomato/rafa', port: 7400 }, dangerous: { hub: { maxPayloadRows: 1000 } } } satisfies HubConfigFile;

    expect(readHubDocument(document, PATH)).toEqual(parseHubConfig(yaml, PATH));
    expect(readHubDocument(document, PATH).port).toBe(7400);
  });

  it('refuses a function in place of a required key once, by its value, not again as missing', () => {
    expect(problemsOf(() => readHubDocument({ hub: { repository: () => 'open-tomato/rafa' } }, PATH))).toEqual([
      aFunction('hub.repository'),
    ]);
    expect(problemsOf(() => readHubDocument({ hub: () => MINIMAL.hub }, PATH))).toEqual([aFunction('hub')]);
  });

  it('collects the top level, the functions and the readers\' problems into one refusal, in that order', () => {
    const document = { loop: {}, hub: { repository: 'open-tomato/rafa', port: 0, storePath: () => '/data/x.sqlite' } };

    expect(problemsOf(() => readHubDocument(document, PATH))).toEqual([
      notAKey('loop', PROJECT),
      aFunction('hub.storePath'),
      `${PATH}: hub.port is 0, expected a whole number from 1 to 65535, such as 7373`,
    ]);
  });

  it('refuses a top-level key beside a hub that is no mapping, both at once', () => {
    expect(problemsOf(() => readHubDocument({ port: 7373, hub: 'open-tomato/rafa' }, PATH))).toEqual([
      notAKey('port', TOP_LEVEL),
      `${PATH}: hub is "open-tomato/rafa", expected a mapping holding hub.repository`,
    ]);
  });

  it('refuses a top-level key alone when every hub key reads', () => {
    expect(problemsOf(() => readHubDocument({ ...MINIMAL, tests: {} }, PATH))).toEqual([notAKey('tests', PROJECT)]);
    expect(readHubDocument(MINIMAL, PATH).repository).toBe('open-tomato/rafa');
  });
});

describe('parseHubConfig, the YAML form', () => {
  const yamlPath = '/srv/hub/rafa-hub.yaml';
  const base = 'hub:\n  repository: open-tomato/rafa';

  it('refuses an unknown top-level key and a key under dangerous other than hub, beside a control with neither', () => {
    expect(parseHubConfig(base.concat('\ndangerous:\n  hub:\n    maxPayloadRows: 1000'), yamlPath).maxPayloadRows).toBe(1000);
    expect(problemsOf(() => parseHubConfig(base.concat('\ndangerus:\n  hub: {}'), yamlPath))).toEqual([
      `${yamlPath}: dangerus is not a key of the hub's config; ${TOP_LEVEL}`,
    ]);
    expect(problemsOf(() => parseHubConfig(base.concat('\ndangerous:\n  store: {}'), yamlPath))).toEqual([
      `${yamlPath}: dangerous.store is not a key of the hub's config; ${DANGEROUS}`,
    ]);
  });

  it('refuses a project block pasted beside hub, naming the project\'s rafa.config.ts', () => {
    expect(problemsOf(() => parseHubConfig(base.concat('\nloop:\n  worktreeSetup: bun install'), yamlPath))).toEqual([
      `${yamlPath}: loop is not a key of the hub's config; ${PROJECT}`,
    ]);
  });
});
