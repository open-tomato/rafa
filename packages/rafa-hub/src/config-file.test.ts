/**
 * Tests for the hub's config file (`config-file.ts`): which file
 * `RAFA_HUB_CONFIG` leads to and in which form, `readHubConfig`'s answer
 * and its refusals (both files in one directory, the YAML fallback beside
 * a missing `.ts` file, neither file), then the `.ts` module's load
 * through define-config's `createLoader`
 * into the `HubConfig` the same document reads to as YAML, each `false`
 * the merge removes set back, the section schemas for `hub` and
 * `dangerous`, and every refusal: an unresolved value import naming its
 * specifier, a module that cannot be loaded, a missing file, a path that
 * is no `.ts` file, the readers' problems and a key two entries set.
 *
 * Each refusal sits beside an accepting control: a type-only import
 * loads where the value import of the same package is refused, and a
 * clean file loads where its broken twin is refused. Every refusal is
 * spelled, never built from the module's own constants. Each fixture is
 * a file under a fresh `tmpdir`, never a real store.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { hubSectionSchemas, loadHubConfigFile, locateHubConfig, missingImportProblem, readHubConfig, restoredDocument } from './config-file.js';
import { HubConfigError, parseHubConfig } from './config.js';

/** Where a project key belongs, as a refusal says it. */
const PROJECT = 'expected it in the project\'s rafa.config.ts, which the hub never reads';

/** What a key holding a function takes, as a refusal says it. */
const FUNCTION = 'expected a value written out; the hub\'s config declares no extension point, so it runs no function';

/** What `hub.port` takes, as a refusal says it. */
const PORT_EXPECTED = 'expected a whole number from 1 to 65535, such as 7373';

/** What `dangerous.hub.maxPayloadRows` takes, as a refusal says it. */
const ROWS_EXPECTED = 'expected a whole number from 1 up, such as 50000, or unlimited';

/** What a refusal of both files in one directory says after naming them. */
const BOTH = 'both are the hub\'s config file, in one directory; expected one, '
  + 'so move what rafa-hub.yaml holds into rafa-hub.config.ts and remove rafa-hub.yaml';

/** A YAML config file's text: `hub.repository` set, then `lines` under `hub`. */
function hubYaml(...lines: string[]): string {
  return ['hub:', '  repository: open-tomato/rafa', ...lines.map((line) => `  ${line}`), ''].join('\n');
}

/** The `.ts` form of a config opening with the type-only import the README shows. */
function module(body: string): string {
  return `import type { HubConfigFile } from '@open-tomato/rafa-hub';\n\nexport default ${body} satisfies HubConfigFile;\n`;
}

/** A config whose first line is `line`, an import, then the default export `body`. */
function importing(line: string, body: string): string {
  return `${line}\n\nexport default ${body};\n`;
}

/** A config taking `hub.port` from a relative module, `./ports.ts`. */
const RELATIVE_PORT = importing('import { port } from \'./ports.ts\';', '{ hub: { repository: \'open-tomato/rafa\', port } }');

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'rafa-hub-config-file-')));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes `text` as `name` in the fixture directory and answers its path. */
async function fixture(name: string, text: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}

/** The problems `loadHubConfigFile` refuses the file at `path` with, or a failure if it loads. */
async function refusalOf(path: string): Promise<readonly string[]> {
  try {
    await loadHubConfigFile(path);
  } catch (error) {
    expect(error).toBeInstanceOf(HubConfigError);
    return (error as HubConfigError).problems;
  }
  throw new Error(`${path} loaded; expected a refusal`);
}

/** The problems `readHubConfig` refuses `env` with, or a failure if it reads. */
async function readRefusalOf(env: Readonly<Record<string, string | undefined>>): Promise<readonly string[]> {
  try {
    await readHubConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(HubConfigError);
    return (error as HubConfigError).problems;
  }
  throw new Error(`${String(env['RAFA_HUB_CONFIG'])} was read; expected a refusal`);
}

describe('readHubConfig', () => {
  it('reads the YAML file RAFA_HUB_CONFIG names, resolving the store beside it, as the yaml form', async () => {
    const path = await fixture('hub.yaml', hubYaml('port: 9000'));

    expect(await readHubConfig({ RAFA_HUB_CONFIG: path })).toEqual({
      form: 'yaml',
      path,
      config: {
        repository: 'open-tomato/rafa',
        port: 9000,
        storePath: join(dir, 'rafa-hub.sqlite'),
        projects: [{ id: 'default', name: 'open-tomato/rafa', repository: 'open-tomato/rafa', storePath: join(dir, 'rafa-hub.sqlite') }],
        cacheForMs: 600_000,
        authAdapter: 'github',
        apiKeys: [],
        login: null,
        storeEngine: 'sqlite',
        postgresUrlVariable: null,
        sqliteLibrary: null,
        rebuildAfterPush: true,
        embeddingModel: null,
        embeddingPrecision: 'half',
        maxPayloadRows: 50_000,
      },
    });
  });

  it('reads the .ts file RAFA_HUB_CONFIG names as the ts form, to the config its YAML twin reads to', async () => {
    const path = await fixture('rafa-hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\', port: 9000 } }'));
    const twin = await fixture('twin.yaml', hubYaml('port: 9000'));

    const reading = await readHubConfig({ RAFA_HUB_CONFIG: path });

    expect(reading.form).toBe('ts');
    expect(reading.path).toBe(path);
    expect(reading.config).toEqual((await readHubConfig({ RAFA_HUB_CONFIG: twin })).config);
    expect(Object.isFrozen(reading)).toBe(true);
  });

  it('refuses an unset or empty RAFA_HUB_CONFIG', async () => {
    const expected = ['RAFA_HUB_CONFIG is not set; expected the path of the hub\'s config file, such as rafa-hub.config.ts'];

    for (const env of [{}, { RAFA_HUB_CONFIG: '' }, { RAFA_HUB_CONFIG: '  ' }]) {
      expect(await readRefusalOf(env)).toEqual(expected);
    }
  });

  it('refuses a YAML file that cannot be read, naming its path', async () => {
    const path = join(dir, 'absent.yaml');

    const problems = await readRefusalOf({ RAFA_HUB_CONFIG: path });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith(`${path}: the hub's config file could not be read: `);
  });

  it('refuses the problems of a file it read, in either form', async () => {
    const yaml = await fixture('hub.yaml', hubYaml('port: -1'));
    const ts = await fixture('hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\', port: -1 } }'));

    expect(await readRefusalOf({ RAFA_HUB_CONFIG: yaml })).toEqual([`${yaml}: hub.port is -1, ${PORT_EXPECTED}`]);
    expect(await readRefusalOf({ RAFA_HUB_CONFIG: ts })).toEqual([`${ts}: hub.port is -1, ${PORT_EXPECTED}`]);
  });
});

describe('readHubConfig over the file-location rules', () => {
  it('refuses rafa-hub.config.ts and rafa-hub.yaml in one directory, naming both, whichever is named', async () => {
    const ts = await fixture('rafa-hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\' } }'));
    const yaml = await fixture('rafa-hub.yaml', hubYaml());
    const other = join(dir, 'hub.yaml');
    const expected = [`${ts} and ${yaml}: ${BOTH}`];

    expect(await readRefusalOf({ RAFA_HUB_CONFIG: ts })).toEqual(expected);
    expect(await readRefusalOf({ RAFA_HUB_CONFIG: yaml })).toEqual(expected);
    expect(await readRefusalOf({ RAFA_HUB_CONFIG: other })).toEqual(expected);
  });

  it('reads each of the two files when it stands alone in its directory', async () => {
    const ts = await fixture('rafa-hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\', port: 7001 } }'));
    const read = await readHubConfig({ RAFA_HUB_CONFIG: ts });
    await rm(ts);
    const yaml = await fixture('rafa-hub.yaml', hubYaml('port: 7002'));

    expect(read.config.port).toBe(7001);
    expect((await readHubConfig({ RAFA_HUB_CONFIG: yaml })).config.port).toBe(7002);
  });

  it('reads rafa-hub.yaml beside a missing named .ts file as the yaml form', async () => {
    const yaml = await fixture('rafa-hub.yaml', hubYaml('port: 7003'));

    for (const name of ['rafa-hub.config.ts', 'hub.config.ts']) {
      const reading = await readHubConfig({ RAFA_HUB_CONFIG: join(dir, name) });
      expect(reading.form).toBe('yaml');
      expect(reading.path).toBe(yaml);
      expect(reading.config.port).toBe(7003);
    }
  });

  it('refuses a missing .ts file with neither file beside it, naming the .ts path', async () => {
    const path = join(dir, 'rafa-hub.config.ts');

    expect(await readRefusalOf({ RAFA_HUB_CONFIG: path })).toEqual([
      `${path}: the hub's config file could not be read: no file at this path, and no rafa-hub.yaml beside it to read instead`,
    ]);
  });

  it('falls back to rafa-hub.yaml alone: a YAML file of another name beside the .ts path is no fallback', async () => {
    await fixture('hub.yaml', hubYaml());
    const path = join(dir, 'rafa-hub.config.ts');

    expect(await readRefusalOf({ RAFA_HUB_CONFIG: path })).toEqual([
      `${path}: the hub's config file could not be read: no file at this path, and no rafa-hub.yaml beside it to read instead`,
    ]);
  });

  it('reads a directory carrying the YAML file\'s name as no file, so neither both nor the fallback holds', async () => {
    const ts = await fixture('rafa-hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\', port: 7004 } }'));
    await mkdir(join(dir, 'rafa-hub.yaml'));

    expect((await readHubConfig({ RAFA_HUB_CONFIG: ts })).config.port).toBe(7004);
    await rm(ts);
    expect(await readRefusalOf({ RAFA_HUB_CONFIG: ts })).toEqual([
      `${ts}: the hub's config file could not be read: no file at this path, and no rafa-hub.yaml beside it to read instead`,
    ]);
  });

  it('loads a named .ts file of another name beside rafa-hub.yaml, as the two-file rule names only rafa-hub.config.ts', async () => {
    await fixture('rafa-hub.yaml', hubYaml('port: 7005'));
    const ts = await fixture('hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\', port: 7006 } }'));

    const reading = await readHubConfig({ RAFA_HUB_CONFIG: ts });

    expect(reading.form).toBe('ts');
    expect(reading.config.port).toBe(7006);
  });

  it('reads a name ending in neither .ts nor .yaml as YAML, as before', async () => {
    const path = await fixture('hub.yml', hubYaml('port: 7007'));

    const reading = await readHubConfig({ RAFA_HUB_CONFIG: path });

    expect(reading.form).toBe('yaml');
    expect(reading.config.port).toBe(7007);
  });
});

describe('locateHubConfig', () => {
  it('resolves a relative name against the working directory', async () => {
    const located = await locateHubConfig('relative/hub.yaml');

    expect(located).toEqual({ form: 'yaml', path: join(process.cwd(), 'relative/hub.yaml') });
  });
});

describe('loadHubConfigFile', () => {
  it('reads a .ts file to the HubConfig its YAML twin reads to', async () => {
    const path = await fixture('rafa-hub.config.ts', module(`{
      hub: { repository: 'open-tomato/rafa', port: 7444, storePath: 'store/hub.sqlite' },
      dangerous: { hub: { maxPayloadRows: 'unlimited' } },
    }`));
    const yaml = [
      'hub:', '  repository: open-tomato/rafa', '  port: 7444', '  storePath: store/hub.sqlite',
      'dangerous:', '  hub:', '    maxPayloadRows: unlimited', '',
    ].join('\n');

    const config = await loadHubConfigFile(path);

    expect(config).toEqual(parseHubConfig(yaml, path));
    expect(config.port).toBe(7444);
    expect(config.storePath).toBe(join(dir, 'store/hub.sqlite'));
    expect(config.maxPayloadRows).toBeNull();
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('reads a false the merge removes as the value written, beside the defaults it would leave', async () => {
    const off = await fixture('off.ts', module(`{
      hub: { repository: 'open-tomato/rafa', auth: { cacheFor: false }, index: { rebuildAfterPush: false } },
    }`));
    const left = await fixture('left.ts', module('{ hub: { repository: \'open-tomato/rafa\' } }'));

    const config = await loadHubConfigFile(off);
    const defaults = await loadHubConfigFile(left);

    expect(config.cacheForMs).toBeNull();
    expect(config.rebuildAfterPush).toBe(false);
    expect(defaults.cacheForMs).toBe(600_000);
    expect(defaults.rebuildAfterPush).toBe(true);
  });

  it('refuses a false where the key takes none, rather than reading it as left out', async () => {
    const path = await fixture('rafa-hub.config.ts', module('{ hub: { repository: false } }'));

    expect(await refusalOf(path)).toEqual([
      `${path}: hub.repository is false, expected a GitHub repository as owner/name, such as open-tomato/rafa`,
    ]);
  });

  it('reads a list of entries, as defineConfig answers, merged in order', async () => {
    const path = await fixture('rafa-hub.config.ts', `export default [
      { hub: { repository: 'open-tomato/rafa' } },
      { hub: { port: 7555 } },
    ];\n`);

    const config = await loadHubConfigFile(path);

    expect(config.repository).toBe('open-tomato/rafa');
    expect(config.port).toBe(7555);
  });

  it('reads a file edited since its first load as it now stands', async () => {
    const path = await fixture('rafa-hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\', port: 7001 } }'));
    const first = await loadHubConfigFile(path);
    await writeFile(path, module('{ hub: { repository: \'open-tomato/rafa\', port: 7002 } }'));

    const second = await loadHubConfigFile(path);

    expect(first.port).toBe(7001);
    expect(second.port).toBe(7002);
  });

  it('refuses every problem of the file at once: a top-level key, a function and a reader\'s', async () => {
    const path = await fixture('rafa-hub.config.ts', `export default {
      hub: { repository: 'open-tomato/rafa', port: 0, auth: { cacheFor: () => '10m' } },
      loop: {},
    };\n`);

    expect(await refusalOf(path)).toEqual([
      `${path}: loop is not a key of the hub's config; ${PROJECT}`,
      `${path}: hub.auth.cacheFor is a function, ${FUNCTION}`,
      `${path}: hub.port is 0, ${PORT_EXPECTED}`,
    ]);
  });

  it('refuses a key two entries of the file set, naming it', async () => {
    const path = await fixture('rafa-hub.config.ts', `export default [
      { hub: { repository: 'open-tomato/rafa', port: 7001 } },
      { hub: { port: 7002 } },
    ];\n`);

    expect(await refusalOf(path)).toEqual([
      `${path}: hub.port is set more than once within one layer: layer "hub" (entries 0, 1)`,
    ]);
  });
});

describe('loadHubConfigFile over imports', () => {
  it('loads a type-only import of a package the directory does not hold', async () => {
    const path = await fixture('rafa-hub.config.ts', module('{ hub: { repository: \'open-tomato/rafa\' } }'));

    expect((await loadHubConfigFile(path)).repository).toBe('open-tomato/rafa');
  });

  it('refuses a value import of the hub\'s package, naming it and the type-only form', async () => {
    const path = await fixture('rafa-hub.config.ts', importing('import { HUB } from \'@open-tomato/rafa-hub\';', '{ hub: { repository: HUB } }'));

    expect(await refusalOf(path)).toEqual([
      `${path}: imports @open-tomato/rafa-hub, which cannot be found from this file; the hub resolves it from this file's `
      + 'directory up, so install @open-tomato/rafa-hub there (bun add @open-tomato/rafa-hub), or import its types alone '
      + '(import type { HubConfigFile } from \'@open-tomato/rafa-hub\'), which need nothing at run time',
    ]);
  });

  it('refuses a value import of a package by its specifier, naming the package to install', async () => {
    const path = await fixture('rafa-hub.config.ts', importing('import { port } from \'@acme/hub-ports/default\';', '{ hub: { repository: \'open-tomato/rafa\', port } }'));

    expect(await refusalOf(path)).toEqual([
      `${path}: imports @acme/hub-ports/default, which cannot be found from this file; the hub resolves it from this file's `
      + 'directory up, so install @acme/hub-ports there (bun add @acme/hub-ports)',
    ]);
  });

  it('refuses a relative value import that does not resolve, naming it with no install', async () => {
    const path = await fixture('rafa-hub.config.ts', RELATIVE_PORT);

    expect(await refusalOf(path)).toEqual([`${path}: imports ./ports.ts, which cannot be found from this file`]);
  });

  it('loads the same relative value import once the file it names exists', async () => {
    const path = await fixture('rafa-hub.config.ts', RELATIVE_PORT);
    await fixture('ports.ts', 'export const port = 7666;\n');

    expect((await loadHubConfigFile(path)).port).toBe(7666);
  });
});

describe('loadHubConfigFile refusing a file it cannot read', () => {
  it('refuses a module that throws, naming its message', async () => {
    const path = await fixture('rafa-hub.config.ts', 'throw new Error(\'no config today\');\n');

    expect(await refusalOf(path)).toEqual([`${path}: cannot be loaded (import failed: no config today)`]);
  });

  it('refuses a module with no default export', async () => {
    const path = await fixture('rafa-hub.config.ts', 'export const hub = { repository: \'open-tomato/rafa\' };\n');

    expect(await refusalOf(path)).toEqual([`${path}: cannot be loaded (the module has no default export)`]);
  });

  it('refuses a path with no file, naming it', async () => {
    const path = join(dir, 'rafa-hub.config.ts');

    expect(await refusalOf(path)).toEqual([`${path}: the hub's config file could not be read: no file at this path`]);
  });

  it('refuses a directory carrying the file\'s name as no file', async () => {
    const path = join(dir, 'rafa-hub.config.ts');
    await mkdir(path);

    expect(await refusalOf(path)).toEqual([`${path}: the hub's config file could not be read: no file at this path`]);
  });

  it('refuses a path that is no .ts file, before looking it up', async () => {
    const path = await fixture('rafa-hub.yaml', 'hub:\n  repository: open-tomato/rafa\n');

    expect(await refusalOf(path)).toEqual([
      `${path}: is not a .ts file; expected the hub's config module, rafa-hub.config.ts`,
    ]);
  });
});

describe('hubSectionSchemas', () => {
  const PATH = '/srv/hub/rafa-hub.config.ts';
  const [hub, dangerous] = hubSectionSchemas(PATH);

  /** What the schema at `section` answers for `value`. */
  function validate(section: typeof hub, value: unknown): unknown {
    return section?.[1]['~standard'].validate(value);
  }

  it('lists the hub section, then the dangerous section, each at its own path', () => {
    expect(hubSectionSchemas(PATH).map(([path]) => path)).toEqual([['hub'], ['dangerous']]);
  });

  it('answers a clean hub section unchanged', () => {
    const value = { repository: 'open-tomato/rafa' };

    expect(validate(hub, value)).toEqual({ value });
  });

  it('answers one issue per problem of the hub section, as readHubDocument spells it', () => {
    expect(validate(hub, { repository: 'open-tomato/rafa', port: 0, fn: () => 1 })).toEqual({
      issues: [
        { message: `${PATH}: hub.fn is a function, ${FUNCTION}`, path: [] },
        { message: `${PATH}: hub.port is 0, ${PORT_EXPECTED}`, path: [] },
      ],
    });
  });

  it('answers a clean dangerous section unchanged, with no word about the hub it reads beside', () => {
    const value = { hub: { maxPayloadRows: 10 } };

    expect(validate(dangerous, value)).toEqual({ value });
  });

  it('answers the problems of the dangerous section alone', () => {
    expect(validate(dangerous, { hub: { maxPayloadRows: 0 }, acceptStaleRefs: true })).toEqual({
      issues: [
        { message: `${PATH}: dangerous.acceptStaleRefs is not a key of the hub's config; ${PROJECT}`, path: [] },
        { message: `${PATH}: dangerous.hub.maxPayloadRows is 0, ${ROWS_EXPECTED}`, path: [] },
      ],
    });
  });

  it('reads a section left out as silence', () => {
    expect(validate(hub, null)).toEqual({ value: null });
    expect(validate(dangerous, null)).toEqual({ value: null });
  });
});

describe('missingImportProblem', () => {
  it('names an install for a bare package and none for a node: or absolute specifier', () => {
    expect(missingImportProblem('/c.ts', 'left-pad')).toBe(
      '/c.ts: imports left-pad, which cannot be found from this file; the hub resolves it from this file\'s directory up, '
      + 'so install left-pad there (bun add left-pad)',
    );
    expect(missingImportProblem('/c.ts', 'node:nothing')).toBe('/c.ts: imports node:nothing, which cannot be found from this file');
    expect(missingImportProblem('/c.ts', '/opt/x.ts')).toBe('/c.ts: imports /opt/x.ts, which cannot be found from this file');
  });
});

describe('restoredDocument', () => {
  it('sets a removed false back, and leaves one a later entry wiped above', () => {
    const provenance = new Map([
      ['hub', [{ entry: 0, kind: 'set' as const }]],
      ['hub.auth', [{ entry: 0, kind: 'set' as const }, { entry: 1, kind: 'replace' as const }]],
      ['hub.auth.cacheFor', [{ entry: 0, kind: 'remove' as const }]],
      ['hub.index', [{ entry: 0, kind: 'set' as const }]],
      ['hub.index.rebuildAfterPush', [{ entry: 0, kind: 'remove' as const }]],
    ]);
    const config = { hub: { auth: {}, index: {} } };

    expect(restoredDocument({ config, provenance })).toEqual({ hub: { auth: {}, index: { rebuildAfterPush: false } } });
    expect(config).toEqual({ hub: { auth: {}, index: {} } });
  });
});
