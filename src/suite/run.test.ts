/**
 * Tests for the suite runner (`src/suite/run.ts`).
 *
 * The fixtures under `testdata/` but one were recorded from real runs of
 * bun 1.4.2 over scratch projects, each run as `env -u CLAUDECODE bun test
 * [paths] --reporter=junit --reporter-outfile=<name>.junit.xml` with
 * stderr captured to `<name>.stderr.txt`. Two edits were made after
 * recording, neither touching a name, a count or a summary line: every
 * `hostname` attribute reads `fixture-host`, and every scratch directory
 * in stderr reads `/tmp/scratch`.
 *
 *   - `mixed`: a pass, a failure inside two nested describes whose name
 *     holds quotes, `&` and `<x>`, a skip, a todo, a failure in
 *     `sub/b.test.ts`, and `c.test.ts` importing a missing module. Exit 1.
 *   - `hooks`: failing `beforeAll` and `afterAll`, two failing tests of
 *     one name, a failing `test.each` row, a timeout, an unhandled
 *     rejection inside a test, a file throwing at load, and a file with
 *     no test. Exit 1.
 *   - `errors-only`: two files failing at load and one passing test that
 *     prints ` 5 errors` to stdout. Exit 1, and a JUnit file with no
 *     failure.
 *   - `clean`: `./sub` with one passing test. Exit 0.
 *   - `no-match`: `./nope`. Exit 1, stderr only: Bun wrote no JUnit file.
 *
 * One fixture was recorded the same way under bun 1.3.14, the version
 * `package.json` pins, and is read by `src/triage/inherited.test.ts`:
 *
 *   - `no-message`: one failing `toBe` in `src/parse/parse.test.ts`,
 *     whose `<failure>` carries no `message` attribute (1.4.2 wrote one
 *     for the same test). Exit 1.
 *
 * And one more under 1.3.14, described in `failure-lines.test.ts`:
 *
 *   - `failed-cases`: four files, six failures, none with a `message`
 *     attribute: an error thrown before any `expect`, a failing
 *     `toEqual`, a timeout, and three failures in one file. Exit 1.
 *
 * Runs go through the spawner seam, which plants the recorded JUnit file
 * where it was asked to and answers the recorded stderr; no case spawns
 * `bun`.
 */
import type { SuiteSpawner, SuiteSpawnOptions } from './run.js';

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  CLAUDE_CODE_ENV,
  parseJunitFailures,
  readNoTestFiles,
  readSummary,
  runSuite,
  suiteCommand,
  suiteEnv,
  suitePathArgument,
} from './run.js';

const TESTDATA = join(import.meta.dir, 'testdata');

/** The first line of the message Bun writes for a failing `toBe`. */
const TO_BE = 'expect(received).toBe(expected)';

/** A one-file report whose only testcase, `t`, holds `body`. */
function oneCase(body: string): string {
  return '<testsuites><testsuite name="x.test.ts" file="x.test.ts">'
    + `<testcase name="t" file="x.test.ts">${body}</testcase>`
    + '</testsuite></testsuites>';
}

/** A recorded fixture's text. */
function fixture(file: string): string {
  return readFileSync(join(TESTDATA, file), 'utf8');
}

/** The recorded fixture's failures, which every JUnit fixture parses to. */
function failuresOf(name: string) {
  return parseJunitFailures(fixture(`${name}.junit.xml`));
}

/** One spawn the stand-in saw. */
interface SeenSpawn {
  readonly argv: readonly string[];
  readonly options: SuiteSpawnOptions;
  /** Whether a file sat at the JUnit path when the spawn began. */
  readonly junitPresent: boolean;
}

/**
 * A spawner answering a recorded run: it copies `<name>.junit.xml` to the
 * `--reporter-outfile` path when one was recorded, and answers
 * `<name>.stderr.txt` with `exitCode`.
 */
function recordedSpawner(name: string, exitCode: number, seen: SeenSpawn[]): SuiteSpawner {
  return async (argv, options) => {
    const outfile = argv.find((arg) => arg.startsWith('--reporter-outfile='))?.slice('--reporter-outfile='.length) ?? '';
    seen.push({ argv, options, junitPresent: existsSync(outfile) });
    const recorded = join(TESTDATA, `${name}.junit.xml`);
    if (existsSync(recorded)) copyFileSync(recorded, outfile);
    return { exitCode, stderr: fixture(`${name}.stderr.txt`) };
  };
}

/** Stderr of a run where `sub/f.test.ts` throws while it loads and `a.test.ts` passes. */
const UNHANDLED_STDERR = [
  'bun test v1.4.2',
  '',
  'a.test.ts:',
  '(pass) passes [0.10ms]',
  '',
  'sub/f.test.ts:',
  '',
  '# Unhandled error between tests',
  '-------------------------------',
  ' 9 | const x: any = undefined;',
  '10 | x.foo();',
  '       ^',
  'TypeError: undefined is not an object (evaluating \'(void 0).foo\')',
  '      at /tmp/scratch/sub/f.test.ts:10:3',
  '-------------------------------',
  '',
  '',
  ' 1 pass',
  ' 1 fail',
  ' 1 error',
  'Ran 1 test across 2 files. [12.00ms]',
  '',
].join('\n');

/** The text {@link UNHANDLED_STDERR} leaves beside the JUnit file: the block and the summary lines. */
const UNHANDLED_TEXT = [
  'sub/f.test.ts:',
  '# Unhandled error between tests',
  '-------------------------------',
  ' 9 | const x: any = undefined;',
  '10 | x.foo();',
  '       ^',
  'TypeError: undefined is not an object (evaluating \'(void 0).foo\')',
  '      at /tmp/scratch/sub/f.test.ts:10:3',
  '-------------------------------',
  '',
  ' 1 pass',
  ' 1 fail',
  ' 1 error',
  'Ran 1 test across 2 files. [12.00ms]',
  '',
].join('\n');

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafa-suite-run-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseJunitFailures', () => {
  it('names a nested failure by its describes outermost first, unescaped', () => {
    expect(failuresOf('mixed')).toEqual([
      { file: 'a.test.ts', name: 'outer > inner > fails "quoted" & <x>', message: TO_BE },
      { file: 'sub/b.test.ts', name: 'b fails', message: 'boom' },
    ]);
  });

  it('does not take the name from classname, which holds the chain innermost first', () => {
    // Control: the fixture really does carry the reversed chain, so the
    // assertion above could have read it.
    expect(fixture('mixed.junit.xml')).toContain('classname="inner &gt; outer"');
    expect(failuresOf('mixed')?.map((failure) => failure.name)).not.toContain('inner > outer > fails "quoted" & <x>');
  });

  it('leaves out passing, skipped and todo tests', () => {
    const names = failuresOf('mixed')?.map((failure) => failure.name) ?? [];
    expect(names).not.toContain('passes');
    expect(names).not.toContain('skipped');
    expect(names).not.toContain('todo one');
  });

  it('reads hook failures, a timeout, a rejection and each rows, holding a repeated pair once', () => {
    expect(failuresOf('hooks')).toEqual([
      { file: 'afterall.test.ts', name: '(unnamed)', message: 'aa' },
      { file: 'beforeall.test.ts', name: 'grp > (unnamed)', message: 'ba' },
      { file: 'dup.test.ts', name: 'same', message: TO_BE },
      { file: 'dup.test.ts', name: 'each 2', message: TO_BE },
      { file: 'timeout.test.ts', name: 'slow', message: 'test timed out' },
      { file: 'timeout.test.ts', name: 'rej', message: 'unh' },
    ]);
    // Control: the report holds `same` twice, so holding it once is the parser's doing.
    expect(fixture('hooks.junit.xml').match(/<testcase name="same"/g)).toHaveLength(2);
  });

  it('answers no failure for a file that failed to load, which the report does not hold', () => {
    expect(failuresOf('errors-only')).toEqual([]);
    expect(fixture('errors-only.junit.xml')).not.toContain('a.test.ts');
  });

  it('answers none for a clean run', () => {
    expect(failuresOf('clean')).toEqual([]);
  });

  it('answers null for text that is not a whole report', () => {
    const whole = fixture('mixed.junit.xml');
    expect(parseJunitFailures('')).toBeNull();
    expect(parseJunitFailures(whole.slice(0, whole.indexOf('</testsuites>')))).toBeNull();
    expect(parseJunitFailures('<?xml version="1.0"?><other/>')).toBeNull();
  });

  it('reads an <error> element as a failure, and numeric entities', () => {
    const xml = '<testsuites><testsuite name="x.test.ts" file="x.test.ts">'
      + '<testcase name="a&#10;b&#x21;" file="x.test.ts"><error message="e" /></testcase>'
      + '</testsuite></testsuites>';
    expect(parseJunitFailures(xml)).toEqual([{ file: 'x.test.ts', name: 'a\nb!', message: 'e' }]);
  });
});

describe('parseJunitFailures, the message', () => {
  it('keeps the first line of a <failure message=...>, unescaped, and never the stack in its text', () => {
    const body = '<failure type="Error" message="boom &amp; &lt;x&gt; &quot;q&quot;&#10;second line">'
      + 'Error: boom&#10;      at x.test.ts:3:9&#10;</failure>';

    expect(parseJunitFailures(oneCase(body))).toEqual([{ file: 'x.test.ts', name: 't', message: 'boom & <x> "q"' }]);
  });

  it('keeps the first line of an <error> element\'s message', () => {
    const body = '<error type="TypeError" message="cannot read x&#13;&#10;at y">TypeError: cannot read x</error>';

    expect(parseJunitFailures(oneCase(body))).toEqual([{ file: 'x.test.ts', name: 't', message: 'cannot read x' }]);
  });

  it('takes the first failure element that carries a message', () => {
    const body = '<error type="E">no attribute</error><failure message="second" /><failure message="third" />';

    expect(parseJunitFailures(oneCase(body))).toEqual([{ file: 'x.test.ts', name: 't', message: 'second' }]);
  });

  it('leaves the message out when no element carries one, or its first line is blank', () => {
    // Control: the same failure with a message does carry it, so its absence below is the parser's reading.
    expect(parseJunitFailures(oneCase('<error message="m" />'))?.[0]).toHaveProperty('message', 'm');
    for (const body of ['<error>text only</error>', '<failure message="" />', '<failure message="  &#10;later" />']) {
      expect(parseJunitFailures(oneCase(body))).toEqual([{ file: 'x.test.ts', name: 't' }]);
    }
  });

  it('keeps the message of the first testcase a repeated pair names', () => {
    const xml = '<testsuites><testsuite name="x.test.ts" file="x.test.ts">'
      + '<testcase name="t"><failure message="first" /></testcase>'
      + '<testcase name="t"><failure message="later" /></testcase>'
      + '</testsuite></testsuites>';

    expect(parseJunitFailures(xml)).toEqual([{ file: 'x.test.ts', name: 't', message: 'first' }]);
  });
});

describe('readSummary', () => {
  it('reads the summary line and the error count above it', () => {
    expect(readSummary(fixture('mixed.stderr.txt'))).toEqual({ summary: 'Ran 7 tests across 3 files. [3.00ms]', errors: 1 });
    expect(readSummary(fixture('hooks.stderr.txt')).errors).toBe(1);
  });

  it('reads a plural error line', () => {
    expect(readSummary(fixture('errors-only.stderr.txt'))).toEqual({ summary: 'Ran 3 tests across 3 files. [2.00ms]', errors: 2 });
  });

  it('answers 0 errors for a block with no error line', () => {
    expect(readSummary(fixture('clean.stderr.txt'))).toEqual({ summary: 'Ran 1 test across 1 file. [1.00ms]', errors: 0 });
  });

  it('answers null for both when Bun printed no summary', () => {
    expect(readSummary(fixture('no-match.stderr.txt'))).toEqual({ summary: null, errors: null });
  });

  it('reads only the count lines directly above the summary', () => {
    const stderr = ' 9 errors\n(pass) x\n\n 1 pass\n 0 fail\nRan 1 test across 1 file. [1.00ms]\n';
    expect(readSummary(stderr).errors).toBe(0);
  });
});

describe('readNoTestFiles', () => {
  it('reads Bun\'s no-test-files error, and nothing else, as no test files', () => {
    expect(readNoTestFiles('bun test v1.4.2\nerror: 0 test files matching **{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx} in --cwd="/x"\n')).toBe(true);
    expect(readNoTestFiles('No tests found!\n\nTests need ".test" in the filename\n')).toBe(true);
    expect(readNoTestFiles(fixture('no-match.stderr.txt'))).toBe(false);
    expect(readNoTestFiles(fixture('clean.stderr.txt'))).toBe(false);
  });
});

describe('suiteCommand', () => {
  it('runs the whole project when no paths are handed', () => {
    expect(suiteCommand('/r/junit.xml')).toEqual(['bun', 'test', '--reporter=junit', '--reporter-outfile=/r/junit.xml']);
  });

  it('hands each relative path on as ./<path>, so it is a path and not a substring filter', () => {
    expect(suiteCommand('/r/j.xml', ['src/a.test.ts', './b', '../c', '/abs/d', '-e'])).toEqual([
      'bun',
      'test',
      './src/a.test.ts',
      './b',
      '../c',
      '/abs/d',
      './-e',
      '--reporter=junit',
      '--reporter-outfile=/r/j.xml',
    ]);
    expect(suitePathArgument('sub')).toBe('./sub');
  });

  it('puts --changed=<commit> right after test when a commit is handed, and nothing without one', () => {
    expect(suiteCommand('/r/j.xml', undefined, 'abc123')).toEqual([
      'bun',
      'test',
      '--changed=abc123',
      '--reporter=junit',
      '--reporter-outfile=/r/j.xml',
    ]);
    // Control: the same call without the commit carries no --changed.
    expect(suiteCommand('/r/j.xml').some((part) => part.startsWith('--changed'))).toBe(false);
  });
});

describe('suiteEnv', () => {
  it('drops CLAUDECODE and keeps every other entry, leaving the base as it was', () => {
    const base = { [CLAUDE_CODE_ENV]: '1', PATH: '/bin', HOME: '/h' };
    expect(suiteEnv(base)).toEqual({ PATH: '/bin', HOME: '/h' });
    expect(base[CLAUDE_CODE_ENV]).toBe('1');
  });
});

describe('runSuite', () => {
  it('answers the exit code, summary, errors and failures of a recorded red run', async () => {
    const seen: SeenSpawn[] = [];
    const junitFile = join(dir, 'runs', 'abc', 'task-1.junit.xml');
    const result = await runSuite({ cwd: dir, junitFile, env: { PATH: '/bin', [CLAUDE_CODE_ENV]: '1' }, spawn: recordedSpawner('mixed', 1, seen) });
    expect(result).toEqual({
      command: ['bun', 'test', '--reporter=junit', `--reporter-outfile=${junitFile}`],
      exitCode: 1,
      summary: 'Ran 7 tests across 3 files. [3.00ms]',
      failures: [
        {
          file: 'a.test.ts',
          name: 'outer > inner > fails "quoted" & <x>',
          message: TO_BE,
          errorLines: [`error: ${TO_BE}`, 'Expected: 2', 'Received: 1'],
        },
        { file: 'sub/b.test.ts', name: 'b fails', message: 'boom', errorLines: ['error: boom'] },
      ],
      errors: 1,
      junit: 'read',
      unhandled: [{ file: 'c.test.ts', firstLine: 'error: Cannot find module \'./nope.js\' from \'/tmp/scratch/c.test.ts\'' }],
    });
    expect(seen[0]?.options).toEqual({ cwd: dir, env: { PATH: '/bin' } });
  });

  it('answers the error lines of a failure whose JUnit element says nothing, and keeps them beside the JUnit file', async () => {
    const junitFile = join(dir, 'suite', 'task.junit.xml');
    const result = await runSuite({ cwd: dir, junitFile, spawn: recordedSpawner('failed-cases', 1, []) });
    // Control: the report itself carries no message for any of the six, so the lines below come from stderr alone.
    expect(fixture('failed-cases.junit.xml')).not.toContain('message=');
    expect(result.failures).toHaveLength(6);
    expect(result.failures[1]).toEqual({
      file: 'thrown.test.ts',
      name: 'stand-in claude > throws before any expect',
      errorLines: ['UndeclaredSpendError: rafa loop start spends through claude and declared none', 'second line of the message'],
    });
    expect(result.failures[0]?.errorLines).toEqual(['this test timed out after 50ms.']);
    const kept = readFileSync(join(dir, 'suite', 'task.output.txt'), 'utf8');
    expect(kept).toContain([
      'thrown.test.ts:',
      '(fail) stand-in claude > throws before any expect',
      '  UndeclaredSpendError: rafa loop start spends through claude and declared none',
      '  second line of the message',
    ].join('\n'));
    expect(kept.endsWith(' 2 pass\n 6 fail\n 3 expect() calls\nRan 8 tests across 4 files. [64.00ms]\n')).toBe(true);
    // Control: neither a passing case nor a stack frame is kept.
    expect(kept).not.toContain('(pass)');
    expect(kept).not.toContain('/tmp/scratch');
  });

  it('leaves the error lines out of a failure whose (fail) line stderr does not hold', async () => {
    const junitFile = join(dir, 'j.xml');
    const spawn: SuiteSpawner = async () => {
      copyFileSync(join(TESTDATA, 'failed-cases.junit.xml'), junitFile);
      return { exitCode: 1, stderr: ' 2 pass\n 6 fail\nRan 8 tests across 4 files. [64.00ms]\n' };
    };
    const result = await runSuite({ cwd: dir, junitFile, spawn });
    expect(result.failures).toHaveLength(6);
    expect(result.failures.every((failure) => !('errorLines' in failure))).toBe(true);
  });

  it('creates the JUnit file\'s directory before the spawn', async () => {
    const junitFile = join(dir, 'deep', 'er', 'j.xml');
    // Control: the directory is not there before the run.
    expect(existsSync(join(dir, 'deep'))).toBe(false);
    const result = await runSuite({ cwd: dir, junitFile, spawn: recordedSpawner('clean', 0, []) });
    expect(result.junit).toBe('read');
  });

  it('removes a stale JUnit file, so a run writing none reads missing rather than the last run', async () => {
    const seen: SeenSpawn[] = [];
    const junitFile = join(dir, 'j.xml');
    writeFileSync(junitFile, fixture('mixed.junit.xml'));
    const result = await runSuite({ cwd: dir, paths: ['nope'], junitFile, spawn: recordedSpawner('no-match', 1, seen) });
    expect(seen[0]?.junitPresent).toBe(false);
    expect(result).toMatchObject({ exitCode: 1, summary: null, errors: null, failures: [], junit: 'missing' });
    expect(result.command).toContain('./nope');
  });

  it('answers a red run with no failure named when every error is outside a test', async () => {
    const result = await runSuite({ cwd: dir, junitFile: join(dir, 'j.xml'), spawn: recordedSpawner('errors-only', 1, []) });
    expect(result).toMatchObject({ exitCode: 1, failures: [], errors: 2, junit: 'read' });
  });

  it('answers unreadable for a JUnit file that is not a whole report', async () => {
    const junitFile = join(dir, 'j.xml');
    const spawn: SuiteSpawner = async () => {
      writeFileSync(junitFile, '<testsuites><testsuite name="a.test.ts">');
      return { exitCode: 1, stderr: '' };
    };
    const result = await runSuite({ cwd: dir, junitFile, spawn });
    expect(result).toMatchObject({ junit: 'unreadable', failures: [] });
  });

  it('spawns the --changed selection when changedSince is handed', async () => {
    const seen: SeenSpawn[] = [];
    const junitFile = join(dir, 'j.xml');
    const result = await runSuite({ cwd: dir, junitFile, changedSince: 'base1', spawn: recordedSpawner('clean', 0, seen) });
    expect(result.command).toEqual(['bun', 'test', '--changed=base1', '--reporter=junit', `--reporter-outfile=${junitFile}`]);
    expect(seen[0]?.argv).toEqual(result.command);
  });

  it('refuses an empty path list rather than running the whole project', async () => {
    const seen: SeenSpawn[] = [];
    const run = runSuite({ cwd: dir, paths: [], junitFile: join(dir, 'j.xml'), spawn: recordedSpawner('clean', 0, seen) });
    expect(run).rejects.toThrow(RangeError);
    expect(seen).toHaveLength(0);
  });

  it('answers the file and first line of an error outside a test, and writes the block and summary beside the JUnit file', async () => {
    const junitFile = join(dir, 'suite', 'task.junit.xml');
    const outputFile = join(dir, 'suite', 'task.output.txt');
    let outputPresent = true;
    const spawn: SuiteSpawner = async () => {
      outputPresent = existsSync(outputFile);
      writeFileSync(junitFile, '<testsuites><testsuite name="a.test.ts" file="a.test.ts"><testcase name="passes" file="a.test.ts"/></testsuite></testsuites>');
      return { exitCode: 1, stderr: UNHANDLED_STDERR };
    };
    mkdirSync(join(dir, 'suite'));
    writeFileSync(outputFile, 'stale output from the last run\n');
    const result = await runSuite({ cwd: dir, junitFile, spawn });
    // Control: the stale text sat there before the run, so its absence at the spawn is the removal.
    expect(outputPresent).toBe(false);
    expect(result.unhandled).toEqual([{ file: 'sub/f.test.ts', firstLine: 'TypeError: undefined is not an object (evaluating \'(void 0).foo\')' }]);
    expect(result).toMatchObject({ exitCode: 1, failures: [], errors: 1, junit: 'read' });
    expect(readFileSync(outputFile, 'utf8')).toBe(UNHANDLED_TEXT);
  });

  it('answers no unhandled error and writes the summary alone for a clean run', async () => {
    const junitFile = join(dir, 'clean.junit.xml');
    const result = await runSuite({ cwd: dir, junitFile, spawn: recordedSpawner('clean', 0, []) });
    expect(result.unhandled).toEqual([]);
    expect(readFileSync(join(dir, 'clean.output.txt'), 'utf8')).toBe(' 1 pass\n 0 fail\nRan 1 test across 1 file. [1.00ms]\n');
  });

  it('reads process.env when no environment is handed, without CLAUDECODE', async () => {
    const seen: SeenSpawn[] = [];
    await runSuite({ cwd: dir, junitFile: join(dir, 'j.xml'), spawn: recordedSpawner('clean', 0, seen) });
    expect(seen[0]?.options.env['PATH']).toBe(process.env['PATH']);
    expect(CLAUDE_CODE_ENV in (seen[0]?.options.env ?? {})).toBe(false);
  });
});
