import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  TOP_SLOWEST,
  isGreen,
  isTestFileName,
  main,
  parseArguments,
  parseJunit,
  renderTestTimingMarkdown,
  summarizeTiming,
} from './test-timing';

const NESTED = 'src/a/nested.test.ts';
const FLAT = 'src/b/flat.test.ts';
const SKIPPED = 'src/c/skipped.test.ts';
const UNRUN = 'src/d/unrun.test.ts';

/**
 * A report in the shape bun 1.3 writes: `nested.test.ts` holds cases at
 * three depths, its suites' own `time` left at `0` as bun leaves a fast
 * suite, so only the cases' sum is right; every case of `skipped.test.ts`
 * is skipped or `todo`.
 */
function report(failing: boolean): string {
  const failure = failing
    ? '\n        <failure type="AssertionError" />\n      '
    : '';
  const failures = failing
    ? 1
    : 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="7" failures="${failures}" skipped="2" time="5.5">
  <testsuite name="${NESTED}" file="${NESTED}" tests="4" time="0">
    <testsuite name="outer &amp; &quot;q&quot;" file="${NESTED}" time="0">
      <testsuite name="inner" file="${NESTED}" time="0">
        <testcase name="deep" classname="inner" time="1.25" file="${NESTED}" />
      </testsuite>
      <testcase name="middle" classname="outer" time="0.5" file="${NESTED}">${failure}</testcase>
    </testsuite>
    <testcase name="top" classname="" time="0.25" file="${NESTED}" />
    <testcase name="top two" classname="" time="0.000001" file="${NESTED}"></testcase>
  </testsuite>
  <testsuite name="${FLAT}" file="${FLAT}" tests="1" time="3">
    <testcase name="slow" classname="" time="3" file="${FLAT}" />
  </testsuite>
  <testsuite name="${SKIPPED}" file="${SKIPPED}" tests="2" skipped="2" time="0">
    <testcase name="later" classname="" time="0" file="${SKIPPED}">
      <skipped />
    </testcase>
    <testcase name="todo" classname="" time="0" file="${SKIPPED}">
      <skipped message="TODO" />
    </testcase>
  </testsuite>
</testsuites>
`;
}

describe('parseJunit and summarizeTiming', () => {
  it('sums a file\'s cases across its nested suites, ignoring the suites\' own time', () => {
    const summary = summarizeTiming(parseJunit(report(false)));
    const nested = summary.files.find((file) => file.file === NESTED);
    expect(nested).toEqual({ failed: 0, file: NESTED, micros: 2_000_001, passed: 4, skipped: 0 });
    expect(summary.totalMicros).toBe(5_000_001);
    expect(summary.wallMicros).toBe(5_500_000);
    expect(summary.files.map((file) => file.file)).toEqual([NESTED, FLAT, SKIPPED]);
  });

  it('names each case by its describes, its entities decoded', () => {
    const names = parseJunit(report(false)).cases.map((item) => item.name);
    expect(names).toEqual(['outer & "q" > inner > deep', 'outer & "q" > middle', 'top', 'top two', 'slow', 'later', 'todo']);
  });

  it('counts a file whose every case skipped, at no time, and names it', () => {
    const summary = summarizeTiming(parseJunit(report(false)));
    expect(summary.files.find((file) => file.file === SKIPPED)).toEqual({ failed: 0, file: SKIPPED, micros: 0, passed: 0, skipped: 2 });
    expect(summary.allSkipped).toEqual([SKIPPED]);
    expect(summary.skipped).toBe(2);
  });

  it('ranks the slowest files slowest first and gives their share of the total', () => {
    const summary = summarizeTiming(parseJunit(report(false)));
    expect(summary.slowest.map((file) => file.file)).toEqual([FLAT, NESTED, SKIPPED]);
    expect(summary.slowestMicros).toBe(summary.totalMicros);
  });

  it('keeps only the slowest TOP_SLOWEST files, ties broken by path', () => {
    const cases = Array.from({ length: TOP_SLOWEST + 5 }, (_, at) => ({
      file: `src/f${String(at).padStart(2, '0')}.test.ts`,
      micros: at < 3
        ? 1_000
        : 10,
      name: 't',
      outcome: 'passed' as const,
    }));
    const summary = summarizeTiming({ cases, wallMicros: 0 });
    expect(summary.slowest).toHaveLength(TOP_SLOWEST);
    expect(summary.slowest.slice(0, 4).map((file) => file.file)).toEqual(['src/f00.test.ts', 'src/f01.test.ts', 'src/f02.test.ts', 'src/f03.test.ts']);
    expect(summary.slowestMicros).toBe(3_000 + (TOP_SLOWEST - 3) * 10);
  });

  it('refuses a text with no testsuites root', () => {
    expect(() => parseJunit('<html></html>')).toThrow('not a junit report');
  });

  it('refuses a malformed time', () => {
    expect(() => parseJunit('<testsuites time="1"><testcase name="x" time="soon" file="a.test.ts" /></testsuites>')).toThrow('malformed time "soon"');
  });
});

describe('the run\'s outcome', () => {
  it('reports a run with one failure as not green, naming the case', () => {
    const summary = summarizeTiming(parseJunit(report(true)));
    expect(summary.failed).toBe(1);
    expect(summary.passed).toBe(4);
    expect(summary.failures.map((item) => item.name)).toEqual(['outer & "q" > middle']);
    expect(isGreen(summary, 1)).toBe(false);
    // The exit code alone does not make a run green when a case failed.
    expect(isGreen(summary, 0)).toBe(false);
    const markdown = renderTestTimingMarkdown(summary, 1, [NESTED, FLAT, SKIPPED]);
    expect(markdown).toContain('Run: not green. Exit code 1; 4 pass, 1 fail, 2 skipped across 3 test files.');
    expect(markdown).toContain(`## Failed cases\n\n- \`${NESTED}\`: outer & "q" > middle`);
  });

  it('reports a clean run as green, and a non-zero exit with no failed case as not green', () => {
    const summary = summarizeTiming(parseJunit(report(false)));
    expect(isGreen(summary, 0)).toBe(true);
    expect(isGreen(summary, 1)).toBe(false);
    const markdown = renderTestTimingMarkdown(summary, 0, [NESTED, FLAT, SKIPPED]);
    expect(markdown).toContain('Run: green. Exit code 0; 5 pass, 0 fail, 2 skipped across 3 test files.');
    expect(markdown).not.toContain('## Failed cases');
  });
});

describe('renderTestTimingMarkdown', () => {
  it('opens with the coverage line naming a tracked test file the run did not hold', () => {
    const summary = summarizeTiming(parseJunit(report(false)));
    const markdown = renderTestTimingMarkdown(summary, 0, [NESTED, FLAT, SKIPPED, UNRUN]);
    expect(markdown.split('\n').slice(0, 3)).toEqual([
      '# Test timing',
      '',
      `Coverage: 3 of 4 tracked files read (test files \`bun test\` discovers). Not read: \`${UNRUN}\`.`,
    ]);
  });

  it('shows the time, the share and the outcome of each slowest file', () => {
    const markdown = renderTestTimingMarkdown(summarizeTiming(parseJunit(report(false))), 0, [NESTED, FLAT, SKIPPED]);
    expect(markdown).toContain('Time in test cases: 5.00 s; wall clock 5.50 s, 0.50 s of it outside any case');
    expect(markdown).toContain('They take 5.00 s, 100.0% of the time in test cases.');
    expect(markdown).toContain(`| 1 | \`${FLAT}\` | 3.00 s | 60.0% | 1 | 0 | 0 |`);
    expect(markdown).toContain(`| 2 | \`${NESTED}\` | 2.00 s | 40.0% | 4 | 0 | 0 |`);
    expect(markdown).toContain(`| 3 | \`${SKIPPED}\` | 0.00 s | 0.0% | 0 | 0 | 2 |`);
    expect(markdown).toContain(`## Files whose every case was skipped\n\n- \`${SKIPPED}\`\n`);
  });
});

describe('isTestFileName', () => {
  it('matches the names bun test discovers and nothing else', () => {
    expect(['a.test.ts', 'b_test.tsx', 'c.spec.js', 'd_spec.mjs', 'scripts/e.test.ts'].every(isTestFileName)).toBe(true);
    expect(['a.ts', 'test.ts', 'a.test.json', 'node_modules/x/a.test.ts', 'a.test.ts.snap'].some(isTestFileName)).toBe(false);
  });
});

describe('parseArguments', () => {
  it('reads the report path and the exit code', () => {
    expect(parseArguments(['run.xml', '1'])).toEqual({ exitCode: 1, reportPath: 'run.xml' });
  });

  it('refuses a missing or non-numeric exit code', () => {
    expect(() => parseArguments(['run.xml'])).toThrow('usage:');
    expect(() => parseArguments(['run.xml', 'one'])).toThrow('whole number');
  });
});

describe('main', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'test-timing-'));
    for (const path of [NESTED, FLAT, SKIPPED, UNRUN, 'src/a/helper.ts']) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), '');
    }
    writeFileSync(join(root, 'run.xml'), report(true));
    for (const args of [['init', '--quiet'], ['add', '--', 'src']]) {
      const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' });
      if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
      }
    }
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('writes the summary against the tracked test files, the untracked report aside', async () => {
    expect(await main(root, 'run.xml', 1)).toEqual(['docs/survey/test-timing.md']);
    const markdown = readFileSync(join(root, 'docs/survey/test-timing.md'), 'utf8');
    expect(markdown).toContain(`Coverage: 3 of 4 tracked files read (test files \`bun test\` discovers). Not read: \`${UNRUN}\`.`);
    expect(markdown).toContain('Run: not green. Exit code 1; 4 pass, 1 fail, 2 skipped across 3 test files.');
  });

  it('reads a report given by absolute path', async () => {
    await main(root, join(root, 'run.xml'), 0);
    expect(readFileSync(join(root, 'docs/survey/test-timing.md'), 'utf8')).toContain('Run: not green. Exit code 0;');
  });
});
