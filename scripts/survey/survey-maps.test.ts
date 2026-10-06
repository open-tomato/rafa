/**
 * Every map script run over one temporary git repository, never the live
 * one. Each summary's coverage line must count the tracked files the
 * script was meant to read, and the deliberately unparseable source must
 * be named as missed by the one script that parses source: the import
 * graph, whose `bun build` drops it. The other scripts read its text, so
 * their coverage lines name nothing missed.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { surveyConcepts } from './concepts.js';
import { surveyImportGraph } from './import-graph.js';
import { surveyProvenance } from './provenance.js';
import { surveyTestIndex } from './test-index.js';
import { surveyTestTiming } from './test-timing.js';

/** The files the fixture commits, each by its repository path. */
const FIXTURE_FILES: Readonly<Record<string, string>> = {
  'src/a.ts': 'import { b } from \'./b.js\';\n\nexport const a = b + 1;\n',
  'src/b.ts': 'export const b = 1;\n',
  'src/a.test.ts': 'import { test, expect } from \'bun:test\';\nimport { a } from \'./a.js\';\n\n'
    + 'test(\'a\', () => {\n  expect(a).toBe(2);\n});\n',
  'src/unparseable.ts': 'export const = ;\n',
  'packages/pkg/index.ts': 'export { b } from \'../../src/b.js\';\n',
  'context/terminology.md': '# Terminology\n\n**The ledger** is the formal name for the effort record.\n',
  'context/cli.md': '# CLI\n\n## Running a loop\n\nThe loop runs each task in turn.\n',
};

/** The unparseable source, the one file every map script is meant to read but the import graph cannot. */
const UNPARSEABLE = 'src/unparseable.ts';

/** The source files the import graph, provenance and concepts are meant to read, sorted. */
const SOURCE_FILES = ['packages/pkg/index.ts', 'src/a.ts', 'src/b.ts', UNPARSEABLE];

/** The test files the test index and test timing are meant to read. */
const TEST_FILES = ['src/a.test.ts'];

/** The context pages and the source files the concept map is meant to read, sorted. */
const CONCEPT_FILES = ['context/cli.md', 'context/terminology.md', ...SOURCE_FILES];

const GIT_ARGS = ['-c', 'user.name=survey', '-c', 'user.email=survey@example.invalid', '-c', 'commit.gpgsign=false'];

let repo = '';
let boardDir = '';
let boardPath = '';

/** Writes `files` into the fixture under their repository paths. */
function plant(files: Readonly<Record<string, string>>): void {
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  });
}

/** A junit report over one passing test case in each test file, shaped as bun writes it. */
function junitFor(files: readonly string[]): string {
  const body = files
    .map((file) => `    <testcase name="case" classname="d" time="0.5" file="${file}" line="1" />`)
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test">\n'
    + `  <testsuite name="x" file="x" time="0">\n${body}\n  </testsuite>\n</testsuites>\n`;
}

/** The first line of a summary, which opens with its coverage line. */
async function firstLine(name: string): Promise<string> {
  const text = await Bun.file(join(repo, '.rafa/survey', `${name}.md`)).text();
  return text.split('\n')[0] ?? '';
}

/** Parses a coverage line into its three counts and the missed paths it names. */
function parseCoverage(line: string): { tracked: number; read: number; missed: number; names: string[] } {
  const match = /^Coverage: (\d+) tracked, (\d+) read, (\d+) missed: (.*)$/.exec(line);
  if (match === null) {
    throw new Error(`not a coverage line: ${line}`);
  }
  const names = (match[4] ?? 'none') === 'none'
    ? []
    : [...(match[4] ?? '').matchAll(/`([^`]+)`/g)].map((hit) => hit[1] ?? '');
  return { tracked: Number(match[1]), read: Number(match[2]), missed: Number(match[3]), names };
}

beforeAll(async () => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-survey-maps-test-')));
  boardDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-survey-maps-board-')));
  boardPath = join(boardDir, 'board.json');
  plant(FIXTURE_FILES);
  await Bun.$`git init -q`.cwd(repo).quiet();
  await Bun.$`git ${GIT_ARGS} add -A`.cwd(repo).quiet();
  await Bun.$`git ${GIT_ARGS} commit -q -m ${'feat: add the fixture (#1)'}`.cwd(repo).quiet();
  plant({ 'src/b.ts': 'export const b = 2;\n' });
  await Bun.$`git ${GIT_ARGS} commit -q -am ${'fix: change b (#2)'}`.cwd(repo).quiet();
  plant({ '.rafa/survey/junit.xml': junitFor(TEST_FILES) });
  writeFileSync(boardPath, JSON.stringify({ rows: [] }));
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(boardDir, { recursive: true, force: true });
});

describe('survey map scripts over a temporary repository', () => {
  it('import-graph counts every source it is meant to read and names the unparseable one as missed', async () => {
    await surveyImportGraph(repo);

    const coverage = parseCoverage(await firstLine('import-graph'));
    expect(coverage).toEqual({ tracked: SOURCE_FILES.length, read: SOURCE_FILES.length - 1, missed: 1, names: [UNPARSEABLE] });
  });

  it('test-index counts every test file it is meant to read and misses none', async () => {
    await surveyTestIndex(repo);

    const coverage = parseCoverage(await firstLine('test-index'));
    expect(coverage).toEqual({ tracked: TEST_FILES.length, read: TEST_FILES.length, missed: 0, names: [] });
  });

  it('provenance counts every source it is meant to read and misses none', async () => {
    await surveyProvenance(repo, boardPath);

    const coverage = parseCoverage(await firstLine('provenance'));
    expect(coverage).toEqual({ tracked: SOURCE_FILES.length, read: SOURCE_FILES.length, missed: 0, names: [] });
  });

  it('concepts counts every page and source it is meant to read and misses none', async () => {
    await surveyConcepts(repo);

    const coverage = parseCoverage(await firstLine('concepts'));
    expect(coverage).toEqual({ tracked: CONCEPT_FILES.length, read: CONCEPT_FILES.length, missed: 0, names: [] });
  });

  it('test-timing counts every test file it is meant to read and misses none', async () => {
    await surveyTestTiming(repo, '.rafa/survey/junit.xml');

    const coverage = parseCoverage(await firstLine('test-timing'));
    expect(coverage).toEqual({ tracked: TEST_FILES.length, read: TEST_FILES.length, missed: 0, names: [] });
  });
});
