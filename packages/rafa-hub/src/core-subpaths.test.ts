/**
 * The package reaches core only through `@open-tomato/rafa/store` and
 * `@open-tomato/rafa/ports`. `tsconfig.packages.json` maps core's
 * subpaths to its source under `packages/rafa/src/`, so bun and tsc
 * resolve both without a build; these cases hold that map's four
 * entries under core's package source, and hold a route into core by
 * any other name unresolved. That the map and core's manifest `exports`
 * name the same files is the third case of the two-names sweep,
 * `src/tests/core-package.sweep.test.ts`.
 */
import type { Sync, SyncPortVersion } from '@open-tomato/rafa/ports';
import type { StoreMergeResult, WirePayload } from '@open-tomato/rafa/store';

import {
  decodeWirePayload,
  EFFORT_KEY_PROJECTIONS,
  encodeWirePayload,
  exportWirePayload,
  materialiseWirePayload,
  mergeStore,
  selectEffortStore,
  TRUSTED_PERMISSIONS,
} from '@open-tomato/rafa/store';
import { describe, expect, it } from 'bun:test';

const ROOT = new URL('../../../', import.meta.url);
const CORE_SOURCE = new URL('packages/rafa/src/', ROOT).href;
const UNRESOLVED_CODE = 'ERR_MODULE_NOT_FOUND';

async function readJson(name: string): Promise<unknown> {
  return Bun.file(new URL(name, ROOT)).json();
}

describe('core subpaths from this package', () => {
  it('resolves the store subpath to the store entry under core\'s package source', () => {
    expect(import.meta.resolve('@open-tomato/rafa/store'))
      .toBe(new URL('packages/rafa/src/effort/store/index.ts', ROOT).href);
    expect(typeof selectEffortStore).toBe('function');
    expect(EFFORT_KEY_PROJECTIONS).toBeDefined();
  });

  it('reaches the wire codec, mergeStore and TRUSTED_PERMISSIONS through the store subpath', () => {
    const payload: Pick<WirePayload, 'migrations'> = { migrations: [] };
    const status: StoreMergeResult['status'] = 'merged';
    expect([payload.migrations, status]).toEqual([[], 'merged']);
    expect([exportWirePayload, materialiseWirePayload, encodeWirePayload, decodeWirePayload, mergeStore]
      .map((value) => typeof value)).toEqual(['function', 'function', 'function', 'function', 'function']);
    expect(TRUSTED_PERMISSIONS).toEqual(['admin', 'maintain', 'write']);
  });

  it('resolves the ports subpath to the ports entry, which exports no runtime value', async () => {
    expect(import.meta.resolve('@open-tomato/rafa/ports'))
      .toBe(new URL('packages/rafa/src/ports/index.ts', ROOT).href);
    const kind: Sync['kind'] = 'service';
    const version: SyncPortVersion = 1;
    expect([kind, version]).toEqual(['service', 1]);
    expect(Object.keys(await import('@open-tomato/rafa/ports'))).toEqual([]);
  });

  it('maps exactly four entries, each resolving under core\'s package source', async () => {
    const shared = await readJson('tsconfig.packages.json') as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    expect(Object.keys(shared.compilerOptions.paths)).toEqual([
      '@open-tomato/rafa/store',
      '@open-tomato/rafa/ports',
      '@open-tomato/rafa/store/*',
      '@open-tomato/rafa/*',
    ]);
    // One specifier per entry: each lands on its own file under the package source.
    expect([
      '@open-tomato/rafa/store',
      '@open-tomato/rafa/ports',
      '@open-tomato/rafa/store/sqlite',
      '@open-tomato/rafa/core/git',
    ].map((specifier) => import.meta.resolve(specifier).slice(CORE_SOURCE.length))).toEqual([
      'effort/store/index.ts',
      'ports/index.ts',
      'effort/store/sqlite.ts',
      'core/git/index.ts',
    ]);
  });

  it.each([
    '@open-tomato/rafa/src/effort/store/index.ts',
    '@open-tomato/rafa/cli',
  ])('leaves %s unresolved', async (specifier: string) => {
    // The code, not Bun's message wording, is what both Bun versions share.
    const failure: unknown = await import(specifier).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeDefined();
    expect((failure as { code?: string }).code).toBe(UNRESOLVED_CODE);
  });
});
