/**
 * Tests for making the loaded modules' adapters the active registry
 * (`packages/rafa/src/modules/activate.ts`).
 *
 * Each case loads the `sync-fixture` module under `testdata/`, whose
 * `git` sync strategy core does not register, through `loadModules` from
 * a config naming it, as `src/rafa.ts` does before it dispatches. The
 * manifest is held to rafa 0.1.0 and the port versions core serves, so a
 * release moving the version turns no case red.
 *
 * Every activation is undone after its case, and the registry active
 * before the case is put back, so no file bun runs later reads the
 * fixture's adapter.
 */
import type { AdapterRegistry } from '../core/adapters/index.js';

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  activeAdapterRegistry,
  CORE_ADAPTER_REGISTRY,
  PORT_VERSIONS,
  restoreAdapters,
} from '../core/adapters/index.js';
import { parseConfigText, resolveConfig } from '../core/config/index.js';

import { activateModuleAdapters, baseAdapterRegistry } from './activate.js';
import { loadModules, moduleSettings } from './load.js';

/** The module whose `git` sync strategy each case activates. */
const FIXTURE_MODULE = fileURLToPath(new URL('./testdata/sync-fixture', import.meta.url));

/** What every manifest is held to. */
const MANIFEST_SEAMS = { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS };

/** A project root no case writes under: the fixture is named by its absolute path. */
const ROOT = '/project';

/** The settings of a config giving the fixture under `modules:` and naming it on `allowList:`. */
const SETTINGS = moduleSettings(
  resolveConfig({
    cli: {},
    file: parseConfigText(
      `modules:\n  - path: ${FIXTURE_MODULE}\nallowList:\n  - sync-fixture\n`,
      join(ROOT, '.rafa', 'config.yaml'),
    ),
    user: null,
  }),
  { root: ROOT, home: '/home/someone' },
);

/** The fixture loaded from {@link SETTINGS}, starting from `registry` when one is given. */
function loadFixture(registry?: AdapterRegistry): ReturnType<typeof loadModules> {
  return loadModules(SETTINGS, registry === undefined
    ? { manifest: MANIFEST_SEAMS }
    : { manifest: MANIFEST_SEAMS, adapters: registry });
}

describe('activateModuleAdapters', () => {
  let previous: AdapterRegistry = activeAdapterRegistry();
  const undos: (() => void)[] = [];

  beforeEach(() => {
    previous = activeAdapterRegistry();
  });

  afterEach(() => {
    for (const undo of undos.splice(0).reverse()) undo();
    restoreAdapters(previous);
  });

  it('loads the fixture and registers its kind on a registry that is not yet the active one', async () => {
    const loaded = await loadFixture();

    expect(loaded.modules.map((module) => module.state)).toEqual(['loaded']);
    expect(loaded.adapters.find('sync', 'git')).toBeDefined();
    expect(CORE_ADAPTER_REGISTRY.find('sync', 'git')).toBeUndefined();
  });

  it('resolves the fixture\'s kind through CORE_ADAPTER_REGISTRY once activated', async () => {
    const loaded = await loadFixture();

    undos.push(activateModuleAdapters(loaded));

    const sync = CORE_ADAPTER_REGISTRY.resolve('sync', 'git').create({ repoRoot: ROOT });
    expect(sync.kind).toBe('git');
    expect(await sync.push({ to: null })).toEqual({ status: 'pushed', path: null });
    expect(activeAdapterRegistry()).toBe(loaded.adapters);
  });

  it('keeps the registry it replaced as the base, which holds core\'s kinds and not the module\'s', async () => {
    const loaded = await loadFixture();
    expect(baseAdapterRegistry()).toBe(CORE_ADAPTER_REGISTRY);

    undos.push(activateModuleAdapters(loaded));

    expect(baseAdapterRegistry()).toBe(previous);
    expect(baseAdapterRegistry().find('sync', 'git')).toBeUndefined();
    expect(baseAdapterRegistry().find('sync', 'local')).toBeDefined();
  });

  it('lets a second load from the config report the module loaded, not refused', async () => {
    undos.push(activateModuleAdapters(await loadFixture()));

    const again = await loadFixture();

    expect(again.modules.map((module) => [module.state, module.adapters, module.problems])).toEqual([
      ['loaded', ['sync/git'], []],
    ]);
    expect(again.warnings).toEqual([]);
  });

  it('refuses the module on a second load started from the active registry: the control', async () => {
    undos.push(activateModuleAdapters(await loadFixture()));

    const again = await loadFixture(activeAdapterRegistry());

    expect(again.modules.map((module) => module.state)).toEqual(['refused']);
    expect(again.modules[0]?.problems).toEqual(['adapter registry: sync/git is already registered']);
  });

  it('keeps the first base across a second activation', async () => {
    undos.push(activateModuleAdapters(await loadFixture()));
    const again = await loadFixture();

    undos.push(activateModuleAdapters(again));

    expect(activeAdapterRegistry()).toBe(again.adapters);
    expect(baseAdapterRegistry()).toBe(previous);
  });

  it('leaves the active registry and the base alone when handed CORE_ADAPTER_REGISTRY', () => {
    undos.push(activateModuleAdapters({ adapters: CORE_ADAPTER_REGISTRY }));

    expect(activeAdapterRegistry()).toBe(previous);
    expect(baseAdapterRegistry()).toBe(CORE_ADAPTER_REGISTRY);
  });

  it('puts the active registry and the base back when undone', async () => {
    const undo = activateModuleAdapters(await loadFixture());

    undo();

    expect(activeAdapterRegistry()).toBe(previous);
    expect(baseAdapterRegistry()).toBe(CORE_ADAPTER_REGISTRY);
    expect(CORE_ADAPTER_REGISTRY.find('sync', 'git')).toBeUndefined();
  });
});
