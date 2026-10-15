import type { CoreMove } from './core-moves';

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import {
  barrelPaths,
  baseName,
  CORE_BARRELS,
  CORE_FOLDER,
  CORE_FOLDERS,
  CORE_MOVES,
  CORE_NAMED_FILES,
  CORE_PACKAGE,
  CORE_PARKED_TESTS,
  CORE_REEXPORTS,
  CORE_SOURCE,
  CORE_SUBJECTS,
  findCollisions,
  isCoreBarrel,
  isCoreFile,
  isCoreRead,
  movedPaths,
  movedTo,
  subjectFolder,
  testTarget,
} from './core-moves';
import { classifyFile, listTrackedFiles } from './files';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_SUFFIX = '.test.ts';

/** The folder of a path, with its closing `/`. */
function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** A file's name less `.ts`: `src/pr/git.ts` gives `git`. */
function stemOf(path: string): string {
  return baseName(path).replace(/\.ts$/, '');
}

/** Whether a test file's name opens with a moving file's stem, in that file's folder. */
function isNamedAfter(test: string, move: CoreMove): boolean {
  const stem = stemOf(move.from);
  const name = baseName(test);
  return folderOf(test) === folderOf(move.from) && (name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`));
}

/** A planted move with no test file. */
function plant(from: string, to: string, tests: readonly string[] = []): CoreMove {
  return { from, subject: 'git', tests, to };
}

describe('CORE_MOVES', () => {
  it('lists twenty-nine files, each once, sorted by the path it has today', () => {
    const from = CORE_MOVES.map((move) => move.from);

    expect(from).toHaveLength(29);
    expect(new Set(from).size).toBe(29);
    expect(from).toEqual([...from].sort());
  });

  it('puts each file in its subject folder under src/core/ with its base name kept', () => {
    for (const move of CORE_MOVES) {
      expect(CORE_SUBJECTS).toContain(move.subject);
      expect(move.to).toBe(`${CORE_FOLDER}${move.subject}/${baseName(move.from)}`);
      expect(move.from.startsWith(CORE_FOLDER)).toBe(false);
    }
  });

  it('holds a source file on both sides of every move, as classifyFile reads it', () => {
    for (const move of CORE_MOVES) {
      expect([move.from, classifyFile(move.from)]).toEqual([move.from, 'source']);
      expect([move.to, classifyFile(move.to)]).toEqual([move.to, 'source']);
    }
  });

  it('lists each file\'s test files sorted, named after it, in its folder, test files on both sides', () => {
    for (const move of CORE_MOVES) {
      expect(move.tests).toEqual([...move.tests].sort());
      for (const test of move.tests) {
        expect([test, isNamedAfter(test, move)]).toEqual([test, true]);
        expect([test, classifyFile(test)]).toEqual([test, 'test']);
        expect(classifyFile(testTarget(move.subject, test))).toBe('test');
      }
    }
  });

  it('holds 30 test files, with none for stream.ts, plan-files.ts, session-readings.ts and plan-stamp.ts', () => {
    const without = CORE_MOVES.filter((move) => move.tests.length === 0).map((move) => move.from);

    expect(CORE_MOVES.flatMap((move) => move.tests)).toHaveLength(30);
    expect(without).toEqual(['src/adapters/output/stream.ts', 'src/loop/session-readings.ts', 'src/plan/plan-files.ts', 'src/utils/plan-stamp.ts']);
  });

  it('uses every subject folder', () => {
    const used = [...new Set(CORE_MOVES.map((move) => move.subject))].sort();

    expect(used).toEqual([...CORE_SUBJECTS]);
  });
});

describe('CORE_BARRELS', () => {
  it('gives every subject at least one barrel, each a source file directly in the subject folder', () => {
    for (const subject of CORE_SUBJECTS) {
      const barrels = CORE_BARRELS[subject];

      expect(barrels.length).toBeGreaterThan(0);
      expect(barrels).toEqual([...barrels].sort());
      for (const barrel of barrels) {
        expect(barrel).toBe(`${subjectFolder(subject)}${baseName(barrel)}`);
        expect(classifyFile(barrel)).toBe('source');
      }
    }
  });

  it('lists thirteen barrels, three of them for config, three for loop and two for plan', () => {
    expect(barrelPaths()).toEqual([
      'src/core/adapters/index.ts',
      'src/core/command/index.ts',
      'src/core/config/index.ts',
      'src/core/config/load.ts',
      'src/core/config/sections.ts',
      'src/core/git/index.ts',
      'src/core/loop/hops.ts',
      'src/core/loop/index.ts',
      'src/core/loop/readings.ts',
      'src/core/output/index.ts',
      'src/core/plan/block-reader.ts',
      'src/core/plan/index.ts',
      'src/core/runtime/index.ts',
    ]);
  });

  it('answers a barrel as one, and a moved file beside it as not one', () => {
    expect(isCoreBarrel('src/core/config/sections.ts')).toBe(true);
    expect(isCoreBarrel('src/core/config/config-sections.ts')).toBe(false);
    expect(isCoreBarrel('src/core/plan/block-reader.ts')).toBe(true);
    expect(isCoreBarrel('src/core/plan/blocks.ts')).toBe(false);
    expect(isCoreBarrel('src/core/loop/readings.ts')).toBe(true);
    expect(isCoreBarrel('src/core/loop/session-readings.ts')).toBe(false);
    expect(isCoreBarrel('src/core/loop/hops.ts')).toBe(true);
    expect(isCoreBarrel('src/core/loop/hop-record.ts')).toBe(false);
    expect(isCoreBarrel('src/core/runtime/index.ts')).toBe(true);
    expect(isCoreBarrel('src/core/runtime/identity.ts')).toBe(false);
    expect(isCoreBarrel('src/runtime/identity.ts')).toBe(false);
    expect(isCoreBarrel('src/plan/index.ts')).toBe(false);
  });
});

describe('movedPaths and movedTo', () => {
  it('spreads the moves into 59 paths, a file first and its test files after it', () => {
    const paths = movedPaths();

    expect(paths).toHaveLength(59);
    expect(paths.slice(0, 2)).toEqual([
      { from: 'src/adapters/output/active.ts', to: 'src/core/output/active.ts' },
      { from: 'src/adapters/output/active.test.ts', to: 'src/core/output/active.test.ts' },
    ]);
  });

  it('answers the target of a file and of a test file, and nothing for a file that stays', () => {
    expect(movedTo('src/cli/prompt/confirm.ts')).toBe('src/core/command/confirm.ts');
    expect(movedTo('src/loop/sessions-hop.test.ts')).toBe('src/core/loop/sessions-hop.test.ts');
    expect(movedTo('src/config-schema-board.test.ts')).toBe('src/core/config/config-schema-board.test.ts');
    expect(movedTo('src/config-schema-hub.test.ts')).toBeUndefined();
    expect(movedTo('src/core/loop/sessions.ts')).toBeUndefined();
  });
});

describe('findCollisions', () => {
  it('finds none across the twenty-nine moves, their test files and the barrels', () => {
    expect(findCollisions(CORE_MOVES, CORE_BARRELS)).toEqual([]);
  });

  it('answers two files that land on one target', () => {
    const collisions = findCollisions(
      [plant('src/pr/git.ts', 'src/core/git/git.ts'), plant('src/utils/git.ts', 'src/core/git/git.ts')],
      {},
    );

    expect(collisions).toEqual([
      { claims: ['target of src/pr/git.ts', 'target of src/utils/git.ts'], path: 'src/core/git/git.ts' },
    ]);
  });

  it('answers two test files of one base name that land in one subject folder', () => {
    const collisions = findCollisions(
      [
        plant('src/pr/git.ts', 'src/core/git/git.ts', ['src/pr/run.test.ts']),
        plant('src/utils/commit.ts', 'src/core/git/commit.ts', ['src/utils/run.test.ts']),
      ],
      {},
    );

    expect(collisions.map((collision) => collision.path)).toEqual(['src/core/git/run.test.ts']);
  });

  it('answers a moved file that lands on a barrel', () => {
    const collisions = findCollisions([plant('src/pr/index.ts', 'src/core/git/index.ts')], {
      git: ['src/core/git/index.ts'],
    });

    expect(collisions).toEqual([
      { claims: ['barrel of git', 'target of src/pr/index.ts'], path: 'src/core/git/index.ts' },
    ]);
  });

  it('answers one file listed twice, and one barrel listed under two subjects', () => {
    const twice = findCollisions(
      [plant('src/pr/git.ts', 'src/core/git/git.ts'), plant('src/pr/git.ts', 'src/core/git/runner.ts')],
      {},
    );
    const shared = findCollisions([], { git: ['src/core/index.ts'], plan: ['src/core/index.ts'] });

    expect(twice.map((collision) => collision.path)).toEqual(['src/pr/git.ts']);
    expect(shared.map((collision) => collision.path)).toEqual(['src/core/index.ts']);
  });

  it('answers a target that is the path another entry moves away from', () => {
    const collisions = findCollisions(
      [plant('src/core/git/old.ts', 'src/core/git/new.ts'), plant('src/pr/old.ts', 'src/core/git/old.ts')],
      {},
    );

    expect(collisions.map((collision) => collision.path)).toEqual(['src/core/git/old.ts']);
  });
});

describe('CORE_REEXPORTS', () => {
  it('lists the old path of a moved source file, each once, sorted', () => {
    const from = CORE_MOVES.map((move) => move.from);

    expect(CORE_REEXPORTS).toEqual([
      'src/adapters/output/stream.ts',
      'src/adapters/output/text.ts',
      'src/cli/core/types.ts',
      'src/cli/running.ts',
      'src/cli/spends.ts',
      'src/loop/session-record-parse.ts',
      'src/runtime/identity.ts',
      'src/utils/declaration.ts',
      'src/utils/plan-stamp.ts',
      'src/utils/session-env.ts',
    ]);
    expect(CORE_REEXPORTS).toEqual([...new Set(CORE_REEXPORTS)].sort());
    for (const path of CORE_REEXPORTS) {
      expect([path, from.includes(path)]).toEqual([path, true]);
    }
  });
});

describe('where core is', () => {
  it('names the package, its source folder and the parked tests\' folder, each with its closing /', () => {
    expect(CORE_PACKAGE).toBe('packages/rafa/');
    expect(CORE_SOURCE).toBe('packages/rafa/src/');
    expect(CORE_PARKED_TESTS).toBe('src/tests/core-coupled/');
  });

  it('lists the three folders and the four named files core is before the move, sorted', () => {
    expect(CORE_FOLDERS).toEqual([CORE_FOLDER, 'src/effort/store/', 'src/ports/']);
    expect(CORE_FOLDERS).toEqual([...CORE_FOLDERS].sort());
    expect(CORE_NAMED_FILES).toEqual(['src/report/parse.ts', 'src/report/record.ts', 'src/schema/project-id.ts', 'src/schema/tiers.ts']);
    expect(CORE_NAMED_FILES).toEqual([...CORE_NAMED_FILES].sort());
  });

  it('closes every folder with / and puts no named file under a folder', () => {
    for (const folder of CORE_FOLDERS) {
      expect(folder.endsWith('/')).toBe(true);
    }
    for (const path of CORE_NAMED_FILES) {
      expect([path, CORE_FOLDERS.some((folder) => path.startsWith(folder))]).toEqual([path, false]);
    }
  });
});

describe('isCoreFile', () => {
  it('holds a file under each core folder and each named file', () => {
    expect(isCoreFile('src/core/git/git.ts')).toBe(true);
    expect(isCoreFile('src/effort/store/index.ts')).toBe(true);
    expect(isCoreFile('src/ports/log-level.ts')).toBe(true);
    for (const path of CORE_NAMED_FILES) {
      expect([path, isCoreFile(path)]).toEqual([path, true]);
    }
  });

  it('refuses a sibling of a named file, a folder that only shares a prefix, the parked tests and the package before it is core', () => {
    expect(isCoreFile('src/report/parse.test.ts')).toBe(false);
    expect(isCoreFile('src/report/render.ts')).toBe(false);
    expect(isCoreFile('src/core-x.ts')).toBe(false);
    expect(isCoreFile('src/effort/store-sync.ts')).toBe(false);
    expect(isCoreFile('src/effort/sync/push.ts')).toBe(false);
    expect(isCoreFile(`${CORE_PARKED_TESTS}core/config/config.test.ts`)).toBe(false);
    expect(isCoreFile(`${CORE_SOURCE}core/git/git.ts`)).toBe(false);
  });

  it('reads planted lists: the package\'s source folder alone, with no named file, as after the move', () => {
    const folders = [CORE_SOURCE];

    expect(isCoreFile(`${CORE_SOURCE}report/parse.ts`, folders, [])).toBe(true);
    expect(isCoreFile('src/report/parse.ts', folders, [])).toBe(false);
    expect(isCoreFile('src/core/git/git.ts', folders, [])).toBe(false);
  });
});

describe('isCoreRead', () => {
  it('holds every core file and a test parked under src/tests/core-coupled/', () => {
    expect(isCoreRead('src/core/git/git.ts')).toBe(true);
    expect(isCoreRead('src/report/record.ts')).toBe(true);
    expect(isCoreRead(`${CORE_PARKED_TESTS}effort/store/settings.test.ts`)).toBe(true);
  });

  it('refuses a file outside core, another test under src/tests/ and a folder that only shares the parked prefix', () => {
    expect(isCoreRead('src/board/place.ts')).toBe(false);
    expect(isCoreRead('src/tests/core-barrels.sweep.test.ts')).toBe(false);
    expect(isCoreRead('src/tests/core-coupled-notes.ts')).toBe(false);
  });

  it('reads planted lists for the core files and keeps the parked tests', () => {
    expect(isCoreRead(`${CORE_SOURCE}ports/log-level.ts`, [CORE_SOURCE], [])).toBe(true);
    expect(isCoreRead(`${CORE_PARKED_TESTS}core/config/config.test.ts`, [CORE_SOURCE], [])).toBe(true);
    expect(isCoreRead('src/ports/log-level.ts', [CORE_SOURCE], [])).toBe(false);
  });
});

/**
 * The lists against the tracked tree. These stay true through the move:
 * a listed path is tracked where it is today or at its target, and never
 * at both, but for an old path {@link CORE_REEXPORTS} keeps as a
 * re-export, which is tracked at both once its file has moved.
 */
describe('the lists against the tracked tree', () => {
  const tracked = new Set(listTrackedFiles(REPO_ROOT).all);
  const kept = new Set(CORE_REEXPORTS);

  it('finds every listed file and test file at its old path or at its target, never both but for a kept re-export', () => {
    const paths = movedPaths();
    const placed = paths.map((moved) => [moved.from, Number(tracked.has(moved.from)) + Number(tracked.has(moved.to))]);

    expect(tracked.size).toBeGreaterThan(0);
    expect(placed).toEqual(paths.map((moved) => [moved.from, kept.has(moved.from) && tracked.has(moved.to)
      ? 2
      : 1]));
  });

  it('finds every kept re-export at its old path once its file sits at its target', () => {
    const moved = CORE_MOVES.filter((move) => kept.has(move.from) && tracked.has(move.to));

    expect(moved.map((move) => [move.from, tracked.has(move.from)])).toEqual(moved.map((move) => [move.from, true]));
  });

  it('finds a tracked code file under every core folder and every named file tracked', () => {
    const files = [...tracked];

    expect(CORE_FOLDERS.map((folder) => [folder, files.some((path) => path.startsWith(folder))]))
      .toEqual(CORE_FOLDERS.map((folder) => [folder, true]));
    expect(CORE_NAMED_FILES.map((path) => [path, tracked.has(path)])).toEqual(CORE_NAMED_FILES.map((path) => [path, true]));
  });

  it('lists every test file named after a file still at its old path that has no source file of its own', () => {
    const unmoved = CORE_MOVES.filter((move) => tracked.has(move.from) && !tracked.has(move.to));
    const listed = new Set(unmoved.flatMap((move) => move.tests));
    const owned = [...tracked].filter((path) => {
      if (classifyFile(path) !== 'test' || !path.endsWith(TEST_SUFFIX)) {
        return false;
      }
      const ownSource = `${path.slice(0, -TEST_SUFFIX.length)}.ts`;
      return !tracked.has(ownSource) || unmoved.some((move) => move.from === ownSource);
    });
    const named = owned.filter((path) => unmoved.some((move) => isNamedAfter(path, move))).sort();

    expect(named).toEqual([...listed].sort());
  });
});
