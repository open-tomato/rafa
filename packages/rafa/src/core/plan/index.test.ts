/**
 * Tests for the `index.ts` barrel: it exports every name `parse.ts`,
 * `plan-files.ts`, `plan-stamp.ts`, `declaration.ts`,
 * `blocker-comment.ts` and `tracker-path.ts` export, each once, as the
 * same binding, no other name, and no name the other plan barrel holds.
 *
 * The barrel spells its names, so a name added to one of the six files
 * and not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `packages/rafa/src/core/git/index.test.ts` reads its
 * barrel.
 *
 * The second case holds that the six files share no name, type or
 * runtime. The first and fourth cases join the six lists, and a name on
 * both files would be one the barrel can export from one of them only:
 * it fails there rather than being lost to the join.
 *
 * Four names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `PlanModel`, a type of `parse.ts`; `TaskCounts`, a type of
 * `plan-files.ts`; `parsePlan`, a function of `parse.ts`; and `plural`,
 * a function of `plan-files.ts`.
 *
 * The last case holds the two plan barrels apart. `RafaBlock` on
 * `block-reader.ts` is its control: a reading of that barrel that came
 * back empty would find no name in common and pass.
 *
 * Four mutations were driven against this file on 2026-10-12, one run
 * each, with the barrel restored and verified with `sha256sum -c`. The
 * barrel leaving out `plural` reddened the first, third and fourth
 * cases. The barrel leaving out the type `TaskCounts` reddened the
 * fourth case alone. The barrel exporting `readRafaBlocks` as well
 * reddened the first, fourth and fifth cases. The barrel exporting
 * `parsePlan` as a wrapper reddened the third case alone. None reddened
 * the second case, whose control is the planted lists it reads first.
 */
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as blockerComment from './blocker-comment.js';
import * as declaration from './declaration.js';
import * as parse from './parse.js';
import * as planFiles from './plan-files.js';
import * as planStamp from './plan-stamp.js';
import * as trackerPath from './tracker-path.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/plan/index.ts';
const BLOCK_BARREL = 'packages/rafa/src/core/plan/block-reader.ts';
const BLOCKER_COMMENT = 'packages/rafa/src/core/plan/blocker-comment.ts';
const DECLARATION = 'packages/rafa/src/core/plan/declaration.ts';
const PARSE = 'packages/rafa/src/core/plan/parse.ts';
const PLAN_FILES = 'packages/rafa/src/core/plan/plan-files.ts';
const PLAN_STAMP = 'packages/rafa/src/core/plan/plan-stamp.ts';
const TRACKER_PATH = 'packages/rafa/src/core/plan/tracker-path.ts';

/** Every path a case reads the export names of, in the order the cases first name them. */
const EXPORT_PATHS: readonly string[] = [PARSE, PLAN_FILES, PLAN_STAMP, DECLARATION, BLOCKER_COMMENT, TRACKER_PATH, BARREL, BLOCK_BARREL];

/**
 * Every export name of each file, types included, sorted. Runs once,
 * from the `beforeAll`, over {@link EXPORT_PATHS}, so no case pays for
 * the compile inside its own timeout.
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

let exportNames: Record<string, string[]> | null = null;

/**
 * The export names by path, once `beforeAll` has read them.
 *
 * @returns The names by path of every file in {@link EXPORT_PATHS}.
 * @throws When the `beforeAll` never ran.
 */
function storedExportNames(): Record<string, string[]> {
  if (exportNames === null) throw new Error('the export names were never read');
  return exportNames;
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

/** The runtime bindings of the six files; the second case holds that no name is lost to the spread. */
const BEHIND: Readonly<Record<string, unknown>> = {
  ...parse,
  ...planFiles,
  ...planStamp,
  ...declaration,
  ...blockerComment,
  ...trackerPath,
};

describe('the plan barrel', () => {
  beforeAll(() => {
    exportNames = readExportNames(EXPORT_PATHS);
  }, 30_000);

  it('exports the runtime names of the six files, each once, and no other', () => {
    const expected = [
      ...Object.keys(parse),
      ...Object.keys(planFiles),
      ...Object.keys(planStamp),
      ...Object.keys(declaration),
      ...Object.keys(blockerComment),
      ...Object.keys(trackerPath),
    ].sort();

    expect(Object.keys(parse)).toContain('parsePlan');
    expect(Object.keys(planFiles)).toContain('plural');
    expect(Object.keys(planStamp)).toContain('stampPrompt');
    expect(Object.keys(declaration)).toContain('parseTaskDeclaration');
    expect(Object.keys(blockerComment)).toContain('splitBlockerComment');
    expect(Object.keys(trackerPath)).toContain('trackerPathFor');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('reads six files that share no name, type or runtime', () => {
    const names = storedExportNames();

    expect(names[PARSE]?.length).toBeGreaterThan(0);
    expect(names[PLAN_FILES]?.length).toBeGreaterThan(0);
    expect(names[PLAN_STAMP]?.length).toBeGreaterThan(0);
    expect(names[DECLARATION]?.length).toBeGreaterThan(0);
    expect(names[BLOCKER_COMMENT]?.length).toBeGreaterThan(0);
    expect(names[TRACKER_PATH]?.length).toBeGreaterThan(0);
    expect(onTwo([['a', 'b'], ['b', 'c'], ['c']])).toEqual(['b', 'c']);
    expect(onTwo([
      names[PARSE] ?? [],
      names[PLAN_FILES] ?? [],
      names[PLAN_STAMP] ?? [],
      names[DECLARATION] ?? [],
      names[BLOCKER_COMMENT] ?? [],
      names[TRACKER_PATH] ?? [],
    ])).toEqual([]);
    expect(onTwo([
      Object.keys(parse),
      Object.keys(planFiles),
      Object.keys(planStamp),
      Object.keys(declaration),
      Object.keys(blockerComment),
      Object.keys(trackerPath),
    ])).toEqual([]);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(BEHIND).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(BEHIND)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of the six files with the runtime ones, each once, and no other', () => {
    const names = storedExportNames();
    const expected = [
      ...(names[PARSE] ?? []),
      ...(names[PLAN_FILES] ?? []),
      ...(names[PLAN_STAMP] ?? []),
      ...(names[DECLARATION] ?? []),
      ...(names[BLOCKER_COMMENT] ?? []),
      ...(names[TRACKER_PATH] ?? []),
    ].sort();

    expect(names[PARSE]).toContain('PlanModel');
    expect(names[PLAN_FILES]).toContain('TaskCounts');
    expect(names[DECLARATION]).toContain('TaskDeclaration');
    expect(names[BLOCKER_COMMENT]).toContain('BlockerSplit');
    expect(Object.keys(blockerComment)).not.toContain('BlockerSplit');
    expect(Object.keys(parse)).not.toContain('PlanModel');
    expect(Object.keys(planFiles)).not.toContain('TaskCounts');
    expect(names[BARREL]).toEqual(expected);
  });

  it('holds no name the other plan barrel holds, type or runtime', () => {
    const names = storedExportNames();

    expect(names[BARREL]?.length).toBeGreaterThan(0);
    expect(names[BLOCK_BARREL]).toContain('RafaBlock');
    expect(onTwo([names[BARREL] ?? [], names[BLOCK_BARREL] ?? []])).toEqual([]);
  });
});
