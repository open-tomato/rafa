import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  clusterOfTest,
  DEFAULT_REPORT,
  parseJunit,
  readTestTiming,
  renderTestTiming,
  reportArgument,
  surveyTestTiming,
} from './test-timing.js';

/**
 * The test timing over in-memory junit text and a temporary git
 * repository, never the live one.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-test-timing-test-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function plant(root: string, files: Record<string, string>): void {
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  });
}

/** A junit report shaped as bun writes it, the file's own suite time `0`. */
function junit(cases: readonly [string, string][]): string {
  const body = cases
    .map(([file, time]) => `    <testcase name="case" classname="d" time="${time}" file="${file}" line="1" />`)
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test">\n'
    + `  <testsuite name="x" file="x" time="0">\n${body}\n  </testsuite>\n</testsuites>\n`;
}

describe('parseJunit', () => {
  it('sums the case times per file and counts the cases', () => {
    const files = parseJunit(junit([['src/a/x.test.ts', '0.5'], ['src/a/x.test.ts', '0.25'], ['src/b/y.test.ts', '2']]));

    expect([...files]).toEqual([
      ['src/a/x.test.ts', { tests: 2, seconds: 0.75 }],
      ['src/b/y.test.ts', { tests: 1, seconds: 2 }],
    ]);
  });

  it('decodes an escaped file path', () => {
    expect([...parseJunit(junit([['src/a&amp;b.test.ts', '1']])).keys()]).toEqual(['src/a&b.test.ts']);
  });

  it('refuses a text that is no junit report, and reads an empty one as no file', () => {
    expect(() => parseJunit('{"tests": []}')).toThrow('no <testsuites>');
    expect(parseJunit(junit([])).size).toBe(0);
  });

  it('refuses a case with no file or a time that is not a number', () => {
    expect(() => parseJunit('<testsuites><testcase name="n" time="1" /></testsuites>')).toThrow('no file attribute');
    expect(() => parseJunit(junit([['src/a.test.ts', 'soon']]))).toThrow('not a number');
  });
});

describe('clusterOfTest', () => {
  const clusterOf = new Map([
    ['src/a/x.ts', 'c1'],
    ['src/a/y.ts', 'c2'],
    ['src/a/z.ts', 'c2'],
  ]);

  it('takes the subject source file\'s cluster first', () => {
    expect(clusterOfTest('src/a/x.test.ts', clusterOf)).toBe('c1');
  });

  it('falls back to the directory\'s most common cluster, then to none', () => {
    expect(clusterOfTest('src/a/other.test.ts', clusterOf)).toBe('c2');
    expect(clusterOfTest('src/b/other.test.ts', clusterOf)).toBe('none');
  });
});

describe('readTestTiming', () => {
  it('groups tracked files per folder and per cluster, slowest first, and lists untracked report files', () => {
    const report = parseJunit(junit([
      ['src/a/x.test.ts', '1'],
      ['src/a/y.test.ts', '3'],
      ['src/b/w.test.ts', '0.5'],
      ['scripts/s.test.ts', '9'],
    ]));
    const clusterOf = new Map([['src/a/x.ts', 'c1'], ['src/a/y.ts', 'c2'], ['src/b/w.ts', 'c1']]);

    const data = readTestTiming('r.xml', report, ['src/a/x.test.ts', 'src/a/y.test.ts', 'src/b/w.test.ts'], clusterOf);

    expect(data.seconds).toBe(4.5);
    expect(data.files.map((file) => file.path)).toEqual(['src/a/y.test.ts', 'src/a/x.test.ts', 'src/b/w.test.ts']);
    expect(data.folders).toEqual([
      { name: 'src/a', files: 2, tests: 2, seconds: 4 },
      { name: 'src/b', files: 1, tests: 1, seconds: 0.5 },
    ]);
    expect(data.clusters).toEqual([
      { name: 'c2', files: 1, tests: 1, seconds: 3 },
      { name: 'c1', files: 2, tests: 2, seconds: 1.5 },
    ]);
    expect(data.untracked).toEqual(['scripts/s.test.ts']);
    expect(renderTestTiming(data)).toContain('| `c2` | 1 | 1 | 3 |');
  });
});

describe('reportArgument', () => {
  it('reads the path after --report, defaults without one and refuses a bare flag', () => {
    expect(reportArgument(['--report', 'out/j.xml'])).toBe('out/j.xml');
    expect(reportArgument([])).toBe(DEFAULT_REPORT);
    expect(() => reportArgument(['--report'])).toThrow('needs a path');
  });
});

describe('surveyTestTiming', () => {
  it('writes the reading with a coverage line naming the tracked test file the report missed', async () => {
    plant(base, {
      'src/a/x.ts': 'export const x = 1;\n',
      'src/a/x.test.ts': '\n',
      'src/a/slow.test.ts': '\n',
      '.rafa/survey/import-graph.json': JSON.stringify({ data: { files: [{ path: 'src/a/x.ts', cluster: 'c1' }] } }),
      '.rafa/survey/junit.xml': junit([['src/a/x.test.ts', '1.5']]),
    });
    await Bun.$`git init -q && git add src`.cwd(base).quiet();

    const data = await surveyTestTiming(base);

    expect(data.clusters).toEqual([{ name: 'c1', files: 1, tests: 1, seconds: 1.5 }]);
    const markdown = await Bun.file(join(base, '.rafa/survey/test-timing.md')).text();
    expect(markdown.split('\n')[0]).toBe('Coverage: 2 tracked, 1 read, 1 missed: `src/a/slow.test.ts`');
  });

  it('names the run line when the report is absent', async () => {
    plant(base, { 'src/a/x.test.ts': '\n' });
    await Bun.$`git init -q && git add src`.cwd(base).quiet();

    await expect(surveyTestTiming(base)).rejects.toThrow('--reporter=junit');
  });
});
