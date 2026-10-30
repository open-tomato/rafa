/**
 * The move set's parking rule over a planted input: a moved test that
 * reaches a feature package the target declares, by a subpath or by its
 * facade, stays with its source when `declared` names that package's
 * folder, and parks, its row naming the file, when `declared` is absent
 * or names another package.
 */
import type { PassMovesInput } from './pass-moves-set';

import { describe, expect, it } from 'bun:test';

import { readMoveSet } from './pass-moves-set';
import { readPassTarget } from './pass-target';

const PR = readPassTarget('rafa-pr');

/** The file a subpath of board's lands on. */
const BOARD_FILE = 'packages/rafa-board/src/board/columns.ts';

/** The file board's facade by name lands on. */
const BOARD_FACADE = 'packages/rafa-board/index.ts';

/** What each specifier of the planted tree resolves to. */
const RESOLVED: Readonly<Record<string, string>> = {
  './merge.js': 'src/pr/merge.ts',
  './open.js': 'src/pr/open.ts',
  '@open-tomato/rafa-board': BOARD_FACADE,
  '@open-tomato/rafa-board/board/columns': BOARD_FILE,
};

const SOURCES = new Map<string, string>([
  ['src/pr/merge.ts', 'export const merge = 1;\n'],
  ['src/pr/merge.test.ts', 'import { columns } from \'@open-tomato/rafa-board/board/columns\';\n\nimport { merge } from \'./merge.js\';\n\nexport const read = [columns, merge];\n'],
  ['src/pr/open.ts', 'export const open = 1;\n'],
  ['src/pr/open.test.ts', 'import { board } from \'@open-tomato/rafa-board\';\n\nimport { open } from \'./open.js\';\n\nexport const read = [board, open];\n'],
  [BOARD_FILE, 'export const columns = 1;\n'],
  [BOARD_FACADE, 'export { columns as board } from \'./src/board/columns.js\';\n'],
]);

const FILES = [...SOURCES.keys()];

/** The planted input, with `declared` as handed in. */
function inputWith(declared: readonly string[] | undefined): PassMovesInput {
  return {
    ...declared === undefined
      ? {}
      : { declared },
    files: FILES,
    integrationGlobs: [],
    moves: [
      { from: 'src/pr/merge.ts', to: 'packages/rafa-pr/src/pr/merge.ts' },
      { from: 'src/pr/open.ts', to: 'packages/rafa-pr/src/pr/open.ts' },
    ],
    resolve: (specifier) => RESOLVED[specifier],
    sources: SOURCES,
    target: PR,
    tracked: new Set(FILES),
  };
}

function setOf(declared: readonly string[] | undefined): ReturnType<typeof readMoveSet> {
  const files = new Set(FILES);
  return readMoveSet(inputWith(declared), (path) => files.has(path));
}

describe('readMoveSet with declared feature packages', () => {
  it('moves both tests with their sources when declared names the package\'s folder', () => {
    const set = setOf(['packages/rafa-board/']);

    expect(set.refusals).toEqual([]);
    expect(set.parked).toEqual([]);
    expect(set.colocated).toEqual([
      { from: 'src/pr/merge.test.ts', to: 'packages/rafa-pr/src/pr/merge.test.ts' },
      { from: 'src/pr/open.test.ts', to: 'packages/rafa-pr/src/pr/open.test.ts' },
    ]);
  });

  it.each([
    ['declared is absent', undefined],
    ['declared names another package', ['packages/rafa-release/']],
  ])('parks both tests, each row naming the file it reaches, when %s', (_name, declared) => {
    const set = setOf(declared);

    expect(set.refusals).toEqual([]);
    expect(set.colocated).toEqual([]);
    expect(set.parked).toEqual([
      { from: 'src/pr/merge.test.ts', reaches: [BOARD_FILE], to: 'src/tests/pr-coupled/pr/merge.test.ts' },
      { from: 'src/pr/open.test.ts', reaches: [BOARD_FACADE], to: 'src/tests/pr-coupled/pr/open.test.ts' },
    ]);
  });
});
