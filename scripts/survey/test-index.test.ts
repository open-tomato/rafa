import type { ImportEdge, ImportGraph } from './import-graph';
import type { TestIndex, TestIndexEntry } from './test-index';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  computeTestIndex,
  indexFolder,
  main,
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
function plantedIndex(): TestIndex {
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
  return computeTestIndex({ graph, sources });
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

/** Runs git in a scratch repository and fails the test on a non-zero exit. */
function git(root: string, args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
}

function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

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
