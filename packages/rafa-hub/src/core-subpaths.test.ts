/**
 * The package reaches core only through `@open-tomato/rafa/store` and
 * `@open-tomato/rafa/ports`. `tsconfig.packages.json` maps each subpath
 * to the source file the root build compiles into its `exports` target,
 * so bun and tsc resolve both without a build; these cases hold that
 * map to core's entries and to the root `exports`, and hold every other
 * route into core unresolved.
 */
import type { Sync, SyncPortVersion } from '@open-tomato/rafa/ports';

import { EFFORT_KEY_PROJECTIONS, selectEffortStore } from '@open-tomato/rafa/store';
import { describe, expect, it } from 'bun:test';

const ROOT = new URL('../../../', import.meta.url);
const CORE_PREFIX = '@open-tomato/rafa/';
const UNRESOLVED = 'Cannot find package \'@open-tomato/rafa\'';

async function readJson(name: string): Promise<unknown> {
  return Bun.file(new URL(name, ROOT)).json();
}

describe('core subpaths from this package', () => {
  it('resolves the store subpath to the store entry under the root src/', () => {
    expect(import.meta.resolve('@open-tomato/rafa/store'))
      .toBe(new URL('src/effort/store/index.ts', ROOT).href);
    expect(typeof selectEffortStore).toBe('function');
    expect(EFFORT_KEY_PROJECTIONS).toBeDefined();
  });

  it('resolves the ports subpath to the ports entry, which exports no runtime value', async () => {
    expect(import.meta.resolve('@open-tomato/rafa/ports'))
      .toBe(new URL('src/ports/index.ts', ROOT).href);
    const kind: Sync['kind'] = 'service';
    const version: SyncPortVersion = 1;
    expect([kind, version]).toEqual(['service', 1]);
    expect(Object.keys(await import('@open-tomato/rafa/ports'))).toEqual([]);
  });

  it('maps exactly the store and ports subpaths, each to the source of its exports target', async () => {
    const shared = await readJson('tsconfig.packages.json') as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    const core = await readJson('package.json') as {
      exports: Record<string, string>;
    };
    const paths = shared.compilerOptions.paths;
    expect(Object.keys(paths).sort()).toEqual([
      '@open-tomato/rafa/ports',
      '@open-tomato/rafa/store',
    ]);
    for (const [specifier, targets] of Object.entries(paths)) {
      const subpath = `./${specifier.slice(CORE_PREFIX.length)}`;
      const source = targets[0]?.replace(/^\.\/src\//, '').replace(/\.ts$/, '');
      expect(targets).toHaveLength(1);
      expect(core.exports[subpath]).toBe(`./dist/${source}.js`);
    }
  });

  it.each([
    '@open-tomato/rafa/src/effort/store/index.ts',
    '@open-tomato/rafa/cli',
  ])('leaves %s unresolved', async (specifier: string) => {
    await expect(import(specifier)).rejects.toThrow(UNRESOLVED);
  });
});
