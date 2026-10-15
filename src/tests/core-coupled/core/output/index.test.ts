/**
 * Tests for the `index.ts` barrel: it exports every name `active.ts`,
 * `text.ts` and `stream.ts` export, each once, as the same binding, and
 * no other name.
 *
 * The barrel spells its names, so a name added to one of the three and
 * not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `packages/rafa/src/core/config/load.test.ts` reads
 * its barrel.
 *
 * `active.ts` exports no type, `text.ts` exports one, the interface
 * `CreateTextOutputOptions`, and `stream.ts` exports one and nothing
 * else, the interface `OutputStream`. So the checker's list is the
 * namespaces' five runtime names and those two. `packages/rafa/src/core/config/load.ts`,
 * which exports the type `ConfigRoots`, is read beside them as the
 * control that the checker's reading sees a type name at all.
 *
 * Four names are held by name, so a reading that came back empty fails
 * rather than agreeing with itself: `activeOutput`, the reader every
 * printing function calls, `runWithActiveOutput`, the scope the
 * dispatcher runs each command in, `createTextOutput`, the default
 * output's maker, and `OutputStream`, the one name `stream.ts` exports.
 *
 * The binding case is what a barrel over module state has to hold: a
 * second copy of `active.ts` would have a module-level output of its
 * own. An output set through the barrel is read back through the file,
 * and the reverse, with the default put back after each.
 *
 * Two mutations were driven against this file on 2026-10-12, when the
 * barrel held `active.ts` alone, one run each, with both files restored
 * sha256-identical: the barrel spelling three of the four names
 * reddened all four cases, and `active.ts` exporting its `ScopedOutput`
 * interface reddened the last case alone. Two more were driven on
 * 2026-10-15, once the barrel held all three files, with the barrel
 * restored sha256-identical: dropping `createTextOutput` reddened three
 * cases, the binding-sharing one aside, and dropping `OutputStream`
 * reddened the last case alone.
 */
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as barrel from '@open-tomato/rafa/core/output';
import * as active from '@open-tomato/rafa/core/output/active';
import * as text from '@open-tomato/rafa/core/output/text';

import { createJsonOutput } from '../../../../adapters/output/json.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/output/index.ts';
const ACTIVE = 'packages/rafa/src/core/output/active.ts';
const TEXT = 'packages/rafa/src/core/output/text.ts';
const STREAM = 'packages/rafa/src/core/output/stream.ts';
const LOAD_BARREL = 'packages/rafa/src/core/config/load.ts';

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

describe('the output barrel', () => {
  afterEach(() => {
    active.setActiveOutput(null);
  });

  it('exports the runtime names of active.ts and text.ts, each once, and no other', () => {
    const expected = [...Object.keys(active), ...Object.keys(text)].sort();

    expect(expected).toContain('activeOutput');
    expect(expected).toContain('runWithActiveOutput');
    expect(expected).toContain('createTextOutput');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;
    const declared = [...Object.entries(active), ...Object.entries(text)];

    expect(declared.length).toBeGreaterThan(0);
    for (const [name, value] of declared) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('reads and sets the one module-level output of active.ts, in both directions', () => {
    const viaBarrel = createJsonOutput({ stream: { write: () => true } });
    const viaFile = createJsonOutput({ stream: { write: () => true } });

    barrel.setActiveOutput(viaBarrel, 'json');
    const readThroughFile = [active.activeOutput(), active.activeOutputMode()];
    active.setActiveOutput(viaFile, 'events');
    const readThroughBarrel = [barrel.activeOutput(), barrel.activeOutputMode()];

    expect(readThroughFile[0]).toBe(viaBarrel);
    expect(readThroughFile[1]).toBe('json');
    expect(readThroughBarrel[0]).toBe(viaFile);
    expect(readThroughBarrel[1]).toBe('events');
  });

  it('exports the type names of the three files with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, ACTIVE, TEXT, STREAM, LOAD_BARREL]);
    const expected = [...(names[ACTIVE] ?? []), ...(names[TEXT] ?? []), ...(names[STREAM] ?? [])].sort();

    expect(names[ACTIVE]).toContain('activeOutput');
    expect(names[ACTIVE]).toContain('runWithActiveOutput');
    expect(names[TEXT]).toContain('CreateTextOutputOptions');
    expect(names[STREAM]).toEqual(['OutputStream']);
    expect(names[LOAD_BARREL]).toContain('ConfigRoots');
    expect(names[BARREL]).toEqual(expected);
  });
});
