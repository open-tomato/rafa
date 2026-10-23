/**
 * Tests for the `rafa:search` block parser.
 *
 * Each absence test is paired with the clean answer it departs from, so
 * a parser that answered an absence for every input could not pass: the
 * clean block reads present, and the same block cut one way reads the
 * absence named.
 */
import type { SearchBlockReading } from './block.js';

import { describe, expect, test } from 'bun:test';

import { parseSearchBlock } from './block.js';
import { renderSearchPrompt } from './prompt.js';

const CANDIDATES = ['documentation', 'coding-style'];

/** Fences `body` as a `rafa:search` block after a line of prose. */
function answer(body: string, fence = 'rafa:search'): string {
  return ['I read both candidates.', '', '```' + fence, body, '```', ''].join('\n');
}

const CLEAN_BODY = [
  'matches:',
  '  - name: documentation',
  '    why: "owns TSDoc blocks and inline comment rules"',
  '    quote: "Every exported symbol carries a TSDoc block"',
  '    line: 41',
  'unanswerable: false',
].join('\n');

/** The reading's absence reason, or `present`. */
function outcome(reading: SearchBlockReading): string {
  return reading.present
    ? 'present'
    : reading.reason;
}

describe('a clean answer', () => {
  test('reads its match as written', () => {
    const reading = parseSearchBlock(answer(CLEAN_BODY), CANDIDATES);

    expect(reading.present).toBe(true);
    if (!reading.present) return;
    expect(reading.unanswerable).toBe(false);
    expect(reading.issues).toEqual([]);
    expect(reading.matches).toEqual([{
      name: 'documentation',
      why: 'owns TSDoc blocks and inline comment rules',
      quote: 'Every exported symbol carries a TSDoc block',
      line: 41,
    }]);
  });

  test('the prompt\'s own example block reads as one match', () => {
    const prompt = renderSearchPrompt({
      kind: 'skill',
      question: 'how are comments written',
      candidates: [{ name: 'documentation', file: 'documentation/SKILL.md' }],
    });
    const reading = parseSearchBlock(prompt, ['documentation']);

    expect(reading.present && reading.matches.map((match) => match.name)).toEqual(['documentation']);
  });

  test('only the last rafa:search block counts', () => {
    const draft = answer('matches: []\nunanswerable: true');
    const reading = parseSearchBlock(draft + answer(CLEAN_BODY), CANDIDATES);

    expect(reading.present && reading.matches.length).toBe(1);
  });
});

describe('an absent block', () => {
  test('output with no block at all reads no-block', () => {
    const reading = parseSearchBlock('None of these answer the question.', CANDIDATES);

    expect(outcome(reading)).toBe('no-block');
    expect(reading.present || reading.block).toBeNull();
  });

  test('a block of another kind reads no-block', () => {
    expect(outcome(parseSearchBlock(answer(CLEAN_BODY, 'rafa:report'), CANDIDATES))).toBe('no-block');
    expect(outcome(parseSearchBlock(answer(CLEAN_BODY, 'yaml'), CANDIDATES))).toBe('no-block');
  });

  test('a block quoted inside a longer fence reads no-block', () => {
    const illustrated = ['````markdown', answer(CLEAN_BODY), '````'].join('\n');

    expect(outcome(parseSearchBlock(illustrated, CANDIDATES))).toBe('no-block');
  });

  test('an unclosed block is not read', () => {
    const cut = ['```rafa:search', CLEAN_BODY].join('\n');

    expect(outcome(parseSearchBlock(cut, CANDIDATES))).toBe('unclosed-block');
  });
});

describe('a malformed block', () => {
  test('a body that is not YAML reads malformed and keeps its raw body', () => {
    const body = CLEAN_BODY.replace(
      '"owns TSDoc blocks and inline comment rules"',
      'owns: TSDoc blocks',
    );
    const reading = parseSearchBlock(answer(body), CANDIDATES);

    expect(outcome(reading)).toBe('malformed-block');
    expect(reading.present || reading.block?.body).toBe(body);
  });

  test('a body that is a list reads malformed', () => {
    expect(outcome(parseSearchBlock(answer('- documentation'), CANDIDATES))).toBe('malformed-block');
  });

  test('an empty body reads malformed', () => {
    expect(outcome(parseSearchBlock(answer(''), CANDIDATES))).toBe('malformed-block');
  });

  test('a missing or quoted unanswerable reads malformed', () => {
    const missing = CLEAN_BODY.replace('unanswerable: false', '');
    const quoted = CLEAN_BODY.replace('unanswerable: false', 'unanswerable: "false"');

    expect(outcome(parseSearchBlock(answer(missing), CANDIDATES))).toBe('malformed-block');
    expect(outcome(parseSearchBlock(answer(quoted), CANDIDATES))).toBe('malformed-block');
  });

  test('matches that is not a list reads malformed', () => {
    const body = 'matches: documentation\nunanswerable: false';

    expect(outcome(parseSearchBlock(answer(body), CANDIDATES))).toBe('malformed-block');
  });

  test('a malformed last block is not replaced by an earlier clean one', () => {
    const reading = parseSearchBlock(answer(CLEAN_BODY) + answer('- x'), CANDIDATES);

    expect(outcome(reading)).toBe('malformed-block');
  });
});

describe('unanswerable: true', () => {
  test('with an empty list reads present with no matches', () => {
    const reading = parseSearchBlock(answer('matches: []\nunanswerable: true'), CANDIDATES);

    expect(reading.present).toBe(true);
    if (!reading.present) return;
    expect(reading.unanswerable).toBe(true);
    expect(reading.matches).toEqual([]);
    expect(reading.issues).toEqual([]);
  });

  test('with matches absent reads the same', () => {
    const reading = parseSearchBlock(answer('unanswerable: true'), CANDIDATES);

    expect(reading.present && reading.unanswerable).toBe(true);
  });

  test('with a match listed contradicts itself and reads malformed', () => {
    const body = CLEAN_BODY.replace('unanswerable: false', 'unanswerable: true');

    expect(outcome(parseSearchBlock(answer(body), CANDIDATES))).toBe('malformed-block');
  });
});

describe('entries', () => {
  /** The body with `entry` listed after the clean match. */
  function withEntry(...entry: string[]): string {
    return CLEAN_BODY.replace('unanswerable: false', [...entry, 'unanswerable: false'].join('\n'));
  }

  const DROPS: readonly (readonly [string, string, string[]])[] = [
    ['a scalar entry', 'matches[1]', ['  - coding-style']],
    ['a missing quote', 'matches[1].quote', [
      '  - name: coding-style',
      '    why: "covers naming"',
      '    line: 3',
    ]],
    ['a blank why', 'matches[1].why', [
      '  - name: coding-style',
      '    why: "  "',
      '    quote: "Names are camelCase"',
      '    line: 3',
    ]],
    ['a quoted line number', 'matches[1].line', [
      '  - name: coding-style',
      '    why: "covers naming"',
      '    quote: "Names are camelCase"',
      '    line: "3"',
    ]],
    ['line zero', 'matches[1].line', [
      '  - name: coding-style',
      '    why: "covers naming"',
      '    quote: "Names are camelCase"',
      '    line: 0',
    ]],
    ['a name that is no candidate', 'matches[1].name', [
      '  - name: security',
      '    why: "covers secrets"',
      '    quote: "Never hardcode secrets"',
      '    line: 3',
    ]],
  ];

  for (const [what, field, entry] of DROPS) {
    test(`${what} is dropped and the clean match kept`, () => {
      const reading = parseSearchBlock(answer(withEntry(...entry)), CANDIDATES);

      expect(reading.present).toBe(true);
      if (!reading.present) return;
      expect(reading.matches.map((match) => match.name)).toEqual(['documentation']);
      expect(reading.issues).toHaveLength(1);
      expect(reading.issues[0]?.text).toStartWith(field);
      expect(reading.issues[0]?.text).toEndWith('; dropped');
    });
  }

  test('a usable second entry is kept, in the order written (control)', () => {
    const reading = parseSearchBlock(answer(withEntry(
      '  - name: coding-style',
      '    why: "covers naming"',
      '    quote: "Names are camelCase"',
      '    line: 3',
    )), CANDIDATES);

    expect(reading.present && reading.matches.map((match) => match.name))
      .toEqual(['documentation', 'coding-style']);
    expect(reading.present && reading.issues).toEqual([]);
  });

  test('a second entry naming the same candidate is dropped', () => {
    const reading = parseSearchBlock(answer(withEntry(
      '  - name: documentation',
      '    why: "again"',
      '    quote: "Another line"',
      '    line: 7',
    )), CANDIDATES);

    expect(reading.present && reading.matches.map((match) => match.line)).toEqual([41]);
    expect(reading.present && reading.issues.map((issue) => issue.field)).toEqual(['matches[1]']);
  });

  test('strings are kept as written, never trimmed', () => {
    const body = CLEAN_BODY.replace(
      '"Every exported symbol carries a TSDoc block"',
      '"  Every exported   symbol "',
    );
    const reading = parseSearchBlock(answer(body), CANDIDATES);

    expect(reading.present && reading.matches[0]?.quote).toBe('  Every exported   symbol ');
  });

  test('an unknown key is ignored at either level', () => {
    const body = withEntry().replace('    line: 41', '    line: 41\n    score: 9') + '\nnote: extra';
    const reading = parseSearchBlock(answer(body), CANDIDATES);

    expect(reading.present && reading.matches[0]).toEqual({
      name: 'documentation',
      why: 'owns TSDoc blocks and inline comment rules',
      quote: 'Every exported symbol carries a TSDoc block',
      line: 41,
    });
  });
});
