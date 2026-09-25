/**
 * Tests for the `provenance` field both checkers read.
 *
 * Each refusal is asserted as a code AND a field and sits beside the
 * nearly-identical value that passes, so a module refusing everything
 * fails the passing half. The YAML cases parse real frontmatter text
 * through `readFrontmatter`, which is where the readings in the module
 * note (a flow mapping holding a URL, an unquoted date staying a string)
 * are measured rather than assumed. The set of codes is closed at both
 * ends by the last block.
 */
import { describe, expect, test } from 'bun:test';

import { readFrontmatter } from './frontmatter.js';
import {
  FIRST_PARTY,
  PROVENANCE_ISSUE_CODES,
  PROVENANCE_KEYS,
  checkProvenance,
  readProvenance,
  reviewProblem,
} from './provenance.js';

/** The issues for `provenance: value`, as `code@field`. */
function marks(value: unknown): string[] {
  return checkProvenance({ provenance: value }).map((found) => `${found.code}@${found.field}`);
}

/** A complete third-party mapping. */
const THIRD_PARTY = {
  origin: 'https://github.com/example/agents',
  license: 'MIT',
  reviewed: 'marcos 2026-09-24',
} as const;

describe('an absent field', () => {
  test('is no issue and reads as null', () => {
    expect(checkProvenance({ name: 'x' })).toEqual([]);
    expect(readProvenance({ name: 'x' })).toBeNull();
  });
});

describe('the string shape', () => {
  test('first-party passes', () => {
    expect(marks(FIRST_PARTY)).toEqual([]);
    expect(readProvenance({ provenance: FIRST_PARTY })).toEqual({ kind: 'first-party' });
  });

  test('any other string is unknown', () => {
    const [found] = checkProvenance({ provenance: 'First-Party' });

    expect(found).toEqual({
      code: 'unknown-provenance',
      field: 'provenance',
      message: 'provenance "First-Party" is neither first-party nor a mapping of origin and license',
    });
    expect(readProvenance({ provenance: 'First-Party' })).toBeNull();
  });

  test('an empty string and an empty value are missing', () => {
    expect(marks('')).toEqual(['missing-field@provenance']);
    expect(marks('  ')).toEqual(['missing-field@provenance']);
    expect(marks(null)).toEqual(['missing-field@provenance']);
  });

  test('a list, a number and a boolean are wrongly typed', () => {
    expect(marks(['first-party'])).toEqual(['wrong-type@provenance']);
    expect(marks(1)).toEqual(['wrong-type@provenance']);
    expect(marks(true)).toEqual(['wrong-type@provenance']);
  });
});

describe('the mapping shape', () => {
  test('a reviewed mapping passes and reads every entry', () => {
    expect(marks(THIRD_PARTY)).toEqual([]);
    expect(readProvenance({ provenance: THIRD_PARTY })).toEqual({
      kind: 'third-party',
      origin: 'https://github.com/example/agents',
      license: 'MIT',
      reviewed: { who: 'marcos', date: '2026-09-24' },
    });
  });

  test('an unreviewed mapping passes and reads reviewed as null', () => {
    const value = { origin: THIRD_PARTY.origin, license: 'MIT' };

    expect(marks(value)).toEqual([]);
    expect(readProvenance({ provenance: value })).toEqual({
      kind: 'third-party',
      origin: THIRD_PARTY.origin,
      license: 'MIT',
      reviewed: null,
    });
  });

  test('a reviewer of several words is kept whole', () => {
    const value = { ...THIRD_PARTY, reviewed: 'Marcos T. 2026-09-24' };

    expect(readProvenance({ provenance: value })).toMatchObject({
      reviewed: { who: 'Marcos T.', date: '2026-09-24' },
    });
  });

  test('origin and license are each required', () => {
    expect(marks({ license: 'MIT' })).toEqual(['missing-field@provenance.origin']);
    expect(marks({ origin: 'x' })).toEqual(['missing-field@provenance.license']);
    expect(marks({})).toEqual([
      'missing-field@provenance.origin',
      'missing-field@provenance.license',
    ]);
  });

  test('a blank or non-string entry is refused on that entry', () => {
    expect(marks({ origin: ' ', license: 'MIT' })).toEqual(['missing-field@provenance.origin']);
    expect(marks({ origin: 'x', license: 2 })).toEqual(['wrong-type@provenance.license']);
    expect(marks({ origin: 'x', license: 'MIT', reviewed: null }))
      .toEqual(['wrong-type@provenance.reviewed']);
  });

  test('an unknown key is refused, so a typo cannot read as unreviewed', () => {
    const value = { origin: 'x', license: 'MIT', review: 'marcos 2026-09-24' };

    expect(marks(value)).toEqual(['unknown-provenance@provenance.review']);
    expect(checkProvenance({ provenance: value })[0]?.message)
      .toBe(`review is not a provenance key; the keys are ${PROVENANCE_KEYS.join(', ')}`);
    expect(readProvenance({ provenance: value })).toBeNull();
  });
});

describe('reviewed', () => {
  test('<who> <YYYY-MM-DD> on a real day passes', () => {
    expect(reviewProblem('marcos 2026-09-24')).toBeNull();
    expect(reviewProblem('marcos 2028-02-29')).toBeNull();
  });

  test('a date alone, a name alone and a reversed order are refused', () => {
    for (const text of ['2026-09-24', 'marcos', '2026-09-24 marcos', 'marcos 24-09-2026']) {
      expect(marks({ origin: 'x', license: 'MIT', reviewed: text }))
        .toEqual(['invalid-reviewed@provenance.reviewed']);
    }
  });

  test('a day the calendar does not have is refused, and its neighbour passes', () => {
    expect(reviewProblem('marcos 2026-02-30')).toBe('names 2026-02-30, which is not a day on the calendar');
    expect(reviewProblem('marcos 2027-02-29')).toBe('names 2027-02-29, which is not a day on the calendar');
    expect(reviewProblem('marcos 2026-02-28')).toBeNull();
  });
});

describe('as Bun.YAML reads frontmatter text', () => {
  test('a flow mapping holding a URL reads as two strings', () => {
    const data = readFrontmatter([
      '---',
      'name: x',
      'provenance: { origin: https://github.com/example/agents, license: MIT }',
      '---',
      '',
    ].join('\n'));

    expect(data?.['provenance']).toEqual({ origin: 'https://github.com/example/agents', license: 'MIT' });
    expect(checkProvenance(data!)).toEqual([]);
  });

  test('an unquoted date in reviewed stays a string', () => {
    const data = readFrontmatter([
      '---',
      'provenance:',
      '  origin: x',
      '  license: MIT',
      '  reviewed: 2026-09-24',
      '---',
      '',
    ].join('\n'));

    expect(typeof (data?.['provenance'] as Record<string, unknown>)['reviewed']).toBe('string');
    expect(checkProvenance(data!).map((found) => found.code)).toEqual(['invalid-reviewed']);
  });

  test('an unquoted first-party reads as the string', () => {
    const data = readFrontmatter('---\nprovenance: first-party\n---\n');

    expect(readProvenance(data!)).toEqual({ kind: 'first-party' });
  });
});

/** One value per code, so the set of codes is closed at both ends. */
const CODE_EXAMPLES: Readonly<Record<string, unknown>> = {
  'missing-field': { origin: 'x' },
  'wrong-type': 3,
  'unknown-provenance': 'ours',
  'invalid-reviewed': { origin: 'x', license: 'MIT', reviewed: 'nobody' },
};

describe('every code is reachable', () => {
  for (const [code, value] of Object.entries(CODE_EXAMPLES)) {
    test(`${code} is produced`, () => {
      expect(checkProvenance({ provenance: value }).map((found): string => found.code)).toContain(code);
    });
  }

  test('the codes the examples produce are exactly the declared set', () => {
    expect(Object.keys(CODE_EXAMPLES).sort()).toEqual([...PROVENANCE_ISSUE_CODES].sort());
  });
});
