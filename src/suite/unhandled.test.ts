/**
 * Tests for the reader of Bun's unhandled-error blocks
 * (`src/suite/unhandled.ts`).
 *
 * The three `unhandled-*` fixtures under `testdata/` were recorded from
 * real runs of bun 1.4.2 over scratch projects, each run as
 * `env -u CLAUDECODE bun test --reporter=junit
 * --reporter-outfile=<name>.junit.xml` with stderr captured to
 * `<name>.stderr.txt`. The one edit after recording is that every
 * scratch directory reads `/tmp/scratch`.
 *
 *   - `unhandled-one`: `throwing.test.ts` throws `config not loaded` while
 *     it loads, and `ok.test.ts` holds a pass and a failing `toBe`.
 *   - `unhandled-two`: `boom.test.ts` throws a `TypeError` while it loads,
 *     `sub/missing.test.ts` imports a missing module, and `ok.test.ts`
 *     holds a pass.
 *   - `unhandled-none`: `ok.test.ts` alone, a pass and a failing `toBe`.
 *
 * Each exited 1.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  MAX_BLOCK_LINES,
  MAX_BLOCKS,
  UNHANDLED_HEADING,
  parseUnhandled,
  unhandledText,
} from './unhandled.js';

/** A recorded fixture's stderr. */
function stderrOf(name: string): string {
  return readFileSync(join(import.meta.dir, 'testdata', `${name}.stderr.txt`), 'utf8');
}

/** The dash line Bun draws above and below a block's body. */
const DASHES = '-------------------------------';

/** One block as Bun prints it, under the header naming `file`. */
function block(file: string, body: readonly string[]): string {
  return ['', `${file}:`, '', UNHANDLED_HEADING, DASHES, ...body, DASHES, '', ''].join('\n');
}

describe('parseUnhandled', () => {
  it('reads the file and the error line of the one block a throwing file leaves', () => {
    expect(parseUnhandled(stderrOf('unhandled-one'))).toEqual([
      { file: 'throwing.test.ts', firstLine: 'error: config not loaded' },
    ]);
  });

  it('reads two blocks in the order Bun printed them, skipping the code frame and caret', () => {
    expect(parseUnhandled(stderrOf('unhandled-two'))).toEqual([
      { file: 'boom.test.ts', firstLine: 'TypeError: undefined is not an object (evaluating \'settings.port.value\')' },
      { file: 'sub/missing.test.ts', firstLine: 'error: Cannot find module \'./gone.js\' from \'/tmp/scratch/sub/missing.test.ts\'' },
    ]);
  });

  it('answers no block for a red run whose only failure is inside a test', () => {
    expect(parseUnhandled(stderrOf('unhandled-none'))).toEqual([]);
  });

  it('answers no block for empty stderr', () => {
    expect(parseUnhandled('')).toEqual([]);
  });

  it('reads a padded code frame past line 9 as frame, not as the error', () => {
    const stderr = block('p.test.ts', [' 9 | // nine', '10 | throw new Error(\'deep\');', '               ^', 'error: deep', '      at /x/p.test.ts:10:11']);
    expect(parseUnhandled(stderr)).toEqual([{ file: 'p.test.ts', firstLine: 'error: deep' }]);
  });

  it('keeps only the first line of a multi-line message', () => {
    const stderr = block('h.test.ts', ['error: multi', 'line message', ' code: "X"']);
    expect(parseUnhandled(stderr)).toEqual([{ file: 'h.test.ts', firstLine: 'error: multi' }]);
  });

  it('names no file for a block with no file header above it', () => {
    const stderr = [UNHANDLED_HEADING, DASHES, 'error: orphan', DASHES].join('\n');
    expect(parseUnhandled(stderr)).toEqual([{ file: null, firstLine: 'error: orphan' }]);
  });

  it('names no error line for a block holding only a code frame', () => {
    const stderr = block('q.test.ts', ['1 | throw x;', '    ^']);
    expect(parseUnhandled(stderr)).toEqual([{ file: 'q.test.ts', firstLine: null }]);
  });

  it('reads a block cut off before its closing dash line up to the end of stderr', () => {
    const stderr = ['r.test.ts:', '', UNHANDLED_HEADING, DASHES, 'error: cut short'].join('\n');
    expect(parseUnhandled(stderr)).toEqual([{ file: 'r.test.ts', firstLine: 'error: cut short' }]);
  });

  it('reads Windows line endings as lines', () => {
    expect(parseUnhandled(stderrOf('unhandled-one').replaceAll('\n', '\r\n'))).toEqual([
      { file: 'throwing.test.ts', firstLine: 'error: config not loaded' },
    ]);
  });
});

describe('unhandledText', () => {
  it('keeps the one block, its file header, and the summary lines, and drops the failing test output', () => {
    expect(unhandledText(stderrOf('unhandled-one'))).toBe([
      'throwing.test.ts:',
      UNHANDLED_HEADING,
      DASHES,
      '1 | import { test } from \'bun:test\';',
      '2 | test(\'never runs\', () => {});',
      '3 | throw new Error(\'config not loaded\');',
      '              ^',
      'error: config not loaded',
      '      at /tmp/scratch/throwing.test.ts:3:11',
      DASHES,
      '',
      ' 1 pass',
      ' 2 fail',
      ' 1 error',
      ' 2 expect() calls',
      'Ran 3 tests across 2 files. [5.00ms]',
      '',
    ].join('\n'));
  });

  it('keeps two blocks, a blank line apart, and leaves out the passing file between them', () => {
    const text = unhandledText(stderrOf('unhandled-two'));
    expect(text.split('\n').filter((line) => line.endsWith('.test.ts:'))).toEqual(['boom.test.ts:', 'sub/missing.test.ts:']);
    expect(text).not.toContain('(pass)');
    expect(text).toContain(`${DASHES}\n\nsub/missing.test.ts:\n${UNHANDLED_HEADING}`);
    expect(text.endsWith(' 2 errors\n 1 expect() calls\nRan 3 tests across 3 files. [5.00ms]\n')).toBe(true);
  });

  it('keeps the summary lines only when there is no block', () => {
    expect(unhandledText(stderrOf('unhandled-none'))).toBe([
      ' 1 pass',
      ' 1 fail',
      ' 2 expect() calls',
      'Ran 2 tests across 1 file. [4.00ms]',
      '',
    ].join('\n'));
  });

  it('answers an empty text for stderr with no block and no summary', () => {
    expect(unhandledText('error: something else entirely\n')).toBe('');
  });

  it('caps a block at its first body lines and says how many were left out', () => {
    const body = Array.from({ length: MAX_BLOCK_LINES + 3 }, (_, index) => `line ${index}`);
    const lines = unhandledText(block('long.test.ts', body)).split('\n');
    expect(lines).toContain(`line ${MAX_BLOCK_LINES - 1}`);
    expect(lines).not.toContain(`line ${MAX_BLOCK_LINES}`);
    expect(lines).toContain('... 3 more lines');
    expect(lines.at(-2)).toBe(DASHES);
  });

  it('caps the blocks kept and says how many were left out, while the list keeps them all', () => {
    const stderr = Array.from({ length: MAX_BLOCKS + 2 }, (_, index) => block(`f${index}.test.ts`, [`error: e${index}`])).join('');
    const text = unhandledText(stderr);
    expect(text).toContain(`f${MAX_BLOCKS - 1}.test.ts:`);
    expect(text).not.toContain(`f${MAX_BLOCKS}.test.ts:`);
    expect(text).toContain('... 2 more unhandled error blocks');
    expect(parseUnhandled(stderr)).toHaveLength(MAX_BLOCKS + 2);
  });
});
