/**
 * Which tests a recorded step of the run runs: a task step's scope, from
 * the task line's `tests=` value and the task's diff, and a stage step's
 * test files, from the stage's diff, the plan's `Owns:` folders and
 * `tests.integration`.
 *
 * Nothing here spawns anything or reads git. The diff arrives as a list
 * of repo-relative paths, the form `git diff --name-only` answers with;
 * a caller reading it should pass `--no-renames`, so a moved file names
 * the folder it left as well as the one it reached. The two readers
 * that open files, {@link readPreloadFiles} and {@link listTestFiles},
 * are separate calls whose answers are handed in, so
 * {@link taskStepScope} and {@link stageStepScope} are pure. Paths are
 * compared after a leading `./` and a trailing `/` are taken off.
 *
 * ## A task step
 *
 * {@link taskStepScope} ranks, first match winning:
 *
 *  1. `full`, reason `declared`, when the line says `tests=full`.
 *  2. `full`, reason `trigger`, when the diff touches a full-suite
 *     trigger: a path a `tests.fullSuiteTriggers` glob matches, or one of
 *     the preload files `bunfig.toml`'s `[test] preload` names. Such a
 *     change reaches tests through no import, so Bun's `--changed`
 *     selection cannot see it. {@link TaskStepScope.triggeredBy} lists
 *     the paths that matched, on every answer.
 *  3. For `tests=module`, the test files of every module the diff
 *     touches, where a module is an `Owns:` folder, as the spec defines
 *     it. With no `Owns:` folder at all there is no module to narrow
 *     to, so the step falls back to `affected`, reason `fallback`: the
 *     tests the change reaches, not the whole project. When no touched
 *     folder holds a test file (the diff lies outside every folder, or
 *     its folders have none), the step falls back to `affected`, reason
 *     `no-module-tests`, so a `module` line never runs less than a
 *     default one.
 *  4. `affected` otherwise: the runner's `bun test --changed=<base>`.
 *
 * A glob is matched with `Bun.Glob`, which anchors it at the repository
 * root: on bun 1.4.2 `tsconfig*.json` matched `tsconfig.base.json` and
 * not `sub/tsconfig.json`, and `**` followed by a slash matched zero
 * folders, so the integration defaults match a file at the root too. A
 * preload file is compared as a path, never as a glob, so a name
 * holding `[` or `*` means itself.
 *
 * ## A stage step
 *
 * {@link stageStepScope} answers `affected`, reason `fallback`, when the
 * plan has no `Owns:` folder (no `issue:`, no epic, no line, or a failed
 * read: the reader answers null or an empty list for each): the runner
 * runs it as `bun test --changed=<since>`, from the stage's own diff
 * base, as a task step's `affected` run is. Otherwise it answers the
 * test files under each `Owns:` folder the diff touched, plus every test
 * file a `tests.integration` glob matches, each once, sorted.
 * A path is touched in the DEEPEST `Owns:` folder holding it, the rule
 * `owningBoard` (`board/board-owns.ts`) applies, reused here: with `src`
 * and `src/board` both named, a change under `src/board` runs that
 * folder's tests and not the rest of `src`. A folder holds itself and
 * what is under it, never a sibling sharing its prefix.
 *
 * A changed path no `Owns:` folder holds adds no test file: its task
 * step already ran what `--changed` selects from it. Nor does a stage
 * diff touching a full-suite trigger widen the stage: that task's own
 * step ran the full suite. The list may come out empty, and
 * `runSuite` (`./run.js`) refuses an empty list, so the caller runs
 * nothing for it.
 *
 * ## The two readers
 *
 * {@link readPreloadFiles} reads `bunfig.toml` at the root, parsed with
 * `Bun.TOML`. Only `[test] preload` is read: on bun 1.4.2 `bun test`
 * ran a `[test] preload` file and did NOT run a top-level `preload` one,
 * which `bun <file>` did run. The value may be one string or a list; an
 * entry is taken relative to the root, and one outside it is dropped,
 * since no diff path can name it. A missing file answers no preload; one
 * that does not parse answers none too, as `unreadable` with the reason,
 * never a throw.
 *
 * {@link listTestFiles} walks the root for the files `bun test` finds,
 * measured on bun 1.4.2: a name with `.test`, `_test`, `.spec` or
 * `_spec` before a `ts`, `tsx`, `js`, `jsx`, `mts`, `cts`, `mjs` or
 * `cjs` extension, outside `node_modules` and outside any folder whose
 * name opens with a dot. The walk does not follow symbolic links.
 */
import type { TestScope } from '../utils/declaration.js';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { normaliseFolder } from '../board/board-body.js';
import { owningBoard } from '../board/board-owns.js';

/** The file whose `[test] preload` names preload files, at the root. */
export const BUNFIG_FILE = 'bunfig.toml';

/** A file name `bun test` runs; see the module note. */
const TEST_FILE_NAME = /[._](?:test|spec)\.(?:tsx?|jsx?|[cm][jt]s)$/;

/** The folder the walk never enters, beside dot folders. */
const DEPENDENCY_FOLDER = 'node_modules';

/** Why a task step runs the full suite. */
export type FullSuiteReason = 'declared' | 'trigger';

/** Why a task step runs the affected files: the module note's rules 3 and 4. */
export type AffectedReason = 'declared' | 'fallback' | 'no-module-tests';

/** A task step's scope; the module note ranks the answers. */
export type TaskStepScope =
  | {
    readonly scope: 'full';
    readonly declared: TestScope;
    readonly reason: FullSuiteReason;
    /** The diff's paths matching a full-suite trigger. */
    readonly triggeredBy: readonly string[];
  }
  | {
    readonly scope: 'module';
    readonly declared: TestScope;
    /** The `Owns:` folders the diff touched. */
    readonly folders: readonly string[];
    /** The test files under them, sorted. */
    readonly paths: readonly string[];
    readonly triggeredBy: readonly string[];
  }
  | {
    readonly scope: 'affected';
    readonly declared: TestScope;
    readonly reason: AffectedReason;
    readonly triggeredBy: readonly string[];
  };

/** A stage step's scope; the module note says how its paths are chosen. */
export type StageStepScope =
  | { readonly scope: 'affected'; readonly reason: 'fallback' }
  | {
    readonly scope: 'paths';
    /** The `Owns:` folders the diff touched. */
    readonly folders: readonly string[];
    /** The test files a `tests.integration` glob matches, sorted. */
    readonly integration: readonly string[];
    /** Every test file to run, each once, sorted; may be empty. */
    readonly paths: readonly string[];
  };

/** The full-suite triggers: `tests.fullSuiteTriggers` and the preload files. */
export interface FullSuiteTriggers {
  /** Globs, as `tests.fullSuiteTriggers` holds them. */
  readonly globs: readonly string[];
  /** Repo-relative preload files, from {@link readPreloadFiles}. */
  readonly preload: readonly string[];
}

/** What a task step's scope is chosen from. */
export interface TaskScopeInput {
  /** The task line's `tests=` value, or its default. */
  readonly declared: TestScope;
  /** The task's changed paths, repo-relative. */
  readonly diff: readonly string[];
  readonly triggers: FullSuiteTriggers;
  /** The plan's `Owns:` folders; null or empty when it has none. */
  readonly owns: readonly string[] | null;
  /** The project's test files, from {@link listTestFiles}. */
  readonly testFiles: readonly string[];
}

/** What a stage step's paths are chosen from. */
export interface StageScopeInput {
  /** The stage's changed paths, repo-relative. */
  readonly diff: readonly string[];
  /** The plan's `Owns:` folders; null or empty when it has none. */
  readonly owns: readonly string[] | null;
  /** Globs, as `tests.integration` holds them. */
  readonly integration: readonly string[];
  /** The project's test files, from {@link listTestFiles}. */
  readonly testFiles: readonly string[];
}

/** How `bunfig.toml` read. */
export type PreloadReading =
  | { readonly state: 'read' | 'missing'; readonly files: readonly string[] }
  | { readonly state: 'unreadable'; readonly files: readonly string[]; readonly reason: string };

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
  const globs = integration.map((pattern) => new Bun.Glob(pattern));
  return sortedUnique(normalised(testFiles).filter((file) => globs.some((glob) => glob.match(file))));
}

/** The `Owns:` folders normalised, empty for null. */
function ownsFolders(owns: readonly string[] | null): readonly string[] {
  return owns === null
    ? []
    : normalised(owns);
}

/** A task step's scope. The module note ranks the answers. */
export function taskStepScope(input: TaskScopeInput): TaskStepScope {
  const { declared } = input;
  const triggeredBy = triggeredPaths(input.diff, input.triggers);
  if (declared === 'full') return { scope: 'full', declared, reason: 'declared', triggeredBy };
  if (triggeredBy.length > 0) return { scope: 'full', declared, reason: 'trigger', triggeredBy };
  if (declared === 'affected') return { scope: 'affected', declared, reason: 'declared', triggeredBy };
  const owns = ownsFolders(input.owns);
  if (owns.length === 0) return { scope: 'affected', declared, reason: 'fallback', triggeredBy };

  const folders = touchedFolders(input.diff, owns);
  const paths = testFilesUnder(folders, input.testFiles);
  return paths.length === 0
    ? { scope: 'affected', declared, reason: 'no-module-tests', triggeredBy }
    : { scope: 'module', declared, folders, paths, triggeredBy };
}

/** A stage step's scope. The module note says how its paths are chosen. */
export function stageStepScope(input: StageScopeInput): StageStepScope {
  const owns = ownsFolders(input.owns);
  if (owns.length === 0) return { scope: 'affected', reason: 'fallback' };
  const folders = touchedFolders(input.diff, owns);
  const integration = integrationFiles(input.integration, input.testFiles);
  const paths = sortedUnique([...testFilesUnder(folders, input.testFiles), ...integration]);
  return { scope: 'paths', folders, integration, paths };
}

/** `entry`, a preload entry, repo-relative, or null when it lies outside `root`. */
function preloadPath(root: string, entry: string): string | null {
  const path = isAbsolute(entry)
    ? relative(root, entry).split(sep)
      .join('/')
    : entry;
  const repoRelative = normaliseFolder(path);
  if (repoRelative === '' || isAbsolute(repoRelative)) return null;
  return repoRelative.split('/').includes('..')
    ? null
    : repoRelative;
}

/** A `preload` value's entries: one string, or the strings of a list. */
function preloadEntries(preload: unknown): readonly string[] {
  if (typeof preload === 'string') return [preload];
  if (!Array.isArray(preload)) return [];
  return preload.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The preload files `text`, a `bunfig.toml`, names under `[test]`,
 * repo-relative to `root`, in the order written. Throws what `Bun.TOML`
 * throws for text that does not parse.
 */
export function preloadFilesOf(text: string, root: string): readonly string[] {
  const parsed: unknown = Bun.TOML.parse(text);
  const testTable = (parsed as { readonly test?: unknown }).test;
  if (typeof testTable !== 'object' || testTable === null) return [];
  const preload = (testTable as { readonly preload?: unknown }).preload;
  const paths = preloadEntries(preload).map((entry) => preloadPath(root, entry));
  return paths.filter((path): path is string => path !== null);
}

/** The preload files `bunfig.toml` at `root` names. Never throws. */
export function readPreloadFiles(root: string): PreloadReading {
  const path = join(root, BUNFIG_FILE);
  if (!existsSync(path)) return { state: 'missing', files: [] };
  try {
    return { state: 'read', files: preloadFilesOf(readFileSync(path, 'utf8'), root) };
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    return { state: 'unreadable', files: [], reason };
  }
}

/** The files `bun test` finds under `root`, repo-relative and sorted. See the module note. */
export function listTestFiles(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = folder === ''
        ? entry.name
        : `${folder}/${entry.name}`;
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== DEPENDENCY_FOLDER) walk(path);
      else if (entry.isFile() && TEST_FILE_NAME.test(entry.name)) found.push(path);
    }
  };
  walk('');
  return sortedUnique(found);
}
