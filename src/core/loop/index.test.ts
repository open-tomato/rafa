/**
 * Tests for the `index.ts` barrel: it exports every name `sessions.ts`
 * exports, each once, as the same binding, and no other name.
 *
 * The barrel spells its names, so a name added to `sessions.ts` and not
 * to the barrel is a name no file outside `src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `src/core/plan/block-reader.test.ts`
 * reads its barrel.
 *
 * `sessions.ts` re-exports part of `src/loop/session-record-parse.ts`,
 * and the barrel carries those names two files away from where they are
 * declared. The third case holds each of them to the binding that file
 * declares. `SessionRecordError` is why it matters: a caller catches,
 * with `instanceof` on the class it imported here, an error the parser
 * threw with its own.
 *
 * Six names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `readSessions`, a function `sessions.ts` declares; `SessionRecord`, a
 * type it declares; `parseSessionRecord` and `SessionRecordError`, a
 * function and a class it re-exports; `SessionState`, a type it
 * re-exports; and `freezeRecord`, a function of the parser it does not
 * re-export, which the barrel must not hold.
 *
 * Five mutations were driven against this file on 2026-10-12, one run
 * each, with the barrel and `sessions.ts` restored and verified with
 * `sha256sum -c`. The barrel leaving out `readSessions` reddened the
 * first, second and fourth cases. The barrel leaving out the type
 * `SessionState` reddened the fourth case alone. The barrel exporting
 * `isPidAlive` as a wrapper reddened the second case alone. The barrel
 * exporting `freezeRecord` as well reddened the first, third and fourth
 * cases. `sessions.ts` declaring a `sessionPhase` of its own, in place
 * of the one it re-exports, reddened the third case alone.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as parser from '../../loop/session-record-parse.js';

import * as sessions from './sessions.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../..');

const BARREL = 'src/core/loop/index.ts';
const SESSIONS = 'src/core/loop/sessions.ts';

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

describe('the loop barrel', () => {
  it('exports the runtime names of sessions.ts, each once, and no other', () => {
    const expected = Object.keys(sessions).sort();

    expect(expected).toContain('readSessions');
    expect(expected).toContain('parseSessionRecord');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding sessions.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(sessions).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(sessions)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('carries the names sessions.ts re-exports as the bindings the record parser declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;
    const declared: Readonly<Record<string, unknown>> = parser;
    const carried = Object.keys(parser).filter((name) => name in exported);

    expect(carried).toContain('parseSessionRecord');
    expect(carried).toContain('SessionRecordError');
    expect(Object.keys(parser)).toContain('freezeRecord');
    expect(carried).not.toContain('freezeRecord');
    for (const name of carried) {
      expect([name, exported[name] === declared[name]]).toEqual([name, true]);
    }
  });

  it('exports the type names of sessions.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, SESSIONS]);

    expect(names[SESSIONS]).toContain('SessionRecord');
    expect(names[SESSIONS]).toContain('SessionState');
    expect(Object.keys(sessions)).not.toContain('SessionRecord');
    expect(Object.keys(sessions)).not.toContain('SessionState');
    expect(names[BARREL]).toEqual(names[SESSIONS] ?? []);
  });
});
