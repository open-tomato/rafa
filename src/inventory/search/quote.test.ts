/**
 * Tests for the quote check.
 *
 * The file-level tests read `testdata/corpus/documentation/SKILL.md`,
 * whose line 11 is `Every exported symbol carries a TSDoc block.`. Each
 * dropped reading is paired with a kept one that differs in one thing,
 * so a check that dropped everything, or kept everything, could not
 * pass.
 */
import type { SearchMatch } from './block.js';

import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { checkQuotes, QUOTE_WINDOW, quoteFound } from './quote.js';

const CORPUS = join(import.meta.dir, 'testdata', 'corpus');

const FILES: ReadonlyMap<string, string> = new Map([
  ['documentation', join(CORPUS, 'documentation', 'SKILL.md')],
  ['gate-order', join(CORPUS, 'gate-order', 'SKILL.md')],
]);

const TRUE_QUOTE: SearchMatch = {
  name: 'documentation',
  why: 'owns TSDoc blocks',
  quote: 'Every exported symbol carries a TSDoc block',
  line: 11,
};

const INVENTED_QUOTE: SearchMatch = {
  name: 'gate-order',
  why: 'orders the gates',
  quote: 'Always run lint before the tests',
  line: 9,
};

/** Twenty numbered lines, `line 1` to `line 20`. */
const NUMBERED = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');

describe('checkQuotes over one true and one invented quote', () => {
  test('keeps the true quote and counts the invented one as dropped', async () => {
    const check = await checkQuotes([TRUE_QUOTE, INVENTED_QUOTE], FILES);

    expect(check.kept).toEqual([TRUE_QUOTE]);
    expect(check.dropped).toBe(1);
  });

  test('the invented quote\'s file does hold a real sentence near its line', async () => {
    const real = { ...INVENTED_QUOTE, quote: 'Run the tests, then the type check, then lint.' };

    const check = await checkQuotes([real], FILES);

    expect(check).toEqual({ kept: [real], dropped: 0 });
  });

  test('drops the true quote cited far from its line', async () => {
    const check = await checkQuotes([{ ...TRUE_QUOTE, line: 41 }], FILES);

    expect(check).toEqual({ kept: [], dropped: 1 });
  });

  test('drops a match whose name has no file, or whose file does not read', async () => {
    const missing = new Map([['documentation', join(CORPUS, 'absent', 'SKILL.md')]]);

    expect(await checkQuotes([TRUE_QUOTE], new Map())).toEqual({ kept: [], dropped: 1 });
    expect(await checkQuotes([TRUE_QUOTE], missing)).toEqual({ kept: [], dropped: 1 });
  });

  test('answers nothing kept and nothing dropped for no matches', async () => {
    expect(await checkQuotes([], FILES)).toEqual({ kept: [], dropped: 0 });
  });
});

describe('quoteFound', () => {
  test('finds a quote exactly three lines either side, and not four', () => {
    expect(QUOTE_WINDOW).toBe(3);
    expect(quoteFound(NUMBERED, 'line 7', 10)).toBe(true);
    expect(quoteFound(NUMBERED, 'line 13', 10)).toBe(true);
    expect(quoteFound(NUMBERED, 'line 6', 10)).toBe(false);
    expect(quoteFound(NUMBERED, 'line 14', 10)).toBe(false);
  });

  test('clamps the window at the file\'s ends', () => {
    expect(quoteFound(NUMBERED, 'line 1', 1)).toBe(true);
    expect(quoteFound(NUMBERED, 'line 20', 20)).toBe(true);
    expect(quoteFound(NUMBERED, 'line 20', 21)).toBe(true);
    expect(quoteFound(NUMBERED, 'line 20', 24)).toBe(false);
  });

  test('normalizes whitespace, so a quote wrapped across two lines counts', () => {
    const text = 'Every exported symbol\n   carries a\tTSDoc block.';

    expect(quoteFound(text, '  Every exported symbol carries a TSDoc block ', 1)).toBe(true);
    expect(quoteFound(text, 'Every exported symbol carries a TSDoc blocks', 1)).toBe(false);
  });

  test('compares case and punctuation as written', () => {
    expect(quoteFound('Run the tests.', 'Run the tests.', 1)).toBe(true);
    expect(quoteFound('Run the tests.', 'run the tests.', 1)).toBe(false);
    expect(quoteFound('Run the tests.', 'Run the tests!', 1)).toBe(false);
  });

  test('never finds a blank quote', () => {
    expect(quoteFound(NUMBERED, '  \n ', 10)).toBe(false);
  });
});
