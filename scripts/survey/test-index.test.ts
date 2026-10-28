import type { ImportEdge, ImportGraph } from './import-graph';
import type { IndexRules, TestIndex, TestIndexEntry, TestIndexInput } from './test-index';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { parseCutMap } from './cut-map';
import { CORE_PACKAGE } from './cut-table';
import {
  BASELINE_PATH,
  BIN_ENTRY,
  computeTestIndex,
  indexFolder,
  main,
  packageRules,
  readCommit,
  renderTestIndexJson,
} from './test-index';
import { renderTestIndexMarkdown } from './test-index-markdown';
import { meetsRule } from './test-index-record';

/** A graph over `files` with `value` edges `[from, to]`, every file read but `unread`. */
function plantedGraph(files: readonly string[], links: readonly (readonly [string, string])[], unread: readonly string[] = []): ImportGraph {
  const edges: ImportEdge[] = links.map(([from, to]) => ({ from, kind: 'value', to }));
  return {
    edges,
    nodes: [...files].sort(),
    read: files.filter((path) => !unread.includes(path)).sort(),
    unreached: [...unread].sort(),
    unresolved: [],
  };
}

/** The entry of one test, failing the test when it is missing. */
function entryOf(index: TestIndex, test: string): TestIndexEntry {
  const entry = index.tests.find((item) => item.test === test);
  if (entry === undefined) {
    throw new Error(`no entry for ${test}`);
  }
  return entry;
}

const NEAR = 'src/near/near.ts';
const FAR = 'src/far/far.ts';
const LEAF = 'src/near/leaf.ts';
const FAKE = 'src/near/gh-fake.ts';
const HELPER = 'src/tests/helper.ts';
const SPAWN_HELPER = 'src/tests/spawn-helper.ts';

const PLAIN = 'src/near/plain.test.ts';
const SPAWNING = 'src/near/spawning.test.ts';
const VIA_HELPER = 'src/near/via-helper.test.ts';
const MENTIONS = 'src/near/mentions.test.ts';
const TYPE_ONLY = 'src/near/type-only.test.ts';
const THROUGH_SUPPORT = 'src/tests/through-support.test.ts';
const DIRECT_FAR = 'src/tests/direct-far.test.ts';
const UNREAD = 'src/far/unread.test.ts';

/** Every test reaches `near.ts`, which imports `far.ts`; they differ in how they spawn and what they pass through. */
function plantedInput(): TestIndexInput {
  const sources = new Map<string, string>([
    [PLAIN, 'import { n } from \'./near.js\';\n'],
    [SPAWNING, 'import { n } from \'./near.js\';\nBun.spawnSync([\'git\', \'init\']);\n'],
    [VIA_HELPER, 'import { run } from \'../tests/spawn-helper.js\';\n'],
    [MENTIONS, '/** Unlike its peers, this never calls Bun.spawn. */\nconst note = \'Bun.spawnSync\';\n'],
    [TYPE_ONLY, 'import type { ChildProcess } from \'node:child_process\';\nimport { type SpawnOptions } from \'node:child_process\';\n'],
    [SPAWN_HELPER, 'import { execFileSync } from \'node:child_process\';\n'],
    [THROUGH_SUPPORT, 'import { h } from \'./helper.js\';\nimport { l } from \'../near/leaf.js\';\n'],
    [HELPER, 'import { f } from \'../far/far.js\';\n'],
    [DIRECT_FAR, 'import { f } from \'../far/far.js\';\n'],
    // The fake spawns, but nothing reaches it from a test: it doubles no index.
    [FAKE, 'Bun.spawn([\'gh\']);\n'],
    // A source file that spawns is the code under test: it doubles no index either.
    [FAR, 'Bun.spawn([\'git\']);\n'],
  ]);
  const graph = plantedGraph(
    [NEAR, FAR, LEAF, FAKE, HELPER, SPAWN_HELPER, PLAIN, SPAWNING, VIA_HELPER, MENTIONS, TYPE_ONLY, THROUGH_SUPPORT, DIRECT_FAR, UNREAD],
    [
      [NEAR, FAR],
      [PLAIN, NEAR],
      [SPAWNING, NEAR],
      [VIA_HELPER, SPAWN_HELPER],
      [SPAWN_HELPER, NEAR],
      [MENTIONS, NEAR],
      [TYPE_ONLY, NEAR],
      [THROUGH_SUPPORT, HELPER],
      [THROUGH_SUPPORT, LEAF],
      [HELPER, FAR],
      [DIRECT_FAR, FAR],
    ],
    [UNREAD],
  );
  return { graph, sources };
}

function plantedIndex(): TestIndex {
  return computeTestIndex(plantedInput());
}

describe('a spawning test', () => {
  const index = plantedIndex();

  it('has its index doubled against a test reaching the same folders without spawning', () => {
    expect(entryOf(index, PLAIN)).toMatchObject({ folders: ['src/far', 'src/near'], index: 2, spawns: false, spawnsVia: [] });
    expect(entryOf(index, SPAWNING)).toMatchObject({ folders: ['src/far', 'src/near'], index: 4, spawns: true, spawnsVia: [SPAWNING] });
  });

  it('spawns through a support file it reaches, which is named as the spawner', () => {
    expect(entryOf(index, VIA_HELPER)).toMatchObject({ index: 0, spawnsVia: [SPAWN_HELPER], support: [SPAWN_HELPER] });
    // Its folders come only through the helper, so they are listed apart and the doubled count is zero.
    expect(entryOf(index, VIA_HELPER).supportFolders).toEqual(['src/far', 'src/near']);
  });

  it('does not spawn by naming a spawn call in a comment or a string, or by a type-only import', () => {
    expect(entryOf(index, MENTIONS)).toMatchObject({ index: 2, spawns: false });
    expect(entryOf(index, TYPE_ONLY)).toMatchObject({ index: 2, spawns: false });
  });
});

describe('a test reaching a folder only through support files', () => {
  const index = plantedIndex();

  it('keeps the folder apart, out of its index', () => {
    expect(entryOf(index, THROUGH_SUPPORT)).toMatchObject({
      folders: ['src/near'],
      index: 1,
      support: [HELPER],
      supportFolders: ['src/far'],
    });
  });

  it('counts the folder when another test reaches it directly, the control', () => {
    expect(entryOf(index, DIRECT_FAR)).toMatchObject({ folders: ['src/far'], index: 1, supportFolders: [] });
  });

  it('lists the test under the source file as support-only, not as reaching it', () => {
    const far = index.sources.find((source) => source.source === FAR);
    expect(far?.tests).toEqual([MENTIONS, PLAIN, SPAWNING, TYPE_ONLY, DIRECT_FAR]);
    expect(far?.supportOnlyTests).toEqual([VIA_HELPER, THROUGH_SUPPORT]);
    expect(far?.testsFromOtherFolders).toBe(5);
  });

  it('leaves support files and fakes out of the source files', () => {
    expect(index.sources.map((source) => source.source)).toEqual([FAR, LEAF, NEAR]);
  });
});

describe('the outputs', () => {
  const index = plantedIndex();
  const tracked = plantedGraph([NEAR, FAR, LEAF, FAKE, HELPER, SPAWN_HELPER, PLAIN, SPAWNING, VIA_HELPER, MENTIONS, TYPE_ONLY,
    THROUGH_SUPPORT, DIRECT_FAR, UNREAD], []).nodes;

  it('names a test with no recorded imports as unindexed and not read', () => {
    expect(index.unindexed).toEqual([UNREAD]);
    expect(index.tests.some((entry) => entry.test === UNREAD)).toBe(false);
    const markdown = renderTestIndexMarkdown(index, tracked);
    expect(markdown).toContain(`Coverage: 13 of 14 tracked files read (src/ and packages/*/src/). Not read: \`${UNREAD}\`.`);
    expect(markdown).toContain('## Unindexed tests');
  });

  it('ranks the highest index first and the most-reached source file first', () => {
    const markdown = renderTestIndexMarkdown(index, tracked);
    const rows = markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line));
    expect(rows[0]).toBe(`| 1 | \`${SPAWNING}\` | 4 | 2 | \`${SPAWNING}\` | - |`);
    expect(rows.at(-2)).toBe(`| 1 | \`${FAR}\` | 5 | 5 | 2 |`);
    // `near.ts` is reached only from its own folder, so it is left out.
    expect(rows.at(-1)).toBe(`| 2 | \`${LEAF}\` | 1 | 1 | 0 |`);
  });

  it('writes JSON keyed by path with every key sorted, equal on a second run', () => {
    const json = renderTestIndexJson(index);
    const parsed = JSON.parse(json) as { sources: Record<string, unknown>; tests: Record<string, { index: number }> };
    expect(Object.keys(parsed)).toEqual(['sources', 'tests', 'unindexed']);
    expect(parsed.tests[SPAWNING]?.index).toBe(4);
    expect(Object.keys(parsed.sources)).toEqual([FAR, LEAF, NEAR]);
    expect(renderTestIndexJson(plantedIndex())).toBe(json);
  });

  it('counts a package as one folder', () => {
    expect(indexFolder('packages/rafa-hub/src/store/rows.ts')).toBe('packages/rafa-hub');
    expect(indexFolder('src/effort/store/rows.ts')).toBe('src/effort/store');
  });
});

describe('the index in projected packages', () => {
  const COMMAND = 'src/commands/run.ts';
  const FRESH_CLI = 'src/cli/fresh.ts';
  const FEATURE = 'src/feature/f.ts';
  const ONE = 'src/a/one.ts';
  const TWO = 'src/b/two.ts';
  const THREE = 'src/c/three.ts';
  const KEPT = 'src/split/kept.ts';
  const MOVED = 'src/split/moved.ts';
  const STRAY = 'src/stray/stray.ts';
  const LOOSE = 'src/stray/loose.ts';
  const THREE_TEST = 'src/a/three.test.ts';
  const SPLIT_TEST = 'src/split/split.test.ts';
  const SPAWNS = 'src/feature/spawns.test.ts';
  const QUIET = 'src/feature/quiet.test.ts';
  const STRAY_TEST = 'src/stray/stray.test.ts';

  // Three folders in `rafa-three`, `src/split/` cut across `rafa-three` and `rafa-other`, and `src/stray/` listed nowhere.
  const map = parseCutMap(JSON.stringify({
    packages: [
      { files: [BIN_ENTRY, COMMAND], name: 'rafa-cli' },
      { files: [FEATURE, SPAWNS, QUIET], name: 'rafa-feature' },
      { files: [ONE, TWO, THREE, THREE_TEST, KEPT, SPLIT_TEST], name: 'rafa-three' },
      { files: [MOVED], name: 'rafa-other' },
    ],
    unassigned: [{ files: [], folder: 'src/ci/' }],
  }), 'cut-table.json');
  const linked = plantedGraph(
    [BIN_ENTRY, COMMAND, FRESH_CLI, FEATURE, ONE, TWO, THREE, KEPT, MOVED, STRAY, LOOSE, THREE_TEST, SPLIT_TEST, SPAWNS, QUIET, STRAY_TEST],
    [
      [BIN_ENTRY, COMMAND],
      [BIN_ENTRY, FRESH_CLI],
      [THREE_TEST, ONE],
      [THREE_TEST, TWO],
      [THREE_TEST, THREE],
      [SPLIT_TEST, KEPT],
      [SPLIT_TEST, MOVED],
      [SPAWNS, FEATURE],
      [SPAWNS, ONE],
      [QUIET, FEATURE],
      [STRAY_TEST, STRAY],
    ],
  );
  // The command reaches the feature by a type-only import: the bin's walk follows it as the index's walk does.
  const graph = { ...linked, edges: [...linked.edges, { from: COMMAND, kind: 'type' as const, to: FEATURE }] };
  const input: TestIndexInput = { graph, sources: new Map([[SPAWNS, 'Bun.spawnSync([\'rafa\', \'start\']);\n']]) };
  const rules = packageRules(map, graph);
  const packaged = computeTestIndex(input, rules);
  const surveyed = computeTestIndex(input);

  it('reads each file as the map\'s unit, sets none aside, and walks the bin for the spawned reach', () => {
    for (const path of [BIN_ENTRY, KEPT, MOVED, THREE_TEST, STRAY, 'src/nowhere.ts']) {
      expect(rules.folderOf(path)).toBe(map.unitOf(path));
    }
    expect(rules.folderOf(KEPT)).toBe('rafa-three');
    expect(rules.folderOf(STRAY)).toBeUndefined();
    expect(rules.setsAside(COMMAND)).toBe(false);
    // `rafa-three` holds files no path from the bin reaches, so it is not loaded: the control for the walk.
    expect(rules.spawnedReach).toEqual(['rafa-cli', 'rafa-feature']);
    expect(rules.spawnedUnplaced).toEqual([FRESH_CLI]);
  });

  it('refuses a graph with no bin entry to walk from', () => {
    const headless = plantedGraph([ONE, THREE_TEST], [[THREE_TEST, ONE]]);
    expect(() => packageRules(map, headless)).toThrow(`the bin entry ${BIN_ENTRY} is not a file of the import graph`);
  });

  it('counts three folders in one package once, so the index falls', () => {
    expect(entryOf(surveyed, THREE_TEST)).toMatchObject({ folders: ['src/a', 'src/b', 'src/c'], index: 3 });
    expect(entryOf(packaged, THREE_TEST)).toMatchObject({ folder: 'rafa-three', folders: ['rafa-three'], index: 1 });
  });

  it('counts one folder cut across two packages twice, so the index rises', () => {
    expect(entryOf(surveyed, SPLIT_TEST)).toMatchObject({ folders: ['src/split'], index: 1 });
    expect(entryOf(packaged, SPLIT_TEST)).toMatchObject({ folders: ['rafa-other', 'rafa-three'], index: 2 });
  });

  it('gives a spawning test the bin\'s packages beside its own instead of doubling', () => {
    expect(entryOf(packaged, SPAWNS)).toMatchObject({
      folders: ['rafa-cli', 'rafa-feature', 'rafa-three'],
      index: 3,
      spawns: true,
      spawnsVia: [SPAWNS],
    });
    // The bin's feature is the test's own: counted once, not twice.
    expect(entryOf(packaged, SPAWNS).folders.filter((unit) => unit === 'rafa-feature')).toHaveLength(1);
    // A test that does not spawn is not given the reach.
    expect(entryOf(packaged, QUIET)).toMatchObject({ folders: ['rafa-feature'], index: 1, spawns: false });
  });

  it('doubles as today when the rules carry no reach, the control', () => {
    const unreached: IndexRules = { folderOf: rules.folderOf, setsAside: rules.setsAside };
    expect(entryOf(computeTestIndex(input, unreached), SPAWNS)).toMatchObject({ folders: ['rafa-feature', 'rafa-three'], index: 4 });
    expect(entryOf(surveyed, SPAWNS)).toMatchObject({ folders: ['src/a', 'src/feature'], index: 4 });
  });

  it('names each test file, reached source file and loaded bin file the map holds no unit for', () => {
    // `loose.ts` is listed nowhere either, but nothing reaches it.
    expect(packaged.unplaced).toEqual([FRESH_CLI, STRAY_TEST, STRAY]);
    expect(entryOf(packaged, STRAY_TEST)).toMatchObject({ folder: undefined, folders: [], index: 0 });
    expect(packaged.sources.find((source) => source.source === STRAY)?.folder).toBeUndefined();
    // With no test spawning, nothing loads the bin, so its unplaced file is not reached.
    expect(computeTestIndex({ graph, sources: new Map() }, rules).unplaced).toEqual([STRAY_TEST, STRAY]);
    expect(surveyed.unplaced).toEqual([]);
  });
});

describe('the core type-only rule in projected packages', () => {
  const CORE = 'packages/rafa/src/schema/core.ts';
  const OWN = 'src/feature/own.ts';
  const OTHER = 'src/other/other.ts';
  const TYPED_CORE = 'src/feature/typed-core.test.ts';
  const VALUED_CORE = 'src/feature/valued-core.test.ts';
  const TYPED_OTHER = 'src/feature/typed-other.test.ts';
  const map = parseCutMap(JSON.stringify({
    packages: [
      { files: [CORE], name: CORE_PACKAGE },
      { files: [BIN_ENTRY, OWN, TYPED_CORE, VALUED_CORE, TYPED_OTHER], name: 'rafa-feature' },
      { files: [OTHER], name: 'rafa-other' },
    ],
    unassigned: [],
  }), 'cut-table.json');
  const linked = plantedGraph(
    [BIN_ENTRY, CORE, OWN, OTHER, TYPED_CORE, VALUED_CORE, TYPED_OTHER],
    [[BIN_ENTRY, OWN], [TYPED_CORE, OWN], [VALUED_CORE, OWN], [VALUED_CORE, CORE], [TYPED_OTHER, OWN]],
  );
  const typed = [[BIN_ENTRY, CORE], [TYPED_CORE, CORE], [TYPED_OTHER, OTHER]] as const;
  const graph = { ...linked, edges: [...linked.edges, ...typed.map(([from, to]) => ({ from, kind: 'type' as const, to }))] };
  const input: TestIndexInput = { graph, sources: new Map() };
  const rules = packageRules(map, graph);
  const ruled = computeTestIndex(input, rules);
  // The control: the same graph read with the rule removed.
  const unruled = computeTestIndex(input, { ...rules, follows: undefined });
  const meetsUnitRule = (entry: TestIndexEntry): boolean => meetsRule({
    deep: [],
    kind: 'unit',
    package: entry.folder ?? '',
    packages: entry.folders,
    spawns: entry.spawns,
    spawnsVia: entry.spawnsVia,
  });

  it('does not follow a type edge into core: the test reaches its own unit alone and meets the unit rule', () => {
    expect(entryOf(ruled, TYPED_CORE)).toMatchObject({ folder: 'rafa-feature', folders: ['rafa-feature'], index: 1, sourceFiles: 1 });
    expect(meetsUnitRule(entryOf(ruled, TYPED_CORE))).toBe(true);
    expect(ruled.sources.find((source) => source.source === CORE)?.tests).toEqual([VALUED_CORE]);
  });

  it('counts core for the type edge once the rule is removed, the control', () => {
    expect(entryOf(unruled, TYPED_CORE)).toMatchObject({ folders: [CORE_PACKAGE, 'rafa-feature'], index: 2, sourceFiles: 2 });
    expect(meetsUnitRule(entryOf(unruled, TYPED_CORE))).toBe(false);
    expect(unruled.sources.find((source) => source.source === CORE)?.tests).toEqual([TYPED_CORE, VALUED_CORE]);
  });

  it('follows a value edge into core, with the rule and without it', () => {
    expect(entryOf(ruled, VALUED_CORE)).toMatchObject({ folders: [CORE_PACKAGE, 'rafa-feature'], index: 2 });
    expect(entryOf(unruled, VALUED_CORE)).toEqual(entryOf(ruled, VALUED_CORE));
  });

  it('follows a type edge into another package, with the rule and without it', () => {
    expect(entryOf(ruled, TYPED_OTHER)).toMatchObject({ folders: ['rafa-feature', 'rafa-other'], index: 2 });
    expect(entryOf(unruled, TYPED_OTHER)).toEqual(entryOf(ruled, TYPED_OTHER));
  });

  it('keys on the edge\'s kind and its target\'s unit, and leaves the bin\'s type edge into core in the spawned reach', () => {
    expect(rules.follows?.({ from: TYPED_CORE, kind: 'type', to: CORE })).toBe(false);
    expect(rules.follows?.({ from: TYPED_CORE, kind: 'value', to: CORE })).toBe(true);
    expect(rules.follows?.({ from: TYPED_OTHER, kind: 'type', to: OTHER })).toBe(true);
    expect(rules.spawnedReach).toEqual([CORE_PACKAGE, 'rafa-feature']);
  });
});

/** Runs git in a scratch repository, fails the test on a non-zero exit, and returns what it printed. */
function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** The git options a scratch commit is made under, whatever the machine's own configuration. */
const IDENTITY = ['-c', 'user.name=survey', '-c', 'user.email=survey@example.invalid', '-c', 'commit.gpgsign=false'];

describe('a real bun build over a scratch repository', () => {
  let root = '';
  const files: Record<string, string> = {
    'packages/hub/src/rows.ts': 'export const rows = 1;\n',
    'src/a/barrel.test.ts': 'import { expect, it } from \'bun:test\';\nimport { x } from \'../barrel/index.js\';\n'
      + 'it(\'x\', () => expect(x).toBe(1));\n',
    'src/a/plain.test.ts': 'import { expect, it } from \'bun:test\';\nimport { y } from \'../star/y.js\';\n'
      + 'it(\'y\', () => expect(y).toBe(2));\n',
    'src/barrel/index.ts': 'export { x } from \'../deep/x.js\';\nexport * from \'../star/y.js\';\n'
      + 'export type { T } from \'../types/t.js\';\nexport { rows } from \'../../packages/hub/src/rows.js\';\n',
    'src/deep/x.ts': 'export const x = 1;\n',
    'src/star/y.ts': 'export const y = 2;\n',
    'src/types/t.ts': 'export type T = number;\n',
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-test-index-'));
    git(root, ['init', '--quiet']);
    for (const [path, text] of Object.entries(files)) {
      plant(root, path, text);
    }
    git(root, ['add', '--', ...Object.keys(files)]);
    plant(root, 'src/a/untracked.test.ts', 'import { x } from \'../deep/x.js\';\n');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('counts each folder a test reaches through a re-export, and writes both outputs byte-identical twice', async () => {
    expect(await main(root)).toEqual(['docs/survey/test-index.json', 'docs/survey/test-index.md']);
    const json = readFileSync(join(root, 'docs/survey/test-index.json'), 'utf8');
    const markdown = readFileSync(join(root, 'docs/survey/test-index.md'), 'utf8');
    const parsed = JSON.parse(json) as { tests: Record<string, { folders: string[]; index: number }> };
    // `x` is named, `y` comes by `export *`, `T` by `export type`, `rows` from a package: each folder counts.
    expect(parsed.tests['src/a/barrel.test.ts']).toMatchObject({
      folders: ['packages/hub', 'src/barrel', 'src/deep', 'src/star', 'src/types'],
      index: 5,
    });
    // The control: a test importing one file directly reaches its folder alone.
    expect(parsed.tests['src/a/plain.test.ts']).toMatchObject({ folders: ['src/star'], index: 1 });
    expect(markdown).toContain('Coverage: 7 of 7 tracked files read (src/ and packages/*/src/).');
    expect(json).not.toContain('untracked.test.ts');
    await main(root);
    expect(readFileSync(join(root, 'docs/survey/test-index.json'), 'utf8')).toBe(json);
    expect(readFileSync(join(root, 'docs/survey/test-index.md'), 'utf8')).toBe(markdown);
  });
});

/** The map a scratch repository of the record and the guard is read by. */
const SCRATCH_MAP = 'docs/survey/cut-table.json';

/**
 * A scratch repository's files in scope: the bin, a test of its own unit,
 * and a second unit no test reaches yet.
 */
const SCRATCH_FILES: Readonly<Record<string, string>> = {
  'src/a/one.test.ts': 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n'
    + 'it(\'x\', () => expect(x).toBe(1));\n',
  'src/deep/x.ts': 'export const x = 1;\n',
  'src/far/y.ts': 'export const y = 2;\n',
  'src/rafa.ts': 'import { x } from \'./deep/x.js\';\nexport const bin = x;\n',
};

/**
 * The cut table the scratch repositories plant: the bin, its test and
 * `fresh.test.ts`, listed before it is written, in `@scratch/cli`, and
 * `y.ts` alone in `@scratch/far`. `untracked.test.ts`, `stray.test.ts`
 * and `stray/z.ts` are listed nowhere; the two under `src/stray/` stay
 * unplaced, since no listed file sits beside them and no row names a
 * folder.
 */
const SCRATCH_TABLE = `${JSON.stringify({
  packages: [
    { files: ['src/a/fresh.test.ts', 'src/a/one.test.ts', 'src/deep/x.ts', 'src/rafa.ts'], name: '@scratch/cli' },
    { files: ['src/far/y.ts'], name: '@scratch/far' },
  ],
  unassigned: [],
}, null, 2)}\n`;

/**
 * Plants a scratch repository of the record and the guard: the files in
 * scope, the cut table, a root manifest with no workspace member, and a
 * file out of scope, all staged and none committed.
 *
 * @param prefix - The temp folder's prefix.
 * @param files - The files in scope, by path; the unit test and its sources unless handed.
 * @param table - The cut table's text; {@link SCRATCH_TABLE} unless handed.
 * @returns The repository's root.
 */
function plantScratch(prefix: string, files: Readonly<Record<string, string>> = SCRATCH_FILES, table: string = SCRATCH_TABLE): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ['init', '--quiet']);
  for (const [path, text] of Object.entries(files)) {
    plant(root, path, text);
  }
  plant(root, SCRATCH_MAP, table);
  plant(root, 'package.json', '{ "name": "scratch", "private": true, "workspaces": [] }\n');
  plant(root, 'README.md', 'A file out of scope.\n');
  git(root, ['add', '-A']);
  return root;
}

/** The record mode of a scratch repository, its map passed relative to the root. */
const RECORD_MODE = { baseline: true, map: SCRATCH_MAP } as const;

describe('the record mode over a scratch repository', () => {
  let root = '';
  let head = '';

  beforeAll(() => {
    root = plantScratch('survey-test-index-record-');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('refuses a repository with no commit to name', async () => {
    await expect(main(root, RECORD_MODE)).rejects.toThrow('git rev-parse --verify HEAD^{commit} failed');
    expect(existsSync(join(root, BASELINE_PATH))).toBe(false);
  });

  it('writes the record alone, its header first, naming HEAD and the map\'s hash, byte-identical twice', async () => {
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    head = git(root, ['rev-parse', 'HEAD']).trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(await main(root, RECORD_MODE)).toEqual(['docs/survey/test-index.baseline.json']);
    const json = readFileSync(join(root, BASELINE_PATH), 'utf8');
    const sha256 = new Bun.CryptoHasher('sha256').update(SCRATCH_TABLE)
      .digest('hex');
    expect(json.split('\n')[1]).toBe('  "unit": "packages",');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['unit', 'map', 'commit', 'binReach', 'tests', 'unsorted', 'unindexed']);
    expect(parsed).toEqual({
      binReach: ['@scratch/cli'],
      commit: head,
      map: { path: SCRATCH_MAP, sha256 },
      tests: {
        'src/a/one.test.ts': {
          deep: [],
          kind: 'unit',
          meets: true,
          package: '@scratch/cli',
          packages: ['@scratch/cli'],
          spawns: false,
          spawnsVia: [],
        },
      },
      unindexed: [],
      unit: 'packages',
      unsorted: [],
    });
    // The survey's two files are another mode's: this one leaves them unwritten.
    expect(existsSync(join(root, 'docs/survey/test-index.json'))).toBe(false);
    expect(existsSync(join(root, 'docs/survey/test-index.md'))).toBe(false);
    await main(root, RECORD_MODE);
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(json);
  });

  it('reads past a change out of scope, an untracked file and its own output', () => {
    plant(root, 'README.md', 'Changed, and still out of scope.\n');
    plant(root, 'src/a/untracked.test.ts', 'import { y } from \'../far/y.js\';\n');
    expect(readCommit(root)).toBe(head);
  });

  it('refuses when a tracked file in scope differs from HEAD, unstaged or staged, and leaves the record as it was', async () => {
    const before = readFileSync(join(root, BASELINE_PATH), 'utf8');
    plant(root, 'src/a/one.test.ts', 'import { y } from \'../far/y.js\';\n');
    await expect(main(root, RECORD_MODE)).rejects.toThrow(`1 tracked file(s) in scope differ from ${head}: src/a/one.test.ts`);
    git(root, ['add', '--', 'src/a/one.test.ts', 'src/a/untracked.test.ts']);
    expect(() => readCommit(root)).toThrow(`2 tracked file(s) in scope differ from ${head}: src/a/one.test.ts, src/a/untracked.test.ts`);
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(before);
  });

  it('refuses naming each file the map places in no unit, a test and the source file it reaches, and leaves the record as it was', async () => {
    const before = readFileSync(join(root, BASELINE_PATH), 'utf8');
    git(root, ['reset', '--quiet', '--hard', 'HEAD']);
    plant(root, 'src/stray/stray.test.ts', 'import { z } from \'./z.js\';\n');
    plant(root, 'src/stray/z.ts', 'export const z = 3;\n');
    git(root, ['add', '-A']);
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'stray']);
    const refusal = 'test-index: 2 file(s) the map docs/survey/cut-table.json places in no unit, by listing or by folder:\n'
      + '  src/stray/stray.test.ts\n  src/stray/z.ts\ntest-index: no record was written';
    await expect(main(root, RECORD_MODE)).rejects.toThrow(refusal);
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(before);
  });
});

/** Runs the script itself in `root` with `args`, and returns its exit code and what it printed. */
function runScript(root: string, args: readonly string[]): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'test-index.ts'), ...args], {
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString(), stdout: result.stdout.toString() };
}

/** Runs the guard in `root` against `record`, the map passed beside it. */
function runGuard(root: string, record: string): { exitCode: number; stderr: string; stdout: string } {
  return runScript(root, [`--against=${record}`, `--map=${SCRATCH_MAP}`]);
}

describe('the guard over a scratch repository', () => {
  let root = '';
  let head = '';

  beforeAll(async () => {
    root = plantScratch('survey-test-index-guard-');
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    head = git(root, ['rev-parse', 'HEAD']).trim();
    await main(root, RECORD_MODE);
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('exits 0 on the tree the record was taken from, and writes nothing', () => {
    const record = readFileSync(join(root, BASELINE_PATH), 'utf8');
    const run = runGuard(root, BASELINE_PATH);
    expect(run.stdout).toBe(
      `test-index: 1 test file(s) held to ${BASELINE_PATH}, taken at commit ${head} on ${SCRATCH_MAP}: `
      + '0 risen, 0 sorted, 0 unsorted (0 widened), 1 held, 0 new\n'
      + 'test-index: 0 gone, 0 not read, 0 unindexed still, 0 unplaced\n',
    );
    expect(run).toMatchObject({ exitCode: 0, stderr: '' });
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(record);
    expect(git(root, ['status', '--porcelain', '--', 'src'])).toBe('');
  });

  it('exits 1 naming a unit test that reaches a second unit, and reads an untracked test meeting its rule as new', () => {
    plant(root, 'src/a/one.test.ts', 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n'
      + 'import { y } from \'../far/y.js\';\nit(\'x\', () => expect(x + y).toBe(3));\n');
    plant(root, 'src/a/fresh.test.ts', 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n'
      + 'it(\'x\', () => expect(x).toBe(1));\n');
    const run = runGuard(root, BASELINE_PATH);
    expect(run.stdout.split('\n')).toEqual([
      `test-index: 2 test file(s) held to ${BASELINE_PATH}, taken at commit ${head} on ${SCRATCH_MAP}: `
      + '1 risen, 0 sorted, 0 unsorted (0 widened), 0 held, 1 new',
      'test-index: 0 gone, 0 not read, 0 unindexed still, 0 unplaced',
      '',
      'Risen, the test does not meet its rule and is not on the unsorted list (1):',
      '  src/a/one.test.ts (unit test in @scratch/cli): reaches @scratch/far beyond its own unit',
      '',
      'New, not in the record and meeting its rule (1):',
      '  src/a/fresh.test.ts',
      '',
    ]);
    expect(run).toMatchObject({ exitCode: 1, stderr: '' });
    git(root, ['checkout', '--quiet', '--', 'src/a/one.test.ts']);
    rmSync(join(root, 'src/a/fresh.test.ts'));
  });

  it('exits 1 naming each file the map places in no unit, with no test risen', () => {
    plant(root, 'src/stray/stray.test.ts', 'import { z } from \'./z.js\';\n');
    plant(root, 'src/stray/z.ts', 'export const z = 3;\n');
    const run = runGuard(root, BASELINE_PATH);
    expect(run.stdout.split('\n')).toEqual([
      `test-index: 1 test file(s) held to ${BASELINE_PATH}, taken at commit ${head} on ${SCRATCH_MAP}: `
      + '0 risen, 0 sorted, 0 unsorted (0 widened), 1 held, 0 new',
      'test-index: 0 gone, 0 not read, 0 unindexed still, 1 unplaced',
      '',
      `test-index: 2 file(s) the map ${SCRATCH_MAP} places in no unit, by listing or by folder:`,
      '  src/stray/stray.test.ts',
      '  src/stray/z.ts',
      '',
    ]);
    expect(run).toMatchObject({ exitCode: 1, stderr: '' });
    rmSync(join(root, 'src/stray'), { force: true, recursive: true });
  });

  it('exits 1 with the reason when the record is missing, is not one, or is the folder-unit baseline', () => {
    const missing = runGuard(root, 'docs/survey/absent.json');
    expect(missing).toMatchObject({ exitCode: 1, stdout: '' });
    // The folder is left out: the script names it by its own working directory, which a symlinked temp folder spells otherwise.
    expect(missing.stderr).toStartWith('cannot read the record: no file at ');
    expect(missing.stderr).toEndWith('docs/survey/absent.json\n');
    const wrong = runGuard(root, 'src/deep/x.ts');
    expect(wrong).toMatchObject({ exitCode: 1, stdout: '' });
    expect(wrong.stderr).toStartWith('not a test-index record: ');
    plant(root, 'docs/survey/folders.json', '{ "commit": "abc123", "tests": {}, "unindexed": [] }\n');
    expect(runGuard(root, 'docs/survey/folders.json')).toMatchObject({
      exitCode: 1,
      stderr: 'not a test-index record: it holds no `unit`\n',
      stdout: '',
    });
  });
});

describe('the guard over a scratch repository, header refusals', () => {
  let root = '';
  let record = '';
  let sha256 = '';

  beforeAll(async () => {
    root = plantScratch('survey-test-index-header-');
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    await main(root, RECORD_MODE);
    record = readFileSync(join(root, BASELINE_PATH), 'utf8');
    sha256 = new Bun.CryptoHasher('sha256').update(SCRATCH_TABLE)
      .digest('hex');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('refuses a record in unit folders, naming both units', () => {
    expect(record).toContain('  "unit": "packages",');
    plant(root, 'docs/survey/folders-record.json', record.replace('"unit": "packages"', '"unit": "folders"'));
    const run = runGuard(root, 'docs/survey/folders-record.json');
    expect(run.stdout).toContain('test-index: the record\'s unit is folders; the guard reads packages\n');
    expect(run).toMatchObject({ exitCode: 1, stderr: '' });
  });

  it('refuses a table edited after the record, naming both hashes', () => {
    const edited = `${SCRATCH_TABLE}\n`;
    const editedSha256 = new Bun.CryptoHasher('sha256').update(edited)
      .digest('hex');
    plant(root, SCRATCH_MAP, edited);
    const run = runGuard(root, BASELINE_PATH);
    expect(run.stdout).toContain(
      `test-index: the record was taken on ${SCRATCH_MAP} at sha256 ${sha256}; the map handed is ${SCRATCH_MAP} at sha256 ${editedSha256}\n`,
    );
    expect(run).toMatchObject({ exitCode: 1, stderr: '' });
    plant(root, SCRATCH_MAP, SCRATCH_TABLE);
    expect(runGuard(root, BASELINE_PATH).exitCode).toBe(0);
  });

  it('refuses --baseline without --map, writing no record', () => {
    const run = runScript(root, ['--baseline']);
    expect(run).toMatchObject({ exitCode: 1, stdout: '' });
    expect(run.stderr).toStartWith('--baseline reads the map: pass --map=<file> beside it');
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(record);
  });
});

describe('the guard over a scratch repository, a use-case test', () => {
  const useCase = 'src/a/flow-integration.test.ts';
  const header = 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n';
  const footer = 'it(\'x\', () => expect(x).toBe(1));\n';
  let root = '';

  beforeAll(async () => {
    const table = `${JSON.stringify({
      packages: [
        { files: [useCase, 'src/deep/x.ts', 'src/rafa.ts'], name: '@scratch/cli' },
        { files: ['src/far/y.ts'], name: '@scratch/far' },
      ],
      unassigned: [],
    }, null, 2)}\n`;
    root = plantScratch('survey-test-index-usecase-', {
      ...SCRATCH_FILES,
      [useCase]: header + footer,
      // The escalation template names the -integration spelling that makes
      // the file a use-case test; the section's own default is empty.
      '.rafa/config.yaml': 'templates: [escalation]\n',
    }, table);
    git(root, ['rm', '--quiet', '--cached', '--', 'src/a/one.test.ts']);
    rmSync(join(root, 'src/a/one.test.ts'));
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    await main(root, RECORD_MODE);
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('exits 0 on the tree it was recorded from', () => {
    expect(runGuard(root, BASELINE_PATH)).toMatchObject({ exitCode: 0, stderr: '' });
  });

  it('exits 1 naming the test that gains a deep import into another unit', () => {
    plant(root, useCase, `${header}import { y } from '../far/y.js';\n${footer}`);
    const run = runGuard(root, BASELINE_PATH);
    expect(run.stdout).toContain('1 risen');
    expect(run.stdout).toContain(`  ${useCase} (use-case test in @scratch/cli): enters another unit through no public entry by `);
    expect(run.stdout).toContain('../far/y.js');
    expect(run).toMatchObject({ exitCode: 1, stderr: '' });
  });
});
