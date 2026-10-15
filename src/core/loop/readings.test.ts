/**
 * Tests for the `readings.ts` barrel: it exports every name
 * `session-readings.ts` exports, each once, as the same binding, no
 * other name, and no name `index.ts`, the first loop barrel, holds.
 *
 * The barrel spells its names, so a name added to
 * `session-readings.ts` and not to the barrel is a name no file outside
 * `src/core/` can import. Nothing here is spelled a second time: both
 * sides are read off the modules, the runtime names off their
 * namespaces and the type names with the TypeScript checker, as
 * `src/core/plan/block-reader.test.ts` reads its barrel.
 *
 * Three names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `estimateEta`, a function of `session-readings.ts`;
 * `STOP_POLL_MS`, a constant of it; and `SessionEta`, a type of it.
 *
 * The last case holds the two loop barrels apart. `SessionRecord` on
 * `index.ts` is its control: a reading of that barrel that came back
 * empty would find no name in common and pass.
 *
 * Four mutations were driven against this file on 2026-10-12, one run
 * each, with the barrel restored and verified with `sha256sum -c`. The
 * barrel leaving out `formatDuration` reddened the first three cases.
 * The barrel leaving out the type `SessionEta` reddened the third case
 * alone. The barrel exporting `isLive` as a wrapper reddened the second
 * case alone. The barrel exporting `readSessions` of `sessions.ts` as
 * well reddened the first, third and fourth cases.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as barrel from './readings.js';
import * as readings from './session-readings.js';

const ROOT = resolve(import.meta.dir, '../../..');

const BARREL = 'src/core/loop/readings.ts';
const LOOP_BARREL = 'src/core/loop/index.ts';
const READINGS = 'src/core/loop/session-readings.ts';

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

describe('the session-readings barrel', () => {
  it('exports the runtime names of session-readings.ts, each once, and no other', () => {
    const expected = Object.keys(readings).sort();

    expect(expected).toContain('estimateEta');
    expect(expected).toContain('STOP_POLL_MS');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding session-readings.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(readings).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(readings)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of session-readings.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, READINGS]);

    expect(names[READINGS]).toContain('SessionEta');
    expect(names[READINGS]).toContain('estimateEta');
    expect(Object.keys(readings)).not.toContain('SessionEta');
    expect(names[BARREL]).toEqual(names[READINGS] ?? []);
  });

  it('holds no name the other loop barrel holds, type or runtime', () => {
    const names = readExportNames([BARREL, LOOP_BARREL]);
    const onTwo = (names[BARREL] ?? []).filter((name) => (names[LOOP_BARREL] ?? []).includes(name));

    expect(names[BARREL]?.length).toBeGreaterThan(0);
    expect(names[LOOP_BARREL]).toContain('SessionRecord');
    expect(onTwo).toEqual([]);
  });
});
