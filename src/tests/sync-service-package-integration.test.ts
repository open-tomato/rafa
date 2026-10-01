/**
 * `loadModules` (`src/modules/load.ts`) and `selectSync`
 * (`src/effort/sync/select.ts`) over the REAL
 * `packages/rafa-sync-service` package, not the `sync-fixture` stand-in
 * `select.test.ts` drives: a `.rafa/config.yaml` naming `effort.sync:
 * service`, a `modules:` `path:` source at the package's directory, and
 * an `allowList:` line naming its `package.json` name are read, loaded
 * and selected exactly as an operator's project would, so the package's
 * `rafa` manifest, its `provides.sync` entry and its default export are
 * proven against core's real loader and selector, no fixture standing in
 * for either.
 *
 * The negative sits beside it: the same `modules:` line with no
 * `allowList:` entry leaves the module `disabled` and `selectSync` still
 * throws {@link SyncModuleMissing}, as `select.test.ts`'s "leave the kind
 * refused without the allowList line" case holds for the fixture module.
 *
 * `ROOT` is a path under a temporary directory of this file's own that is
 * never made: `loadModules` reads only the module's own `package.json`
 * and `selectSync`'s adapter, `createServiceSync`, computes its store
 * path without opening it (`openSqliteStore(repoRoot).path()` never
 * touches disk), so both cases hold `ROOT` absent throughout.
 */
import type { RafaConfig } from '../config.js';
import type { LoadedModules } from '../modules/load.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText, resolveConfig } from '../config.js';
import { SyncModuleMissing, selectSync } from '../effort/sync/select.js';
import { loadModules, moduleSettings } from '../modules/load.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-service-package-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A root under the temporary directory, never made. */
const ROOT = join(tempBase, 'repo');

/** The home a project scope resolves against; never made either. */
const HOME = join(tempBase, 'home');

/** The real `rafa-sync-service` package this file loads, no fixture. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../packages/rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

/** A project config naming `effort.sync: service`, `hub.url`, and the package's `modules:` line, with or without `allowList:`. */
function configText(enabled: boolean): string {
  const lines = [
    'effort:',
    '  sync: service',
    'hub:',
    '  url: https://hub.example.org',
    'modules:',
    `  - path: ${SYNC_SERVICE_PACKAGE}`,
  ];
  return enabled
    ? [...lines, 'allowList:', `  - "${SYNC_SERVICE_NAME}"`, ''].join('\n')
    : [...lines, ''].join('\n');
}

/** What loading a project config's `text` came to: `loadModules`'s answer and the resolved `config`. */
interface Loaded {
  readonly loaded: LoadedModules;
  readonly config: RafaConfig;
}

/** Loads `text` as a project config and answers what `loadModules` read of it. */
async function load(text: string): Promise<Loaded> {
  const file = parseConfigText(text, join(ROOT, '.rafa', 'config.yaml'));
  const resolved = resolveConfig({ cli: {}, file, user: null });
  const settings = moduleSettings(resolved, { root: ROOT, home: HOME });
  const loaded = await loadModules(settings);
  return { loaded, config: resolved.config };
}

describe('loadModules and selectSync over the real rafa-sync-service package', () => {
  it('loads the package and selects its service strategy when allowList names it', async () => {
    const { loaded, config } = await load(configText(true));

    expect(loaded.warnings).toEqual([]);
    expect(loaded.modules).toHaveLength(1);
    expect(loaded.modules[0]).toMatchObject({
      name: SYNC_SERVICE_NAME,
      enabled: true,
      state: 'loaded',
      adapters: ['sync/service'],
    });

    const sync = selectSync(ROOT, config, loaded.adapters);

    expect(sync.kind).toBe('service');
    expect(existsSync(ROOT)).toBe(false);
  });

  it('leaves the module disabled and still throws SyncModuleMissing without allowList', async () => {
    const { loaded, config } = await load(configText(false));

    expect(loaded.modules).toHaveLength(1);
    expect(loaded.modules[0]).toMatchObject({
      name: SYNC_SERVICE_NAME,
      enabled: false,
      state: 'disabled',
      adapters: [],
    });
    expect(loaded.warnings).toEqual([]);

    expect(() => selectSync(ROOT, config, loaded.adapters)).toThrow(SyncModuleMissing);
    expect(existsSync(ROOT)).toBe(false);
  });
});
