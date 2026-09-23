import type { CheckIssue } from '../check/run.js';

import { describe, expect, test } from 'bun:test';

import { countCharacters } from '../schema/skill.js';

import {
  checkVerdict,
  EMPTY_FRONTMATTER,
  readInventoryFrontmatter,
  readInventoryText,
  summarize,
  SUMMARY_LIMIT,
} from './record.js';

/** One checker issue of `severity`, the other fields filler. */
function issue(severity: CheckIssue['severity']): CheckIssue {
  return {
    stage: 'schema',
    code: 'missing-field',
    severity,
    field: 'tags',
    line: null,
    message: 'tags is required',
  };
}

describe('summarize', () => {
  test('the limit is the checker\'s description cap, 130', () => {
    expect(SUMMARY_LIMIT).toBe(130);
  });

  test('a description the checker passes is kept whole', () => {
    const description = 'a'.repeat(129);
    expect(summarize(description)).toBe(description);
  });

  test('a description of exactly 130 characters is kept whole', () => {
    const description = 'b'.repeat(130);
    expect(summarize(description)).toBe(description);
  });

  test('a longer description is cut to its first 130 characters', () => {
    const description = `${'c'.repeat(130)}TAIL`;
    const summary = summarize(description);
    expect(summary).toBe('c'.repeat(130));
    expect(summary).not.toContain('TAIL');
  });

  test('the cut counts codepoints and never splits an emoji', () => {
    const description = '🍅'.repeat(140);
    const summary = summarize(description);
    expect(countCharacters(summary)).toBe(130);
    expect(summary).toBe('🍅'.repeat(130));
    // Control: String.length counts each emoji twice, so a cut by length
    // would have kept only 65 of them.
    expect(summary.length).toBe(260);
  });

  test('whitespace runs and newlines collapse to one space', () => {
    expect(summarize('  Reads the\n  plan,\tthen   acts.  ')).toBe('Reads the plan, then acts.');
  });

  test('a cut landing on a space leaves no trailing space', () => {
    const description = `${'d'.repeat(129)} more words`;
    expect(summarize(description)).toBe('d'.repeat(129));
  });

  test('no description is an empty summary', () => {
    expect(summarize(null)).toBe('');
  });
});

describe('readInventoryFrontmatter', () => {
  test('null data reads as the empty reading', () => {
    expect(readInventoryFrontmatter(null)).toEqual(EMPTY_FRONTMATTER);
  });

  test('reads all five keys', () => {
    const reading = readInventoryFrontmatter({
      name: 'tdd-guide',
      description: 'Writes the test first',
      when_to_use: 'When a feature starts',
      prevents: 'untested code',
      tags: ['testing', 'tdd'],
      stack: ['agnostic'],
    });

    expect(reading).toEqual({
      description: 'Writes the test first',
      whenToUse: 'When a feature starts',
      prevents: 'untested code',
      tags: ['testing', 'tdd'],
      stack: ['agnostic'],
    });
  });

  test('absent keys read as null and empty lists', () => {
    expect(readInventoryFrontmatter({ name: 'bare' })).toEqual(EMPTY_FRONTMATTER);
  });

  test('a key of the wrong type reads as absent', () => {
    const reading = readInventoryFrontmatter({
      description: 42,
      when_to_use: ['a list'],
      prevents: { nested: true },
      tags: 7,
      stack: { typescript: true },
    });

    expect(reading).toEqual(EMPTY_FRONTMATTER);
  });

  test('blank strings read as absent and text is trimmed', () => {
    const reading = readInventoryFrontmatter({
      description: '  Trimmed  ',
      when_to_use: '   ',
      prevents: '',
    });

    expect(reading.description).toBe('Trimmed');
    expect(reading.whenToUse).toBeNull();
    expect(reading.prevents).toBeNull();
  });

  test('list entries that are not strings or are blank are dropped', () => {
    const reading = readInventoryFrontmatter({
      tags: [' kept ', 3, null, '', 'also-kept'],
      stack: ['typescript', { bun: true }],
    });

    expect(reading.tags).toEqual(['kept', 'also-kept']);
    expect(reading.stack).toEqual(['typescript']);
  });

  test('a bare string list key reads as a list of one', () => {
    const reading = readInventoryFrontmatter({ tags: 'solo', stack: 'agnostic' });
    expect(reading.tags).toEqual(['solo']);
    expect(reading.stack).toEqual(['agnostic']);
  });

  test('stack names outside the vocabulary are kept as written', () => {
    const reading = readInventoryFrontmatter({ stack: ['kotlin-jvm'] });
    expect(reading.stack).toEqual(['kotlin-jvm']);
  });

  test('the full description is read, the cut is summarize\'s', () => {
    const description = 'e'.repeat(200);
    expect(readInventoryFrontmatter({ description }).description).toBe(description);
  });
});

describe('readInventoryText', () => {
  test('reads the keys from a file\'s YAML block', () => {
    const text = [
      '---',
      'name: planner',
      'description: >-',
      '  Plans the work',
      '  before it starts',
      'when_to_use: Before a large change',
      'prevents: rework',
      'tags:',
      '  - planning',
      'stack: [agnostic]',
      '---',
      '',
      '# Planner',
      '',
    ].join('\n');

    expect(readInventoryText(text)).toEqual({
      description: 'Plans the work before it starts',
      whenToUse: 'Before a large change',
      prevents: 'rework',
      tags: ['planning'],
      stack: ['agnostic'],
    });
  });

  test('a file with no frontmatter reads as the empty reading', () => {
    expect(readInventoryText('# Just a body\n')).toEqual(EMPTY_FRONTMATTER);
  });

  test('an unclosed block reads as the empty reading', () => {
    expect(readInventoryText('---\ndescription: never closed\n')).toEqual(EMPTY_FRONTMATTER);
  });

  test('a block that is not YAML the parser accepts reads as the empty reading', () => {
    const text = '---\ndescription: Probe: answers one literal\n---\n';
    expect(readInventoryText(text)).toEqual(EMPTY_FRONTMATTER);
  });
});

describe('checkVerdict', () => {
  test('no issues is pass', () => {
    expect(checkVerdict([])).toBe('pass');
  });

  test('warnings only is warn', () => {
    expect(checkVerdict([issue('warning'), issue('warning')])).toBe('warn');
  });

  test('any failure is fail', () => {
    expect(checkVerdict([issue('warning'), issue('failure')])).toBe('fail');
  });
});
