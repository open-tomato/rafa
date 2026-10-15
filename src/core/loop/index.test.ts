/**
 * Tests for the `index.ts` barrel: it exports every name `sessions.ts`,
 * `claude.ts` and `session-env.ts` export, each once, as the same binding, and no other
 * name.
 *
 * The barrel spells its names, so a name added to one of the two files
 * and not to the barrel is a name no file outside `src/core/` can
 * import. Nothing here is spelled a second time: both sides are read
 * off the modules, the runtime names off their namespaces and the type
 * names with the TypeScript checker, as `src/core/git/index.test.ts`
 * reads its barrel.
 *
 * The second case holds that the two files share no name, type or
 * runtime. One barrel exports one binding under a name, so a name on
 * both files would be lost from one of them, and the joined lists of
 * the other cases would not say which.
 *
 * `sessions.ts` re-exports part of `src/loop/session-record-parse.ts`,
 * and the barrel carries those names two files away from where they are
 * declared. The fourth case holds each of them to the binding that file
 * declares. `SessionRecordError` is why it matters: a caller catches,
 * with `instanceof` on the class it imported here, an error the parser
 * threw with its own.
 *
 * Eight names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `readSessions`, a function `sessions.ts` declares;
 * `SessionRecord`, a type it declares; `parseSessionRecord` and
 * `SessionRecordError`, a function and a class it re-exports;
 * `SessionState`, a type it re-exports; `claudeArgs`, a function of
 * `claude.ts`; `CapturedSession`, a type of it; and `freezeRecord`, a
 * function of the parser `sessions.ts` does not re-export, which the
 * barrel must not hold.
 *
 * Seven mutations were driven against this file on 2026-10-12, one run
 * each, with the barrel, `sessions.ts` and `claude.ts` restored and
 * verified with `sha256sum -c`. The barrel leaving out `readSessions`
 * reddened the first, third and fifth cases, and so did the barrel
 * leaving out `claudeArgs`. The barrel leaving out the type
 * `CapturedSession` reddened the fifth case alone. The barrel exporting
 * `claudeArgs` as a wrapper reddened the third case alone. The barrel
 * exporting `freezeRecord` as well reddened the first, fourth and fifth
 * cases. `claude.ts` exporting a `RUNS_DIR` of its own reddened every
 * case but the fourth. `sessions.ts` declaring a `sessionPhase` of its
 * own, in place of the one it re-exports, reddened the fourth case
 * alone.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as parser from '../../loop/session-record-parse.js';

import * as claude from './claude.js';
import * as sessionEnv from './session-env.js';
import * as sessions from './sessions.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../..');

const BARREL = 'src/core/loop/index.ts';
const SESSIONS = 'src/core/loop/sessions.ts';
const CLAUDE = 'src/core/loop/claude.ts';
const SESSION_ENV = 'src/core/loop/session-env.ts';

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

/**
 * The names more than one of the lists holds, sorted.
 *
 * @param lists - The lists to compare.
 * @returns Each name found in two lists or more, once.
 */
function onTwo(lists: readonly (readonly string[])[]): string[] {
  const all = lists.flat();
  return [...new Set(all.filter((name, index) => all.indexOf(name) !== index))].sort();
}

/** The runtime bindings of the three files; the second case holds that no name is lost to the spread. */
const BEHIND: Readonly<Record<string, unknown>> = { ...sessions, ...claude, ...sessionEnv };

describe('the loop barrel', () => {
  it('exports the runtime names of the three files, each once, and no other', () => {
    const expected = [...Object.keys(sessions), ...Object.keys(claude), ...Object.keys(sessionEnv)].sort();

    expect(Object.keys(sessions)).toContain('readSessions');
    expect(Object.keys(sessions)).toContain('parseSessionRecord');
    expect(Object.keys(claude)).toContain('claudeArgs');
    expect(Object.keys(sessionEnv)).toContain('sessionSpawnEnv');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('reads three files that share no name, type or runtime', () => {
    const names = readExportNames([SESSIONS, CLAUDE, SESSION_ENV]);

    expect(names[SESSIONS]?.length).toBeGreaterThan(0);
    expect(names[CLAUDE]?.length).toBeGreaterThan(0);
    expect(names[SESSION_ENV]?.length).toBeGreaterThan(0);
    expect(onTwo([['a', 'b'], ['b', 'c'], ['c']])).toEqual(['b', 'c']);
    expect(onTwo([names[SESSIONS] ?? [], names[CLAUDE] ?? [], names[SESSION_ENV] ?? []])).toEqual([]);
    expect(onTwo([Object.keys(sessions), Object.keys(claude), Object.keys(sessionEnv)])).toEqual([]);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(sessions).length).toBeGreaterThan(0);
    expect(Object.keys(claude).length).toBeGreaterThan(0);
    expect(Object.keys(sessionEnv).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(BEHIND)) {
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

  it('exports the type names of the three files with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, SESSIONS, CLAUDE, SESSION_ENV]);
    const expected = [...(names[SESSIONS] ?? []), ...(names[CLAUDE] ?? []), ...(names[SESSION_ENV] ?? [])].sort();

    expect(names[SESSIONS]).toContain('SessionRecord');
    expect(names[SESSIONS]).toContain('SessionState');
    expect(names[CLAUDE]).toContain('CapturedSession');
    expect(names[SESSION_ENV]).toContain('SpawnEnv');
    expect(Object.keys(sessions)).not.toContain('SessionRecord');
    expect(Object.keys(sessions)).not.toContain('SessionState');
    expect(Object.keys(claude)).not.toContain('CapturedSession');
    expect(names[BARREL]).toEqual(expected);
  });
});
