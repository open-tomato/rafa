import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { coverageLine, listTrackedFiles, measureCoverage, SURVEY_DIR, writeSurvey } from './survey-io.js';

/**
 * The survey helper over a temporary git repository of its own, never the
 * live one. Each listing case pairs a tracked file with an untracked one
 * beside it, so a listing that read the folder instead of the index
 * would fail.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-survey-io-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A git repository under the case's folder, `tracked` added to its index and `untracked` left beside them. */
async function plantRepo(tracked: readonly string[], untracked: readonly string[] = []): Promise<string> {
  const root = join(base, 'repo');
  mkdirSync(root, { recursive: true });
  await Bun.$`git init -q`.cwd(root).quiet();
  for (const path of [...tracked, ...untracked]) {
    writeFile(join(root, path), `// ${path}\n`);
  }
  if (tracked.length > 0) {
    await Bun.$`git add -- ${[...tracked]}`.cwd(root).quiet();
  }
  return root;
}

describe('listTrackedFiles', () => {
  it('lists the index sorted and leaves an untracked file out', async () => {
    const root = await plantRepo(['src/b.ts', 'src/a.ts', 'README.md'], ['src/loose.ts']);

    expect(await listTrackedFiles(root)).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
  });

  it('limits the listing to the pathspecs given', async () => {
    const root = await plantRepo(['src/a.ts', 'packages/p/x.ts', 'docs/d.md']);

    expect(await listTrackedFiles(root, ['src', 'packages'])).toEqual(['packages/p/x.ts', 'src/a.ts']);
  });

  it('throws naming git when the folder is not a repository', async () => {
    const outside = join(base, 'plain');
    mkdirSync(outside, { recursive: true });

    await expect(listTrackedFiles(outside)).rejects.toThrow(/git ls-files failed/);
  });
});

describe('measureCoverage', () => {
  it('names each expected file that was not read and ignores a read that was not expected', () => {
    const coverage = measureCoverage(['c.ts', 'a.ts', 'b.ts'], ['a.ts', 'extra.ts', 'c.ts']);

    expect(coverage).toEqual({ expected: ['a.ts', 'b.ts', 'c.ts'], read: ['a.ts', 'c.ts'], missed: ['b.ts'] });
  });

  it('misses nothing when every expected file was read', () => {
    expect(measureCoverage(['a.ts'], new Set(['a.ts'])).missed).toEqual([]);
  });
});

describe('coverageLine', () => {
  it('counts the expected and read files and names every missed one', () => {
    const line = coverageLine(measureCoverage(['a.ts', 'b.ts', 'c.ts'], ['a.ts']));

    expect(line).toBe('Coverage: 3 tracked, 1 read, 2 missed: `b.ts`, `c.ts`');
  });

  it('says none when nothing was missed', () => {
    expect(coverageLine(measureCoverage(['a.ts'], ['a.ts']))).toBe('Coverage: 1 tracked, 1 read, 0 missed: none');
  });
});

describe('writeSurvey', () => {
  it('writes the JSON and the markdown under the survey folder, the summary opening with the coverage line', async () => {
    const coverage = measureCoverage(['a.ts', 'b.ts'], ['a.ts']);

    const paths = await writeSurvey(base, 'import-graph', { data: { clusters: 2 }, markdown: '# Import graph\n', coverage });

    expect(paths).toEqual({
      json: join(base, SURVEY_DIR, 'import-graph.json'),
      markdown: join(base, SURVEY_DIR, 'import-graph.md'),
    });
    expect(await Bun.file(paths.json).json()).toEqual({ name: 'import-graph', coverage, data: { clusters: 2 } });
    expect(await Bun.file(paths.markdown).text()).toBe('Coverage: 2 tracked, 1 read, 1 missed: `b.ts`\n\n# Import graph\n');
  });

  it('writes the coverage line alone when the body is empty', async () => {
    const paths = await writeSurvey(base, 'empty', { data: null, markdown: '', coverage: measureCoverage([], []) });

    expect(await Bun.file(paths.markdown).text()).toBe('Coverage: 0 tracked, 0 read, 0 missed: none\n');
  });

  it('refuses a name that could leave the survey folder, writing nothing', async () => {
    const output = { data: 1, markdown: 'x', coverage: measureCoverage([], []) };

    await expect(writeSurvey(base, '../escape', output)).rejects.toThrow(/survey name/);
    expect(await Bun.file(join(base, SURVEY_DIR, 'escape.json')).exists()).toBe(false);
    expect(await Bun.file(join(base, '.rafa', 'escape.json')).exists()).toBe(false);
  });
});
