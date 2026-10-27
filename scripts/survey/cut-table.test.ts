import type { CutGraph, CutRules, CutTable, PackageRow } from './cut-table';
import type { EdgeKind } from './import-graph';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  BOARD_NAMED,
  CLI_NAMED,
  EFFORT_NAMED,
  INVENTORY_NAMED,
  PR_NAMED,
  RELEASE_NAMED,
  RUN_NAMED,
} from './cut-names';
import {
  buildCutTable,
  CLI_PACKAGE,
  CORE_PACKAGE,
  CUT_RULES,
  findRuleProblems,
  GRAPH_PATH,
  isClearedBySections,
  main,
  parseCutGraph,
  placeFile,
  renderCutTableJson,
  renderCutTableMarkdown,
  SECTIONS_ISSUE,
} from './cut-table';
import { classifyFile, listTrackedFiles } from './files';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The folder of the board's c6 files, below board's package since pass 4c. */
const BOARD_FOLDER = 'packages/rafa-board/src/board/';

/** One planted edge: the importer, the imported file, and the kind (`value` unless given). */
type PlantedEdge = readonly [from: string, to: string, kind?: EdgeKind];

/**
 * A planted graph: a node for each end of each edge and for each extra
 * path, its kind read off its path as the graph script reads it.
 */
function plant(edges: readonly PlantedEdge[], extra: readonly string[] = []): CutGraph {
  const paths = [...new Set([...edges.flatMap(([from, to]) => [from, to]), ...extra])];
  return {
    edges: edges.map(([from, to, kind]) => ({ from, kind: kind ?? 'value', to })),
    nodes: paths.map((path) => ({ kind: classifyFile(path), path })),
  };
}

/** A package's row, or a failure naming the package the table does not hold. */
function rowOf(table: CutTable, name: string): PackageRow {
  const row = table.packages.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(`the table holds no package named ${name}`);
  }
  return row;
}

/** Each package's count, by name. */
function countsOf(table: CutTable): Record<string, number> {
  return Object.fromEntries(table.packages.map((row) => [row.name, row.upwardEdges]));
}

/** Two packages and one unassigned folder, for the tests that plant their own rules. */
const TWO_PACKAGES: CutRules = {
  packages: [
    { folders: ['low/'], name: 'low', named: [] },
    { folders: ['high/'], name: 'high', named: [] },
  ],
  rest: 'high',
  unassigned: ['later/'],
};

describe('CUT_RULES', () => {
  it('lists the twelve packages lowest first, the shared configs and core at the bottom and the CLI at the top', () => {
    expect(CUT_RULES.packages.map((rule) => rule.name)).toEqual([
      'rafa-eslint-config',
      'rafa-typescript-config',
      '@open-tomato/rafa-core',
      'rafa-inventory',
      'rafa-board',
      'rafa-pr',
      'rafa-run',
      'rafa-release',
      'rafa-effort',
      'rafa-hub',
      'rafa-sync-service',
      '@open-tomato/rafa',
    ]);
    expect(CUT_RULES.rest).toBe(CLI_PACKAGE);
  });

  it('lists the three unassigned folders', () => {
    expect(CUT_RULES.unassigned).toEqual(['src/ci/', 'src/commands/stretch/', 'src/stretch/']);
  });

  it('holds no fault: no folder held twice, no file named twice', () => {
    expect(findRuleProblems(CUT_RULES)).toEqual([]);
  });

  it('names for rafa-board the board files docs/survey/cluster-map.json puts in cluster c6, under packages/rafa-board/src/board/ since pass 4c', () => {
    const map = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/survey/cluster-map.json'), 'utf8')) as {
      readonly clusters: Readonly<Record<string, string>>;
    };
    const inC6 = Object.entries(map.clusters)
      .filter(([path, cluster]) => path.startsWith(BOARD_FOLDER) && cluster === 'c6')
      .map(([path]) => path)
      .sort();

    expect(inC6).toHaveLength(14);
    expect(BOARD_NAMED.filter((path) => path.startsWith(BOARD_FOLDER))).toEqual(inC6);
    expect(CUT_RULES.packages.find((rule) => rule.name === 'rafa-board')?.named).toEqual(BOARD_NAMED);
  });
});

/** Each feature package's list of `cut-names.ts` and the CLI's, its length, and the file its rule names beside the list. */
const NAMED_LISTS: readonly (readonly [name: string, list: readonly string[], length: number, kept: readonly string[]])[] = [
  ['rafa-inventory', INVENTORY_NAMED, 0, []],
  ['rafa-board', BOARD_NAMED, 22, []],
  ['rafa-pr', PR_NAMED, 8, ['src/pr/index.ts']],
  ['rafa-run', RUN_NAMED, 22, []],
  ['rafa-release', RELEASE_NAMED, 6, []],
  ['rafa-effort', EFFORT_NAMED, 0, []],
  ['@open-tomato/rafa', CLI_NAMED, 5, []],
];

/**
 * The named lists of `cut-names.ts` against the tracked tree: each list
 * holds the count the plan names, sorted, every file in it tracked, and
 * its package's rule names it with the file the rule named before.
 */
describe('the named lists against the tracked tree', () => {
  const tracked = new Set(listTrackedFiles(REPO_ROOT).all);

  for (const [name, list, length, kept] of NAMED_LISTS) {
    it(`names ${length} tracked files for ${name}, sorted, and its rule holds them`, () => {
      expect(list).toHaveLength(length);
      expect([...list].sort()).toEqual([...list]);
      expect(list.map((path) => [path, tracked.has(path)])).toEqual(list.map((path) => [path, true]));
      expect(CUT_RULES.packages.find((rule) => rule.name === name)?.named).toEqual([...list, ...kept]);
    });
  }

  it('names 63 files across the seven lists, the 64 pass 4b left less the three the fourth decouple item moved into core, plus ahead.ts it placed in board, with the two stale-docs files the sixth moved from pr to release, and pr-retarget.ts the seventh placed in pr', () => {
    expect(NAMED_LISTS.reduce((sum, [, list]) => sum + list.length, 0)).toBe(63);
  });
});

describe('findRuleProblems', () => {
  it('answers nothing for rules that hold', () => {
    expect(findRuleProblems(TWO_PACKAGES)).toEqual([]);
  });

  it('answers a folder two packages hold, and one a package and the unassigned list both hold', () => {
    const problems = findRuleProblems({
      packages: [
        { folders: ['shared/', 'later/'], name: 'low', named: [] },
        { folders: ['shared/'], name: 'high', named: [] },
      ],
      rest: 'high',
      unassigned: ['later/'],
    });

    expect(problems).toEqual([
      { problem: 'folder held more than once', subject: 'later/' },
      { problem: 'folder held more than once', subject: 'shared/' },
    ]);
  });

  it('answers a file two packages name, a package listed twice, and a rest that is no package', () => {
    const problems = findRuleProblems({
      packages: [
        { folders: ['low/'], name: 'low', named: ['src/a.ts'] },
        { folders: ['high/'], name: 'low', named: ['src/a.ts'] },
      ],
      rest: 'nowhere',
      unassigned: [],
    });

    expect(problems).toEqual([
      { problem: 'package listed more than once', subject: 'low' },
      { problem: 'the rest goes to a package that is not listed', subject: 'nowhere' },
      { problem: 'file named more than once', subject: 'src/a.ts' },
    ]);
  });

  it('answers a folder with no closing slash, which would hold a sibling folder too', () => {
    const problems = findRuleProblems({ ...TWO_PACKAGES, unassigned: ['src/ci'] });

    expect(problems).toEqual([{ problem: 'folder has no closing /', subject: 'src/ci' }]);
  });
});

describe('placeFile', () => {
  it('places a file in the package whose folder holds it', () => {
    expect(placeFile('src/release/settle.ts')).toEqual({ by: 'folder', folder: 'src/release/', package: 'rafa-release' });
    expect(placeFile('packages/rafa-hub/src/bin.ts')).toEqual({
      by: 'folder',
      folder: 'packages/rafa-hub/',
      package: 'rafa-hub',
    });
  });

  it('places each shared-config package\'s files by its one folder', () => {
    expect(placeFile('packages/eslint-config/base.test.ts')).toEqual({
      by: 'folder',
      folder: 'packages/eslint-config/',
      package: 'rafa-eslint-config',
    });
    expect(placeFile('packages/typescript-config/base.test.ts')).toEqual({
      by: 'folder',
      folder: 'packages/typescript-config/',
      package: 'rafa-typescript-config',
    });
    expect(placeFile('packages/eslint-config-extra/base.ts').package).toBe(CLI_PACKAGE);
  });

  it('places every file under packages/rafa/ in core, effort\'s and board\'s files in their packages by folder, and src/effort/store/index.ts in the CLI by name', () => {
    expect(placeFile('packages/rafa/src/effort/store/sqlite.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('packages/rafa/src/effort/store/testdata/merge-scenarios.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('packages/rafa-effort/src/effort/report.ts')).toEqual({
      by: 'folder',
      folder: 'packages/rafa-effort/',
      package: 'rafa-effort',
    });
    expect(placeFile('packages/rafa-effort/src/effort/sync/select.ts')).toEqual({
      by: 'folder',
      folder: 'packages/rafa-effort/',
      package: 'rafa-effort',
    });
    expect(placeFile('src/effort/store/index.ts')).toEqual({ by: 'named', folder: undefined, package: CLI_PACKAGE });
    expect(placeFile('packages/rafa-board/src/board/project/rules.ts')).toEqual({
      by: 'folder',
      folder: 'packages/rafa-board/',
      package: 'rafa-board',
    });
  });

  it('places each feature package\'s facade folder in its package, beside core\'s and the hub\'s', () => {
    expect(placeFile('packages/rafa-effort/index.ts')).toEqual({
      by: 'folder',
      folder: 'packages/rafa-effort/',
      package: 'rafa-effort',
    });
    expect(placeFile('packages/rafa-run/index.ts')).toEqual({ by: 'folder', folder: 'packages/rafa-run/', package: 'rafa-run' });
    for (const name of ['inventory', 'board', 'pr', 'release']) {
      expect(placeFile(`packages/rafa-${name}/package.json`).package).toBe(`rafa-${name}`);
    }
    expect(placeFile('packages/rafa/src/index.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('packages/rafa-hub/src/bin.ts').package).toBe('rafa-hub');
    expect(findRuleProblems(CUT_RULES)).toEqual([]);
  });

  it('places a named file by name, against its folder: src/schema/ is split per file', () => {
    expect(placeFile('packages/rafa/src/schema/tiers.ts')).toEqual({ by: 'folder', folder: 'packages/rafa/', package: CORE_PACKAGE });
    expect(placeFile('packages/rafa/src/schema/project-id.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('packages/rafa/src/schema/frontmatter.ts')).toEqual({ by: 'folder', folder: 'packages/rafa/', package: CORE_PACKAGE });
    expect(placeFile('src/schema/agent.ts')).toEqual({ by: 'named', folder: undefined, package: CLI_PACKAGE });
    expect(placeFile('src/schema/skill.ts')).toEqual({ by: 'folder', folder: 'src/schema/', package: 'rafa-inventory' });
  });

  it('places the two report files in core and the third, moved in pass 4a, in rafa-inventory by its folder', () => {
    expect(placeFile('packages/rafa/src/report/parse.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('packages/rafa/src/report/record.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('packages/rafa-inventory/src/report/lessons.ts')).toEqual({ by: 'folder', folder: 'packages/rafa-inventory/', package: 'rafa-inventory' });
  });

  it('sends the test file of a named file where the named file goes', () => {
    expect(placeFile('src/schema/agent.test.ts')).toEqual({ by: 'named', folder: undefined, package: CLI_PACKAGE });
    expect(placeFile('packages/rafa/src/schema/frontmatter.test.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('src/schema/skill.test.ts').package).toBe('rafa-inventory');
  });

  it('places a test parked outside core\'s package by its own path, not where the file it tests went', () => {
    expect(placeFile('packages/rafa/src/schema/tiers.test.ts').package).toBe(CORE_PACKAGE);
    expect(placeFile('src/tests/core-coupled/report/parse.test.ts')).toEqual({ by: 'rest', folder: undefined, package: CLI_PACKAGE });
  });

  it('places the dispatcher, the bin entry and the roster in the CLI by rule', () => {
    expect(placeFile('src/cli/dispatch.ts')).toEqual({ by: 'folder', folder: 'src/cli/', package: CLI_PACKAGE });
    expect(placeFile('src/rafa.ts').by).toBe('named');
    expect(placeFile('src/commands/index.ts').by).toBe('named');
  });

  it('counts a file no rule holds as the CLI\'s, left to place', () => {
    expect(placeFile('src/utils/tracker.ts')).toEqual({ by: 'rest', folder: undefined, package: CLI_PACKAGE });
    expect(placeFile('src/commands/doctor.ts').by).toBe('rest');
    expect(placeFile('src/config-schema-planted.ts').by).toBe('rest');
  });

  it('places a file under an unassigned folder in no package', () => {
    expect(placeFile('src/stretch/prompt.ts')).toEqual({ by: 'unassigned', folder: 'src/stretch/', package: undefined });
    expect(placeFile('src/commands/stretch/start.ts').folder).toBe('src/commands/stretch/');
    expect(placeFile('src/ci/watch.ts').by).toBe('unassigned');
  });

  it('does not read src/commands/ci/ as the unassigned src/ci/', () => {
    expect(placeFile('src/commands/ci/watch.ts')).toEqual({ by: 'rest', folder: undefined, package: CLI_PACKAGE });
  });
});

describe('isClearedBySections', () => {
  it('holds for a section file imported from packages/rafa/src/core/config/ and for nothing else', () => {
    const cleared = (from: string, to: string): boolean => isClearedBySections({ from, kind: 'value', to });

    expect(cleared('packages/rafa/src/core/config/config-schema.ts', 'src/config-schema-planted.ts')).toBe(true);
    expect(cleared('packages/rafa/src/core/config/config-schema.ts', 'src/config-set.ts')).toBe(false);
    expect(cleared('packages/rafa/src/core/config/config-schema.ts', 'src/board/config-schema-hub.ts')).toBe(false);
    expect(cleared('packages/rafa/src/core/command/command.ts', 'src/config-schema-planted.ts')).toBe(false);
  });
});

describe('buildCutTable: upward edges', () => {
  it('counts an import from a lower package into a higher one on the package it leaves, value and type alike', () => {
    const table = buildCutTable(
      plant([
        ['packages/rafa/src/core/command/command.ts', 'packages/rafa-board/src/board/place.ts'],
        ['src/inventory/record.ts', 'src/release/settle.ts', 'type'],
        ['src/release/settle.ts', 'src/utils/tracker.ts'],
      ]),
    );

    expect(countsOf(table)).toEqual({
      '@open-tomato/rafa': 0,
      '@open-tomato/rafa-core': 1,
      'rafa-board': 0,
      'rafa-effort': 0,
      'rafa-eslint-config': 0,
      'rafa-hub': 0,
      'rafa-inventory': 1,
      'rafa-pr': 0,
      'rafa-release': 1,
      'rafa-run': 0,
      'rafa-sync-service': 0,
      'rafa-typescript-config': 0,
    });
    expect(rowOf(table, 'rafa-inventory').edges).toEqual([
      {
        from: 'src/inventory/record.ts',
        fromPackage: 'rafa-inventory',
        kind: 'type',
        to: 'src/release/settle.ts',
        toPackage: 'rafa-release',
      },
    ]);
    expect(table.totals.upwardEdges).toBe(3);
  });

  it('counts no import from a higher package into a lower one, and none inside one package', () => {
    const table = buildCutTable(
      plant([
        ['packages/rafa-board/src/board/place.ts', 'packages/rafa/src/core/command/index.ts'],
        ['packages/rafa-board/src/board/place.ts', 'packages/rafa-board/src/board/blocked.ts'],
        ['src/cli/dispatch.ts', 'src/utils/tracker.ts'],
      ]),
    );

    expect(table.totals.upwardEdges).toBe(0);
    expect(table.totals.nonTestEdges).toBe(3);
  });

  it('reads the order from the rules: the same edge is upward one way round and not the other', () => {
    const graph = plant([['low/a.ts', 'high/b.ts']]);
    const reversed: CutRules = { ...TWO_PACKAGES, packages: [...TWO_PACKAGES.packages].reverse() };

    expect(countsOf(buildCutTable(graph, TWO_PACKAGES))).toEqual({ high: 0, low: 1 });
    expect(countsOf(buildCutTable(graph, reversed))).toEqual({ high: 0, low: 0 });
  });

  it('leaves out an edge with a test file at either end, and keeps one that ends on a test-support file', () => {
    const table = buildCutTable(
      plant([
        ['packages/rafa/src/core/command/command.test.ts', 'packages/rafa-board/src/board/place.ts'],
        ['packages/rafa/src/core/command/command.ts', 'packages/rafa-board/src/board/place.test.ts'],
        ['packages/rafa-board/src/board/place.ts', 'src/tests/cli-capture.ts'],
      ]),
    );

    expect(table.totals.nonTestEdges).toBe(1);
    expect(rowOf(table, CORE_PACKAGE).upwardEdges).toBe(0);
    expect(rowOf(table, 'rafa-board').edges.map((edge) => edge.to)).toEqual(['src/tests/cli-capture.ts']);
  });

  it('sorts a package\'s edges by importer, then by target', () => {
    const table = buildCutTable(
      plant([
        ['packages/rafa/src/ports/index.ts', 'src/pr/types.ts'],
        ['packages/rafa/src/core/git/git.ts', 'src/pr/types.ts'],
        ['packages/rafa/src/core/git/git.ts', 'packages/rafa-board/src/board/trust.ts'],
      ]),
    );

    expect(rowOf(table, CORE_PACKAGE).edges.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      'packages/rafa/src/core/git/git.ts -> packages/rafa-board/src/board/trust.ts',
      'packages/rafa/src/core/git/git.ts -> src/pr/types.ts',
      'packages/rafa/src/ports/index.ts -> src/pr/types.ts',
    ]);
  });

  it('throws on an edge that names a file the graph holds no node for', () => {
    const graph: CutGraph = {
      edges: [{ from: 'packages/rafa-board/src/board/place.ts', kind: 'value', to: 'packages/rafa-board/src/board/gone.ts' }],
      nodes: [{ kind: 'source', path: 'packages/rafa-board/src/board/place.ts' }],
    };

    expect(() => buildCutTable(graph)).toThrow(
      'the edge packages/rafa-board/src/board/place.ts -> packages/rafa-board/src/board/gone.ts names packages/rafa-board/src/board/gone.ts, which is no node of the graph',
    );
  });

  it('throws on rules that hold a fault, before it counts anything', () => {
    const rules: CutRules = { ...TWO_PACKAGES, rest: 'nowhere' };

    expect(() => buildCutTable(plant([]), rules)).toThrow(
      'the cut rules do not hold: nowhere: the rest goes to a package that is not listed',
    );
  });
});

describe('buildCutTable: the edges issue 118 clears', () => {
  const table = buildCutTable(
    plant([
      ['packages/rafa/src/core/config/config-schema.ts', 'src/config-schema-planted.ts'],
      ['packages/rafa/src/core/config/config.ts', 'src/config-set.ts'],
      ['packages/rafa/src/core/command/command.ts', 'src/config-schema-planted.ts'],
      ['packages/rafa-board/src/board/place.ts', 'src/config-schema-planted.ts'],
      ['src/tests/core-coupled/core/config/config.test.ts', 'src/config-schema-planted.ts'],
      ['src/config-schema-planted.ts', 'packages/rafa/src/core/config/sections.ts'],
    ]),
  );

  it('marks the import of a section file from packages/rafa/src/core/config/ and no other upward edge', () => {
    expect(table.clearedByIssue118).toEqual([
      {
        clearedBy: SECTIONS_ISSUE,
        from: 'packages/rafa/src/core/config/config-schema.ts',
        fromPackage: CORE_PACKAGE,
        kind: 'value',
        to: 'src/config-schema-planted.ts',
        toPackage: CLI_PACKAGE,
      },
    ]);
    expect(SECTIONS_ISSUE).toBe(118);
    expect(rowOf(table, 'rafa-board').edges.every((edge) => edge.clearedBy === undefined)).toBe(true);
  });

  it('keeps a cleared edge in the count and takes it off the remaining ones', () => {
    const core = rowOf(table, CORE_PACKAGE);

    expect(core.upwardEdges).toBe(3);
    expect(core.clearedByIssue118).toBe(1);
    expect(core.remaining).toBe(2);
    expect(rowOf(table, 'rafa-board')).toMatchObject({ clearedByIssue118: 0, remaining: 1, upwardEdges: 1 });
    expect(table.totals).toMatchObject({ clearedByIssue118: 1, upwardEdges: 4 });
  });
});

describe('buildCutTable: files', () => {
  const table = buildCutTable(
    plant(
      [
        ['packages/rafa-board/src/board/place.ts', 'src/utils/tracker.ts'],
        ['src/pr/gh.ts', 'src/utils/tracker.ts'],
        ['src/cli/dispatch.ts', 'src/utils/git.ts'],
      ],
      [
        'src/utils/tracker.test.ts',
        'packages/rafa/src/report/parse.ts',
        'packages/rafa/src/report/parse.test.ts',
        'src/pr/gh-fake.ts',
        'src/pr/index.ts',
        'packages/rafa-board/src/board/project/rules.ts',
      ],
    ),
  );

  it('lists each package\'s files sorted, tests included, counted by kind and by folder', () => {
    expect(rowOf(table, 'rafa-pr')).toMatchObject({
      fileCounts: { source: 2, test: 0, testSupport: 1 },
      files: ['src/pr/gh-fake.ts', 'src/pr/gh.ts', 'src/pr/index.ts'],
      filesByFolder: { 'packages/rafa-pr/': 0, 'src/commands/pr/': 0, 'src/pr/': 2, 'src/triage/': 0 },
      folders: ['packages/rafa-pr/', 'src/commands/pr/', 'src/pr/', 'src/triage/'],
      named: [...PR_NAMED, 'src/pr/index.ts'],
      rank: 6,
    });
    expect(rowOf(table, CORE_PACKAGE).files).toEqual(['packages/rafa/src/report/parse.test.ts', 'packages/rafa/src/report/parse.ts']);
    expect(rowOf(table, 'rafa-board').filesByFolder).toMatchObject({ 'packages/rafa-board/': 2, 'src/board/': 0 });
  });

  it('lists the files no rule holds as left to place, each with the upward edges that end on it', () => {
    expect(table.leftToPlace).toEqual([
      { kind: 'source', path: 'src/utils/git.ts', upwardEdgesIn: 0 },
      { kind: 'test', path: 'src/utils/tracker.test.ts', upwardEdgesIn: 0 },
      { kind: 'source', path: 'src/utils/tracker.ts', upwardEdgesIn: 2 },
    ]);
    expect(table.totals.leftToPlace).toBe(3);
  });

  it('counts the files left to place as the CLI\'s, beside the ones it holds by rule', () => {
    expect(rowOf(table, CLI_PACKAGE).files).toEqual([
      'src/cli/dispatch.ts',
      'src/utils/git.ts',
      'src/utils/tracker.test.ts',
      'src/utils/tracker.ts',
    ]);
    expect(table.totals.files).toBe(11);
  });
});

describe('buildCutTable: unassigned folders', () => {
  const table = buildCutTable(
    plant(
      [
        ['src/stretch/run.ts', 'packages/rafa/src/core/command/index.ts'],
        ['src/stretch/run.ts', 'src/stretch/prompt.ts'],
        ['src/cli/dispatch.ts', 'src/stretch/run.ts'],
        ['src/commands/stretch/start.ts', 'src/stretch/run.ts'],
        ['packages/rafa/src/core/command/command.ts', 'src/ci/watch.ts'],
        ['src/stretch/run.test.ts', 'packages/rafa-board/src/board/place.ts'],
      ],
      ['src/ci/watch.test.ts'],
    ),
  );

  it('lists the three folders with their files, tests included', () => {
    expect(table.unassigned.map((entry) => [entry.folder, entry.files])).toEqual([
      ['src/ci/', ['src/ci/watch.test.ts', 'src/ci/watch.ts']],
      ['src/commands/stretch/', ['src/commands/stretch/start.ts']],
      ['src/stretch/', ['src/stretch/prompt.ts', 'src/stretch/run.test.ts', 'src/stretch/run.ts']],
    ]);
    expect(table.totals.unassignedFiles).toBe(6);
  });

  it('counts no edge that touches one as upward, not even one that leaves core', () => {
    expect(table.totals.upwardEdges).toBe(0);
    expect(rowOf(table, CORE_PACKAGE).upwardEdges).toBe(0);
  });

  it('counts each folder\'s edges by the package, or the other unassigned folder, at their other end', () => {
    const [ci, commandsStretch, stretch] = table.unassigned;

    expect(ci).toMatchObject({ importedBy: { [CORE_PACKAGE]: 1 }, importsFrom: {} });
    expect(commandsStretch).toMatchObject({ importedBy: {}, importsFrom: { 'src/stretch/': 1 } });
    expect(stretch).toMatchObject({
      importedBy: { [CLI_PACKAGE]: 1, 'src/commands/stretch/': 1 },
      importsFrom: { [CORE_PACKAGE]: 1 },
    });
    expect(table.totals.unrankedEdges).toBe(4);
  });

  it('keeps an unassigned file out of the files left to place and out of every package', () => {
    expect(table.leftToPlace).toEqual([]);
    expect(table.packages.flatMap((row) => row.files).filter((path) => path.includes('stretch'))).toEqual([]);
  });
});

describe('parseCutGraph', () => {
  it('reads the nodes and edges, and nothing else the graph file holds', () => {
    const text = JSON.stringify({
      betweenness: { 'src/a.ts': 1 },
      clusters: [],
      edges: [{ from: 'src/a.ts', kind: 'type', to: 'src/b.ts' }],
      nodes: [
        { cluster: 'c01-a', kind: 'source', path: 'src/a.ts' },
        { cluster: 'c01-a', kind: 'test-support', path: 'src/b.ts' },
      ],
    });

    expect(parseCutGraph(text)).toEqual({
      edges: [{ from: 'src/a.ts', kind: 'type', to: 'src/b.ts' }],
      nodes: [
        { kind: 'source', path: 'src/a.ts' },
        { kind: 'test-support', path: 'src/b.ts' },
      ],
    });
  });

  it('refuses a file with no nodes array or no edges array', () => {
    expect(() => parseCutGraph('{"nodes":[]}')).toThrow('the import graph holds no `nodes` array or no `edges` array');
    expect(() => parseCutGraph('[]')).toThrow('the import graph holds no `nodes` array or no `edges` array');
  });

  it('refuses a node with a kind it does not know, naming the node', () => {
    const text = JSON.stringify({ edges: [], nodes: [{ kind: 'fixture', path: 'src/a.ts' }] });

    expect(() => parseCutGraph(text)).toThrow(
      'node 0 of the import graph is not a path with a kind: {"kind":"fixture","path":"src/a.ts"}',
    );
  });

  it('refuses an edge with no kind, naming the edge', () => {
    const text = JSON.stringify({ edges: [{ from: 'src/a.ts', to: 'src/b.ts' }], nodes: [] });

    expect(() => parseCutGraph(text)).toThrow(
      'edge 0 of the import graph is not a from, a to and a kind: {"from":"src/a.ts","to":"src/b.ts"}',
    );
  });
});

describe('the two outputs', () => {
  const table = buildCutTable(
    plant([
      ['packages/rafa/src/core/config/config-schema.ts', 'src/config-schema-planted.ts'],
      ['packages/rafa-board/src/board/place.ts', 'src/utils/tracker.ts'],
      ['packages/rafa-board/src/board/place.ts', 'src/start/session.ts', 'type'],
      ['src/stretch/run.ts', 'packages/rafa-board/src/board/place.ts'],
    ]),
  );

  it('renders the JSON with the graph it was read from, twelve packages and an integer count on each', () => {
    const data = JSON.parse(renderCutTableJson(table)) as CutTable & { readonly graph: string };

    expect(data.graph).toBe('docs/survey/import-graph.json');
    expect(data.packages).toHaveLength(12);
    expect(data.packages.every((row) => Number.isInteger(row.upwardEdges))).toBe(true);
    expect(data.order).toEqual(CUT_RULES.packages.map((rule) => rule.name));
    expect(data.unassigned.map((entry) => entry.folder)).toEqual([...CUT_RULES.unassigned]);
    expect(data.clearedByIssue118.map((edge) => edge.clearedBy)).toEqual([118]);
  });

  it('renders the same bytes for the same table, ending in one newline', () => {
    const text = renderCutTableJson(table);

    expect(renderCutTableJson(table)).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('opens the markdown with the sums and says the counts do not certify a cut', () => {
    const lines = renderCutTableMarkdown(table).split('\n');

    expect(lines[0]).toBe('# Cut table');
    expect(lines[2]).toBe(
      'Read from `docs/survey/import-graph.json`: 6 files, 5 of them in 12 packages (2 left to place) and 1 in 3 '
      + 'unassigned folders. Of the 4 edges between two files neither of which is a test, value and type alike, 3 '
      + 'point upward, 1 of them cleared by #118, and 1 have an end in an unassigned folder and no rank.',
    );
    expect(lines).toContain(
      'The counts rank options. They do not certify a cut: `tsc --build` with project references is that gate (#807).',
    );
  });

  it('gives each package one row with its count, what #118 clears and what remains', () => {
    const lines = renderCutTableMarkdown(table).split('\n');

    expect(lines).toContain('| 3 | `@open-tomato/rafa-core` | 1 | 1 | 0 | 0 | 1 | 1 | 0 |');
    expect(lines).toContain('| 5 | `rafa-board` | 1 | 1 | 0 | 0 | 2 | 0 | 2 |');
    expect(lines).toContain('| 12 | `@open-tomato/rafa` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |');
    expect(lines.filter((line) => /^\| \d+ \| `/.test(line))).toHaveLength(12);
  });

  it('names the pairs of packages, the cleared edge, the folder left to place and the unassigned folder', () => {
    const lines = renderCutTableMarkdown(table).split('\n');

    expect(lines).toContain('| `rafa-board` | `rafa-run` | 1 |');
    expect(lines).toContain('| `rafa-board` | `@open-tomato/rafa` | 1 |');
    expect(lines).toContain('- `packages/rafa/src/core/config/config-schema.ts` imports `src/config-schema-planted.ts` (value)');
    expect(lines).toContain('| `src/utils/tracker.ts` | 1 | `@open-tomato/rafa` | left to place |');
    expect(lines).toContain('| `src/start/session.ts` | 1 | `rafa-run` | by rule |');
    expect(lines).toContain('| `src/utils/` | 1 | 1 | 1 |');
    expect(lines).toContain('| `src/stretch/` | 1 | `rafa-board` (1) | - |');
  });

  it('says so when #118 clears no edge', () => {
    const lines = renderCutTableMarkdown(buildCutTable(plant([['packages/rafa-board/src/board/place.ts', 'src/utils/tracker.ts']]))).split('\n');

    expect(lines.slice(lines.indexOf('## Edges #118 clears'), lines.indexOf('## Files left to place'))).toContain('None.');
  });

  it('opens no line with an issue number, which markdown lint reads as a heading with no space', () => {
    const lines = renderCutTableMarkdown(table).split('\n');

    expect(lines.filter((line) => /^#+[^#\s]/.test(line))).toEqual([]);
    expect(lines).toContain(
      'Issue #118 makes each package own its config section, so these imports of a section file from '
      + '`packages/rafa/src/core/config/` go with it.',
    );
  });
});

describe('main', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-cut-table-'));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads docs/survey/import-graph.json under the root and writes both outputs beside it', async () => {
    const graph = plant([
      ['packages/rafa/src/core/config/config-schema.ts', 'src/config-schema-planted.ts'],
      ['packages/rafa-board/src/board/place.ts', 'src/start/session.ts'],
    ]);
    mkdirSync(join(root, 'docs/survey'), { recursive: true });
    writeFileSync(join(root, GRAPH_PATH), JSON.stringify(graph));

    const written = await main(root);

    expect(written).toEqual(['docs/survey/cut-table.json', 'docs/survey/cut-table.md']);
    expect(readFileSync(join(root, 'docs/survey/cut-table.json'), 'utf8')).toBe(renderCutTableJson(buildCutTable(graph)));
    expect(readFileSync(join(root, 'docs/survey/cut-table.md'), 'utf8')).toBe(renderCutTableMarkdown(buildCutTable(graph)));
  });

  it('refuses to run where the graph file is missing, naming the script that writes it', async () => {
    let message = '';
    try {
      await main(root);
    } catch (err) {
      message = err instanceof Error
        ? err.message
        : String(err);
    }

    expect(message).toBe(
      `docs/survey/import-graph.json is missing under ${root}: run \`bun scripts/survey/import-graph.ts\` first`,
    );
  });
});
