/**
 * Tests for the `local` sync strategy and {@link selectSync}
 * (`src/effort/sync/select.ts`).
 *
 * Each refusal sits beside the selection it refuses made to succeed:
 * `git` refused on core's registry is answered by a registry holding a
 * fixture `git`, and the `modules:` and `allowList:` lines the refusal
 * names are filled in, parsed as a project's config, and loaded through
 * `loadModules` over the `sync-fixture` module under
 * `src/modules/testdata/`, which then selects that module's `git`. The
 * same text without its `allowList:` line leaves `git` refused, so the
 * lines are what enabled it.
 *
 * Every root is a path under a temporary directory of this file's own
 * that is never made, and each case that selects holds it absent after,
 * so selecting and the `local` strategy are read as touching no disk.
 *
 * The import cycle between this module and `src/adapters/registry.ts` is
 * read in a child `bun` per import order, since this file has already
 * imported both by the time a case runs.
 *
 * Three mutations were driven on 2026-09-29 over this file,
 * `src/adapters/registry.test.ts`, `src/tests/adapter-registry.test.ts`
 * and `src/modules/`, with `registry.ts` and `select.ts` restored and
 * verified with `sha256sum -c`. The `sync/local` entry removed reddened
 * sixteen cases, both import-order cases among them. The
 * `SyncModuleMissing` branch dropped, so a module strategy fell through
 * to the `TypeError`, reddened seven, the two config-line cases among
 * them. `select.ts` reading `CORE_ADAPTER_REGISTRY` at its top level
 * failed all five test files under those paths at load, no case passing.
 */
import type { AnyAdapter } from '../../adapters/registry.js';
import type { RafaConfig } from '../../config.js';
import type { Sync } from '../../ports/index.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, createAdapterRegistry, PORT_VERSIONS } from '../../adapters/registry.js';
import { parseConfigText, resolveConfig } from '../../config.js';
import { loadModules, moduleSettings } from '../../modules/load.js';

import {
  createLocalSync,
  MODULE_DIRECTORY_PLACEHOLDER,
  MODULE_NAME_PLACEHOLDER,
  MODULE_SYNC_STRATEGIES,
  selectSync,
  SyncModuleMissing,
} from './select.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-select-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A root under the temporary directory, never made. */
const ROOT = join(tempBase, 'repo');

/** The module whose `git` sync adapter the lines in a refusal load. */
const FIXTURE_MODULE = fileURLToPath(new URL('../../modules/testdata/sync-fixture', import.meta.url));

/** The manifest seams the fixture module is held to. */
const MANIFEST_SEAMS = { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS };

/** A fixture `git` strategy, told apart by what its push answers. */
const FIXTURE_GIT: Sync = {
  kind: 'git',
  push: async () => ({ status: 'pushed', path: '/fixture' }),
  pull: async () => ({ status: 'nothing-to-sync' }),
};

/** A `sync` adapter of `kind` answering {@link FIXTURE_GIT}. */
function fixtureAdapter(kind: string): AnyAdapter {
  return { port: 'sync', kind, portVersion: PORT_VERSIONS.sync, create: () => FIXTURE_GIT };
}

/** A config naming `effortSync`. The cast lets a case name a kind the config refuses. */
function naming(effortSync: unknown): Pick<RafaConfig, 'effortSync'> {
  return { effortSync } as Pick<RafaConfig, 'effortSync'>;
}

/** The refusal a module strategy is missing with, on core's registry. */
function missing(kind: string): string {
  return [
    `effort sync: effort.sync is "${kind}", and no module registers a sync adapter of that kind`
      + ` (registered: local). Core ships no ${kind} strategy; load a module that provides`
      + ' one with these lines in .rafa/config.yaml:',
    'modules:',
    '  - path: <module directory>',
    'allowList:',
    '  - <module name>',
  ].join('\n');
}

/** What `selectSync` threw, or undefined when it threw nothing. */
function thrownBy(attempt: () => unknown): unknown {
  try {
    attempt();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('the local sync strategy', () => {
  it('answers that there is nothing to sync, whichever direction and request', async () => {
    const sync = createLocalSync();

    expect(sync.kind).toBe('local');
    expect(await sync.push({ to: null })).toEqual({ status: 'nothing-to-sync' });
    expect(await sync.push({ to: join(ROOT, 'copy') })).toEqual({ status: 'nothing-to-sync' });
    expect(await sync.pull({ from: null, dryRun: false })).toEqual({ status: 'nothing-to-sync' });
    expect(await sync.pull({ from: join(ROOT, 'effort.sqlite'), dryRun: true }))
      .toEqual({ status: 'nothing-to-sync' });
    expect(existsSync(ROOT)).toBe(false);
  });

  it('is a new frozen strategy on each call', () => {
    const first = createLocalSync();

    expect(Object.isFrozen(first)).toBe(true);
    expect(createLocalSync()).not.toBe(first);
  });

  it('is core\'s sync/local', async () => {
    const sync = CORE_ADAPTER_REGISTRY.resolve('sync', 'local').create({ repoRoot: ROOT });

    expect(sync.kind).toBe('local');
    expect(await sync.pull({ from: null, dryRun: false })).toEqual({ status: 'nothing-to-sync' });
  });
});

describe('selectSync', () => {
  it('selects local on core\'s registry when the config names it, touching nothing', async () => {
    const sync = selectSync(ROOT, naming('local'));

    expect(sync.kind).toBe('local');
    expect(await sync.push({ to: null })).toEqual({ status: 'nothing-to-sync' });
    expect(existsSync(ROOT)).toBe(false);
  });

  it('resolves through the registry it is handed, and makes the adapter with the root', () => {
    const roots: string[] = [];
    const registry = CORE_ADAPTER_REGISTRY.register({
      ...fixtureAdapter('git'),
      create: ({ repoRoot }) => {
        roots.push(repoRoot);
        return FIXTURE_GIT;
      },
    });

    expect(selectSync(ROOT, naming('git'), registry)).toBe(FIXTURE_GIT);
    expect(roots).toEqual([ROOT]);
    // Control: core's registry, which the same config selects through by default, holds no git.
    expect(() => selectSync(ROOT, naming('git'))).toThrow(SyncModuleMissing);
  });

  it('names git, service and p2p as the strategies modules bring', () => {
    expect(MODULE_SYNC_STRATEGIES).toEqual(['git', 'service', 'p2p']);
  });

  it.each(['git', 'service', 'p2p'])('refuses %s with no module, naming it and the lines that enable it', (kind) => {
    const error = thrownBy(() => selectSync(ROOT, naming(kind)));

    expect(error).toBeInstanceOf(SyncModuleMissing);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'SyncModuleMissing', kind, message: missing(kind) });
    expect(existsSync(ROOT)).toBe(false);
  });

  it('refuses a module strategy a loaded module does not register, beside one it does', () => {
    const registry = CORE_ADAPTER_REGISTRY.register(fixtureAdapter('git'));

    expect(selectSync(ROOT, naming('git'), registry)).toBe(FIXTURE_GIT);
    expect(thrownBy(() => selectSync(ROOT, naming('p2p'), registry))).toMatchObject({
      name: 'SyncModuleMissing',
      kind: 'p2p',
      message: missing('p2p').replace('(registered: local)', '(registered: local, git)'),
    });
  });

  it.each([
    ['a kind outside the five', 'rsync', '"rsync"'],
    ['a kind in another case', 'Local', '"Local"'],
    ['the name of Object.prototype.constructor', 'constructor', '"constructor"'],
    ['the prototype accessor', '__proto__', '"__proto__"'],
    ['a list naming a kind', ['local'], 'a list'],
    ['undefined', undefined, 'undefined'],
  ])('refuses %s with a TypeError, never downgrading it to local', (_label, kind, quoted) => {
    const error = thrownBy(() => selectSync(ROOT, naming(kind)));

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(SyncModuleMissing);
    expect((error as Error).message).toBe(
      `effort sync: effort.sync is ${quoted}, and no sync adapter is registered under it;`
        + ' expected one of: local, file, git, service, p2p',
    );
  });

  it('refuses a core strategy the registry does not hold, naming the kinds it does', () => {
    const empty = createAdapterRegistry();
    const attempt = (): unknown => selectSync(ROOT, naming('local'), empty);

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(
      'effort sync: effort.sync is "local", and no sync adapter is registered under it; registered: none',
    );
    // Control: the same registry holding a local of its own selects it.
    const held = empty.register(fixtureAdapter('local'));
    expect(selectSync(ROOT, naming('local'), held)).toBe(FIXTURE_GIT);
  });
});

describe('the lines a SyncModuleMissing names', () => {
  /** The lines the refusal names, below its first, as a project config file's text. */
  const namedLines = (): string => {
    const error = thrownBy(() => selectSync(ROOT, naming('git')));
    const [, ...lines] = (error as Error).message.split('\n');
    return lines.join('\n')
      .replace(MODULE_DIRECTORY_PLACEHOLDER, FIXTURE_MODULE)
      .replace(MODULE_NAME_PLACEHOLDER, 'sync-fixture');
  };

  /** Loads a project config's text, answering the sync its `effort.sync` selects through the modules it loads. */
  const selectFrom = async (text: string): Promise<Sync> => {
    const file = parseConfigText(text, join(ROOT, '.rafa', 'config.yaml'));
    const resolved = resolveConfig({ cli: {}, file, user: null });
    const settings = moduleSettings(resolved, { root: ROOT, home: join(tempBase, 'home') });
    const loaded = await loadModules(settings, { manifest: MANIFEST_SEAMS });
    return selectSync(ROOT, resolved.config, loaded.adapters);
  };

  it('load a module providing the kind once filled in, and the kind is selected', async () => {
    const sync = await selectFrom(`effort:\n  sync: git\n${namedLines()}\n`);

    expect(sync.kind).toBe('git');
    expect(await sync.push({ to: null })).toEqual({ status: 'pushed', path: null });
  });

  it('leave the kind refused without the allowList line', async () => {
    const text = `effort:\n  sync: git\n${namedLines().split('\nallowList:')[0] ?? ''}\n`;

    expect(text).toContain('modules:');
    expect(text).not.toContain('allowList');
    await expect(selectFrom(text)).rejects.toThrow(SyncModuleMissing);
  });
});

describe('the import cycle with the adapter registry', () => {
  const SELECT_ENTRY = fileURLToPath(new URL('./select.ts', import.meta.url));
  const REGISTRY_ENTRY = fileURLToPath(new URL('../../adapters/registry.ts', import.meta.url));

  /** Runs a child `bun` importing `first` before the other module, answering its exit code and stdout. */
  const importing = (first: string, second: string): { exitCode: number; stdout: string } => {
    const script = [
      `const first = await import(${JSON.stringify(first)});`,
      `const second = await import(${JSON.stringify(second)});`,
      'const { selectSync } = first.selectSync ? first : second;',
      'const { CORE_ADAPTER_REGISTRY } = first.CORE_ADAPTER_REGISTRY ? first : second;',
      'const sync = selectSync("/nonexistent", { effortSync: "local" });',
      'const pushed = await sync.push({ to: null });',
      'console.log(JSON.stringify([CORE_ADAPTER_REGISTRY.kinds("sync"), sync.kind, pushed.status]));',
    ].join('\n');
    const child = Bun.spawnSync([process.execPath, '-e', script]);
    return { exitCode: child.exitCode, stdout: child.stdout.toString() };
  };

  it.each([
    ['select.ts', SELECT_ENTRY, REGISTRY_ENTRY],
    ['registry.ts', REGISTRY_ENTRY, SELECT_ENTRY],
  ])('resolves sync/local when %s is imported first', (_label, first, second) => {
    expect(importing(first, second)).toEqual({
      exitCode: 0,
      stdout: '[["local"],"local","nothing-to-sync"]\n',
    });
  });
});
