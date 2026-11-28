/**
 * Tests for the hub's config written as a `.ts` module
 * (`config-file.ts`): the load through define-config's `createLoader`
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

import { hubSectionSchemas, loadHubConfigFile, missingImportProblem, restoredDocument } from './config-file.js';
import { HubConfigError, parseHubConfig } from './config.js';

/** Where a project key belongs, as a refusal says it. */
const PROJECT = 'expected it in the project\'s rafa.config.ts, which the hub never reads';

/** What a key holding a function takes, as a refusal says it. */
const FUNCTION = 'expected a value written out; the hub\'s config declares no extension point, so it runs no function';

/** What `hub.port` takes, as a refusal says it. */
const PORT_EXPECTED = 'expected a whole number from 1 to 65535, such as 7373';

/** What `dangerous.hub.maxPayloadRows` takes, as a refusal says it. */
const ROWS_EXPECTED = 'expected a whole number from 1 up, such as 50000, or unlimited';

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
