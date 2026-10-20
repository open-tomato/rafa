/**
 * The move-set half of the pass-moves codemod (`pass-moves.ts`): steps 1
 * and 2, reading which files move where from a move list and the files a
 * commit would hold. A listed file moves to its `to`; its colocated tests
 * and its folder's `testdata/` go with it; a moved test whose imports
 * reach a file outside the package and the move is parked instead. A
 * colocated test the project's `tests.integration` globs match is left in
 * place, until #913 places each integration test with the package entry it
 * drives. Every function here is pure over its input; the rewrites of each
 * moved and importing file are `pass-moves.ts`'s.
 */
import type { SiteNote } from './core-package-text';
import type { FileMove } from './moves/types';
import type { ResolveImport } from '../survey/import-graph';

import { posix } from 'node:path';

import { isCodeFile } from '../survey/core-barrels';
import { CORE_PARKED_TESTS, CORE_SOURCE } from '../survey/core-moves';
import { classifyFile } from '../survey/files';

import { CODE_EXTENSION, parseSource, specifierSites } from './core-package-text';

/** The folder a parked test's path is read below, with its closing `/`. */
export const SOURCE_ROOT = 'src/';

/** One file that changes path. */
export interface PathMove {
  readonly from: string;
  readonly to: string;
}

/** One parked test, with the files outside the package it reaches. */
export interface ParkedTest extends PathMove {
  /** The files outside the package and the move its imports reach, sorted. */
  readonly reaches: readonly string[];
}

/** The inputs of `planPassMoves` (`pass-moves.ts`). */
export interface PassMovesInput {
  /** Every committable file present on disk, repository-relative. */
  readonly files: readonly string[];
  /** The files git's index holds. */
  readonly tracked: ReadonlySet<string>;
  /** The text of each code file, `.md` file and the cluster map. */
  readonly sources: ReadonlyMap<string, string>;
  readonly resolve: ResolveImport;
  /** The move list. */
  readonly moves: readonly FileMove[];
  /**
   * The project's `tests.integration` patterns, matched against a
   * repository-relative path with `Bun.Glob` as `testKind` of
   * `scripts/survey/test-kinds.ts` matches them.
   */
  readonly integrationGlobs: readonly string[];
  /** Whether a path exists on disk; the committable files unless handed in. */
  readonly present?: (path: string) => boolean;
}

/**
 * Where a parked test lands: its path below `src/` under {@link CORE_PARKED_TESTS}.
 *
 * @param path - Its path before the move, under `src/`.
 * @returns Its parked path.
 */
export function parkedPath(path: string): string {
  return `${CORE_PARKED_TESTS}${path.slice(SOURCE_ROOT.length)}`;
}

/** Whether a resolved location is outside the repository. */
export function isOutsideRepository(landed: string): boolean {
  return landed.startsWith('/') || landed.includes('node_modules/') || /^[a-z]+:/.test(landed);
}

/** Orders two moves by their `from` path. */
export function byFrom(a: PathMove, b: PathMove): number {
  return a.from.localeCompare(b.from);
}

/** The refusals the list earns before any file is read. */
function listRefusals(input: PassMovesInput, present: (path: string) => boolean): SiteNote[] {
  const files = new Set(input.files);
  const refusals: SiteNote[] = [];
  const seen = new Set<string>();
  for (const move of input.moves) {
    const refuse = (text: string): void => {
      refusals.push({ file: move.from, line: 0, text });
    };
    if (!input.tracked.has(move.from)) refuse('is not tracked');
    else if (!files.has(move.from)) refuse('is not on disk');
    if (input.tracked.has(move.to) || present(move.to)) refuse(`moves to ${move.to}, which exists`);
    if (!move.to.startsWith(CORE_SOURCE)) refuse(`moves to ${move.to}, outside ${CORE_SOURCE}`);
    for (const path of [move.from, move.to]) {
      if (seen.has(path)) refuse(`lists ${path} twice`);
      seen.add(path);
    }
  }
  return refusals;
}

/** A test file's name with `.test` dropped, and its stem. */
function ownSource(test: string): { readonly own: string; readonly stem: string } {
  const own = posix.basename(test).replace(/\.test(\.[^.]+)$/, '$1');
  return { own, stem: own.replace(CODE_EXTENSION, '') };
}

/**
 * Step 1's colocated tests: each test file of a listed file's folder whose
 * stem is the listed file's, or opens with it and a `.` or `-` when it has
 * no source file of its own. The longest listed stem wins.
 *
 * @param files - The committable files.
 * @param moves - The listed moves.
 * @returns Each colocated test with its path after the move, sorted.
 */
function colocatedTests(files: readonly string[], moves: readonly FileMove[]): PathMove[] {
  const all = new Set(files);
  const listed = new Set(moves.map((move) => move.from));
  const result: PathMove[] = [];
  for (const file of files) {
    if (classifyFile(file) !== 'test' || listed.has(file)) continue;
    const folder = posix.dirname(file);
    const { own, stem } = ownSource(file);
    const hasOwn = all.has(posix.join(folder, own));
    const owners = moves.filter((move) => {
      if (posix.dirname(move.from) !== folder) return false;
      const listedStem = posix.basename(move.from).replace(CODE_EXTENSION, '');
      return stem === listedStem || (!hasOwn && (stem.startsWith(`${listedStem}.`) || stem.startsWith(`${listedStem}-`)));
    });
    const owner = owners.sort((a, b) => b.from.length - a.from.length)[0];
    if (owner !== undefined) result.push({ from: file, to: posix.join(posix.dirname(owner.to), posix.basename(file)) });
  }
  return result.sort(byFrom);
}

/**
 * Step 1's `testdata/` folders: the folder of each listed file whose source
 * files are all listed, moved beside the listed file.
 *
 * @param files - The committable files.
 * @param moves - The listed moves.
 * @returns The folders, each with its closing `/`, and their files.
 */
function testdataMoves(files: readonly string[], moves: readonly FileMove[]): { readonly folders: PathMove[]; readonly files: PathMove[] } {
  const listed = new Set(moves.map((move) => move.from));
  const folders: PathMove[] = [];
  const moved: PathMove[] = [];
  const byFolder = new Map<string, FileMove>();
  for (const move of [...moves].sort(byFrom)) {
    if (!byFolder.has(posix.dirname(move.from))) byFolder.set(posix.dirname(move.from), move);
  }
  for (const [folder, move] of byFolder) {
    const sources = files.filter((file) => posix.dirname(file) === folder && isCodeFile(file) && classifyFile(file) === 'source');
    const data = files.filter((file) => file.startsWith(`${folder}/testdata/`));
    if (data.length === 0 || sources.some((file) => !listed.has(file))) continue;
    const from = `${folder}/testdata/`;
    const to = `${posix.dirname(move.to)}/testdata/`;
    folders.push({ from, to });
    moved.push(...data.map((file) => ({ from: file, to: `${to}${file.slice(from.length)}` })));
  }
  return { files: moved.sort(byFrom), folders };
}

/**
 * Step 2: the files outside the package and the move a test's imports reach.
 *
 * @param input - The run's input.
 * @param inPackage - The path after the move of each file that moves into the package.
 * @param file - The test's path.
 * @returns The files, sorted.
 */
function reachesOf(input: PassMovesInput, inPackage: ReadonlyMap<string, string>, file: string): readonly string[] {
  const text = input.sources.get(file);
  if (text === undefined || !isCodeFile(file)) {
    return [];
  }
  const reached = new Set<string>();
  for (const site of specifierSites(parseSource(file, text))) {
    const landed = input.resolve(site.node.text, file);
    if (landed !== undefined && !isOutsideRepository(landed) && !inPackage.has(landed) && !landed.startsWith(CORE_SOURCE)) {
      reached.add(landed);
    }
  }
  return [...reached].sort();
}

/** Step 1's three lists and step 2's, with the path after the move of each. */
export interface MoveSet {
  readonly moves: readonly PathMove[];
  readonly colocated: readonly PathMove[];
  /** The colocated tests an integration glob matches, left in place, sorted. */
  readonly left: readonly string[];
  readonly testdata: readonly PathMove[];
  readonly folders: readonly PathMove[];
  readonly parked: readonly ParkedTest[];
  readonly finals: ReadonlyMap<string, string>;
  readonly refusals: readonly SiteNote[];
}

/** Whether one of the integration globs matches a repository-relative path. */
function isIntegrationTest(path: string, globs: readonly string[]): boolean {
  return globs.some((pattern) => new Bun.Glob(pattern).match(path));
}

/**
 * Reads steps 1 and 2 over the input, with the refusals of the list and
 * of the paths the moves land on. A colocated test an integration glob
 * matches is left: it is in neither `colocated` nor `finals`.
 *
 * @param input - The run's input.
 * @param present - Whether a path exists on disk.
 * @returns The move set.
 */
export function readMoveSet(input: PassMovesInput, present: (path: string) => boolean): MoveSet {
  const refusals = listRefusals(input, present);
  const moves = [...input.moves].map((move) => ({ from: move.from, to: move.to })).sort(byFrom);
  const found = colocatedTests(input.files, moves);
  const left = found.filter((test) => isIntegrationTest(test.from, input.integrationGlobs)).map((test) => test.from);
  const tests = found.filter((test) => !left.includes(test.from));
  const data = testdataMoves(input.files, moves);
  const inPackage = new Map([...moves, ...tests, ...data.files].map((move) => [move.from, move.to]));
  const parked: ParkedTest[] = [];
  for (const test of [...moves, ...tests].filter((move) => classifyFile(move.from) === 'test')) {
    const reaches = reachesOf(input, inPackage, test.from);
    if (reaches.length === 0) continue;
    if (!test.from.startsWith(SOURCE_ROOT)) {
      refusals.push({ file: test.from, line: 0, text: `reaches ${reaches.join(', ')}, and is not under ${SOURCE_ROOT} to park` });
      continue;
    }
    parked.push({ from: test.from, reaches, to: parkedPath(test.from) });
  }
  const parkedFrom = new Set(parked.map((test) => test.from));
  const colocated = tests.filter((test) => !parkedFrom.has(test.from));
  for (const move of [...colocated, ...data.files, ...parked]) {
    if (input.tracked.has(move.to) || present(move.to)) refusals.push({ file: move.from, line: 0, text: `moves to ${move.to}, which exists` });
  }
  const finals = new Map([...moves, ...colocated, ...data.files, ...parked].map((move) => [move.from, move.to]));
  return { colocated, finals, folders: data.folders, left, moves, parked, refusals, testdata: data.files };
}
