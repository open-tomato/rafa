/**
 * Where the shared contract files go: the data behind the move of #905,
 * which puts the files every part of rafa depends on into `src/core/`
 * before any package is cut (epic #801).
 *
 * Three things are listed, and nothing here reads the tree:
 *
 *   - {@link CORE_MOVES}: the nineteen files that change path, each with
 *     its path under `src/core/` and its subject folder. A file keeps its
 *     base name;
 *   - with each file, its colocated test files by their path today. A test
 *     file moves with its file into the same folder and keeps its base
 *     name too ({@link testTarget});
 *   - {@link CORE_BARRELS}: the barrel files of each subject, the only
 *     files under `src/core/` a file outside it may import.
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
 * A move task that splits a barrel adds the new barrel here in the same
 * task. A barrel is split, never widened, when it would close a runtime
 * cycle.
 *
 * {@link findCollisions} is the check the unit tests hold the lists to:
 * no two targets are one path, and no target is a path something else
 * moves away from.
 */

/** The folder the files move into, with its closing `/`. */
export const CORE_FOLDER = 'src/core/';

/** The subject folders under `src/core/`, sorted. */
export const CORE_SUBJECTS = ['adapters', 'command', 'config', 'git', 'loop', 'output', 'plan'] as const;

/** One subject folder under `src/core/`. */
export type CoreSubject = (typeof CORE_SUBJECTS)[number];

/** One file that changes path into `src/core/`. */
export interface CoreMove {
  /** The file's path today, repository-relative. */
  readonly from: string;
  /** The subject folder it moves into. */
  readonly subject: CoreSubject;
  /** Its colocated test files by their path today, sorted; empty when it has none. */
  readonly tests: readonly string[];
  /** Its path under `src/core/`, repository-relative. */
  readonly to: string;
}

/** One path that changes: a moving file or one of its test files. */
export interface MovedPath {
  /** The path today. */
  readonly from: string;
  /** The path under `src/core/`. */
  readonly to: string;
}

/** Two listed paths that cannot both hold. */
export interface Collision {
  /** The path claimed twice, repository-relative. */
  readonly path: string;
  /** What claims it, one phrase per claim, sorted. */
  readonly claims: readonly string[];
}

/** The nineteen files that move, sorted by their path today. */
export const CORE_MOVES: readonly CoreMove[] = [
  {
    from: 'src/adapters/output/active.ts',
    subject: 'output',
    tests: ['src/adapters/output/active.test.ts'],
    to: 'src/core/output/active.ts',
  },
  {
    from: 'src/adapters/registry.ts',
    subject: 'adapters',
    tests: ['src/adapters/registry.test.ts'],
    to: 'src/core/adapters/registry.ts',
  },
  {
    from: 'src/cli/command.ts',
    subject: 'command',
    tests: ['src/cli/command.test.ts'],
    to: 'src/core/command/command.ts',
  },
  {
    from: 'src/cli/prompt/confirm.ts',
    subject: 'command',
    tests: ['src/cli/prompt/confirm.test.ts'],
    to: 'src/core/command/confirm.ts',
  },
  {
    from: 'src/cli/version.ts',
    subject: 'command',
    tests: ['src/cli/version.test.ts'],
    to: 'src/core/command/version.ts',
  },
  {
    from: 'src/config-items.ts',
    subject: 'config',
    tests: ['src/config-items.test.ts'],
    to: 'src/core/config/config-items.ts',
  },
  {
    from: 'src/config-load.ts',
    subject: 'config',
    tests: ['src/config-load.test.ts'],
    to: 'src/core/config/config-load.ts',
  },
  {
    from: 'src/config-readers.ts',
    subject: 'config',
    tests: ['src/config-readers.test.ts'],
    to: 'src/core/config/config-readers.ts',
  },
  {
    from: 'src/config-schema.ts',
    subject: 'config',
    tests: ['src/config-schema-board.test.ts', 'src/config-schema.test.ts'],
    to: 'src/core/config/config-schema.ts',
  },
  {
    from: 'src/config-sections.ts',
    subject: 'config',
    tests: ['src/config-sections.test.ts'],
    to: 'src/core/config/config-sections.ts',
  },
  {
    from: 'src/config.ts',
    subject: 'config',
    tests: ['src/config.test.ts'],
    to: 'src/core/config/config.ts',
  },
  {
    from: 'src/loop/session-readings.ts',
    subject: 'loop',
    tests: [],
    to: 'src/core/loop/session-readings.ts',
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
    to: 'src/core/loop/sessions.ts',
  },
  {
    from: 'src/plan/blocks.ts',
    subject: 'plan',
    tests: ['src/plan/blocks.test.ts'],
    to: 'src/core/plan/blocks.ts',
  },
  {
    from: 'src/plan/parse.ts',
    subject: 'plan',
    tests: ['src/plan/parse.test.ts'],
    to: 'src/core/plan/parse.ts',
  },
  {
    from: 'src/plan/plan-files.ts',
    subject: 'plan',
    tests: [],
    to: 'src/core/plan/plan-files.ts',
  },
  {
    from: 'src/pr/git.ts',
    subject: 'git',
    tests: ['src/pr/git.test.ts'],
    to: 'src/core/git/git.ts',
  },
  {
    from: 'src/utils/claude.ts',
    subject: 'loop',
    tests: ['src/utils/claude.test.ts'],
    to: 'src/core/loop/claude.ts',
  },
  {
    from: 'src/utils/commit.ts',
    subject: 'git',
    tests: ['src/utils/commit.test.ts'],
    to: 'src/core/git/commit.ts',
  },
];

/**
 * The barrel files of each subject, sorted. `config` has three. The
 * leaf pair `config-sections.ts` and `config-readers.ts` sits behind
 * `sections.ts`, because `config-merged.ts` imports section files that
 * import that pair back, and one barrel over all of them would close a
 * cycle through every section file. `config-load.ts` sits alone behind
 * `load.ts`, because it imports `src/effort/store/settings.ts`, which
 * imports `index.ts` and `sections.ts` back.
 *
 * `plan` has two. The leaf `blocks.ts` sits alone behind
 * `block-reader.ts`, because `parse.ts` imports `src/utils/tracker.ts`,
 * which imports `blocks.ts` back, and one barrel over both would close
 * a cycle through the tracker. `index.ts` holds `parse.ts` and
 * `plan-files.ts`.
 *
 * `loop` has two. `session-readings.ts` sits alone behind
 * `readings.ts`, because it imports
 * `src/effort/store/task-finishes.ts`, from which
 * `src/effort/store/development-build.ts` is reached by value, and
 * that file imports `index.ts` back. `index.ts` holds `sessions.ts`
 * and `claude.ts`, which share it because neither reaches a file that
 * imports it back.
 */
export const CORE_BARRELS: Readonly<Record<CoreSubject, readonly string[]>> = {
  adapters: ['src/core/adapters/index.ts'],
  command: ['src/core/command/index.ts'],
  config: ['src/core/config/index.ts', 'src/core/config/load.ts', 'src/core/config/sections.ts'],
  git: ['src/core/git/index.ts'],
  loop: ['src/core/loop/index.ts', 'src/core/loop/readings.ts'],
  output: ['src/core/output/index.ts'],
  plan: ['src/core/plan/block-reader.ts', 'src/core/plan/index.ts'],
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
 * `config` gives `src/core/config/`.
 *
 * @param subject - The subject.
 * @returns Its folder under `src/core/`.
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
 * @returns Its path under `src/core/`.
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
 * The path under `src/core/` of a file or test file that moves.
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
 * @returns `true` when a file outside `src/core/` may import it.
 */
export function isCoreBarrel(path: string): boolean {
  return barrelPaths().includes(path);
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
