import type { CoreMove } from './core-moves';
import type { ImportEdge, ImportGraph } from './import-graph';
import type { BaselineComparison, TestIndex, TestIndexEntry, TestIndexInput } from './test-index';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { CORE_PACKAGE, CORE_PARKED_TESTS, CORE_SOURCE } from './core-moves';
import {
  BASELINE_PATH,
  CORE_PACKAGE_UNIT,
  CORE_TEST_PREFIXES,
  against,
  compareToBaseline,
  computeTestIndex,
  coreRules,
  holdsBaseline,
  indexFolder,
  main,
  parseBaseline,
  parseMode,
  pathBeforePackage,
  readCommit,
  renderComparison,
  renderTestIndexBaselineJson,
  renderTestIndexJson,
  renderTestIndexMarkdown,
  spawnApis,
} from './test-index';

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

  it('reads each way of spawning from a parse', () => {
    expect(spawnApis('a.ts', 'Bun.spawn([]);\nBun.spawnSync([]);\nawait Bun.$`ls`;\n')).toEqual(['Bun.$', 'Bun.spawn', 'Bun.spawnSync']);
    expect(spawnApis('a.ts', 'import { $ } from \'bun\';\nimport { spawn } from \'child_process\';\n')).toEqual(['$ from bun', 'child_process']);
    expect(spawnApis('a.mjs', 'import * as cp from \'node:child_process\';\n')).toEqual(['node:child_process']);
    expect(spawnApis('a.ts', 'import { file } from \'bun\';\nimport { type $ } from \'bun\';\n')).toEqual([]);
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

describe('the baseline', () => {
  const index = plantedIndex();

  it('names the commit read beside each test\'s index and what it was counted from', () => {
    const parsed = JSON.parse(renderTestIndexBaselineJson(index, 'abc123')) as {
      commit: string;
      tests: Record<string, unknown>;
      unindexed: string[];
    };
    expect(Object.keys(parsed)).toEqual(['commit', 'tests', 'unindexed']);
    expect(parsed.commit).toBe('abc123');
    expect(parsed.tests[SPAWNING]).toEqual({ folders: ['src/far', 'src/near'], index: 4, spawns: true, spawnsVia: [SPAWNING] });
    expect(parsed.tests[THROUGH_SUPPORT]).toEqual({ folders: ['src/near'], index: 1, spawns: false, spawnsVia: [] });
    expect(Object.keys(parsed.tests)).toEqual(index.tests.map((entry) => entry.test));
    expect(parsed.unindexed).toEqual([UNREAD]);
  });

  it('differs by the commit alone when the index is the same', () => {
    const first = renderTestIndexBaselineJson(index, 'abc123');
    expect(renderTestIndexBaselineJson(plantedIndex(), 'abc123')).toBe(first);
    expect(renderTestIndexBaselineJson(index, 'def456')).toBe(first.replace('abc123', 'def456'));
  });

  it('is picked by --baseline alone, and any other argument is refused', () => {
    expect(parseMode([])).toBe('survey');
    expect(parseMode(['--baseline'])).toBe('baseline');
    expect(() => parseMode(['--base'])).toThrow('unknown arguments: --base.');
    expect(() => parseMode(['--baseline', '--baseline'])).toThrow('unknown arguments');
  });
});

describe('the rules of the comparison', () => {
  const BARREL = 'src/core/config/index.ts';
  const UNLISTED_INDEX = 'src/core/loop/index.ts';
  const CONFIG = 'src/core/config/config.ts';
  const SESSIONS = 'src/core/loop/sessions.ts';
  const SECTION = 'src/sections/hub.ts';
  const OUTSIDE = 'src/near/outside.test.ts';
  const INSIDE = 'src/core/config/config.test.ts';
  const DEEP = 'src/near/deep.test.ts';
  const THROUGH_INDEX = 'src/near/through-index.test.ts';
  const input: TestIndexInput = {
    graph: plantedGraph(
      [BARREL, UNLISTED_INDEX, CONFIG, SESSIONS, SECTION, NEAR, SPAWN_HELPER, OUTSIDE, INSIDE, DEEP, THROUGH_INDEX],
      [
        [BARREL, CONFIG],
        [UNLISTED_INDEX, SESSIONS],
        [CONFIG, SECTION],
        [OUTSIDE, BARREL],
        [OUTSIDE, NEAR],
        [INSIDE, CONFIG],
        [INSIDE, SESSIONS],
        [DEEP, CONFIG],
        [DEEP, SPAWN_HELPER],
        [THROUGH_INDEX, UNLISTED_INDEX],
      ],
    ),
    sources: new Map([
      // A barrel that spawns is a source file still: it doubles no index. The helper is the control.
      [BARREL, 'Bun.spawn([\'git\']);\nexport * from \'./config.js\';\n'],
      [SPAWN_HELPER, 'import { execFileSync } from \'node:child_process\';\n'],
    ]),
  };
  const held = computeTestIndex(input, coreRules([BARREL]));
  const surveyed = computeTestIndex(input);

  it('stop the walk at a core barrel, which is reached, not counted, and listed with what lies behind it', () => {
    expect(entryOf(held, OUTSIDE)).toMatchObject({
      folders: ['src/near'],
      index: 1,
      spawns: false,
      support: [BARREL],
      supportFolders: ['src/core', 'src/sections'],
    });
    // The control: the survey's rules walk on through the same file and count every folder behind it.
    expect(entryOf(surveyed, OUTSIDE)).toMatchObject({ folders: ['src/core/config', 'src/near', 'src/sections'], index: 3, support: [] });
  });

  it('count src/core/ as one folder, whatever the subject folders reached', () => {
    expect(entryOf(held, INSIDE)).toMatchObject({ folder: 'src/core', folders: ['src/core', 'src/sections'], index: 2 });
    expect(entryOf(surveyed, INSIDE)).toMatchObject({
      folder: 'src/core/config',
      folders: ['src/core/config', 'src/core/loop', 'src/sections'],
      index: 3,
    });
  });

  it('count a deep import and walk past it, and double the index for a support file that spawns', () => {
    expect(entryOf(held, DEEP)).toMatchObject({ folders: ['src/core', 'src/sections'], index: 4, spawnsVia: [SPAWN_HELPER] });
  });

  it('set aside the listed barrels alone: any other index file under src/core/ is counted and walked past', () => {
    expect(entryOf(held, THROUGH_INDEX)).toMatchObject({ folders: ['src/core'], index: 1, support: [] });
    const all = computeTestIndex(input, coreRules([BARREL, UNLISTED_INDEX]));
    expect(entryOf(all, THROUGH_INDEX)).toMatchObject({ folders: [], index: 0, support: [UNLISTED_INDEX] });
  });

  it('leave the index of a tree with no src/core/ as the survey counts it', () => {
    expect(computeTestIndex(plantedInput(), coreRules())).toEqual(plantedIndex());
  });

  it('count every file under the package source as the package, src/core/ included once it lies there', () => {
    const today = coreRules([]);
    expect(today.folderOf(`${CORE_SOURCE}effort/store/settings.ts`)).toBe(CORE_PACKAGE_UNIT);
    expect(today.folderOf(`${CORE_SOURCE}report/parse.ts`)).toBe(CORE_PACKAGE_UNIT);
    expect(today.folderOf('src/core/config/config.ts')).toBe('src/core');
    expect(today.folderOf('src/effort/store/settings.ts')).toBe('src/effort/store');
    // After the flip, src/core/ lies under the package: the package is read first, so it is not a unit of its own.
    const moved = coreRules([], `${CORE_SOURCE}core/`);
    expect(moved.folderOf(`${CORE_SOURCE}core/config/config.ts`)).toBe(CORE_PACKAGE_UNIT);
    expect(moved.folderOf('src/core/config/config.ts')).toBe('src/core/config');
    expect(CORE_PACKAGE_UNIT).toBe('packages/rafa');
  });
});

describe('the comparison against a baseline', () => {
  const X = 'src/deep/x.ts';
  const MATE = 'src/deep/mate.ts';
  const Y = 'src/far/y.ts';
  const CORE_X = 'src/core/plan/x.ts';
  const BARREL = 'src/core/plan/index.ts';
  const EQUAL = 'src/a/equal.test.ts';
  const RISES = 'src/a/rises.test.ts';
  const FALLS = 'src/a/falls.test.ts';
  const SPAWNS_LATER = 'src/a/spawns-later.test.ts';
  const DROPPED = 'src/a/dropped.test.ts';
  const FRESH = 'src/a/fresh.test.ts';
  const UNREAD_LATER = 'src/a/unread-later.test.ts';
  const MOVED = 'src/deep/x.test.ts';
  const MOVED_FROM_MATE = 'src/deep/x-mate.test.ts';
  const MOVED_TO = 'src/core/plan/x.test.ts';
  const MOVED_FROM_MATE_TO = 'src/core/plan/x-mate.test.ts';
  const moves: readonly CoreMove[] = [{ from: X, subject: 'plan', tests: [MOVED_FROM_MATE, MOVED], to: CORE_X }];

  const before = computeTestIndex({
    graph: plantedGraph(
      [X, MATE, Y, EQUAL, RISES, FALLS, SPAWNS_LATER, DROPPED, UNREAD_LATER, MOVED, MOVED_FROM_MATE],
      [
        [EQUAL, Y],
        [RISES, Y],
        [FALLS, X],
        [FALLS, Y],
        [SPAWNS_LATER, Y],
        [DROPPED, Y],
        [UNREAD_LATER, Y],
        [MOVED, X],
        [MOVED_FROM_MATE, X],
        [MOVED_FROM_MATE, MATE],
      ],
    ),
    sources: new Map(),
  });
  const baseline = parseBaseline(renderTestIndexBaselineJson(before, 'abc123'));

  // `x.ts` has moved behind a barrel with its two tests; `mate.ts` stays, and one moved test still reaches it.
  const after = computeTestIndex(
    {
      graph: plantedGraph(
        [CORE_X, BARREL, MATE, Y, EQUAL, RISES, FALLS, SPAWNS_LATER, FRESH, UNREAD_LATER, MOVED_TO, MOVED_FROM_MATE_TO],
        [
          [BARREL, CORE_X],
          [EQUAL, Y],
          [RISES, Y],
          [RISES, MATE],
          [FALLS, BARREL],
          [FALLS, Y],
          [SPAWNS_LATER, Y],
          [FRESH, Y],
          [FRESH, MATE],
          [UNREAD_LATER, Y],
          [MOVED_TO, CORE_X],
          [MOVED_FROM_MATE_TO, CORE_X],
          [MOVED_FROM_MATE_TO, MATE],
        ],
        [UNREAD_LATER],
      ),
      sources: new Map([[SPAWNS_LATER, 'Bun.spawnSync([\'git\', \'init\']);\n']]),
    },
    coreRules([BARREL]),
  );
  const comparison = compareToBaseline(after, baseline, moves);

  it('names a risen test file with both indexes and the folder it gained', () => {
    expect(comparison.risen.find((change) => change.test === RISES)).toEqual({
      after: 2,
      baselineTest: RISES,
      before: 1,
      gained: ['src/deep'],
      lost: [],
      spawnsSince: [],
      test: RISES,
    });
    expect(holdsBaseline(comparison)).toBe(false);
  });

  it('names a test file as risen when it starts to spawn over the same folders', () => {
    expect(comparison.risen.find((change) => change.test === SPAWNS_LATER)).toMatchObject({
      after: 2,
      before: 1,
      gained: [],
      spawnsSince: [SPAWNS_LATER],
    });
  });

  it('holds an equal test file, and one whose index fell behind a barrel', () => {
    expect(comparison.equal.map((change) => change.test)).toEqual([EQUAL, MOVED_TO]);
    expect(comparison.fallen).toEqual([
      { after: 1, baselineTest: FALLS, before: 2, gained: [], lost: ['src/deep'], spawnsSince: [], test: FALLS },
    ]);
  });

  it('follows a moved test file to the entry under its old path, equal when it reaches src/core/ alone', () => {
    expect(comparison.equal.find((change) => change.test === MOVED_TO)).toEqual({
      after: 1,
      baselineTest: MOVED,
      before: 1,
      gained: ['src/core'],
      lost: ['src/deep'],
      spawnsSince: [],
      test: MOVED_TO,
    });
  });

  it('names a moved test file as risen when it still reaches the folder it left', () => {
    expect(comparison.risen.map((change) => change.test)).toEqual([RISES, SPAWNS_LATER, MOVED_FROM_MATE_TO]);
    expect(comparison.risen.find((change) => change.test === MOVED_FROM_MATE_TO)).toMatchObject({
      after: 2,
      baselineTest: MOVED_FROM_MATE,
      before: 1,
      gained: ['src/core'],
      lost: [],
    });
  });

  it('reads a moved test file as new and its old path as gone without the list of moves, the control', () => {
    const unfollowed = compareToBaseline(after, baseline, []);
    expect(unfollowed.added).toEqual([FRESH, MOVED_FROM_MATE_TO, MOVED_TO]);
    expect(unfollowed.gone).toEqual([DROPPED, MOVED_FROM_MATE, MOVED]);
    expect(unfollowed.risen.map((change) => change.test)).toEqual([RISES, SPAWNS_LATER]);
  });

  it('names a new test file apart, held to nothing whatever its index', () => {
    expect(entryOf(after, FRESH).index).toBe(2);
    expect(comparison.added).toEqual([FRESH]);
    expect(holdsBaseline({ ...comparison, risen: [], unread: [] })).toBe(true);
  });

  it('names a baseline entry no test file answers as gone, which fails nothing', () => {
    expect(comparison.gone).toEqual([DROPPED]);
    expect(holdsBaseline({ ...comparison, added: [], risen: [], unread: [] })).toBe(true);
  });

  it('fails on a test file the baseline indexed and nothing read now', () => {
    expect(comparison.unread).toEqual([UNREAD_LATER]);
    expect(holdsBaseline({ ...comparison, risen: [] })).toBe(false);
  });

  it('holds a tree compared with its own baseline, every test file equal', () => {
    const same: BaselineComparison = compareToBaseline(before, baseline, moves);
    expect(same).toMatchObject({ added: [], commit: 'abc123', fallen: [], gone: [], risen: [], unread: [] });
    expect(same.equal).toHaveLength(before.tests.length);
    expect(holdsBaseline(same)).toBe(true);
  });

  it('prints the counts, each risen test file with what it gained, and the others by name', () => {
    expect(renderComparison(comparison, 'base.json').split('\n')).toEqual([
      'test-index: 6 test file(s) held to base.json, read at commit abc123: 3 risen, 2 equal, 1 fallen',
      'test-index: 1 new, 1 gone, 1 not read',
      '',
      'Risen, the index is above the baseline (3):',
      `  ${RISES}: 1 -> 2 (gained src/deep)`,
      `  ${SPAWNS_LATER}: 1 -> 2 (now spawns via ${SPAWNS_LATER})`,
      `  ${MOVED_FROM_MATE_TO} (in the baseline as ${MOVED_FROM_MATE}): 1 -> 2 (gained src/core)`,
      '',
      'Not read, the baseline holds an index and bun build reached no imports now (1):',
      `  ${UNREAD_LATER}`,
      '',
      'New, the baseline holds no index and nothing is held (1):',
      `  ${FRESH}`,
      '',
      'Gone, no test file answers the baseline entry (1):',
      `  ${DROPPED}`,
    ]);
    const same = renderComparison(compareToBaseline(before, baseline, moves), 'base.json');
    expect(same.split('\n')).toEqual([
      'test-index: 8 test file(s) held to base.json, read at commit abc123: 0 risen, 8 equal, 0 fallen',
      'test-index: 0 new, 0 gone, 0 not read',
    ]);
  });

  it('is picked by --against=<baseline> alone, with a path', () => {
    expect(parseMode(['--against=docs/survey/test-index.baseline.json'])).toEqual({ against: 'docs/survey/test-index.baseline.json' });
    expect(() => parseMode(['--against='])).toThrow('unknown arguments: --against=.');
    expect(() => parseMode(['--against'])).toThrow('unknown arguments: --against.');
    expect(() => parseMode(['--baseline', '--against=a.json'])).toThrow('unknown arguments');
  });

  it('refuses a text that is not a baseline', () => {
    expect(() => parseBaseline('not json')).toThrow('not a test-index baseline');
    expect(() => parseBaseline('[]')).toThrow('it must hold a commit, tests keyed by path, and unindexed');
    expect(() => parseBaseline('{"commit":"abc","tests":{}}')).toThrow('it must hold a commit');
    expect(() => parseBaseline('{"commit":"abc","tests":{"a.test.ts":{"folders":[],"index":1.5,"spawns":false,"spawnsVia":[]}},"unindexed":[]}'))
      .toThrow('tests["a.test.ts"] must hold folders, a whole index, spawns and spawnsVia');
    expect(() => parseBaseline('{"commit":"abc","tests":{"a.test.ts":{"index":1}},"unindexed":[]}')).toThrow('tests["a.test.ts"]');
  });
});

describe('the comparison once core is its package', () => {
  const X = 'src/deep/x.ts';
  const MATE = 'src/deep/mate.ts';
  const Y = 'src/far/y.ts';
  const STORE = 'src/effort/store/s.ts';
  const PORT = 'src/ports/p.ts';
  const MOVED = 'src/deep/x.test.ts';
  const MOVED_MATE = 'src/deep/x-mate.test.ts';
  const STORE_TEST = 'src/effort/store/s.test.ts';
  const COUPLED = 'src/effort/store/c.test.ts';
  const moves: readonly CoreMove[] = [{ from: X, subject: 'plan', tests: [MOVED_MATE, MOVED], to: 'src/core/plan/x.ts' }];

  const PKG_X = `${CORE_SOURCE}core/plan/x.ts`;
  const PKG_STORE = `${CORE_SOURCE}effort/store/s.ts`;
  const PKG_PORT = `${CORE_SOURCE}ports/p.ts`;
  const MOVED_NOW = `${CORE_SOURCE}core/plan/x.test.ts`;
  const MATE_PARKED = `${CORE_PARKED_TESTS}core/plan/x-mate.test.ts`;
  const STORE_TEST_NOW = `${CORE_SOURCE}effort/store/s.test.ts`;
  const COUPLED_PARKED = `${CORE_PARKED_TESTS}effort/store/c.test.ts`;
  const ELSEWHERE = 'packages/other/src/effort/store/s.test.ts';

  const before = computeTestIndex({
    graph: plantedGraph(
      [X, MATE, Y, STORE, PORT, MOVED, MOVED_MATE, STORE_TEST, COUPLED],
      [
        [MOVED, X],
        [MOVED, PORT],
        [MOVED_MATE, X],
        [MOVED_MATE, Y],
        [STORE_TEST, STORE],
        [STORE_TEST, PORT],
        [COUPLED, STORE],
        [COUPLED, Y],
      ],
    ),
    sources: new Map(),
  });
  const baseline = parseBaseline(renderTestIndexBaselineJson(before, 'abc123'));

  // `x.ts` has moved into `src/core/`, and the package holds it, the store and the ports; two tests wait parked outside it.
  const after = computeTestIndex(
    {
      graph: plantedGraph(
        [PKG_X, PKG_STORE, PKG_PORT, MATE, Y, MOVED_NOW, MATE_PARKED, STORE_TEST_NOW, COUPLED_PARKED, ELSEWHERE],
        [
          [MOVED_NOW, PKG_X],
          [MOVED_NOW, PKG_PORT],
          [MATE_PARKED, PKG_X],
          [MATE_PARKED, Y],
          [MATE_PARKED, MATE],
          [STORE_TEST_NOW, PKG_STORE],
          [STORE_TEST_NOW, PKG_PORT],
          [COUPLED_PARKED, PKG_STORE],
          [COUPLED_PARKED, Y],
          [ELSEWHERE, PKG_STORE],
        ],
      ),
      sources: new Map(),
    },
    coreRules([], `${CORE_SOURCE}core/`),
  );
  const comparison = compareToBaseline(after, baseline, moves);

  it('brings a path under the package source or the parked tests back to src/, and leaves any other', () => {
    expect(CORE_TEST_PREFIXES).toEqual([CORE_SOURCE, CORE_PARKED_TESTS]);
    expect(pathBeforePackage(STORE_TEST_NOW)).toBe(STORE_TEST);
    expect(pathBeforePackage(COUPLED_PARKED)).toBe(COUPLED);
    expect(pathBeforePackage(MOVED_NOW)).toBe('src/core/plan/x.test.ts');
    expect(pathBeforePackage(ELSEWHERE)).toBe(ELSEWHERE);
    expect(pathBeforePackage(`${CORE_PACKAGE}build.test.ts`)).toBe(`${CORE_PACKAGE}build.test.ts`);
    expect(pathBeforePackage(STORE_TEST)).toBe(STORE_TEST);
  });

  it('counts the package once for a test inside it, whatever folders of the package it reaches', () => {
    expect(entryOf(after, STORE_TEST_NOW)).toMatchObject({ folder: CORE_PACKAGE_UNIT, folders: [CORE_PACKAGE_UNIT], index: 1 });
    expect(entryOf(after, MOVED_NOW)).toMatchObject({ folder: CORE_PACKAGE_UNIT, folders: [CORE_PACKAGE_UNIT], index: 1 });
  });

  it('holds a package test under its path brought back to src/, fallen when the store and the ports are one folder', () => {
    expect(comparison.fallen.find((change) => change.test === STORE_TEST_NOW)).toEqual({
      after: 1,
      baselineTest: STORE_TEST,
      before: 2,
      gained: [CORE_PACKAGE_UNIT],
      lost: ['src/effort/store', 'src/ports'],
      spawnsSince: [],
      test: STORE_TEST_NOW,
    });
  });

  it('holds a parked test under its path brought back to src/', () => {
    expect(comparison.equal.find((change) => change.test === COUPLED_PARKED)).toMatchObject({
      after: 2,
      baselineTest: COUPLED,
      before: 2,
    });
  });

  it('follows a package or parked test brought back to src/ on to the path the moves took it from', () => {
    expect(comparison.fallen.find((change) => change.test === MOVED_NOW)).toMatchObject({ after: 1, baselineTest: MOVED, before: 2 });
    // The parked mate still reaches the folder its file left, so it rises, held to the entry under its old path.
    expect(comparison.risen).toEqual([
      { after: 3, baselineTest: MOVED_MATE, before: 2, gained: [CORE_PACKAGE_UNIT], lost: [], spawnsSince: [], test: MATE_PARKED },
    ]);
    expect(comparison).toMatchObject({ added: [ELSEWHERE], gone: [], unread: [] });
  });

  it('reads a test brought back to a moved path as new without the list of moves, the control', () => {
    const unfollowed = compareToBaseline(after, baseline, []);
    expect(unfollowed.added).toEqual([ELSEWHERE, MOVED_NOW, MATE_PARKED].sort());
    expect(unfollowed.gone).toEqual([MOVED_MATE, MOVED]);
    // The prefix rule needs no list: the store and parked tests are held still.
    expect([...unfollowed.equal, ...unfollowed.fallen].map((change) => change.baselineTest).sort()).toEqual([COUPLED, STORE_TEST]);
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

describe('the baseline mode over a scratch repository', () => {
  let root = '';
  let head = '';
  const files: Record<string, string> = {
    'src/a/one.test.ts': 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n'
      + 'it(\'x\', () => expect(x).toBe(1));\n',
    'src/deep/x.ts': 'export const x = 1;\n',
    'src/far/y.ts': 'export const y = 2;\n',
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-test-index-baseline-'));
    git(root, ['init', '--quiet']);
    for (const [path, text] of Object.entries(files)) {
      plant(root, path, text);
    }
    plant(root, 'README.md', 'A file out of scope.\n');
    git(root, ['add', '-A']);
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('refuses a repository with no commit to name', async () => {
    await expect(main(root, 'baseline')).rejects.toThrow('git rev-parse --verify HEAD^{commit} failed');
    expect(existsSync(join(root, BASELINE_PATH))).toBe(false);
  });

  it('writes the baseline alone, naming HEAD, byte-identical twice', async () => {
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    head = git(root, ['rev-parse', 'HEAD']).trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(await main(root, 'baseline')).toEqual(['docs/survey/test-index.baseline.json']);
    const json = readFileSync(join(root, BASELINE_PATH), 'utf8');
    expect(JSON.parse(json)).toEqual({
      commit: head,
      tests: { 'src/a/one.test.ts': { folders: ['src/deep'], index: 1, spawns: false, spawnsVia: [] } },
      unindexed: [],
    });
    // The survey's two files are another mode's: this one leaves them unwritten.
    expect(existsSync(join(root, 'docs/survey/test-index.json'))).toBe(false);
    expect(existsSync(join(root, 'docs/survey/test-index.md'))).toBe(false);
    await main(root, 'baseline');
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(json);
  });

  it('reads past a change out of scope, an untracked file and its own output', () => {
    plant(root, 'README.md', 'Changed, and still out of scope.\n');
    plant(root, 'src/a/untracked.test.ts', 'import { y } from \'../far/y.js\';\n');
    expect(readCommit(root)).toBe(head);
  });

  it('refuses when a tracked file in scope differs from HEAD, unstaged or staged, and leaves the baseline as it was', async () => {
    const before = readFileSync(join(root, BASELINE_PATH), 'utf8');
    plant(root, 'src/a/one.test.ts', 'import { y } from \'../far/y.js\';\n');
    await expect(main(root, 'baseline')).rejects.toThrow(`1 tracked file(s) in scope differ from ${head}: src/a/one.test.ts`);
    git(root, ['add', '--', 'src/a/one.test.ts', 'src/a/untracked.test.ts']);
    expect(() => readCommit(root)).toThrow(`2 tracked file(s) in scope differ from ${head}: src/a/one.test.ts, src/a/untracked.test.ts`);
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(before);
  });
});

/** Runs the script itself in `root` with `--against=<baseline>` and returns its exit code and what it printed. */
function runAgainst(root: string, baseline: string): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'test-index.ts'), `--against=${baseline}`], {
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString(), stdout: result.stdout.toString() };
}

describe('the comparing mode over a scratch repository', () => {
  let root = '';
  let head = '';
  // `src/pr/git.ts` and its test are a move `core-moves.ts` lists, to `src/core/git/`, behind the barrel `index.ts`.
  const files: Record<string, string> = {
    'src/a/one.test.ts': 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n'
      + 'it(\'x\', () => expect(x).toBe(1));\n',
    'src/deep/x.ts': 'export const x = 1;\n',
    'src/far/y.ts': 'export const y = 2;\n',
    'src/pr/git.test.ts': 'import { expect, it } from \'bun:test\';\nimport { git } from \'./git.js\';\n'
      + 'it(\'git\', () => expect(git).toBe(3));\n',
    'src/pr/git.ts': 'export const git = 3;\n',
    'src/pr/merge.test.ts': 'import { expect, it } from \'bun:test\';\nimport { merge } from \'./merge.js\';\n'
      + 'it(\'merge\', () => expect(merge).toBe(3));\n',
    'src/pr/merge.ts': 'import { git } from \'./git.js\';\nexport const merge = git;\n',
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-test-index-against-'));
    git(root, ['init', '--quiet']);
    for (const [path, text] of Object.entries(files)) {
      plant(root, path, text);
    }
    git(root, ['add', '-A']);
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    head = git(root, ['rev-parse', 'HEAD']).trim();
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('exits 0 on the tree the baseline was read from, and writes nothing', async () => {
    await main(root, 'baseline');
    const baseline = readFileSync(join(root, BASELINE_PATH), 'utf8');
    const run = runAgainst(root, BASELINE_PATH);
    expect(run.stdout).toBe(
      `test-index: 3 test file(s) held to ${BASELINE_PATH}, read at commit ${head}: 0 risen, 3 equal, 0 fallen\n`
      + 'test-index: 0 new, 0 gone, 0 not read\n',
    );
    expect(run).toMatchObject({ exitCode: 0, stderr: '' });
    expect(readFileSync(join(root, BASELINE_PATH), 'utf8')).toBe(baseline);
    expect(git(root, ['status', '--porcelain', '--', 'src'])).toBe('');
    expect(existsSync(join(root, 'docs/survey/test-index.json'))).toBe(false);
  });

  it('holds a moved test file under its old path, and a test file that reaches the moved file through its barrel', async () => {
    mkdirSync(join(root, 'src/core/git'), { recursive: true });
    git(root, ['mv', 'src/pr/git.ts', 'src/core/git/git.ts']);
    git(root, ['mv', 'src/pr/git.test.ts', 'src/core/git/git.test.ts']);
    // The barrel is untracked, as a move task leaves it until the loop commits.
    plant(root, 'src/core/git/index.ts', 'export { git } from \'./git.js\';\n');
    plant(root, 'src/pr/merge.ts', 'import { git } from \'../core/git/index.js\';\nexport const merge = git;\n');
    const comparison = await against(root, join(root, BASELINE_PATH));
    expect(comparison).toMatchObject({ added: [], commit: head, fallen: [], gone: [], risen: [], unread: [] });
    expect(comparison.equal).toEqual([
      { after: 1, baselineTest: 'src/a/one.test.ts', before: 1, gained: [], lost: [], spawnsSince: [], test: 'src/a/one.test.ts' },
      {
        after: 1,
        baselineTest: 'src/pr/git.test.ts',
        before: 1,
        gained: ['src/core'],
        lost: ['src/pr'],
        spawnsSince: [],
        test: 'src/core/git/git.test.ts',
      },
      { after: 1, baselineTest: 'src/pr/merge.test.ts', before: 1, gained: [], lost: [], spawnsSince: [], test: 'src/pr/merge.test.ts' },
    ]);
  });

  it('names a test file as risen when the import goes deeper than the barrel, the control', async () => {
    plant(root, 'src/pr/merge.ts', 'import { git } from \'../core/git/git.js\';\nexport const merge = git;\n');
    const comparison = await against(root, BASELINE_PATH);
    expect(comparison.risen).toEqual([
      { after: 2, baselineTest: 'src/pr/merge.test.ts', before: 1, gained: ['src/core'], lost: [], spawnsSince: [], test: 'src/pr/merge.test.ts' },
    ]);
    plant(root, 'src/pr/merge.ts', 'import { git } from \'../core/git/index.js\';\nexport const merge = git;\n');
    expect((await against(root, BASELINE_PATH)).risen).toEqual([]);
  });

  it('exits 1 naming the risen test file, and reads an untracked test file as new', () => {
    plant(root, 'src/a/one.test.ts', 'import { expect, it } from \'bun:test\';\nimport { x } from \'../deep/x.js\';\n'
      + 'import { y } from \'../far/y.js\';\nit(\'x\', () => expect(x + y).toBe(3));\n');
    plant(root, 'src/a/fresh.test.ts', 'import { expect, it } from \'bun:test\';\nimport { y } from \'../far/y.js\';\n'
      + 'it(\'y\', () => expect(y).toBe(2));\n');
    const run = runAgainst(root, BASELINE_PATH);
    expect(run.stdout.split('\n')).toEqual([
      `test-index: 3 test file(s) held to ${BASELINE_PATH}, read at commit ${head}: 1 risen, 2 equal, 0 fallen`,
      'test-index: 1 new, 0 gone, 0 not read',
      '',
      'Risen, the index is above the baseline (1):',
      '  src/a/one.test.ts: 1 -> 2 (gained src/far)',
      '',
      'New, the baseline holds no index and nothing is held (1):',
      '  src/a/fresh.test.ts',
      '',
    ]);
    expect(run).toMatchObject({ exitCode: 1, stderr: '' });
  });

  it('exits 1 with the reason when the baseline is missing or is not one', () => {
    const missing = runAgainst(root, 'docs/survey/absent.json');
    expect(missing).toMatchObject({ exitCode: 1, stdout: '' });
    // The folder is left out: the script names it by its own working directory, which a symlinked temp folder spells otherwise.
    expect(missing.stderr).toStartWith('cannot read the baseline: no file at ');
    expect(missing.stderr).toEndWith('docs/survey/absent.json\n');
    const wrong = runAgainst(root, 'src/deep/x.ts');
    expect(wrong).toMatchObject({ exitCode: 1, stdout: '' });
    expect(wrong.stderr).toStartWith('not a test-index baseline: ');
  });
});
