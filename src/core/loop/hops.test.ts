/**
 * Tests for the `hops.ts` barrel: it exports every name `hop-record.ts`
 * exports, each once, as the same binding, no other name, and no name
 * the other two loop barrels hold.
 *
 * The barrel spells its names, so a name added to `hop-record.ts` and
 * not to the barrel is a name no file outside `src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `readings.test.ts` reads its barrel.
 *
 * Two names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `asHopRecord`, a function of `hop-record.ts`, and `Place`, a type of it.
 *
 * The last case holds the three loop barrels apart. `SessionRecord` on
 * `index.ts` and `estimateEta` on `readings.ts` are its controls: a
 * reading of either barrel that came back empty would find no name in
 * common and pass.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as hopRecord from './hop-record.js';
import * as barrel from './hops.js';

const ROOT = resolve(import.meta.dir, '../../..');

const BARREL = 'src/core/loop/hops.ts';
const LOOP_BARREL = 'src/core/loop/index.ts';
const READINGS_BARREL = 'src/core/loop/readings.ts';
const HOP_RECORD = 'src/core/loop/hop-record.ts';

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

describe('the hops barrel', () => {
  it('exports the runtime names of hop-record.ts, each once, and no other', () => {
    const expected = Object.keys(hopRecord).sort();

    expect(expected).toContain('asHopRecord');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding hop-record.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(hopRecord).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(hopRecord)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of hop-record.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, HOP_RECORD]);

    expect(names[HOP_RECORD]).toContain('Place');
    expect(names[HOP_RECORD]).toContain('asHopRecord');
    expect(Object.keys(hopRecord)).not.toContain('Place');
    expect(names[BARREL]).toEqual(names[HOP_RECORD] ?? []);
  });

  it('holds no name the other two loop barrels hold, type or runtime', () => {
    const names = readExportNames([BARREL, LOOP_BARREL, READINGS_BARREL]);
    const others = [...(names[LOOP_BARREL] ?? []), ...(names[READINGS_BARREL] ?? [])];
    const onTwo = (names[BARREL] ?? []).filter((name) => others.includes(name));

    expect(names[BARREL]?.length).toBeGreaterThan(0);
    expect(names[LOOP_BARREL]).toContain('SessionRecord');
    expect(names[READINGS_BARREL]).toContain('estimateEta');
    expect(onTwo).toEqual([]);
  });
});
