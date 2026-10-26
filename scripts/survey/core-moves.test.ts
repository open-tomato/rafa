import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import {
  barrelPaths,
  baseName,
  CORE_BARRELS,
  CORE_FOLDER,
  CORE_FOLDERS,
  CORE_NAMED_FILES,
  CORE_PACKAGE,
  CORE_PARKED_TESTS,
  CORE_SOURCE,
  CORE_SUBJECTS,
  isCoreBarrel,
  isCoreFile,
  isCoreRead,
  subjectFolder,
} from './core-moves';
import { classifyFile, listTrackedFiles } from './files';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

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

  it('lists fourteen barrels, three of them for config, three for loop and two for plan', () => {
    expect(barrelPaths()).toEqual([
      'packages/rafa/src/core/adapters/index.ts',
      'packages/rafa/src/core/command/index.ts',
      'packages/rafa/src/core/config/index.ts',
      'packages/rafa/src/core/config/load.ts',
      'packages/rafa/src/core/config/sections.ts',
      'packages/rafa/src/core/git/index.ts',
      'packages/rafa/src/core/loop/hops.ts',
      'packages/rafa/src/core/loop/index.ts',
      'packages/rafa/src/core/loop/readings.ts',
      'packages/rafa/src/core/output/index.ts',
      'packages/rafa/src/core/plan/block-reader.ts',
      'packages/rafa/src/core/plan/index.ts',
      'packages/rafa/src/core/runtime/index.ts',
      'packages/rafa/src/core/services/index.ts',
    ]);
  });

  it('answers a barrel as one, and a moved file beside it as not one', () => {
    expect(isCoreBarrel('packages/rafa/src/core/config/sections.ts')).toBe(true);
    expect(isCoreBarrel('packages/rafa/src/core/config/config-sections.ts')).toBe(false);
    expect(isCoreBarrel('packages/rafa/src/core/plan/block-reader.ts')).toBe(true);
    expect(isCoreBarrel('packages/rafa/src/core/plan/blocks.ts')).toBe(false);
    expect(isCoreBarrel('packages/rafa/src/core/loop/readings.ts')).toBe(true);
    expect(isCoreBarrel('packages/rafa/src/core/loop/session-readings.ts')).toBe(false);
    expect(isCoreBarrel('packages/rafa/src/core/loop/hops.ts')).toBe(true);
    expect(isCoreBarrel('packages/rafa/src/core/loop/hop-record.ts')).toBe(false);
    expect(isCoreBarrel('packages/rafa/src/core/runtime/index.ts')).toBe(true);
    expect(isCoreBarrel('packages/rafa/src/core/runtime/identity.ts')).toBe(false);
    expect(isCoreBarrel('src/runtime/identity.ts')).toBe(false);
    expect(isCoreBarrel('src/core/config/sections.ts')).toBe(false);
    expect(isCoreBarrel('src/plan/index.ts')).toBe(false);
  });
});

describe('where core is', () => {
  it('names the package, its source folder and the parked tests\' folder, each with its closing /', () => {
    expect(CORE_PACKAGE).toBe('packages/rafa/');
    expect(CORE_SOURCE).toBe('packages/rafa/src/');
    expect(CORE_PARKED_TESTS).toBe('src/tests/core-coupled/');
  });

  it('lists the package\'s source folder alone and no named file, core being its package', () => {
    expect(CORE_FOLDERS).toEqual([CORE_SOURCE]);
    expect(CORE_NAMED_FILES).toEqual([]);
    expect(CORE_FOLDER).toBe(`${CORE_SOURCE}core/`);
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
  it('holds a file under each folder core had and each file it named, at its path in the package', () => {
    expect(isCoreFile('packages/rafa/src/core/git/git.ts')).toBe(true);
    expect(isCoreFile('packages/rafa/src/effort/store/index.ts')).toBe(true);
    expect(isCoreFile('packages/rafa/src/ports/log-level.ts')).toBe(true);
    expect(isCoreFile('packages/rafa/src/report/parse.ts')).toBe(true);
    expect(isCoreFile('packages/rafa/src/schema/tiers.ts')).toBe(true);
  });

  it('refuses the old paths, the two build entries, a folder that only shares a prefix and the parked tests', () => {
    expect(isCoreFile('src/core/git/git.ts')).toBe(false);
    expect(isCoreFile('src/report/parse.ts')).toBe(false);
    expect(isCoreFile('src/effort/store/index.ts')).toBe(false);
    expect(isCoreFile('src/ports/index.ts')).toBe(false);
    expect(isCoreFile('packages/rafa-hub/src/bin.ts')).toBe(false);
    expect(isCoreFile('packages/rafa/package.json')).toBe(false);
    expect(isCoreFile(`${CORE_PARKED_TESTS}core/config/config.test.ts`)).toBe(false);
  });

  it('reads planted lists: the three folders and four named files core had before the move', () => {
    const folders = ['src/core/', 'src/effort/store/', 'src/ports/'];
    const named = ['src/report/parse.ts', 'src/report/record.ts', 'src/schema/project-id.ts', 'src/schema/tiers.ts'];

    expect(isCoreFile('src/core/git/git.ts', folders, named)).toBe(true);
    expect(isCoreFile('src/report/parse.ts', folders, named)).toBe(true);
    expect(isCoreFile('src/report/parse.test.ts', folders, named)).toBe(false);
    expect(isCoreFile('src/effort/store-sync.ts', folders, named)).toBe(false);
    expect(isCoreFile(`${CORE_SOURCE}core/git/git.ts`, folders, named)).toBe(false);
  });
});

describe('isCoreRead', () => {
  it('holds every core file and a test parked under src/tests/core-coupled/', () => {
    expect(isCoreRead('packages/rafa/src/core/git/git.ts')).toBe(true);
    expect(isCoreRead('packages/rafa/src/report/record.ts')).toBe(true);
    expect(isCoreRead(`${CORE_PARKED_TESTS}effort/store/settings.test.ts`)).toBe(true);
  });

  it('refuses a file outside core, another test under src/tests/ and a folder that only shares the parked prefix', () => {
    expect(isCoreRead('packages/rafa-board/src/board/place.ts')).toBe(false);
    expect(isCoreRead('src/tests/core-barrels.sweep.test.ts')).toBe(false);
    expect(isCoreRead('src/tests/core-coupled-notes.ts')).toBe(false);
  });

  it('reads planted lists for the core files and keeps the parked tests', () => {
    expect(isCoreRead('src/ports/log-level.ts', ['src/ports/'], [])).toBe(true);
    expect(isCoreRead(`${CORE_PARKED_TESTS}core/config/config.test.ts`, ['src/ports/'], [])).toBe(true);
    expect(isCoreRead(`${CORE_SOURCE}ports/log-level.ts`, ['src/ports/'], [])).toBe(false);
  });
});

/**
 * The lists of where core is against the tracked tree: every core
 * folder holds a tracked file, and every named file is tracked.
 */
describe('the lists against the tracked tree', () => {
  const tracked = new Set(listTrackedFiles(REPO_ROOT).all);

  it('finds a tracked code file under every core folder and every named file tracked', () => {
    const files = [...tracked];

    expect(CORE_FOLDERS.map((folder) => [folder, files.some((path) => path.startsWith(folder))]))
      .toEqual(CORE_FOLDERS.map((folder) => [folder, true]));
    expect(CORE_NAMED_FILES.map((path) => [path, tracked.has(path)])).toEqual(CORE_NAMED_FILES.map((path) => [path, true]));
  });
});
