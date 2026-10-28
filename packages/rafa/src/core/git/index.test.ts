/**
 * Tests for the `index.ts` barrel: it exports every name `git.ts`,
 * `commit.ts` and `gh-runner.ts` export, each once, as the same
 * binding, and no other name, with the one name `git.ts` and
 * `commit.ts` share exported as `git.ts` declares it.
 *
 * The barrel spells its names, so a name added to one of the two files
 * and not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time but the shared name: both sides
 * are read off the modules, the runtime names off their namespaces and
 * the type names with the TypeScript checker, as
 * `packages/rafa/src/core/command/index.test.ts` reads its barrel.
 *
 * `SHARED` is the spelled list, and the second case holds it to exactly
 * the names both files export. Both export a type `GitRunner`, and they
 * are two types, so the barrel can export one of them only; its note
 * says which and why. A second name on both files fails that case
 * rather than being lost to the joined list of the last one.
 *
 * The last case reads where each barrel name is declared, since a list
 * of names cannot tell the `GitRunner` of `git.ts` from the one of
 * `commit.ts`. `CommitAttempt` is its control: a name the reading must
 * place in `commit.ts`, so a reading that placed every name in one file
 * fails.
 *
 * Four names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `GitResult`, a type of `git.ts`; `CommitAttempt`, a type of
 * `commit.ts`; `createGitRunner`, a function of `git.ts`; and
 * `commitTaskWork`, a function of `commit.ts`.
 *
 * Three mutations were driven against this file on 2026-10-12, one run
 * each, with the barrel restored and verified with `sha256sum -c`. The
 * barrel leaving out `gitSaid` reddened the first, third and fourth
 * cases. The barrel leaving out the type `CommitStep` reddened the
 * fourth case alone. The barrel exporting the `GitRunner` of `commit.ts`
 * in place of the one of `git.ts` reddened the fifth case alone.
 */
import { relative, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as commit from './commit.js';
import * as git from './git.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/git/index.ts';
const GIT = 'packages/rafa/src/core/git/git.ts';
const COMMIT = 'packages/rafa/src/core/git/commit.ts';
const GH = 'packages/rafa/src/core/git/gh-runner.ts';

/** The names both files export. The barrel exports each as `git.ts` declares it. */
const SHARED = ['GitRunner'];

/** Every path a case reads the exports of, in the order the cases first name them. */
const EXPORT_PATHS: readonly string[] = [GIT, COMMIT, BARREL, GH];

/**
 * Every export name of each file, types included, with the file that
 * declares it: a re-exported name is followed to its declaration. Runs
 * once, from the `beforeAll`, over {@link EXPORT_PATHS}, so no case pays
 * for the compile inside its own timeout.
 *
 * @param paths - Repository-relative paths of the modules to read.
 * @returns By path, each export name with the repository-relative path of its declaring file.
 * @throws When `tsconfig.json` does not parse, a path is no module or a name has no declaration.
 */
function readExports(paths: readonly string[]): Record<string, Record<string, string>> {
  const files = paths.map((path) => resolve(ROOT, path));
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve(ROOT, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error('tsconfig.json did not parse');
  const program = ts.createProgram(files, parsed.options);
  const checker = program.getTypeChecker();
  const exports: Record<string, Record<string, string>> = {};
  for (const [index, file] of files.entries()) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) throw new Error(`not in program: ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) throw new Error(`not a module: ${file}`);
    const declaredIn: Record<string, string> = {};
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const target = (symbol.flags & ts.SymbolFlags.Alias) === 0
        ? symbol
        : checker.getAliasedSymbol(symbol);
      const declaration = target.declarations?.[0];
      if (declaration === undefined) throw new Error(`no declaration: ${symbol.name} of ${file}`);
      declaredIn[symbol.name] = relative(ROOT, declaration.getSourceFile().fileName);
    }
    exports[paths[index] ?? file] = declaredIn;
  }
  return exports;
}

let storedExports: Record<string, Record<string, string>> | null = null;

/**
 * The exports by path, once `beforeAll` has read them.
 *
 * @returns By path, the declaring file of each export name of every file in {@link EXPORT_PATHS}.
 * @throws When the `beforeAll` never ran.
 */
function exportsByPath(): Record<string, Record<string, string>> {
  if (storedExports === null) throw new Error('the exports were never read');
  return storedExports;
}

/**
 * The names of one file's exports, sorted.
 *
 * @param declaredIn - One file's entry of {@link readExports}; nothing when the file was not read.
 * @returns Its export names.
 */
function namesOf(declaredIn: Readonly<Record<string, string>> | undefined): string[] {
  return Object.keys(declaredIn ?? {}).sort();
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

/** The runtime bindings of the two files; the second case holds that no runtime name is lost to the spread. */
const BEHIND: Readonly<Record<string, unknown>> = { ...git, ...commit };

describe('the git barrel', () => {
  beforeAll(() => {
    storedExports = readExports(EXPORT_PATHS);
  }, 30_000);

  it('exports the runtime names of the two files, each once, and no other', () => {
    const expected = [...Object.keys(git), ...Object.keys(commit)].sort();

    expect(Object.keys(git)).toContain('createGitRunner');
    expect(Object.keys(commit)).toContain('commitTaskWork');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('reads two files that share the spelled names and no other, none of them a runtime name', () => {
    const exports = exportsByPath();

    expect(namesOf(exports[GIT]).length).toBeGreaterThan(0);
    expect(namesOf(exports[COMMIT]).length).toBeGreaterThan(0);
    expect(onTwo([['a', 'b'], ['b', 'c'], ['c']])).toEqual(['b', 'c']);
    expect(onTwo([namesOf(exports[GIT]), namesOf(exports[COMMIT])])).toEqual(SHARED);
    expect(onTwo([Object.keys(git), Object.keys(commit)])).toEqual([]);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(BEHIND).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(BEHIND)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of the two files with the runtime ones, each once, and no other', () => {
    const exports = exportsByPath();
    const expected = [
      ...new Set([...namesOf(exports[GIT]), ...namesOf(exports[COMMIT]), ...namesOf(exports[GH])]),
    ].sort();

    expect(namesOf(exports[GIT])).toContain('GitResult');
    expect(namesOf(exports[COMMIT])).toContain('CommitAttempt');
    expect(namesOf(exports[GH])).toEqual(['GhResult', 'GhRunner']);
    expect(Object.keys(git)).not.toContain('GitResult');
    expect(Object.keys(commit)).not.toContain('CommitAttempt');
    expect(namesOf(exports[BARREL])).toEqual(expected);
  });

  it('exports each shared name as git.ts declares it, and every other name from its own file', () => {
    const exports = exportsByPath();
    const gitNames = namesOf(exports[GIT]);
    const ghNames = namesOf(exports[GH]);
    const expected = Object.fromEntries(
      namesOf(exports[BARREL]).map((name) => [
        name,
        gitNames.includes(name)
          ? GIT
          : ghNames.includes(name)
            ? GH
            : COMMIT,
      ]),
    );

    expect(expected['CommitAttempt']).toBe(COMMIT);
    expect(expected['GhRunner']).toBe(GH);
    for (const name of SHARED) {
      expect([name, expected[name]]).toEqual([name, GIT]);
    }
    expect(exports[BARREL]).toEqual(expected);
  });
});
