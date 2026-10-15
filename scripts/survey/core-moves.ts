/**
 * Where core is, and the data behind the move of #905, which put the
 * files every part of rafa depends on into `src/core/` before any
 * package was cut (epic #801). Core now lives in its workspace package,
 * `packages/rafa/` (#1090): `src/core/`, `src/effort/store/`,
 * `src/ports/` and the four named files moved to the same paths under
 * `packages/rafa/src/`, so `src/core/<p>` is `packages/rafa/src/core/<p>`.
 *
 * Two things are spelled here: where core is, and the files that moved
 * into its `core/` folder. Where core is:
 *
 *   - {@link CORE_FOLDERS} and {@link CORE_NAMED_FILES}: the folders and
 *     the files outside them that are core, the one place a sweep, a
 *     survey script or a spawned loader reads them from
 *     ({@link isCoreFile}). Since the move they are `[CORE_SOURCE]` and
 *     `[]`;
 *   - {@link CORE_PACKAGE} and {@link CORE_SOURCE}: the package's folder
 *     and its source folder;
 *   - {@link CORE_PARKED_TESTS}: where a test of core that imports a file
 *     above core waits. A sweep reads such a test as it reads core's own
 *     files ({@link isCoreRead}).
 *
 * The move into `core/` lists four things:
 *
 *   - {@link CORE_MOVES}: the twenty-nine files that changed path, each
 *     with its path under {@link CORE_FOLDER} and its subject folder. A
 *     file keeps its base name;
 *   - with each file, its colocated test files by their path before #905.
 *     A test file moved with its file into the same folder and kept its
 *     base name too ({@link testTarget});
 *   - {@link CORE_BARRELS}: the barrel files of each subject, the only
 *     files under {@link CORE_FOLDER} a file outside core may import;
 *   - {@link CORE_REEXPORTS}: the old paths that still hold a re-export
 *     of their moved file, none since the move into the package.
 *
 * A colocated test file is a test file in the moving file's folder whose
 * name opens with the file's stem and that has no source file of its own:
 * `src/loop/sessions-hop.test.ts` is one of `src/loop/sessions.ts`, while
 * `src/config-schema-hub.test.ts` belongs to `src/config-schema-hub.ts`,
 * which stays. `src/config-schema-board.test.ts` has no source file of its
 * own and reads `config-schema.ts` and `config.ts`; it is listed with
 * `src/config-schema.ts`, the file it is named after. A test under
 * `src/tests/` is not colocated and does not move.
 *
 * A task that splits a barrel adds the new barrel here in the same task.
 * A barrel is split, never widened, when it would close a runtime cycle.
 *
 * {@link findCollisions} is the check the unit tests hold the lists to:
 * no two targets are one path, and no target is a path something else
 * moves away from.
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
export const CORE_SUBJECTS = ['adapters', 'command', 'config', 'git', 'loop', 'output', 'plan', 'runtime'] as const;

/** One subject folder under {@link CORE_FOLDER}. */
export type CoreSubject = (typeof CORE_SUBJECTS)[number];

/** One file that changed path into {@link CORE_FOLDER}. */
export interface CoreMove {
  /** The file's path today, repository-relative. */
  readonly from: string;
  /** The subject folder it moves into. */
  readonly subject: CoreSubject;
  /** Its colocated test files by their path today, sorted; empty when it has none. */
  readonly tests: readonly string[];
  /** Its path under {@link CORE_FOLDER}, repository-relative. */
  readonly to: string;
}

/** One path that changes: a moving file or one of its test files. */
export interface MovedPath {
  /** The path today. */
  readonly from: string;
  /** The path under {@link CORE_FOLDER}. */
  readonly to: string;
}

/** Two listed paths that cannot both hold. */
export interface Collision {
  /** The path claimed twice, repository-relative. */
  readonly path: string;
  /** What claims it, one phrase per claim, sorted. */
  readonly claims: readonly string[];
}

/**
 * The twenty-nine files that move, sorted by their path today: the
 * nineteen of #905, `src/runtime/identity.ts`, which #1088 moved so the
 * effort store imports nothing above core for it, the `text` output
 * adapter with the `OutputStream` it writes to, which #1089 moved so
 * `src/core/output/active.ts` and `src/core/adapters/registry.ts` import
 * nothing above core for them, and the command contracts of
 * `src/cli/core/types.ts` and the `spends` declaration of
 * `src/cli/spends.ts`, which #1089 moved so `src/core/command/command.ts`
 * imports nothing above core for them, and the running command record
 * of `src/cli/running.ts`, which #1089 moved so
 * `src/core/loop/claude.ts` imports nothing above core for it, and the
 * plan stamp and the task declaration parser of `src/utils/`, which
 * #1089 moved so `src/core/plan/` imports nothing above core for them,
 * and the session environment of `src/utils/session-env.ts`, which #1089
 * moved so `src/core/loop/claude.ts` imports nothing above core for it,
 * and the session record parser of `src/loop/session-record-parse.ts`,
 * which #1089 moved so `src/core/loop/sessions.ts` imports nothing above
 * core for it.
 */
export const CORE_MOVES: readonly CoreMove[] = [
  {
    from: 'src/adapters/output/active.ts',
    subject: 'output',
    tests: ['src/adapters/output/active.test.ts'],
    to: 'packages/rafa/src/core/output/active.ts',
  },
  {
    from: 'src/adapters/output/stream.ts',
    subject: 'output',
    tests: [],
    to: 'packages/rafa/src/core/output/stream.ts',
  },
  {
    from: 'src/adapters/output/text.ts',
    subject: 'output',
    tests: ['src/adapters/output/text.test.ts'],
    to: 'packages/rafa/src/core/output/text.ts',
  },
  {
    from: 'src/adapters/registry.ts',
    subject: 'adapters',
    tests: ['src/adapters/registry.test.ts'],
    to: 'packages/rafa/src/core/adapters/registry.ts',
  },
  {
    from: 'src/cli/command.ts',
    subject: 'command',
    tests: ['src/cli/command.test.ts'],
    to: 'packages/rafa/src/core/command/command.ts',
  },
  {
    from: 'src/cli/core/types.ts',
    subject: 'command',
    tests: ['src/cli/core/types.test.ts'],
    to: 'packages/rafa/src/core/command/types.ts',
  },
  {
    from: 'src/cli/prompt/confirm.ts',
    subject: 'command',
    tests: ['src/cli/prompt/confirm.test.ts'],
    to: 'packages/rafa/src/core/command/confirm.ts',
  },
  {
    from: 'src/cli/running.ts',
    subject: 'command',
    tests: ['src/cli/running.test.ts'],
    to: 'packages/rafa/src/core/command/running.ts',
  },
  {
    from: 'src/cli/spends.ts',
    subject: 'command',
    tests: ['src/cli/spends.test.ts'],
    to: 'packages/rafa/src/core/command/spends.ts',
  },
  {
    from: 'src/cli/version.ts',
    subject: 'command',
    tests: ['src/cli/version.test.ts'],
    to: 'packages/rafa/src/core/command/version.ts',
  },
  {
    from: 'src/config-items.ts',
    subject: 'config',
    tests: ['src/config-items.test.ts'],
    to: 'packages/rafa/src/core/config/config-items.ts',
  },
  {
    from: 'src/config-load.ts',
    subject: 'config',
    tests: ['src/config-load.test.ts'],
    to: 'packages/rafa/src/core/config/config-load.ts',
  },
  {
    from: 'src/config-readers.ts',
    subject: 'config',
    tests: ['src/config-readers.test.ts'],
    to: 'packages/rafa/src/core/config/config-readers.ts',
  },
  {
    from: 'src/config-schema.ts',
    subject: 'config',
    tests: ['src/config-schema-board.test.ts'],
    to: 'packages/rafa/src/core/config/config-schema.ts',
  },
  {
    from: 'src/config-sections.ts',
    subject: 'config',
    tests: ['src/config-sections.test.ts'],
    to: 'packages/rafa/src/core/config/config-sections.ts',
  },
  {
    from: 'src/config.ts',
    subject: 'config',
    tests: ['src/config.test.ts'],
    to: 'packages/rafa/src/core/config/config.ts',
  },
  {
    from: 'src/loop/session-readings.ts',
    subject: 'loop',
    tests: [],
    to: 'packages/rafa/src/core/loop/session-readings.ts',
  },
  {
    from: 'src/loop/session-record-parse.ts',
    subject: 'loop',
    tests: ['src/loop/session-record-parse.test.ts'],
    to: 'packages/rafa/src/core/loop/session-record-parse.ts',
  },
  {
    from: 'src/loop/sessions.ts',
    subject: 'loop',
    tests: [
      'src/loop/sessions-decisions.test.ts',
      'src/loop/sessions-hop.test.ts',
      'src/loop/sessions-phase.test.ts',
      'src/loop/sessions-steps.test.ts',
      'src/loop/sessions-worktree.test.ts',
      'src/loop/sessions.test.ts',
    ],
    to: 'packages/rafa/src/core/loop/sessions.ts',
  },
  {
    from: 'src/plan/blocks.ts',
    subject: 'plan',
    tests: ['src/plan/blocks.test.ts'],
    to: 'packages/rafa/src/core/plan/blocks.ts',
  },
  {
    from: 'src/plan/parse.ts',
    subject: 'plan',
    tests: ['src/plan/parse.test.ts'],
    to: 'packages/rafa/src/core/plan/parse.ts',
  },
  {
    from: 'src/plan/plan-files.ts',
    subject: 'plan',
    tests: [],
    to: 'packages/rafa/src/core/plan/plan-files.ts',
  },
  {
    from: 'src/pr/git.ts',
    subject: 'git',
    tests: ['src/pr/git.test.ts'],
    to: 'packages/rafa/src/core/git/git.ts',
  },
  {
    from: 'src/runtime/identity.ts',
    subject: 'runtime',
    tests: ['src/runtime/identity.test.ts'],
    to: 'packages/rafa/src/core/runtime/identity.ts',
  },
  {
    from: 'src/utils/claude.ts',
    subject: 'loop',
    tests: ['src/utils/claude.test.ts'],
    to: 'packages/rafa/src/core/loop/claude.ts',
  },
  {
    from: 'src/utils/commit.ts',
    subject: 'git',
    tests: ['src/utils/commit.test.ts'],
    to: 'packages/rafa/src/core/git/commit.ts',
  },
  {
    from: 'src/utils/declaration.ts',
    subject: 'plan',
    tests: ['src/utils/declaration.test.ts'],
    to: 'packages/rafa/src/core/plan/declaration.ts',
  },
  {
    from: 'src/utils/plan-stamp.ts',
    subject: 'plan',
    tests: [],
    to: 'packages/rafa/src/core/plan/plan-stamp.ts',
  },
  {
    from: 'src/utils/session-env.ts',
    subject: 'loop',
    tests: ['src/utils/session-env.test.ts'],
    to: 'packages/rafa/src/core/loop/session-env.ts',
  },
];

/**
 * The old paths of moved files that still hold a file: a re-export of
 * the moved file's names, kept while a non-test file outside core
 * imports the old path, sorted. Each is the `from` of a move in
 * {@link CORE_MOVES}. Core's move into its package (#1090) deleted them
 * and pointed their importers at core's subpaths, so none is left.
 */
export const CORE_REEXPORTS: readonly string[] = [];

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
 * `plan` has two. The leaf `blocks.ts` sits alone behind
 * `block-reader.ts`, because `parse.ts` imports `src/utils/tracker.ts`,
 * which imports `blocks.ts` back, and one barrel over both would close
 * a cycle through the tracker. `index.ts` holds `parse.ts` and
 * `plan-files.ts`.
 *
 * `runtime` has one, `index.ts`, over `identity.ts`, which imports no
 * file under `src/` and so reaches nothing that imports it back.
 *
 * `loop` has three. `session-readings.ts` sits alone behind
 * `readings.ts`, because it imports
 * `src/effort/store/task-finishes.ts`, from which
 * `src/effort/store/development-build.ts` is reached by value, and
 * that file imports `index.ts` back. `hop-record.ts` sits alone behind
 * `hops.ts`, because `src/next/hop-record.ts` imports it by value and
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
  command: ['packages/rafa/src/core/command/index.ts'],
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
 * Where a colocated test file goes: into its file's subject folder, under
 * its own base name.
 *
 * @param subject - The subject its file moves into.
 * @param test - The test file's path today.
 * @returns Its path under {@link CORE_FOLDER}.
 */
export function testTarget(subject: CoreSubject, test: string): string {
  return `${subjectFolder(subject)}${baseName(test)}`;
}

/**
 * Every path that changes, a moving file first and its test files after
 * it, in the order of `moves`.
 *
 * @param moves - The moves to spread; {@link CORE_MOVES} unless a test plants its own.
 * @returns One entry per file and per test file.
 */
export function movedPaths(moves: readonly CoreMove[] = CORE_MOVES): readonly MovedPath[] {
  return moves.flatMap((move) => [
    { from: move.from, to: move.to },
    ...move.tests.map((test) => ({ from: test, to: testTarget(move.subject, test) })),
  ]);
}

/**
 * The path under {@link CORE_FOLDER} of a file or test file that moved.
 *
 * @param path - A repository-relative path as it is today.
 * @param moves - The moves to read; {@link CORE_MOVES} unless a test plants its own.
 * @returns Its path after the move, or `undefined` when it is not listed.
 */
export function movedTo(path: string, moves: readonly CoreMove[] = CORE_MOVES): string | undefined {
  return movedPaths(moves).find((moved) => moved.from === path)?.to;
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

/**
 * The paths claimed more than once across the moves and the barrels. A
 * target is claimed by each file, test file or barrel that lands on it,
 * and a path today is claimed by each entry that moves away from it. So
 * the check answers two targets on one path, one file listed twice, and a
 * target that is the old path of another entry. Pure: it reads the lists
 * handed in and never the tree.
 *
 * @param moves - The moves to check.
 * @param barrels - The barrels by subject to check.
 * @returns One entry per path claimed twice or more, sorted by path; empty when none collide.
 */
export function findCollisions(
  moves: readonly CoreMove[],
  barrels: Readonly<Partial<Record<CoreSubject, readonly string[]>>>,
): readonly Collision[] {
  const claims = new Map<string, readonly string[]>();
  const claim = (path: string, phrase: string): void => {
    claims.set(path, [...(claims.get(path) ?? []), phrase]);
  };
  for (const moved of movedPaths(moves)) {
    claim(moved.from, `moves to ${moved.to}`);
    claim(moved.to, `target of ${moved.from}`);
  }
  for (const [subject, paths] of Object.entries(barrels)) {
    for (const path of paths) {
      claim(path, `barrel of ${subject}`);
    }
  }
  return [...claims.entries()]
    .filter(([, phrases]) => phrases.length > 1)
    .map(([path, phrases]) => ({ claims: [...phrases].sort(), path }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
