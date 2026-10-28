/**
 * Where core is, and the barrels of each of its subjects. Core is the
 * workspace package `packages/rafa/` (#1090): the files every part of
 * rafa depends on, which #905 gathered into `src/core/` before any
 * package was cut (epic #801), and which the move into the package put,
 * with `src/effort/store/`, `src/ports/` and four named files, at the
 * same paths under `packages/rafa/src/`.
 *
 * Beside `core/`, the package holds the effort store, the ports, and
 * the folders pass 1 of #808 moved in, the root files that reach no
 * feature (`scripts/codemod/moves/pass-1.ts`): the logger and events
 * adapters, `bugs/`, `commands/plan/plan-files.ts`, the
 * `config-schema-*.ts` section files, `modules/`, `next/hop-record.ts`,
 * `plan/`, `project/`, `runtime/live-loops.ts` and `utils/`. Each sits
 * at its old path below `src/`; outside `core/` no barrel rule applies,
 * so a file outside the package imports one by its own subpath.
 *
 * Where core is:
 *
 *   - {@link CORE_FOLDERS} and {@link CORE_NAMED_FILES}: the folders and
 *     the files outside them that are core, the one place a sweep, a
 *     survey script or a spawned loader reads them from
 *     ({@link isCoreFile}). Since the move they are `[CORE_SOURCE]` and
 *     `[]`;
 *   - {@link CORE_PACKAGE}, {@link CORE_SOURCE} and {@link CORE_FOLDER}:
 *     the package's folder, its source folder and the `core/` folder
 *     under it;
 *   - {@link CORE_PARKED_TESTS}: where a test of core that imports a file
 *     above core waits. A sweep reads such a test as it reads core's own
 *     files ({@link isCoreRead}).
 *
 * The barrels: {@link CORE_SUBJECTS} names the subject folders under
 * {@link CORE_FOLDER}, and {@link CORE_BARRELS} the barrel files of each,
 * the only files under {@link CORE_FOLDER} a file outside core may import
 * ({@link isCoreBarrel}).
 *
 * A task that splits a barrel adds the new barrel here in the same task.
 * A barrel is split, never widened, when it would close a runtime cycle.
 */

/** The folder of core's workspace package, with its closing `/`. */
export const CORE_PACKAGE = 'packages/rafa/';

/** The source folder of core's workspace package, with its closing `/`. */
export const CORE_SOURCE: string = `${CORE_PACKAGE}src/`;

/** The folder the files moved into, with its closing `/`. */
export const CORE_FOLDER: string = `${CORE_SOURCE}core/`;

/**
 * Where a test of core that imports a file above core waits once core is
 * its package, under its path below `src/`, with its closing `/`.
 */
export const CORE_PARKED_TESTS = 'src/tests/core-coupled/';

/**
 * The folders that are core, each with its closing `/`, sorted. Before
 * the move into the package they were `src/core/`, the effort store and
 * the ports; since it, the package's source folder alone.
 */
export const CORE_FOLDERS: readonly string[] = [CORE_SOURCE];

/**
 * The files outside {@link CORE_FOLDERS} that are core, sorted. The move
 * into the package emptied it: the four it named are under
 * {@link CORE_SOURCE} now.
 */
export const CORE_NAMED_FILES: readonly string[] = [];

/** The subject folders under {@link CORE_FOLDER}, sorted. */
export const CORE_SUBJECTS = ['adapters', 'command', 'config', 'git', 'loop', 'output', 'plan', 'runtime', 'services'] as const;

/** One subject folder under {@link CORE_FOLDER}. */
export type CoreSubject = (typeof CORE_SUBJECTS)[number];

/**
 * The barrel files of each subject, sorted. `config` has three. The
 * leaf pair `config-sections.ts` and `config-readers.ts` sits behind
 * `sections.ts`; it was split off while `config-merged.ts` imported
 * section files that import that pair back, when one barrel over all of
 * them would have closed a cycle through every section file. That file
 * is retired and nothing behind `index.ts` imports a section file, so
 * the split stands as the move left it. `index.ts` holds
 * `config-items.ts`, `config-schema.ts`, `core-section.ts`, `section.ts`
 * and `config.ts`. `config-load.ts` sits alone behind `load.ts`,
 * because it imports `src/effort/store/settings.ts`, which imports
 * `src/config-registry.ts`, which imports `index.ts` back, and
 * `sections.ts` directly.
 *
 * `command` has two. `index.ts` holds the command contract.
 * `parseArgs.ts`, moved from `src/cli/core/` so run reaches no root
 * file, is read through a subpath of its own, `core/command/parseArgs`,
 * rather than a line of `index.ts`. It is no split: it re-exports
 * nothing and imports `types.ts` alone, with `import type`.
 *
 * `plan` has two. The leaf `blocks.ts` sits alone behind
 * `block-reader.ts`, because `parse.ts` imports `packages/rafa/src/utils/tracker.ts`,
 * which imports `blocks.ts` back, and one barrel over both would close
 * a cycle through the tracker. `index.ts` holds `parse.ts` and
 * `plan-files.ts`.
 *
 * `runtime` has one, `index.ts`, over `identity.ts`, which imports no
 * file under `src/` and so reaches nothing that imports it back.
 *
 * `services` has one, `index.ts`, over `registry.ts` and `shapes.ts`,
 * which import types alone and so load no file that imports it back.
 *
 * `loop` has three. `session-readings.ts` sits alone behind
 * `readings.ts`, because it imports
 * `src/effort/store/task-finishes.ts`, from which
 * `src/effort/store/development-build.ts` is reached by value, and
 * that file imports `index.ts` back. `hop-record.ts` sits alone behind
 * `hops.ts`, because `packages/rafa/src/next/hop-record.ts` imports it by value and
 * was reached by value from `sessions.ts`, through
 * `src/loop/session-record-parse.ts`, when the split was made, so
 * `index.ts` over it would have closed a cycle; that parser has since
 * moved here as `session-record-parse.ts` and imports `hop-record.ts`
 * by path. `index.ts` holds `sessions.ts`, `claude.ts`,
 * `session-env.ts` and `suite-failure.ts`, which share it because none
 * reaches a file that imports it back; the parser's names reach it
 * through `sessions.ts`.
 */
export const CORE_BARRELS: Readonly<Record<CoreSubject, readonly string[]>> = {
  adapters: ['packages/rafa/src/core/adapters/index.ts'],
  command: ['packages/rafa/src/core/command/index.ts', 'packages/rafa/src/core/command/parseArgs.ts'],
  config: [
    'packages/rafa/src/core/config/index.ts',
    'packages/rafa/src/core/config/load.ts',
    'packages/rafa/src/core/config/sections.ts',
  ],
  git: ['packages/rafa/src/core/git/index.ts'],
  loop: [
    'packages/rafa/src/core/loop/hops.ts',
    'packages/rafa/src/core/loop/index.ts',
    'packages/rafa/src/core/loop/readings.ts',
  ],
  output: ['packages/rafa/src/core/output/index.ts'],
  plan: ['packages/rafa/src/core/plan/block-reader.ts', 'packages/rafa/src/core/plan/index.ts'],
  runtime: ['packages/rafa/src/core/runtime/index.ts'],
  services: ['packages/rafa/src/core/services/index.ts'],
};

/**
 * The last segment of a path: `src/pr/git.ts` gives `git.ts`.
 *
 * @param path - A path with `/` between segments.
 * @returns Its base name.
 */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The folder a subject's files move into, with its closing `/`:
 * `config` gives `packages/rafa/src/core/config/`.
 *
 * @param subject - The subject.
 * @returns Its folder under {@link CORE_FOLDER}.
 */
export function subjectFolder(subject: CoreSubject): string {
  return `${CORE_FOLDER}${subject}/`;
}

/**
 * Every barrel file, sorted.
 *
 * @param barrels - The barrels by subject; {@link CORE_BARRELS} unless a test plants its own.
 * @returns The barrel paths of all subjects.
 */
export function barrelPaths(
  barrels: Readonly<Partial<Record<CoreSubject, readonly string[]>>> = CORE_BARRELS,
): readonly string[] {
  return Object.values(barrels)
    .flat()
    .sort();
}

/**
 * Whether a path is one of the listed barrels.
 *
 * @param path - A repository-relative path.
 * @returns `true` when a file outside core may import it.
 */
export function isCoreBarrel(path: string): boolean {
  return barrelPaths().includes(path);
}

/**
 * Whether a path is a core file: under one of the core folders, or one of
 * the named files.
 *
 * @param path - A repository-relative path.
 * @param folders - The core folders; {@link CORE_FOLDERS} unless a test plants its own.
 * @param named - The named files; {@link CORE_NAMED_FILES} unless a test plants its own.
 * @returns `true` when the path is core's.
 */
export function isCoreFile(
  path: string,
  folders: readonly string[] = CORE_FOLDERS,
  named: readonly string[] = CORE_NAMED_FILES,
): boolean {
  return folders.some((folder) => path.startsWith(folder)) || named.includes(path);
}

/**
 * Whether a sweep reads a path as one of core's own files: a core file,
 * or a test parked under {@link CORE_PARKED_TESTS}.
 *
 * @param path - A repository-relative path.
 * @param folders - The core folders; {@link CORE_FOLDERS} unless a test plants its own.
 * @param named - The named files; {@link CORE_NAMED_FILES} unless a test plants its own.
 * @returns `true` when the path is core's or a parked test.
 */
export function isCoreRead(
  path: string,
  folders: readonly string[] = CORE_FOLDERS,
  named: readonly string[] = CORE_NAMED_FILES,
): boolean {
  return isCoreFile(path, folders, named) || path.startsWith(CORE_PARKED_TESTS);
}
