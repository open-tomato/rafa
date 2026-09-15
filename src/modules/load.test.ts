/**
 * Tests for loading configured modules (`src/modules/load.ts`).
 *
 * Every module is a real directory written under a temporary directory
 * of this file's own, outside the repository, holding a `package.json`
 * and the entry files its manifest names, and imported through the
 * loader's default importer. So a syntax error is Bun's own, and each
 * case holds its paths under that directory. The manifest is held to rafa
 * 0.1.0 and the port versions core serves through the manifest seams, so
 * a release moving the version turns no case red.
 *
 * Each refusal sits beside its control: the module it breaks, loaded
 * with that one thing put back.
 */
import type { ModuleSettings } from './load.js';
import type { ModuleSource } from '../config-sections.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '../adapters/registry.js';
import { parseConfigText, resolveConfig } from '../config.js';

import { loadInvocationModules, loadModules, moduleSettings } from './load.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-module-load-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** What every manifest is held to. */
const MANIFEST_SEAMS = { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS };

/** An adapter entry: its default export is the adapter's create. */
const ADAPTER_SOURCE = 'export default (context) => ({ context });\n';

/** The manifest of a module providing a `demo` tracker and commands. */
function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    types: ['tracker', 'commands'],
    provides: {
      tracker: { kind: 'demo', entry: './tracker.ts' },
      commands: { entry: './commands.ts' },
    },
    requires: { rafa: '>=0.1 <1', ports: { tracker: 1 } },
    ...overrides,
  };
}

/** Writes a module directory of its own, answering it. `packageJson` is written as given when a string. */
function plantModule(packageJson: Record<string, unknown> | string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tempBase, 'module-'));
  const text = typeof packageJson === 'string'
    ? packageJson
    : JSON.stringify(packageJson);
  writeFileSync(join(dir, 'package.json'), text);
  const planted = { 'tracker.ts': ADAPTER_SOURCE, 'commands.ts': 'export default [];\n', ...files };
  for (const [name, source] of Object.entries(planted)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), source);
  }
  return dir;
}

/** A module named `name` with the demo manifest, overridden. */
function demoModule(name = 'demo', overrides: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  return plantModule({ name, version: '0.3.0', rafa: manifest(overrides) }, files);
}

/** A `path` source naming `location`. */
function pathSource(location: string): ModuleSource {
  return { kind: 'path', location, ref: null };
}

/** Loads `sources` with `allowList`, against the temporary base. */
function load(sources: readonly ModuleSource[], allowList: readonly string[]) {
  const settings: ModuleSettings = { modules: sources, allowList, base: tempBase };
  return loadModules(settings, { manifest: MANIFEST_SEAMS });
}

describe('a path source allowList names', () => {
  it('registers its adapters, hands on its command entry and warns about nothing', async () => {
    const dir = demoModule();

    const loaded = await load([pathSource(dir)], ['demo']);

    expect(loaded.warnings).toEqual([]);
    expect(loaded.modules).toEqual([{
      at: 'modules[0]',
      source: pathSource(dir),
      name: 'demo',
      version: '0.3.0',
      directory: dir,
      types: ['tracker', 'commands'],
      enabled: true,
      state: 'loaded',
      adapters: ['tracker/demo'],
      commands: join(dir, 'commands.ts'),
      problems: [],
    }]);
    expect(loaded.commands).toEqual([{ name: 'demo', entry: join(dir, 'commands.ts') }]);
    const adapter = loaded.adapters.find('tracker', 'demo');
    expect(adapter?.portVersion).toBe(1);
    expect(adapter?.create({ repoRoot: '/repo' })).toEqual({ context: { repoRoot: '/repo' } } as never);
    expect(loaded.adapters.kinds('tracker')).toEqual([...CORE_ADAPTER_REGISTRY.kinds('tracker'), 'demo']);
    expect(CORE_ADAPTER_REGISTRY.find('tracker', 'demo')).toBeUndefined();
  });

  it('resolves a relative path against the base, and a scoped package name is its name', async () => {
    const dir = plantModule({ name: '@scope/demo', rafa: manifest() });
    const relativePath = dir.slice(tempBase.length + 1);

    const loaded = await load([pathSource(relativePath)], ['@scope/demo']);

    expect(loaded.modules.map((module) => [module.directory, module.state, module.version])).toEqual([[dir, 'loaded', null]]);
    expect(loaded.commands).toEqual([{ name: '@scope/demo', entry: join(dir, 'commands.ts') }]);
  });

  it('registers an output and a store beside a tracker, each at the version its manifest states', async () => {
    const dir = demoModule('many', {
      types: ['tracker', 'store', 'output'],
      provides: {
        tracker: { kind: 'demo', entry: './tracker.ts' },
        store: { kind: 'homelab', entry: './adapters/store.ts' },
        output: { kind: 'mqtt', entry: './adapters/output.ts', channels: ['socket'] },
      },
      requires: { rafa: '>=0.1', ports: { tracker: 1, store: 1, output: 1 } },
    }, { 'adapters/store.ts': ADAPTER_SOURCE, 'adapters/output.ts': ADAPTER_SOURCE });

    const loaded = await load([pathSource(dir)], ['many']);

    expect(loaded.warnings).toEqual([]);
    expect(loaded.modules[0]?.adapters).toEqual(['tracker/demo', 'store/homelab', 'output/mqtt']);
    expect(loaded.commands).toEqual([]);
    expect(loaded.adapters.find('store', 'homelab')).toBeDefined();
    expect(loaded.adapters.find('output', 'mqtt')).toBeDefined();
  });
});

describe('a module allowList does not name', () => {
  it('is read and validated, and loads nothing and warns about nothing', async () => {
    const dir = demoModule();
    const broken = demoModule('broken', { requires: { rafa: '>=0.1', ports: { tracker: 2 } } });

    const loaded = await load([pathSource(dir), pathSource(broken)], []);

    expect(loaded.modules.map((module) => [module.name, module.enabled, module.state, module.types, module.adapters, module.commands]))
      .toEqual([
        ['demo', false, 'disabled', ['tracker', 'commands'], [], null],
        ['broken', false, 'disabled', [], [], null],
      ]);
    expect(loaded.modules[1]?.problems).toEqual([`${join(broken, 'package.json')}: rafa.requires.ports.tracker is 2, but core serves tracker port version 1`]);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.commands).toEqual([]);
    expect(loaded.adapters).toBe(CORE_ADAPTER_REGISTRY);
  });
});

describe('sources phase 1 does not read', () => {
  const npm: ModuleSource = { kind: 'npm', location: '@open-tomato/rafa-linear', ref: null };
  const github: ModuleSource = { kind: 'github', location: 'someone/rafa-obsidian', ref: 'v0.3.0' };

  it('refuses an npm and a github source by name, warning when allowList names them', async () => {
    const loaded = await load([npm, github], ['@open-tomato/rafa-linear', 'someone/rafa-obsidian']);

    expect(loaded.modules.map((module) => [module.name, module.state, module.problems])).toEqual([
      ['@open-tomato/rafa-linear', 'refused', ['npm source "@open-tomato/rafa-linear" is refused: phase 1 loads path sources alone, and installing a package or a repository is phase 7\'s']],
      ['someone/rafa-obsidian', 'refused', ['github source "someone/rafa-obsidian" is refused: phase 1 loads path sources alone, and installing a package or a repository is phase 7\'s']],
    ]);
    expect(loaded.warnings).toEqual([
      'module "@open-tomato/rafa-linear": npm source "@open-tomato/rafa-linear" is refused: phase 1 loads path sources alone, and installing a package or a repository is phase 7\'s',
      'module "someone/rafa-obsidian": github source "someone/rafa-obsidian" is refused: phase 1 loads path sources alone, and installing a package or a repository is phase 7\'s',
    ]);
    expect(loaded.commands).toEqual([]);
  });

  it('lists them disabled with the same problem and no warning when allowList names neither', async () => {
    const loaded = await load([npm, github], []);

    expect(loaded.modules.map((module) => [module.state, module.problems.length])).toEqual([['disabled', 1], ['disabled', 1]]);
    expect(loaded.warnings).toEqual([]);
  });
});

describe('an enabled module that is refused', () => {
  it('names both port numbers when core does not serve the version its manifest states', async () => {
    const dir = demoModule('demo', { requires: { rafa: '>=0.1', ports: { tracker: 2 } } });

    const loaded = await load([pathSource(dir)], ['demo']);

    expect(loaded.warnings).toEqual([`module "demo": ${join(dir, 'package.json')}: rafa.requires.ports.tracker is 2, but core serves tracker port version 1`]);
    expect(loaded.modules[0]?.state).toBe('refused');
    expect(loaded.adapters.find('tracker', 'demo')).toBeUndefined();
    expect(loaded.commands).toEqual([]);
  });

  it('refuses a module providing a learning source', async () => {
    const dir = demoModule('demo', {
      types: ['learning'],
      provides: { learning: { kind: 'remote', entry: './tracker.ts' } },
      requires: { rafa: '>=0.1', ports: { learning: 1 } },
    });

    const loaded = await load([pathSource(dir)], ['demo']);

    expect(loaded.modules[0]?.state).toBe('refused');
    expect(loaded.warnings.join('\n')).toContain('rafa.types[0] is "learning", which core closes to third parties');
    expect(loaded.adapters.find('learning', 'remote')).toBeUndefined();
  });

  it('registers none of its adapters when one kind is already held, and hands on no command entry', async () => {
    const dir = demoModule('demo', {
      types: ['tracker', 'store', 'commands'],
      provides: {
        tracker: { kind: 'github', entry: './tracker.ts' },
        store: { kind: 'homelab', entry: './tracker.ts' },
        commands: { entry: './commands.ts' },
      },
      requires: { rafa: '>=0.1', ports: { tracker: 1, store: 1 } },
    });

    const loaded = await load([pathSource(dir)], ['demo']);

    expect(loaded.warnings).toEqual(['module "demo": adapter registry: tracker/github is already registered']);
    expect(loaded.modules[0]?.adapters).toEqual([]);
    expect(loaded.adapters.find('store', 'homelab')).toBeUndefined();
    expect(loaded.adapters).toBe(CORE_ADAPTER_REGISTRY);
    expect(loaded.commands).toEqual([]);
  });

  it('refuses an adapter entry whose default export is no function', async () => {
    const dir = demoModule('demo', {}, { 'tracker.ts': 'export default { kind: "demo" };\n' });

    const loaded = await load([pathSource(dir)], ['demo']);

    expect(loaded.warnings).toEqual([`module "demo": provides.tracker.entry ${join(dir, 'tracker.ts')} has default export a mapping, expected the adapter's create function`]);
  });

  it('refuses an adapter entry that fails to import, naming its path', async () => {
    const dir = demoModule('demo', {}, { 'tracker.ts': 'export default (context) => ({ context };\n' });

    const loaded = await load([pathSource(dir)], ['demo']);

    expect(loaded.modules[0]?.state).toBe('refused');
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toStartWith(`module "demo": provides.tracker.entry ${join(dir, 'tracker.ts')} failed to import: `);
  });

  it('refuses an entry resolving outside the module directory', async () => {
    const dir = demoModule('demo', {
      provides: { tracker: { kind: 'demo', entry: '../elsewhere/tracker.ts' }, commands: { entry: '/etc/commands.ts' } },
    });

    const loaded = await load([pathSource(dir)], ['demo']);

    expect(loaded.warnings).toEqual([
      `module "demo": provides.tracker.entry is "../elsewhere/tracker.ts", which resolves outside the module directory ${dir}`,
      `module "demo": provides.commands.entry is "/etc/commands.ts", which resolves outside the module directory ${dir}`,
    ]);
  });

  it('refuses a directory with no package.json, one that is no JSON, and one with no name', async () => {
    const missing = join(tempBase, 'no-such-module');
    const notJson = plantModule('{ "name": ');
    const unnamed = plantModule({ rafa: manifest() });

    const loaded = await load([pathSource(missing), pathSource(notJson), pathSource(unnamed)], ['demo']);

    expect(loaded.modules.map((module) => [module.name, module.state])).toEqual([[null, 'disabled'], [null, 'disabled'], [null, 'disabled']]);
    expect(loaded.modules[0]?.problems[0]).toStartWith(`${join(missing, 'package.json')} cannot be read as JSON: `);
    expect(loaded.modules[1]?.problems[0]).toStartWith(`${join(notJson, 'package.json')} cannot be read as JSON: `);
    expect(loaded.modules[2]?.problems).toEqual([`${join(unnamed, 'package.json')}: name is undefined, expected a package name with no space and no leading dash`]);
    expect(loaded.warnings).toEqual(['allowList names the module "demo", which no modules: source gives']);
  });

  it('reads a rafa manifest under __proto__ as no manifest, where the same manifest under rafa loads', async () => {
    const hidden = plantModule(`{ "name": "hidden", "__proto__": { "rafa": ${JSON.stringify(manifest())} } }`);
    const control = plantModule({ name: 'control', rafa: manifest() });

    const loaded = await load([pathSource(hidden), pathSource(control)], ['hidden', 'control']);

    expect(loaded.modules.map((module) => [module.name, module.state, module.problems])).toEqual([
      ['hidden', 'refused', [`${join(hidden, 'package.json')} carries no rafa manifest`]],
      ['control', 'loaded', []],
    ]);
    expect(({} as Record<string, unknown>)['rafa']).toBeUndefined();
  });

  it('refuses the second source giving a name, keeping the first loaded', async () => {
    const first = demoModule('demo');
    const second = demoModule('demo');

    const loaded = await load([pathSource(first), pathSource(second)], ['demo']);

    expect(loaded.modules.map((module) => module.state)).toEqual(['loaded', 'refused']);
    expect(loaded.warnings).toEqual(['module "demo": modules[1] gives the module "demo", which modules[0] gives already']);
    expect(loaded.commands).toEqual([{ name: 'demo', entry: join(first, 'commands.ts') }]);
  });
});

describe('moduleSettings', () => {
  it('resolves a relative path against the project root, or against the home when the user scope gave modules', () => {
    const place = { root: '/project', home: '/home/someone' };
    const fromFile = resolveConfig({ cli: {}, file: parseConfigText('modules:\n  - path: ../x\n', '/project/.rafa/config.yaml'), user: null });
    const fromUser = resolveConfig({ cli: {}, file: null, user: parseConfigText('modules:\n  - path: ../x\nallowList: [x]\n', '/home/someone/.rafa/config.yaml') });

    expect(moduleSettings(fromFile, place)).toEqual({ modules: [pathSource('../x')], allowList: [], base: '/project' });
    expect(moduleSettings(fromUser, place)).toEqual({ modules: [pathSource('../x')], allowList: ['x'], base: '/home/someone' });
  });
});

describe('loadInvocationModules', () => {
  /** A project root holding `configText` as its config, beside a home of its own. */
  function plantProject(configText: string): { root: string; home: string } {
    const scope = mkdtempSync(join(tempBase, 'project-'));
    const root = join(scope, 'root');
    const home = join(scope, 'home');
    mkdirSync(join(root, '.rafa'), { recursive: true });
    mkdirSync(join(root, 'sub'));
    mkdirSync(home);
    writeFileSync(join(root, '.rafa', 'config.yaml'), configText);
    return { root, home };
  }

  it('loads the modules of the project the working directory is in, its unknown keys warned about by nobody', async () => {
    const dir = plantModule({ name: 'demo', rafa: manifest() });
    const { root, home } = plantProject(`version: 1\nnonesuch: 1\nmodules:\n  - path: ${dir}\nallowList: [demo]\n`);

    const loaded = await loadInvocationModules({ cwd: join(root, 'sub'), home }, { manifest: MANIFEST_SEAMS });

    expect(loaded.warnings).toEqual([]);
    expect(loaded.commands).toEqual([{ name: 'demo', entry: join(dir, 'commands.ts') }]);
  });

  it('loads none outside a project, warning about nothing', async () => {
    const outside = mkdtempSync(join(tempBase, 'outside-'));

    const loaded = await loadInvocationModules({ cwd: outside, home: join(outside, 'home') });

    expect(loaded).toEqual({ adapters: CORE_ADAPTER_REGISTRY, commands: [], modules: [], warnings: [] });
  });

  it('loads none and warns nothing for a config that cannot be used and for a relative working directory, where the same project with a usable config loads', async () => {
    const dir = plantModule({ name: 'demo', rafa: manifest() });
    const refusedProject = plantProject(`version: 1\nstore: postgres\nmodules:\n  - path: ${dir}\nallowList: [demo]\n`);
    const control = plantProject(`version: 1\nmodules:\n  - path: ${dir}\nallowList: [demo]\n`);
    const none = { adapters: CORE_ADAPTER_REGISTRY, commands: [], modules: [], warnings: [] };

    const refused = await loadInvocationModules({ cwd: refusedProject.root, home: refusedProject.home }, { manifest: MANIFEST_SEAMS });
    const relativeCwd = await loadInvocationModules({ cwd: 'relative/dir', home: control.home }, { manifest: MANIFEST_SEAMS });
    const loaded = await loadInvocationModules({ cwd: control.root, home: control.home }, { manifest: MANIFEST_SEAMS });

    expect(refused).toEqual(none);
    expect(relativeCwd).toEqual(none);
    expect(loaded.commands).toEqual([{ name: 'demo', entry: join(dir, 'commands.ts') }]);
  });
});
