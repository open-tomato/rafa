/**
 * Which tests one check point runs: {@link resolveChecks} turns a
 * check-point entry (`checks.task`, `checks.stage`, `checks.loop`), a list
 * of the six names `config-schema-checks.ts` closes, into one
 * {@link CheckRun}, from the diff, the plan's `Owns:` folders, the
 * project's test files, the preload files and the three glob lists
 * (`tests.fullSuiteTriggers`, `tests.contract`, `tests.integration`).
 *
 * Nothing here spawns anything or reads git or a file: every input
 * arrives as a value, so the resolver is pure. The diff arrives as a list
 * of repo-relative paths, the form `git diff --name-only` answers with; a
 * caller reading it should pass `--no-renames`, so a moved file names the
 * folder it left as well as the one it reached. The test files and the
 * preload files come from `listTestFiles` and `readPreloadFiles`
 * (`./scope.js`). Paths are compared after a leading `./` and a trailing
 * `/` are taken off.
 *
 * ## The six names
 *
 *  - `affected`: the runner's `bun test --changed=<base>`, widened to the
 *    full suite when the diff touches a full-suite trigger (below).
 *  - `related`: the test files under each `Owns:` folder the diff touched.
 *    With no `Owns:` folder at all there is no module to narrow to, and
 *    it runs as `affected` instead, reason `fallback`; a trigger never
 *    widens that fallback.
 *  - `unit`: every test file no `tests.contract` and no
 *    `tests.integration` glob matches.
 *  - `contract`: every test file a `tests.contract` glob matches.
 *  - `integration`: every test file a `tests.integration` glob matches.
 *  - `full`: the whole project, one `bun test` with no path.
 *
 * ## How one entry folds into one run
 *
 * First match winning:
 *
 *  1. An empty entry is `none`, reason `no-check`, whatever the task
 *     line's `tests=` value says: nothing runs.
 *  2. `full`, reason `declared`, when the entry names `full` or the task
 *     line says `tests=full`: it swallows every other name.
 *  3. `full`, reason `trigger`, when the entry names `affected` and the
 *     diff touches a full-suite trigger: a path a
 *     `tests.fullSuiteTriggers` glob matches, or one of the preload files
 *     `bunfig.toml`'s `[test] preload` names. Such a change reaches tests
 *     through no import, so Bun's `--changed` selection cannot see it.
 *     {@link CheckRun}'s `triggeredBy` lists the paths that matched.
 *  4. `affected` when no path list is in play: `affected` alone, reason
 *     `declared`, or `related` falling back, reason `fallback`.
 *  5. `paths` otherwise: the files of every `related`, `unit`,
 *     `contract` and `integration` in the entry, each once, sorted,
 *     with `affectedToo` true when an `affected` (or a `related` falling
 *     back to it) stood beside them, which the caller reads: the task
 *     step joins the `tests.alwaysRun` files to the list for it
 *     (`start/suite-task-step.ts`). The list may come out empty, and
 *     `runSuite` (`./run.js`) refuses an empty list, so the caller runs
 *     nothing for it.
 *
 * A task line's `tests=module` reads the entry's `affected` as
 * `related`, and keeps what `affected` promised on both sides: a trigger
 * still widens it to `full` (rule 3), and when no touched folder holds a
 * test file it runs as `affected` again, reason `no-module-tests`, so a
 * `module` line never runs less than the entry without it. `tests=affected`
 * reads the entry as written, as does no value: a stage or loop step
 * hands in none, and so does a task line declaring none.
 *
 * A path is touched in the DEEPEST `Owns:` folder holding it, the rule
 * `owningBoard` (`board/board-owns.ts`) applies, reused here: with `src`
 * and `src/board` both named, a change under `src/board` runs that
 * folder's tests and not the rest of `src`. A folder holds itself and
 * what is under it, never a sibling sharing its prefix. A changed path
 * no `Owns:` folder holds adds no test file to `related`.
 *
 * A glob is matched with `Bun.Glob`, which anchors it at the repository
 * root: on bun 1.4.2 `tsconfig*.json` matched `tsconfig.base.json` and not
 * `sub/tsconfig.json`, and `**` followed by a slash matched zero folders,
 * so the integration spellings match a file at the root too. A preload
 * file is compared as a path, never as a glob, so a name holding `[` or
 * `*` means itself.
 */
import type { CheckName } from '@open-tomato/rafa/config-schema-checks';
import type { TestScope } from '@open-tomato/rafa/core/plan';

import { normaliseFolder, owningBoard } from '@open-tomato/rafa-board';

/** Why a check point runs the full suite: the entry or the line named `full`, or a trigger widened `affected`. */
export type FullCheckReason = 'declared' | 'trigger';

/** Why a check point runs `bun test --changed`: the module note's rules 4 and the `tests=module` floor. */
export type AffectedCheckReason = 'declared' | 'fallback' | 'no-module-tests';

/** What one check-point entry runs; the module note ranks the answers. */
export type CheckRun =
  | { readonly kind: 'none'; readonly reason: 'no-check' }
  | {
    readonly kind: 'full';
    readonly reason: FullCheckReason;
    /** The diff's paths matching a full-suite trigger, on either reason. */
    readonly triggeredBy: readonly string[];
  }
  | { readonly kind: 'affected'; readonly reason: AffectedCheckReason }
  | {
    readonly kind: 'paths';
    /** Every test file to run, each once, sorted; may be empty. */
    readonly paths: readonly string[];
    /** True when an `affected` run stands beside the paths. */
    readonly affectedToo: boolean;
  };

/** The full-suite triggers: `tests.fullSuiteTriggers` and the preload files. */
export interface FullSuiteTriggers {
  /** Globs, as `tests.fullSuiteTriggers` holds them. */
  readonly globs: readonly string[];
  /** Repo-relative preload files, from `readPreloadFiles` (`./scope.js`). */
  readonly preload: readonly string[];
}

/** What {@link resolveChecks} turns into one run. */
export interface CheckInput {
  /** The check-point entry's names. */
  readonly names: readonly CheckName[];
  /** The task line's `tests=` value, or null for a stage or loop step or a line declaring none. */
  readonly declared: TestScope | null;
  /** The changed paths, repo-relative. */
  readonly diff: readonly string[];
  /** The plan's `Owns:` folders; null or empty when it has none. */
  readonly owns: readonly string[] | null;
  /** The project's test files, from `listTestFiles` (`./scope.js`). */
  readonly testFiles: readonly string[];
  /** Repo-relative preload files, from `readPreloadFiles` (`./scope.js`). */
  readonly preload: readonly string[];
  /** Globs, as `tests.fullSuiteTriggers` holds them. */
  readonly fullSuiteTriggers: readonly string[];
  /** Globs, as `tests.contract` holds them. */
  readonly contract: readonly string[];
  /** Globs, as `tests.integration` holds them. */
  readonly integration: readonly string[];
}

/** The answer for an empty entry. */
const NO_CHECK: CheckRun = Object.freeze({ kind: 'none', reason: 'no-check' });

/** How the entry's `related` reads: not named, its files, or `affected` in its place for the reason given. */
type RelatedReading =
  | { readonly state: 'off' }
  | { readonly state: 'paths'; readonly paths: readonly string[] }
  | { readonly state: 'affected'; readonly reason: 'fallback' | 'no-module-tests' };

/** `paths`, each once, sorted, as a new list. */
function sortedUnique(paths: Iterable<string>): readonly string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

/** `paths` normalised, with any left empty dropped. */
function normalised(paths: readonly string[]): readonly string[] {
  return paths.map(normaliseFolder).filter((path) => path !== '');
}

/** True when `folder` is `path` or a folder above it. */
function holds(folder: string, path: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** The test files any of `patterns` matches, sorted. */
function globbedFiles(patterns: readonly string[], testFiles: readonly string[]): readonly string[] {
  const globs = patterns.map((pattern) => new Bun.Glob(pattern));
  return sortedUnique(normalised(testFiles).filter((file) => globs.some((glob) => glob.match(file))));
}

/** The diff's paths a trigger glob matches or a preload file equals, sorted. */
export function triggeredPaths(diff: readonly string[], triggers: FullSuiteTriggers): readonly string[] {
  const globs = triggers.globs.map((pattern) => new Bun.Glob(pattern));
  const preload = new Set(normalised(triggers.preload));
  const matches = (path: string): boolean => preload.has(path) || globs.some((glob) => glob.match(path));
  return sortedUnique(normalised(diff).filter(matches));
}

/**
 * The `Owns:` folders `diff` touched, each path counted in the deepest
 * folder holding it, sorted. See the module note.
 */
export function touchedFolders(diff: readonly string[], owns: readonly string[]): readonly string[] {
  const board = { number: 0, owner: null, owns: normalised(owns) };
  const touched = normalised(diff).map((path) => owningBoard(path, [board], null)?.match ?? null);
  return sortedUnique(touched.filter((folder): folder is string => folder !== null));
}

/** The test files under any of `folders`, sorted. */
function testFilesUnder(folders: readonly string[], testFiles: readonly string[]): readonly string[] {
  return sortedUnique(normalised(testFiles).filter((file) => folders.some((folder) => holds(folder, file))));
}

/** The test files a `tests.integration` glob matches, sorted. */
export function integrationFiles(integration: readonly string[], testFiles: readonly string[]): readonly string[] {
  return globbedFiles(integration, testFiles);
}

/** The test files a `tests.contract` glob matches, sorted. */
export function contractFiles(contract: readonly string[], testFiles: readonly string[]): readonly string[] {
  return globbedFiles(contract, testFiles);
}

/** The test files no `tests.contract` and no `tests.integration` glob matches, sorted. */
export function unitFiles(contract: readonly string[], integration: readonly string[], testFiles: readonly string[]): readonly string[] {
  const named = new Set([...contractFiles(contract, testFiles), ...integrationFiles(integration, testFiles)]);
  return sortedUnique(normalised(testFiles).filter((file) => !named.has(file)));
}

/** How `related` reads for `input`; `moduleRead` when it stands for the entry's `affected` under `tests=module`. */
function readRelated(input: CheckInput, named: boolean, moduleRead: boolean): RelatedReading {
  if (!named) return { state: 'off' };
  const owns = input.owns === null
    ? []
    : normalised(input.owns);
  if (owns.length === 0) return { state: 'affected', reason: 'fallback' };
  const paths = testFilesUnder(touchedFolders(input.diff, owns), input.testFiles);
  return paths.length === 0 && moduleRead
    ? { state: 'affected', reason: 'no-module-tests' }
    : { state: 'paths', paths };
}

/** The path lists `names` asks for beside `related`'s own. */
function namedLists(input: CheckInput, names: ReadonlySet<CheckName>): readonly (readonly string[])[] {
  const lists: (readonly string[])[] = [];
  if (names.has('unit')) lists.push(unitFiles(input.contract, input.integration, input.testFiles));
  if (names.has('contract')) lists.push(contractFiles(input.contract, input.testFiles));
  if (names.has('integration')) lists.push(integrationFiles(input.integration, input.testFiles));
  return lists;
}

/** What one check-point entry runs. The module note ranks the answers. */
export function resolveChecks(input: CheckInput): CheckRun {
  const names: ReadonlySet<CheckName> = new Set(input.names);
  if (names.size === 0) return NO_CHECK;
  const triggeredBy = triggeredPaths(input.diff, { globs: input.fullSuiteTriggers, preload: input.preload });
  if (input.declared === 'full' || names.has('full')) return { kind: 'full', reason: 'declared', triggeredBy };
  if (names.has('affected') && triggeredBy.length > 0) return { kind: 'full', reason: 'trigger', triggeredBy };

  const moduleRead = input.declared === 'module' && names.has('affected');
  const explicitAffected = names.has('affected') && !moduleRead;
  const related = readRelated(input, names.has('related') || moduleRead, moduleRead);
  const lists = [
    ...(related.state === 'paths'
      ? [related.paths]
      : []),
    ...namedLists(input, names),
  ];
  if (lists.length === 0) {
    const reason = related.state === 'affected' && !explicitAffected
      ? related.reason
      : 'declared';
    return { kind: 'affected', reason };
  }
  const affectedToo = explicitAffected || related.state === 'affected';
  return { kind: 'paths', paths: sortedUnique(lists.flat()), affectedToo };
}
