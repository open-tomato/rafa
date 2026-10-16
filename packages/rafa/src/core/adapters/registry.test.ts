/**
 * Tests for the adapter registry's mechanics: the port versions it
 * serves, what `register` accepts and refuses, what a lookup answers,
 * and the active registry `registerAdapters`, `restoreAdapters` and
 * `activeAdapterRegistry` keep, which `CORE_ADAPTER_REGISTRY` reads.
 *
 * Every case runs over fixture adapters built here: {@link BASE} holds
 * fixtures under the kinds core registers, so a refusal listing the
 * kinds held lists what it listed when these cases read core's own, and
 * this file imports nothing above core. Core's own adapters are read in
 * `src/adapter-registry.test.ts`, beside the composition root that
 * registers them.
 *
 * `PORT_VERSIONS` is held to the literal types `packages/rafa/src/ports/index.ts`
 * declares by reading them off the TypeScript compiler, under the
 * options the root tsconfig gives `check-types`, because bun runs this
 * file without checking a type. The same reader runs over a probe
 * written to a temporary directory outside the repository, declaring
 * one version drifted and one widened to `number`, and must report
 * both: the control that the comparison can fail.
 *
 * Every refusal is spelled here in full, and each sits beside a case the
 * registry accepts, so a registry refusing everything fails as surely as
 * one refusing nothing.
 *
 * The active registry is a module-level value, and bun runs every test
 * file in one process, where an earlier file may already have imported
 * the root. So each case over it starts from an empty registry it
 * restores, and puts back the registry it found in a `finally`.
 *
 * Twelve mutations were driven against this file on 2026-09-14, one run
 * each, with the unmutated modules at 52 pass before them and restored
 * byte-identical after, and every one reddened at least one case:
 *
 *   - The version check dropped reddened the seven version refusals, and
 *     so did the refusal naming the implemented version alone. The check
 *     made with `!=` reddened the `"1"` case alone.
 *   - `PORT_VERSIONS.tracker` set to 2 reddened thirteen cases, and
 *     `check-types` failed with TS2322 at the value. `TrackerPortVersion`
 *     widened to `number` passed `check-types` and reddened the literal
 *     case, the reason that case reads the compiler. `PortVersions`
 *     without `planner` reddened the literal case too.
 *   - A second adapter under a held key accepted reddened the duplicate
 *     case. The adapter held uncopied reddened the frozen-copy case and
 *     the frozen-registry case. `find` indexing an object reddened the
 *     three `Object.prototype` names and the list.
 *   - `register` changing the registry in place reddened five cases, the
 *     core registry left unchanged among them. `kinds` not refusing an
 *     unknown port reddened its refusal case. The store backends
 *     registered in reverse reddened the order case, and with it the
 *     store entry's refusals, which list the kinds in that order.
 *
 * The cases those readings name that read core's own kinds (the order
 * case, the core registry left unchanged, the frozen-registry case and
 * the store entry's refusals) moved to `src/adapter-registry.test.ts`
 * with the adapters, as did the readings driven once each core adapter
 * was registered; that file summarises them.
 *
 * Two more were driven on 2026-09-29, once the `sync` port was served
 * with no core kind, over this file, `src/tests/core-coupled/ports/index.test.ts`,
 * `src/tests/adapter-registry.test.ts` and `src/modules/`, with
 * `registry.ts` restored and verified with `sha256sum -c`.
 * `PORT_VERSIONS.sync` set to 2 failed `check-types` and reddened the
 * literal case and both sync add-on cases. The sync adapters left out
 * of the index reddened the add-on sync kind case alone.
 *
 * Five more were driven on 2026-10-15, once the active registry and its
 * facade arrived, one run each over this file and
 * `src/adapter-registry.test.ts`, 85 pass unmutated, with `registry.ts`
 * restored and verified with `sha256sum -c`. The facade's `find`
 * answering without the refusal reddened the refusal case alone.
 * `registerAdapters` keeping the adapters it accepted before a refused
 * one reddened the refused-list case alone. `restoreAdapters` taking the
 * facade reddened its refusal case alone. The facade's `kinds` caching
 * the first registry it read reddened twelve cases, the call-time case
 * among them. A fifth, the facade's `kinds` reading a registry captured
 * when the module loaded, reddened nothing: that registry is always the
 * empty one, so the mutant fell through to the active registry and
 * answered as the facade does.
 */
import type { AdapterRegistry, AnyAdapter } from './registry.js';
import type { Sync, Tracker } from '../../ports/index.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import {
  activeAdapterRegistry,
  CORE_ADAPTER_REGISTRY,
  createAdapterRegistry,
  PORT_VERSIONS,
  registerAdapters,
  restoreAdapters,
} from './registry.js';

/** The repository root, whose tsconfig the compiler reads under. */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The ports entry, whose literal version types the value is held to. */
const PORTS_ENTRY = fileURLToPath(new URL('../../ports/index.ts', import.meta.url));

/** The port types, in the order a refusal lists them. */
const PORT_TYPES = 'tracker, store, learning, output, planner, sync, logger';

/** A probe declaring one version drifted and one widened. */
const DRIFTED_PROBE = [
  'export interface PortVersions {',
  '  tracker: 2;',
  '  store: 1;',
  '  learning: 1;',
  '  output: 1;',
  '  planner: number;',
  '  sync: 1;',
  '}',
  '',
].join('\n');

/** What the reader must report for the drifted probe. */
const DRIFTED_READING = { tracker: 2, store: 1, learning: 1, output: 1, planner: 'number', sync: 1 };

/** A tracker every fixture adapter answers. Never called. */
const FIXTURE_TRACKER: Tracker = {
  kind: 'obsidian',
  capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
  preflight: async () => ({ ok: true }),
  find: async () => [],
  get: async () => {
    throw new Error('unused');
  },
  create: async () => {
    throw new Error('unused');
  },
  comment: async () => {},
  transition: async () => ({}),
};

/** A sync every fixture sync adapter answers. Never called. */
const FIXTURE_SYNC: Sync = {
  kind: 'git',
  push: async () => ({ status: 'nothing-to-sync' }),
  pull: async () => ({ status: 'nothing-to-sync' }),
};

/**
 * A tracker adapter as an add-on hands one over, with any field replaced.
 * The cast is the plant: a refusal case hands the registry what an
 * add-on's JavaScript could.
 */
function addOn(fields: Record<string, unknown> = {}): AnyAdapter {
  return {
    port: 'tracker',
    kind: 'obsidian',
    portVersion: 1,
    create: () => FIXTURE_TRACKER,
    ...fields,
  } as unknown as AnyAdapter;
}

let tempDir = '';
let program: ts.Program | null = null;

/**
 * A registry of fixture adapters under the kinds core registers, in the
 * order the root registers them: the registry the mechanics run over.
 */
const BASE: AdapterRegistry = createAdapterRegistry([
  addOn({ port: 'store', kind: 'sqlite' }),
  addOn({ port: 'store', kind: 'ndjson' }),
  addOn({ kind: 'local' }),
  addOn({ kind: 'github' }),
  addOn({ port: 'learning', kind: 'local' }),
  addOn({ port: 'planner', kind: 'claude' }),
  addOn({ port: 'sync', kind: 'local', create: () => FIXTURE_SYNC }),
  addOn({ port: 'sync', kind: 'file', create: () => FIXTURE_SYNC }),
]);

/** What every member of `CORE_ADAPTER_REGISTRY` throws while nothing is registered. */
const UNREGISTERED = 'adapter registry: no adapter is registered: call registerCoreAdapters()'
  + ' from src/adapter-registry.ts before reading CORE_ADAPTER_REGISTRY';

/** What `restoreAdapters` throws when handed `CORE_ADAPTER_REGISTRY` itself. */
const RESTORE_REFUSAL = 'adapter registry: CORE_ADAPTER_REGISTRY reads the active registry and cannot be made the active one;'
  + ' restore what registerAdapters or activeAdapterRegistry answered';

/**
 * Runs `body` with no adapter registered, and puts back the registry it
 * found, whatever `body` registered or threw.
 */
function overEmpty(body: () => void): void {
  const found = activeAdapterRegistry();
  restoreAdapters(createAdapterRegistry());
  try {
    body();
  } finally {
    restoreAdapters(found);
  }
}

/**
 * The `PortVersions` a file declares, read off the compiler: each
 * member's number when its type is a number literal, and the type as
 * the checker prints it when not.
 */
function declaredVersions(file: string): Record<string, number | string> {
  if (program === null) throw new Error('the program was never compiled');
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`the program holds no ${file}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) throw new Error(`the compiler holds no symbol for ${file}`);
  const declaration = checker.getExportsOfModule(moduleSymbol)
    .find((exported) => exported.name === 'PortVersions');
  if (declaration === undefined) throw new Error(`${file} exports no PortVersions`);

  const members = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(declaration));
  return Object.fromEntries(members.map((member) => {
    const type = checker.getTypeOfSymbol(member);
    return [member.name, type.isNumberLiteral()
      ? type.value
      : checker.typeToString(type)];
  }));
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-registry-'));
  const probe = join(tempDir, 'drifted.ts');
  writeFileSync(probe, DRIFTED_PROBE);

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    REPO_ROOT,
    undefined,
    configPath,
  );
  program = ts.createProgram({ rootNames: [PORTS_ENTRY, probe], options: parsed.options });
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('PORT_VERSIONS', () => {
  it('holds each port type at the number literal the ports entry declares', () => {
    expect(declaredVersions(PORTS_ENTRY)).toEqual({ ...PORT_VERSIONS });
  });

  it('is told apart from a declaration with a version drifted and one widened', () => {
    const reading = declaredVersions(join(tempDir, 'drifted.ts'));

    expect(reading).toEqual(DRIFTED_READING);
    expect(reading).not.toEqual({ ...PORT_VERSIONS });
  });

  it('lists the port types in the order refusals name them', () => {
    expect(Object.keys(PORT_VERSIONS).join(', ')).toBe(PORT_TYPES);
  });

  it('refuses a caller moving a version', () => {
    const versions = PORT_VERSIONS as { tracker: number };

    expect(() => {
      versions.tracker = 2;
    }).toThrow(TypeError);
    expect(PORT_VERSIONS.tracker).toBe(1);
  });
});

describe('registering an adapter', () => {
  it('answers a new registry holding an add-on kind, leaving the one it extended unchanged', () => {
    const extended = BASE.register(addOn());

    expect(extended).not.toBe(BASE);
    expect(extended.kinds('tracker')).toEqual(['local', 'github', 'obsidian']);
    expect(extended.kinds('store')).toEqual(['sqlite', 'ndjson']);
    expect(extended.resolve('tracker', 'obsidian').create({ repoRoot: '/nonexistent' }))
      .toBe(FIXTURE_TRACKER);
    expect(BASE.kinds('tracker')).toEqual(['local', 'github']);
    expect(BASE.find('tracker', 'obsidian')).toBeUndefined();
  });

  it('never calls create when it registers or resolves an adapter', () => {
    const contexts: unknown[] = [];
    const extended = BASE.register(addOn({
      create: (context: unknown) => {
        contexts.push(context);
        return FIXTURE_TRACKER;
      },
    }));
    const adapter = extended.resolve('tracker', 'obsidian');

    expect(contexts).toEqual([]);
    adapter.create({ repoRoot: '/repo' });
    expect(contexts).toEqual([{ repoRoot: '/repo' }]);
  });

  it('holds a frozen copy, so changing the adapter handed over changes nothing held', () => {
    const handed = addOn() as { kind: string; portVersion: number };
    const extended = BASE.register(handed as unknown as AnyAdapter);
    handed.portVersion = 2;
    handed.kind = 'moved';

    const held = extended.resolve('tracker', 'obsidian');
    expect(held.portVersion).toBe(1);
    expect(held.kind).toBe('obsidian');
    expect(Object.isFrozen(held)).toBe(true);
    expect(extended.find('tracker', 'moved')).toBeUndefined();
  });

  it('accepts an add-on at the port version core serves', () => {
    expect(createAdapterRegistry([addOn({ portVersion: 1 })]).kinds('tracker'))
      .toEqual(['obsidian']);
  });

  it.each([
    [2, '2'],
    [0, '0'],
    ['1', '"1"'],
    [1.5, '1.5'],
    [undefined, 'undefined'],
  ])('refuses an add-on implementing port version %p, naming both numbers', (version, quoted) => {
    expect(() => BASE.register(addOn({ portVersion: version }))).toThrow(
      `adapter registry: tracker/obsidian implements tracker port version ${quoted},`
        + ' and core serves tracker port version 1',
    );
  });

  it('names the port a refused version belongs to', () => {
    const store = addOn({ port: 'store', kind: 'homelab', portVersion: 2 });

    expect(() => BASE.register(store)).toThrow(
      'adapter registry: store/homelab implements store port version 2,'
        + ' and core serves store port version 1',
    );
  });

  it('refuses a second adapter under a port type and kind already held', () => {
    const again = addOn({ port: 'store', kind: 'sqlite' });

    expect(() => BASE.register(again))
      .toThrow('adapter registry: store/sqlite is already registered');
    expect(BASE.register(addOn({ kind: 'sqlite' })).kinds('tracker'))
      .toEqual(['local', 'github', 'sqlite']);
  });

  it.each([
    ['a port type nothing declares', 'storage', '"storage"'],
    ['a port type in another case', 'Store', '"Store"'],
    ['the name of Object.prototype.constructor', 'constructor', '"constructor"'],
    ['the name of Object.prototype.toString', 'toString', '"toString"'],
    ['the prototype accessor', '__proto__', '"__proto__"'],
    ['a list naming a port type', ['store'], 'a list'],
    ['no port at all', undefined, 'undefined'],
  ])('refuses an adapter whose port is %s', (_label, port, quoted) => {
    const attempt = (): unknown => BASE.register(addOn({ port }));

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`adapter registry: port is ${quoted}, expected one of: ${PORT_TYPES}`);
  });

  it.each([
    ['', '""'],
    [42, '42'],
    [undefined, 'undefined'],
  ])('refuses an adapter whose kind is %p', (kind, quoted) => {
    const attempt = (): unknown => BASE.register(addOn({ kind }));

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(
      `adapter registry: a tracker adapter has kind ${quoted}, expected a non-empty name`,
    );
  });

  it('refuses an adapter with no create function', () => {
    const attempt = (): unknown => BASE.register(addOn({ create: undefined }));

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(
      'adapter registry: tracker/obsidian has create undefined, expected a function',
    );
  });

  it.each([
    [null, 'null'],
    ['tracker', '"tracker"'],
  ])('refuses %p in place of an adapter', (value, quoted) => {
    const attempt = (): unknown => BASE.register(value as unknown as AnyAdapter);

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`adapter registry: an adapter is ${quoted}, expected a mapping`);
  });

  it('answers a new registry holding an add-on sync kind after the sync kinds held', () => {
    const extended = BASE.register(
      addOn({ port: 'sync', kind: 'git', create: () => FIXTURE_SYNC }),
    );

    expect(extended.kinds('sync')).toEqual(['local', 'file', 'git']);
    expect(extended.resolve('sync', 'git').create({ repoRoot: '/nonexistent' })).toBe(FIXTURE_SYNC);
    expect(BASE.kinds('sync')).toEqual(['local', 'file']);
  });

  it('refuses a sync add-on taking a held sync kind over', () => {
    const local = addOn({ port: 'sync', kind: 'local', create: () => FIXTURE_SYNC });

    expect(() => BASE.register(local)).toThrow('adapter registry: sync/local is already registered');
  });

  it('refuses a sync add-on at a port version core does not serve, naming both numbers', () => {
    const sync = addOn({ port: 'sync', kind: 'git', portVersion: 2, create: () => FIXTURE_SYNC });

    expect(() => BASE.register(sync)).toThrow(
      'adapter registry: sync/git implements sync port version 2,'
        + ' and core serves sync port version 1',
    );
  });

  it('refuses through createAdapterRegistry as register does, on the first refused adapter', () => {
    const attempt = (): unknown => createAdapterRegistry([
      addOn(),
      addOn({ kind: 'linear', portVersion: 3 }),
      addOn({ kind: 'linear', portVersion: 4 }),
    ]);

    expect(attempt).toThrow(
      'adapter registry: tracker/linear implements tracker port version 3,'
        + ' and core serves tracker port version 1',
    );
  });
});

describe('looking an adapter up', () => {
  it('finds a store backend by its kind', () => {
    expect(BASE.find('store', 'sqlite')).toMatchObject({
      port: 'store',
      kind: 'sqlite',
      portVersion: 1,
    });
  });

  it.each([
    ['a kind nothing registers', 'postgres'],
    ['a kind in another case', 'SQLite'],
    ['the name of Object.prototype.constructor', 'constructor'],
    ['the name of Object.prototype.toString', 'toString'],
    ['the prototype accessor', '__proto__'],
    ['a list naming a kind', ['sqlite']],
    ['a number', 42],
    ['undefined', undefined],
  ])('finds nothing under %s', (_label, kind) => {
    expect(BASE.find('store', kind as unknown as string)).toBeUndefined();
  });

  it.each(['storage', 'constructor', '__proto__'])('finds nothing under the port %p, throwing nothing', (port) => {
    const find = BASE.find as (port: unknown, kind: string) => unknown;

    expect(find(port, 'sqlite')).toBeUndefined();
  });

  it('resolves nothing under a kind not held, naming the kinds that are', () => {
    expect(() => BASE.resolve('store', 'postgres')).toThrow(
      'adapter registry: no store adapter is registered as "postgres"; registered: sqlite, ndjson',
    );
    expect(() => BASE.resolve('store', 'constructor')).toThrow(
      'adapter registry: no store adapter is registered as "constructor"; registered: sqlite, ndjson',
    );
    expect(() => BASE.resolve('tracker', 'linear')).toThrow(
      'adapter registry: no tracker adapter is registered as "linear"; registered: local, github',
    );
    expect(() => BASE.resolve('learning', 'remote')).toThrow(
      'adapter registry: no learning adapter is registered as "remote"; registered: local',
    );
    expect(() => BASE.resolve('planner', 'webhook')).toThrow(
      'adapter registry: no planner adapter is registered as "webhook"; registered: claude',
    );
    expect(() => BASE.resolve('sync', 'git')).toThrow(
      'adapter registry: no sync adapter is registered as "git"; registered: local, file',
    );
  });

  it('refuses a port type it does not declare, in resolve and in kinds', () => {
    const resolve = BASE.resolve as (port: unknown, kind: string) => unknown;
    const kinds = BASE.kinds as (port: unknown) => unknown;
    const refusal = `adapter registry: port is "storage", expected one of: ${PORT_TYPES}`;

    expect(() => resolve('storage', 'sqlite')).toThrow(TypeError);
    expect(() => resolve('storage', 'sqlite')).toThrow(refusal);
    expect(() => kinds('storage')).toThrow(TypeError);
    expect(() => kinds('storage')).toThrow(refusal);
  });

  it('answers kinds a caller can change without changing the registry', () => {
    const kinds = BASE.kinds('store') as string[];
    kinds.push('postgres');

    expect(BASE.kinds('store')).toEqual(['sqlite', 'ndjson']);
  });
});

describe('the active registry and CORE_ADAPTER_REGISTRY', () => {
  it('refuses every member while nothing is registered, naming the module that registers core\'s adapters', () => {
    overEmpty(() => {
      expect(() => CORE_ADAPTER_REGISTRY.resolve('logger', 'console')).toThrow(UNREGISTERED);
      expect(() => CORE_ADAPTER_REGISTRY.find('logger', 'console')).toThrow(UNREGISTERED);
      expect(() => CORE_ADAPTER_REGISTRY.kinds('logger')).toThrow(UNREGISTERED);
      expect(() => CORE_ADAPTER_REGISTRY.register(addOn())).toThrow(UNREGISTERED);

      // Control: one adapter registered, and each member answers.
      registerAdapters([addOn()]);
      const find = CORE_ADAPTER_REGISTRY.find as (port: unknown, kind: string) => unknown;

      expect(CORE_ADAPTER_REGISTRY.kinds('tracker')).toEqual(['obsidian']);
      expect(CORE_ADAPTER_REGISTRY.find('tracker', 'obsidian')?.kind).toBe('obsidian');
      expect(find('storage', 'obsidian')).toBeUndefined();
      expect(CORE_ADAPTER_REGISTRY.resolve('tracker', 'obsidian').create({ repoRoot: '/nonexistent' }))
        .toBe(FIXTURE_TRACKER);
      expect(CORE_ADAPTER_REGISTRY.register(addOn({ kind: 'linear' })).kinds('tracker'))
        .toEqual(['obsidian', 'linear']);
      expect(CORE_ADAPTER_REGISTRY.kinds('tracker')).toEqual(['obsidian']);
    });
  });

  it('reads the active registry when a member is called, not when the registry was taken', () => {
    overEmpty(() => {
      const taken = CORE_ADAPTER_REGISTRY;
      registerAdapters([addOn()]);

      expect(taken.kinds('tracker')).toEqual(['obsidian']);
      const before = registerAdapters([addOn({ kind: 'linear' })]);
      expect(taken.kinds('tracker')).toEqual(['obsidian', 'linear']);
      restoreAdapters(before);
      expect(taken.kinds('tracker')).toEqual(['obsidian']);
    });
  });

  it('registers in order and answers the registry it replaced, which a later registration leaves unchanged', () => {
    overEmpty(() => {
      const empty = activeAdapterRegistry();
      const replaced = registerAdapters([addOn(), addOn({ kind: 'linear' })]);
      const first = activeAdapterRegistry();
      registerAdapters([addOn({ port: 'store', kind: 'homelab' })]);

      expect(replaced).toBe(empty);
      expect(replaced.kinds('tracker')).toEqual([]);
      expect(first.kinds('tracker')).toEqual(['obsidian', 'linear']);
      expect(first.kinds('store')).toEqual([]);
      expect(activeAdapterRegistry().kinds('store')).toEqual(['homelab']);
      expect(activeAdapterRegistry().kinds('tracker')).toEqual(['obsidian', 'linear']);
    });
  });

  it('registers none of a list it refuses, leaving the active registry as it was', () => {
    overEmpty(() => {
      registerAdapters([addOn()]);
      const before = activeAdapterRegistry();

      expect(() => registerAdapters([addOn({ kind: 'linear' }), addOn({ kind: 'jira', portVersion: 2 })])).toThrow(
        'adapter registry: tracker/jira implements tracker port version 2,'
          + ' and core serves tracker port version 1',
      );
      expect(() => registerAdapters([addOn()])).toThrow('adapter registry: tracker/obsidian is already registered');
      expect(activeAdapterRegistry()).toBe(before);
      expect(CORE_ADAPTER_REGISTRY.find('tracker', 'linear')).toBeUndefined();

      // Control: the same list without the refused adapter registers.
      registerAdapters([addOn({ kind: 'linear' })]);
      expect(CORE_ADAPTER_REGISTRY.kinds('tracker')).toEqual(['obsidian', 'linear']);
    });
  });

  it('refuses CORE_ADAPTER_REGISTRY as the registry to restore, leaving the active one as it was', () => {
    overEmpty(() => {
      registerAdapters([addOn()]);
      const before = activeAdapterRegistry();
      const attempt = (): void => restoreAdapters(CORE_ADAPTER_REGISTRY);

      expect(attempt).toThrow(TypeError);
      expect(attempt).toThrow(RESTORE_REFUSAL);
      expect(activeAdapterRegistry()).toBe(before);
      expect(CORE_ADAPTER_REGISTRY.kinds('tracker')).toEqual(['obsidian']);
    });
  });

  it('is frozen, as every registry is, so no caller swaps a member', () => {
    const facade = CORE_ADAPTER_REGISTRY as { kinds: unknown };

    expect(Object.isFrozen(CORE_ADAPTER_REGISTRY)).toBe(true);
    expect(Object.isFrozen(BASE)).toBe(true);
    expect(() => {
      facade.kinds = () => [];
    }).toThrow(TypeError);
  });
});
