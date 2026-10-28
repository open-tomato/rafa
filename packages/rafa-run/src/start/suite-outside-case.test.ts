/**
 * Unit cases for `suite-outside-case.ts`: which runs
 * {@link failedOutsideAnyCase} reads as failed outside any test case,
 * the three it leaves alone first (a run Bun found no test file for, a
 * SIGINT stop, a zero exit) and then the red reading, each paired with
 * the run that differs from it by one field. Then the sentence a blocker
 * quotes the tail in, with its two caps, the entry a recorded step
 * carries, and the two things said of a baseline of that shape: the
 * lines a run stops with on a fresh one, and why a stored one is
 * recorded again.
 *
 * {@link TAIL} is what bun 1.3.14 printed on stderr for two test files
 * importing a package that is not installed, blank lines taken out as
 * `readOutputTail` (`suite/run.ts`) takes them: the run exited 1 and
 * wrote no JUnit file.
 */
import type { SuiteFailure, SuiteResult } from '@open-tomato/rafa/suite/run';

import { describe, expect, it } from 'bun:test';

import {
  baselineHaltLines,
  failedOutsideAnyCase,
  OUTSIDE_CASE_LIKELY_CAUSE,
  OUTSIDE_CASE_REASON,
  outsideCaseRecord,
  outsideCaseText,
  storedOutsideCaseLine,
  TAIL_LINE_QUOTED_LENGTH,
  TAIL_QUOTED_LENGTH,
} from './suite-outside-case.js';
import { SIGINT_EXIT_CODE } from './suite-step.js';

const FAILURE: SuiteFailure = { file: 'src/a.test.ts', name: 'a > fails' };

const TAIL = [
  'b.test.ts:',
  '# Unhandled error between tests',
  '-------------------------------',
  'error: Cannot find package \'other-missing-package\' from \'/repo/b.test.ts\'',
  '-------------------------------',
  'a.test.ts:',
  '# Unhandled error between tests',
  '-------------------------------',
  'error: Cannot find package \'zod-not-installed\' from \'/repo/a.test.ts\'',
  '-------------------------------',
  ' 0 pass',
  ' 2 fail',
  ' 2 errors',
  'Ran 2 tests across 2 files. [10.00ms]',
];

/** A run that exits 1 with a summary line and no failing case: the red reading, unless told otherwise. */
function run(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    command: ['bun', 'test'],
    exitCode: 1,
    summary: 'Ran 2 tests across 2 files. [10.00ms]',
    failures: [],
    errors: 2,
    junit: 'missing',
    unhandled: [],
    outputTail: TAIL,
    ...overrides,
  };
}

/** The lines `text` quotes, in order, read back off its `"..."` spans. */
function quotedIn(text: string): readonly string[] {
  return [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
}

describe('failedOutsideAnyCase', () => {
  it('leaves a run Bun found no test file for, which exits 1 with no failure listed', () => {
    const empty = run({ summary: null, errors: null, outputTail: ['error: 0 test files matching **{.test,.spec}.ts'], noTestFiles: true });
    expect(failedOutsideAnyCase(empty)).toBe(false);
    // Control: the same run without the mark is the red reading.
    expect(failedOutsideAnyCase({ ...empty, noTestFiles: undefined })).toBe(true);
  });

  it('leaves a run ended by SIGINT, and not one ended by SIGTERM', () => {
    expect(SIGINT_EXIT_CODE).toBe(130);
    expect(failedOutsideAnyCase(run({ exitCode: SIGINT_EXIT_CODE, summary: null, errors: null }))).toBe(false);
    // Control: 143, SIGTERM's code, is a nonzero exit as any other.
    expect(failedOutsideAnyCase(run({ exitCode: 143, summary: null, errors: null }))).toBe(true);
  });

  it('leaves a zero exit, whatever else the run holds', () => {
    expect(failedOutsideAnyCase(run({ exitCode: 0, errors: 0 }))).toBe(false);
    expect(failedOutsideAnyCase(run({ exitCode: 0 }))).toBe(false);
  });

  it('reads a nonzero exit listing no failing case as failed, with or without a summary line or an error count', () => {
    expect(failedOutsideAnyCase(run())).toBe(true);
    expect(failedOutsideAnyCase(run({ errors: 0 }))).toBe(true);
    expect(failedOutsideAnyCase(run({ summary: null, errors: null }))).toBe(true);
    expect(failedOutsideAnyCase(run({ exitCode: 2, outputTail: [] }))).toBe(true);
    // Control: the same exit with one failing case listed is a run whose failures are split against the baseline.
    expect(failedOutsideAnyCase(run({ failures: [FAILURE] }))).toBe(false);
  });
});

describe('OUTSIDE_CASE_REASON', () => {
  it('is the wording the plan fixes', () => {
    expect(OUTSIDE_CASE_REASON).toBe('the run failed outside any test case');
  });
});

describe('outsideCaseText', () => {
  it('names the exit code and the reason, and quotes a short tail whole, in the order Bun printed it', () => {
    const tail = ['error: Cannot find package \'zod\' from \'/repo/a.test.ts\'', ' 0 pass', ' 1 fail'];
    const text = outsideCaseText(run({ exitCode: 3, outputTail: tail }));
    expect(text).toBe(`bun test exited 3 and listed no failing test: ${OUTSIDE_CASE_REASON}. The last lines it printed: "error: Cannot find package 'zod' from '/repo/a.test.ts'", "0 pass", "1 fail".`);
    expect(text).not.toContain('\n');
  });

  it('quotes the end of a longer tail within the cap, saying how many of its lines those are', () => {
    const text = outsideCaseText(run());
    const quoted = quotedIn(text);
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.length).toBeLessThan(TAIL.length);
    expect(quoted).toEqual(TAIL.slice(-quoted.length).map((line) => line.trim()));
    expect(quoted.join('').length).toBeLessThanOrEqual(TAIL_QUOTED_LENGTH);
    // The cap leaves room for the last error Bun named, past its count lines.
    expect(text).toContain('Cannot find package \'zod-not-installed\'');
    expect(text).toContain(`(${quoted.length} of the ${TAIL.length} lines on the step's record)`);
    // Control: one more line would pass the cap.
    const oneMore = TAIL.slice(-(quoted.length + 1)).map((line) => line.trim());
    expect(oneMore.join('').length).toBeGreaterThan(TAIL_QUOTED_LENGTH);
  });

  it('cuts a line longer than the line cap and marks the cut', () => {
    const long = 'x'.repeat(TAIL_LINE_QUOTED_LENGTH + 50);
    const text = outsideCaseText(run({ outputTail: [long] }));
    expect(quotedIn(text)).toEqual([`${'x'.repeat(TAIL_LINE_QUOTED_LENGTH)}...`]);
    // Control: a line at the cap is quoted whole.
    const fits = 'y'.repeat(TAIL_LINE_QUOTED_LENGTH);
    expect(quotedIn(outsideCaseText(run({ outputTail: [fits] })))).toEqual([fits]);
  });

  it('stays within a few hundred characters whatever the tail holds', () => {
    const wide = Array.from({ length: 40 }, (_, index) => `${index} ${'z'.repeat(400)}`);
    const text = outsideCaseText(run({ outputTail: wide }));
    expect(text.length).toBeLessThan(TAIL_QUOTED_LENGTH + 200);
    expect(quotedIn(text).length).toBeGreaterThan(0);
  });

  it('says Bun printed nothing for an empty tail', () => {
    const text = outsideCaseText(run({ outputTail: [] }));
    expect(text).toBe(`bun test exited 1 and listed no failing test: ${OUTSIDE_CASE_REASON}. It printed nothing on stderr.`);
  });
});

describe('outsideCaseRecord', () => {
  it('answers the mark with a copy of the tail for a run failed outside any case, and no key for any other', () => {
    const result = run();
    const entry = outsideCaseRecord({ outsideCase: true }, result);
    expect(entry).toEqual({ outsideCase: true, outputTail: TAIL });
    expect(entry.outputTail).not.toBe(result.outputTail);
    // Control: the same run under a verdict that is not this reading adds nothing.
    expect(outsideCaseRecord({ outsideCase: false }, result)).toEqual({});
  });
});

describe('baselineHaltLines', () => {
  it('names the exit code, the reason and the likely cause, then every line of the tail as Bun printed it', () => {
    const lines = baselineHaltLines(run({ exitCode: 3 }));
    expect(lines.slice(0, 4)).toEqual([
      `⛔ The suite baseline exited 3 and listed no failing test: ${OUTSIDE_CASE_REASON}. Stopping before any session of this run is dispatched; the baseline was not written.`,
      `   The likely cause is ${OUTSIDE_CASE_LIKELY_CAUSE}: dependencies not installed in this checkout is the case seen.`,
      '   Once the suite loads, run again: that run records the baseline.',
      `   The last ${TAIL.length} line(s) bun test printed on stderr:`,
    ]);
    // The tail whole and uncut, its own leading spaces kept: the blocker's caps do not apply here.
    expect(lines.slice(4)).toEqual(TAIL.map((line) => `     ${line}`));
    expect(OUTSIDE_CASE_LIKELY_CAUSE).toBe('a test file that did not load');
  });

  it('does not cut a line the blocker would cut', () => {
    const long = 'x'.repeat(TAIL_LINE_QUOTED_LENGTH + 50);
    expect(baselineHaltLines(run({ outputTail: [long] })).at(-1)).toBe(`     ${long}`);
  });

  it('says Bun printed nothing for an empty tail', () => {
    const lines = baselineHaltLines(run({ outputTail: [] }));
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toBe('   bun test printed nothing on stderr.');
  });
});

describe('storedOutsideCaseLine', () => {
  it('names the file, the stored run\'s exit code and the reason, and says the baseline is recorded again', () => {
    expect(storedOutsideCaseLine('SUITE_BASELINE-x.json', { exitCode: 2 })).toBe(
      `⚠️  SUITE_BASELINE-x.json holds a run that exited 2 and listed no failing test (${OUTSIDE_CASE_REASON}); recording the baseline again.`,
    );
  });
});
