/**
 * Tests for `base.json`, the strict base every rafa tsconfig extends
 * through `@open-tomato/rafa-typescript-config/base`: the two flags the
 * monorepo split holds every package to, `isolatedDeclarations` and
 * `erasableSyntaxOnly`, and `declaration`, which `tsc` refuses
 * `isolatedDeclarations` without.
 *
 * The file is read as JSON, not through `tsc`, so the values are the ones
 * written in it; each flag is held to `true`, spelled here, so a flag
 * dropped or set to `false` fails its case. The manifest case holds the
 * `./base` export the `extends` lines name, which a consumer resolves the
 * file through.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

/** The package's directory. */
const PACKAGE_DIR = import.meta.dir;

/** Reads a JSON file of the package as an object. */
async function readJson(name: string): Promise<Record<string, unknown>> {
  return (await Bun.file(join(PACKAGE_DIR, name)).json()) as Record<string, unknown>;
}

/** The `compilerOptions` of `base.json`. */
async function baseOptions(): Promise<Record<string, unknown>> {
  const base = await readJson('base.json');
  return base['compilerOptions'] as Record<string, unknown>;
}

describe('base.json', () => {
  it('sets isolatedDeclarations', async () => {
    expect((await baseOptions())['isolatedDeclarations']).toBe(true);
  });

  it('sets erasableSyntaxOnly', async () => {
    expect((await baseOptions())['erasableSyntaxOnly']).toBe(true);
  });

  it('sets declaration, which isolatedDeclarations needs', async () => {
    expect((await baseOptions())['declaration']).toBe(true);
  });

  it('extends nothing, so no flag comes from a file outside the package', async () => {
    expect(await readJson('base.json')).not.toHaveProperty('extends');
  });
});

describe('package.json', () => {
  it('exports base.json as ./base, the path every extends line names', async () => {
    const manifest = await readJson('package.json');
    expect(manifest['name']).toBe('@open-tomato/rafa-typescript-config');
    expect(manifest['private']).toBe(true);
    expect(manifest['exports']).toEqual({ './base': './base.json' });
    expect(manifest['files']).toEqual(['base.json']);
  });
});
