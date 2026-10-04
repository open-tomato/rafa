/**
 * The sweep timing of `start/sweep-timing.ts`, over handmade JUnit text
 * shaped as bun 1.4.2 writes it and JUnit files under a temporary
 * directory. Nothing here spawns `bun test`; the step's own use is
 * covered through its seams in `suite-step.test.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { parseJunitFileTimes, reportSlowSweeps, SLOW_SWEEP_SECONDS, slowSweepLine, slowSweeps } from './sweep-timing.js';

const SLOW = 'src/tests/slow.sweep.test.ts';
const QUICK = 'src/tests/quick.sweep.test.ts';
const PLAIN = 'src/a.test.ts';

/** One file's `<testsuite>`, holding a `describe` block whose own time is `inner`. */
function suite(file: string, seconds: number, inner = 0): string {
  return [
    `  <testsuite name="${file}" file="${file}" tests="1" assertions="1" failures="0" skipped="0" time="${seconds}" hostname="h">`,
    `    <testsuite name="g" file="${file}" line="2" tests="1" assertions="1" failures="0" skipped="0" time="${inner}" hostname="h">`,
    `      <testcase name="t" classname="g" time="${seconds}" file="${file}" line="2" assertions="1" />`,
    '    </testsuite>',
    '  </testsuite>',
  ].join('\n');
}

/** A whole report over `suites`. */
function report(...suites: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites name="bun test" tests="3" assertions="3" failures="0" skipped="0" time="30">',
    ...suites,
    '</testsuites>',
    '',
  ].join('\n');
}

let dir: string;
let infos: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sweep-timing-'));
  infos = [];
  setActiveOutput(sinkOutput({ info: (message) => infos.push(message) }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('parseJunitFileTimes', () => {
  it('reads each file\'s time off the suites directly under testsuites, and none of the describe blocks', () => {
    const xml = report(suite(SLOW, 12.5, 99), suite(PLAIN, 0.25, 99));
    expect(parseJunitFileTimes(xml)).toEqual([{ file: SLOW, seconds: 12.5 }, { file: PLAIN, seconds: 0.25 }]);
  });

  it('answers null for text that is not a whole testsuites document', () => {
    expect(parseJunitFileTimes(report(suite(SLOW, 12)).replace('</testsuites>', ''))).toBeNull();
    expect(parseJunitFileTimes('')).toBeNull();
  });

  it('skips a file whose time is not a number, keeping the others', () => {
    const xml = report(suite(SLOW, 12).replace('time="12"', 'time="soon"'), suite(QUICK, 11));
    expect(parseJunitFileTimes(xml)).toEqual([{ file: QUICK, seconds: 11 }]);
  });
});

describe('slowSweeps', () => {
  const times = [{ file: QUICK, seconds: 2 }, { file: SLOW, seconds: 12 }, { file: PLAIN, seconds: 40 }];

  it('names an always-run file over the limit and leaves out one under it', () => {
    expect(slowSweeps(times, [QUICK, SLOW])).toEqual([{ file: SLOW, seconds: 12 }]);
  });

  it('names no file the always-run list leaves out, however slow', () => {
    // Control: the same 40s file is named once the list holds it.
    expect(slowSweeps(times, [PLAIN])).toEqual([{ file: PLAIN, seconds: 40 }]);
    expect(slowSweeps(times, [QUICK])).toEqual([]);
  });

  it('reads a file at exactly the limit as not over it', () => {
    expect(slowSweeps([{ file: SLOW, seconds: SLOW_SWEEP_SECONDS }], [SLOW])).toEqual([]);
    expect(slowSweeps([{ file: SLOW, seconds: SLOW_SWEEP_SECONDS + 0.01 }], [SLOW])).toHaveLength(1);
  });

  it('matches a path handed with or without ./, and lists the slowest first', () => {
    const both = [{ file: SLOW, seconds: 11 }, { file: QUICK, seconds: 15 }];
    expect(slowSweeps(both, [`./${SLOW}`, QUICK]).map((time) => time.file)).toEqual([QUICK, SLOW]);
  });
});

describe('slowSweepLine', () => {
  it('names each slow file with its time to one decimal, and the limit', () => {
    expect(slowSweepLine([{ file: SLOW, seconds: 12.34 }])).toBe(`🐢 1 tests.alwaysRun file(s) took over 10s in the task step: ${SLOW} (12.3s).`);
  });

  it('answers null for no slow file', () => {
    expect(slowSweepLine([])).toBeNull();
  });
});

describe('reportSlowSweeps', () => {
  it('prints one line for a file over the limit, and none for the same report with it under', () => {
    const over = join(dir, 'over.junit.xml');
    const under = join(dir, 'under.junit.xml');
    writeFileSync(over, report(suite(SLOW, 12), suite(QUICK, 1)), 'utf8');
    writeFileSync(under, report(suite(SLOW, 9.9), suite(QUICK, 1)), 'utf8');

    expect(reportSlowSweeps(over, [SLOW, QUICK])).toContain(`${SLOW} (12.0s)`);
    expect(infos).toHaveLength(1);
    expect(infos[0]).not.toContain(QUICK);

    expect(reportSlowSweeps(under, [SLOW, QUICK])).toBeNull();
    expect(infos).toHaveLength(1);
  });

  it('prints nothing for a missing or unreadable JUnit file, or for no always-run file', () => {
    const over = join(dir, 'over.junit.xml');
    writeFileSync(over, report(suite(SLOW, 12)), 'utf8');
    const broken = join(dir, 'broken.junit.xml');
    writeFileSync(broken, '<testsuites>', 'utf8');

    expect(reportSlowSweeps(join(dir, 'absent.junit.xml'), [SLOW])).toBeNull();
    expect(reportSlowSweeps(broken, [SLOW])).toBeNull();
    expect(reportSlowSweeps(over, [])).toBeNull();
    expect(infos).toEqual([]);
  });
});
