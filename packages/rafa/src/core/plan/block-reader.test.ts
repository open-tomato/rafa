/**
 * Tests for the `block-reader.ts` barrel: it exports every name
 * `blocks.ts` exports, each once, as the same binding, no other name,
 * and no name the other plan barrel holds.
 *
 * The barrel spells its names, so a name added to `blocks.ts` and not to
 * the barrel is a name no file outside `packages/rafa/src/core/` can import. Nothing
 * here is spelled a second time: both sides are read off the modules,
 * the runtime names off their namespaces and the type names with the
 * TypeScript checker, as `packages/rafa/src/core/config/load.test.ts` reads its
 * barrel.
 *
 * Two names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `readRafaBlocks`, the function the tracker imports, and `RafaBlock`,
 * a type of `blocks.ts`.
 *
 * The last case holds the two plan barrels apart. `PlanModel` on
 * `index.ts` is its control: a reading of that barrel that came back
 * empty would find no name in common and pass.
 *
 * Three mutations were driven against this file on 2026-10-12, one run
 * each, with the barrel restored and verified with `sha256sum -c`. The
 * barrel leaving out `isRafaBlockKind` reddened the first three cases.
 * The barrel leaving out the type `LineSpan` reddened the third case
 * alone. The barrel exporting the type `PlanTask` as well reddened the
 * third and fourth cases.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as barrel from './block-reader.js';
import * as blocks from './blocks.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/plan/block-reader.ts';
const PLAN_BARREL = 'packages/rafa/src/core/plan/index.ts';
const BLOCKS = 'packages/rafa/src/core/plan/blocks.ts';

/**
 * Every export name of each file, types included, sorted.
 *
 * @param paths - Repository-relative paths of the modules to read.
 * @returns The names by path.
 * @throws When `tsconfig.json` does not parse or a path is no module.
 */
function readExportNames(paths: readonly string[]): Record<string, string[]> {
  const files = paths.map((path) => resolve(ROOT, path));
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve(ROOT, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error('tsconfig.json did not parse');
  const program = ts.createProgram(files, parsed.options);
  const checker = program.getTypeChecker();
  const names: Record<string, string[]> = {};
  for (const [index, file] of files.entries()) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) throw new Error(`not in program: ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) throw new Error(`not a module: ${file}`);
    names[paths[index] ?? file] = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.name)
      .sort();
  }
  return names;
}

describe('the block-reader barrel', () => {
  it('exports the runtime names of blocks.ts, each once, and no other', () => {
    const expected = Object.keys(blocks).sort();

    expect(expected).toContain('readRafaBlocks');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding blocks.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(blocks).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(blocks)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of blocks.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, BLOCKS]);

    expect(names[BLOCKS]).toContain('RafaBlock');
    expect(names[BLOCKS]).toContain('readRafaBlocks');
    expect(Object.keys(blocks)).not.toContain('RafaBlock');
    expect(names[BARREL]).toEqual(names[BLOCKS] ?? []);
  });

  it('holds no name the other plan barrel holds, type or runtime', () => {
    const names = readExportNames([BARREL, PLAN_BARREL]);
    const onTwo = (names[BARREL] ?? []).filter((name) => (names[PLAN_BARREL] ?? []).includes(name));

    expect(names[BARREL]?.length).toBeGreaterThan(0);
    expect(names[PLAN_BARREL]).toContain('PlanModel');
    expect(onTwo).toEqual([]);
  });
});
