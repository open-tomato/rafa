/**
 * Tests for the reader of the error Bun prints for each failed case
 * (`src/suite/failure-lines.ts`).
 *
 * The two `failed-*` fixtures under `testdata/` were recorded from real
 * runs of bun 1.3.14, the version `package.json` pins, over scratch
 * projects, each run as `env -u CLAUDECODE bun test --reporter=junit
 * --reporter-outfile=<name>.junit.xml` with stderr captured to
 * `<name>.stderr.txt`. Two edits were made after recording, neither
 * touching a name, a count or an error line: every `hostname` attribute
 * reads `fixture-host`, and every scratch directory reads `/tmp/scratch`.
 *
 *   - `failed-cases`: `thrown.test.ts`, whose first case throws an
 *     `UndeclaredSpendError` with a two-line message before any `expect`;
 *     `assertion.test.ts`, one failing `toEqual`; `timeout.test.ts`, one
 *     case over its 50ms timeout; and `sub/two.test.ts`, three failures
 *     around a pass: a plain `Error`, a thrown string and a rejected
 *     `TypeError`. Every `<failure>` of its JUnit file is written with no
 *     `message` attribute. Exit 1.
 *   - `failed-noise`: `noise.test.ts`, seven failures: one printing two
 *     lines to stderr before it throws (the first ends in `:`, the second
 *     opens with `at`), an error with a cause, a thrown object, an error
 *     whose `stack` was emptied, a failing `toBe`, a failing `toContain`
 *     in a case whose name ends in `[x]`, and a 400-character message.
 *     Exit 1.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  failedCasesLines,
  failingFilesOf,
  MAX_ERROR_LINE_LENGTH,
  MAX_ERROR_LINES,
  MAX_FAILED_CASES,
  parseFailedCases,
  suiteOutputText,
  withErrorLines,
} from './failure-lines.js';
import { parseJunitFailures } from './run.js';

/** A recorded fixture's text. */
function fixture(file: string): string {
  return readFileSync(join(import.meta.dir, 'testdata', file), 'utf8');
}

/** The four files `failed-cases` holds, in the order Bun ran them. */
const CASES_FILES = ['timeout.test.ts', 'thrown.test.ts', 'assertion.test.ts', 'sub/two.test.ts'];

/** The two lines Bun printed for the error thrown before any `expect`. */
const THROWN_LINES = ['UndeclaredSpendError: rafa loop start spends through claude and declared none', 'second line of the message'];

/** The failed cases of `failed-cases`, by `file > name`. */
function casesByName(): Readonly<Record<string, readonly string[]>> {
  const cases = parseFailedCases(fixture('failed-cases.stderr.txt'), CASES_FILES);
  return Object.fromEntries(cases.map((failed) => [`${failed.file} > ${failed.name}`, failed.errorLines]));
}

describe('parseFailedCases over a recorded run', () => {
  it('keeps the lines of an error thrown before any expect, without the code frame and the stack', () => {
    expect(casesByName()['thrown.test.ts > stand-in claude > throws before any expect']).toEqual(THROWN_LINES);
    // Control: the frame and the stack are in the recording, so leaving them out is the reader's doing.
    expect(fixture('failed-cases.stderr.txt')).toContain('7 | function guard(): void {');
    expect(fixture('failed-cases.stderr.txt')).toContain('at guard (/tmp/scratch/thrown.test.ts:8:119)');
  });

  it('keeps an assertion failure\'s heading and the first lines of its difference, capped', () => {
    const lines = casesByName()['assertion.test.ts > fails an assertion'] ?? [];
    expect(lines).toEqual(['error: expect(received).toEqual(expected)', '{', '-   "a": 2,', '+   "a": 1,', '}']);
    expect(lines).toHaveLength(MAX_ERROR_LINES);
    // Control: Bun printed two more lines of the difference, which the cap leaves out.
    expect(fixture('failed-cases.stderr.txt')).toContain('- Expected  - 1');
  });

  it('reads a timeout from the line under its (fail) line', () => {
    expect(casesByName()['timeout.test.ts > times out']).toEqual(['this test timed out after 50ms.']);
  });

  it('reads each failure of one file from the lines above its own (fail) line', () => {
    const cases = casesByName();
    expect(cases['sub/two.test.ts > two > first throws a plain error']).toEqual(['error: first boom']);
    expect(cases['sub/two.test.ts > two > second throws a string']).toEqual(['error: second boom']);
    expect(cases['sub/two.test.ts > two > third rejects']).toEqual(['TypeError: third boom']);
  });

  it('answers the failed cases in the order Bun printed them, and no passing one', () => {
    const cases = parseFailedCases(fixture('failed-cases.stderr.txt'), CASES_FILES);
    expect(cases.map((failed) => `${failed.file} > ${failed.name}`)).toEqual([
      'timeout.test.ts > times out',
      'thrown.test.ts > stand-in claude > throws before any expect',
      'assertion.test.ts > fails an assertion',
      'sub/two.test.ts > two > first throws a plain error',
      'sub/two.test.ts > two > second throws a string',
      'sub/two.test.ts > two > third rejects',
    ]);
  });

  it('does not give a timeout\'s line to the case printed after it', () => {
    const cases = parseFailedCases(fixture('hooks.stderr.txt'), ['timeout.test.ts']);
    expect(cases).toEqual([
      { file: 'timeout.test.ts', name: 'slow', label: 'slow [50.19ms]', errorLines: ['this test timed out after 50ms.'] },
      { file: 'timeout.test.ts', name: 'rej', label: 'rej [0.17ms]', errorLines: ['error: unh'] },
    ]);
  });
});

describe('parseFailedCases over a noisy file', () => {
  const cases = parseFailedCases(fixture('failed-noise.stderr.txt'), ['noise.test.ts']);
  const linesOf = (name: string): readonly string[] | undefined => cases.find((failed) => failed.name === name)?.errorLines;

  it('starts at the error under the code frame, past what the case printed itself', () => {
    expect(linesOf('logs then throws')).toEqual(['error: after noise']);
    // Control: the case's own two lines sit above the frame in the recording.
    expect(fixture('failed-noise.stderr.txt')).toContain('warming up:\n  at the wrong place\n');
  });

  it('reads a line ending in a colon as a file header only for a file it was handed', () => {
    expect(cases.every((failed) => failed.file === 'noise.test.ts')).toBe(true);
    expect(cases).toHaveLength(7);
    // Control: handed the printed line as a file, the reader takes it for a header.
    const misled = parseFailedCases(fixture('failed-noise.stderr.txt'), ['noise.test.ts', 'warming up']);
    expect(misled.every((failed) => failed.file === 'warming up')).toBe(true);
  });

  it('keeps the outer error of one with a cause, a bare `error` for a thrown object, and a stackless one', () => {
    expect(linesOf('throws with a cause')).toEqual(['error: outer']);
    expect(linesOf('throws an object')).toEqual(['error']);
    expect(linesOf('throws with no stack')).toEqual(['error: stackless']);
  });

  it('keeps the expected and received lines of a failing toBe', () => {
    expect(linesOf('fails toBe')).toEqual(['error: expect(received).toBe(expected)', 'Expected: 2', 'Received: 1']);
  });

  it('takes only the trailing time off a name that ends in brackets itself', () => {
    const bracketed = cases.find((failed) => failed.label.startsWith('name ends in brackets'));
    expect(bracketed).toMatchObject({ name: 'name ends in brackets [x]', label: 'name ends in brackets [x] [0.05ms]' });
  });

  it('cuts a line longer than the cap, saying it did', () => {
    const [line] = linesOf('long message') ?? [];
    expect(line).toBe(`error: ${'x'.repeat(MAX_ERROR_LINE_LENGTH - 'error: '.length)}...`);
    // Control: the recorded line is longer than the cap.
    expect(fixture('failed-noise.stderr.txt')).toContain(`error: ${'x'.repeat(400)}`);
  });
});

describe('parseFailedCases over written stderr', () => {
  it('reads the error from the first line when Bun printed no code frame', () => {
    const stderr = ['a.test.ts:', 'error: no frame here', '      at <anonymous> (/tmp/scratch/a.test.ts:1:1)', '(fail) frameless [0.01ms]', ''].join('\n');
    expect(parseFailedCases(stderr, ['a.test.ts'])).toEqual([
      { file: 'a.test.ts', name: 'frameless', label: 'frameless [0.01ms]', errorLines: ['error: no frame here'] },
    ]);
  });

  it('answers a failed case with no line when nothing was printed for it', () => {
    const stderr = ['a.test.ts:', '(pass) ok [0.01ms]', '(fail) silent', ''].join('\n');
    expect(parseFailedCases(stderr, ['a.test.ts'])).toEqual([{ file: 'a.test.ts', name: 'silent', label: 'silent', errorLines: [] }]);
  });

  it('leaves out a failed case under no file it was handed', () => {
    const stderr = ['other.test.ts:', 'error: boom', '(fail) elsewhere [0.01ms]', ''].join('\n');
    expect(parseFailedCases(stderr, ['a.test.ts'])).toEqual([]);
    // Control: handed that file, the same text answers the case.
    expect(parseFailedCases(stderr, ['other.test.ts'])).toHaveLength(1);
  });
});

describe('withErrorLines', () => {
  const failures = parseJunitFailures(fixture('failed-cases.junit.xml')) ?? [];

  it('adds its error lines to each failure the JUnit file names, which carries no message itself', () => {
    // Control: bun 1.3.14 wrote no message, so the lines are all a reader has.
    expect(failures.every((failure) => failure.message === undefined)).toBe(true);
    expect(withErrorLines(failures, parseFailedCases(fixture('failed-cases.stderr.txt'), CASES_FILES))).toEqual([
      { file: 'timeout.test.ts', name: 'times out', errorLines: ['this test timed out after 50ms.'] },
      { file: 'thrown.test.ts', name: 'stand-in claude > throws before any expect', errorLines: THROWN_LINES },
      { file: 'assertion.test.ts', name: 'fails an assertion', errorLines: ['error: expect(received).toEqual(expected)', '{', '-   "a": 2,', '+   "a": 1,', '}'] },
      { file: 'sub/two.test.ts', name: 'two > first throws a plain error', errorLines: ['error: first boom'] },
      { file: 'sub/two.test.ts', name: 'two > second throws a string', errorLines: ['error: second boom'] },
      { file: 'sub/two.test.ts', name: 'two > third rejects', errorLines: ['TypeError: third boom'] },
    ]);
  });

  it('leaves a failure as it was when no case matches it or the case holds no line', () => {
    const failure = { file: 'a.test.ts', name: 'grp > t', message: 'boom' };
    expect(withErrorLines([failure], [])).toEqual([failure]);
    expect(withErrorLines([failure], [{ file: 'a.test.ts', name: 'grp > t', label: 'grp > t', errorLines: [] }])).toEqual([failure]);
    expect(withErrorLines([failure], [{ file: 'b.test.ts', name: 'grp > t', label: 'grp > t', errorLines: ['error: x'] }])).toEqual([failure]);
  });

  it('matches a name that ends in a time of its own by the whole text of the (fail) line', () => {
    const failure = { file: 'a.test.ts', name: 'takes [5ms]' };
    const failed = { file: 'a.test.ts', name: 'takes', label: 'takes [5ms]', errorLines: ['error: x'] };
    expect(withErrorLines([failure], [failed])).toEqual([{ ...failure, errorLines: ['error: x'] }]);
  });

  it('gives a pair two cases share the lines of the first', () => {
    const cases = parseFailedCases(fixture('hooks.stderr.txt'), ['dup.test.ts']);
    // Control: the recording holds `same` twice.
    expect(cases.filter((failed) => failed.name === 'same')).toHaveLength(2);
    expect(withErrorLines([{ file: 'dup.test.ts', name: 'same' }], cases)).toEqual([
      { file: 'dup.test.ts', name: 'same', errorLines: ['error: expect(received).toBe(expected)', 'Expected: 2', 'Received: 1'] },
    ]);
  });
});

describe('failingFilesOf', () => {
  it('answers each file once, in the order first named', () => {
    const failures = parseJunitFailures(fixture('failed-cases.junit.xml')) ?? [];
    // Control: the report names `sub/two.test.ts` three times.
    expect(failures.filter((failure) => failure.file === 'sub/two.test.ts')).toHaveLength(3);
    expect(failingFilesOf(failures)).toEqual(CASES_FILES);
    expect(failingFilesOf([])).toEqual([]);
  });
});

describe('failedCasesLines', () => {
  it('writes each file once above its failed cases, each case\'s lines indented under it', () => {
    const cases = parseFailedCases(fixture('failed-cases.stderr.txt'), CASES_FILES);
    expect(failedCasesLines(cases)).toEqual([
      'timeout.test.ts:',
      '(fail) times out',
      '  this test timed out after 50ms.',
      '',
      'thrown.test.ts:',
      '(fail) stand-in claude > throws before any expect',
      '  UndeclaredSpendError: rafa loop start spends through claude and declared none',
      '  second line of the message',
      '',
      'assertion.test.ts:',
      '(fail) fails an assertion',
      '  error: expect(received).toEqual(expected)',
      '  {',
      '  -   "a": 2,',
      '  +   "a": 1,',
      '  }',
      '',
      'sub/two.test.ts:',
      '(fail) two > first throws a plain error',
      '  error: first boom',
      '(fail) two > second throws a string',
      '  error: second boom',
      '(fail) two > third rejects',
      '  TypeError: third boom',
    ]);
  });

  it('keeps the first cases up to the cap and counts the rest', () => {
    const cases = Array.from({ length: MAX_FAILED_CASES + 3 }, (_, index) => ({ file: 'a.test.ts', name: `t${index}`, label: `t${index}`, errorLines: [] }));
    const lines = failedCasesLines(cases);
    expect(lines.filter((line) => line.startsWith('(fail) '))).toHaveLength(MAX_FAILED_CASES);
    expect(lines.at(-1)).toBe('... 3 more failed cases');
    // Control: at the cap itself no line counts a rest.
    expect(failedCasesLines(cases.slice(0, MAX_FAILED_CASES)).at(-1)).toBe(`(fail) t${MAX_FAILED_CASES - 1}`);
  });

  it('answers no line for no case', () => {
    expect(failedCasesLines([])).toEqual([]);
  });
});

describe('suiteOutputText', () => {
  it('puts the failed cases between the unhandled-error blocks and the summary lines', () => {
    const stderr = fixture('mixed.stderr.txt');
    const cases = parseFailedCases(stderr, ['a.test.ts', 'sub/b.test.ts']);
    expect(suiteOutputText(stderr, cases)).toBe([
      'c.test.ts:',
      '# Unhandled error between tests',
      '-------------------------------',
      'error: Cannot find module \'./nope.js\' from \'/tmp/scratch/c.test.ts\'',
      '-------------------------------',
      '',
      'a.test.ts:',
      '(fail) outer > inner > fails "quoted" & <x>',
      '  error: expect(received).toBe(expected)',
      '  Expected: 2',
      '  Received: 1',
      '',
      'sub/b.test.ts:',
      '(fail) b fails',
      '  error: boom',
      '',
      ' 2 pass',
      ' 1 skip',
      ' 1 todo',
      ' 3 fail',
      ' 1 error',
      ' 3 expect() calls',
      'Ran 7 tests across 3 files. [3.00ms]',
      '',
    ].join('\n'));
  });

  it('writes the summary lines alone for a run with no failed case and no block, and nothing for empty stderr', () => {
    expect(suiteOutputText(fixture('clean.stderr.txt'), [])).toBe(' 1 pass\n 0 fail\nRan 1 test across 1 file. [1.00ms]\n');
    expect(suiteOutputText('', [])).toBe('');
  });
});
