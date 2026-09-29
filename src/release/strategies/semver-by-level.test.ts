/**
 * Golden tests for the `semver-by-level` strategy
 * (`src/release/strategies/semver-by-level.ts`): the version's order
 * independence, the highest level winning once, the null cases, the
 * receipt comment, and `{title}` and `{date}` rendering. Every case is
 * a literal; the fold reads nothing else.
 *
 * Things here that would pass while wrong:
 *
 *  - A fold that ignored its fragments would give the same version in
 *    every order, so each order-independence case also pins the version
 *    to the exact string the highest level makes.
 *  - A fold that bumped once per fragment passes a single-fragment case,
 *    so two minors are folded together and must land on ONE minor bump.
 *  - A fold that always answered null passes both null cases, so each is
 *    paired with the same batch plus one `patch` fragment, which must
 *    fold.
 *  - `{date}` taken from the first or the last fragment would pass a
 *    batch whose newest date sits at either end, so the newest sits in
 *    the middle.
 */
import type { Fragment } from '../fragment.js';
import type { FoldFragment } from '../strategy.js';

import { describe, expect, test } from 'bun:test';

import { createSemverByLevel, fragmentsReceipt } from './semver-by-level.js';

const HEADING = '## {version} — {date}, {title}';

const { fold } = createSemverByLevel({ heading: HEADING });

/** A fold fragment with the given id, level, date, title and notes. */
function piece(
  id: string,
  level: Fragment['level'],
  addedOn: string,
  title: string = `title of ${id}`,
  notes: readonly string[] = [`- Area ${id}: note of ${id}`],
): FoldFragment {
  return { id, addedOn, fragment: { plan: id, title, level, notes } };
}

/** Every ordering of `items`. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([
    ...items.slice(0, index),
    ...items.slice(index + 1),
  ]).map((rest) => [item, ...rest]));
}

const PATCH = piece('rafa-1', 'patch', '2026-09-20');
const MINOR = piece('rafa-2', 'minor', '2026-09-21');
const MAJOR = piece('rafa-3', 'major', '2026-09-22');
const NONE = piece('rafa-4', 'none', '2026-09-23', 'a docs tidy', []);

describe('semver-by-level: the version', () => {
  test('is the same in every order of a mixed batch, and is the major bump', () => {
    const batch = [PATCH, MINOR, MAJOR, NONE];
    const versions = permutations(batch).map((order) => fold('0.27.0', order)?.version);
    expect(versions).toHaveLength(24);
    expect(new Set(versions)).toEqual(new Set(['1.0.0']));
  });

  test('is the same in every order of a patch-and-minor batch, and is the minor bump', () => {
    const versions = permutations([PATCH, MINOR, NONE]).map((order) => fold('0.27.3', order)?.version);
    expect(new Set(versions)).toEqual(new Set(['0.28.0']));
  });

  test('moves by the highest level once: two minors make one minor bump', () => {
    const second = piece('rafa-5', 'minor', '2026-09-24');
    expect(fold('0.27.0', [MINOR, second])?.version).toBe('0.28.0');
  });

  test('moves by the highest level once: patches alone make one patch bump', () => {
    const second = piece('rafa-5', 'patch', '2026-09-24');
    expect(fold('0.27.0', [PATCH, second])?.version).toBe('0.27.1');
  });

  test('a none fragment beside a patch leaves the level at patch', () => {
    expect(fold('1.2.3', [NONE, PATCH])?.version).toBe('1.2.4');
  });
});

describe('semver-by-level: nothing to settle', () => {
  test('answers null for no fragment', () => {
    expect(fold('0.27.0', [])).toBeNull();
  });

  test('answers null for only none fragments', () => {
    const second = piece('rafa-5', 'none', '2026-09-24', 'another tidy', []);
    expect(fold('0.27.0', [NONE, second])).toBeNull();
  });

  test('control: the same batch plus one patch fragment folds', () => {
    const second = piece('rafa-5', 'none', '2026-09-24', 'another tidy', []);
    expect(fold('0.27.0', [NONE, second, PATCH])?.version).toBe('0.27.1');
  });

  test('answers null even over an unreadable base, since there is nothing to bump', () => {
    expect(fold('not a version', [NONE])).toBeNull();
  });
});

describe('semver-by-level: refusals are throws', () => {
  test('throws on a base that is no semantic version', () => {
    expect(() => fold('not a version', [PATCH])).toThrow(
      'the base version "not a version" is no semantic version to bump',
    );
  });

  test('throws on an add date that is not YYYY-MM-DD', () => {
    expect(() => fold('0.27.0', [piece('rafa-1', 'patch', '2026-09-20T10:00:00Z')])).toThrow(
      'fragment rafa-1 has add date "2026-09-20T10:00:00Z", expected YYYY-MM-DD',
    );
  });

  test('throws on an id that cannot be one word of the receipt', () => {
    expect(() => fold('0.27.0', [piece('rafa 1', 'patch', '2026-09-20')])).toThrow(
      'fragment id "rafa 1" cannot be one word of the receipt comment',
    );
  });
});

describe('semver-by-level: the section', () => {
  test('golden: heading, receipt under it, notes grouped by area', () => {
    const walk = piece('rafa-247', 'minor', '2026-09-28', 'rafa next --roadmap', [
      '- Walk: one hop to a blocker\'s epic',
      '- CLI: --yes accepts the hop step',
    ]);
    const plans = piece('rafa-234', 'patch', '2026-09-29', 'rafa plan list --open', [
      '- Plans: new rafa plan list --open',
      '- Walk: the hop record stays out of git',
    ]);
    expect(fold('0.27.0', [walk, NONE, plans])).toEqual({
      version: '0.28.0',
      section: [
        '## 0.28.0 — 2026-09-29, rafa next --roadmap; rafa plan list --open',
        '<!-- rafa:fragments rafa-247 rafa-4 rafa-234 -->',
        '',
        '- Walk: one hop to a blocker\'s epic',
        '- Walk: the hop record stays out of git',
        '- CLI: --yes accepts the hop step',
        '- Plans: new rafa plan list --open',
      ].join('\n'),
    });
  });

  test('the receipt names every folded fragment in fold order, none ones included', () => {
    const section = fold('0.27.0', [MAJOR, NONE, PATCH])?.section ?? '';
    expect(section.split('\n')[1]).toBe('<!-- rafa:fragments rafa-3 rafa-4 rafa-1 -->');
  });

  test('the receipt follows fold order: reversing the batch reverses it', () => {
    const section = fold('0.27.0', [PATCH, NONE, MAJOR])?.section ?? '';
    expect(section.split('\n')[1]).toBe('<!-- rafa:fragments rafa-1 rafa-4 rafa-3 -->');
  });

  test('fragmentsReceipt spells the comment', () => {
    expect(fragmentsReceipt(['rafa-247', 'rafa-247-2'])).toBe('<!-- rafa:fragments rafa-247 rafa-247-2 -->');
  });

  test('{title} joins the shipping titles in fold order with "; "', () => {
    const heading = fold('0.27.0', [MINOR, PATCH])?.section.split('\n')[0];
    expect(heading).toBe('## 0.28.0 — 2026-09-21, title of rafa-2; title of rafa-1');
    const reversed = fold('0.27.0', [PATCH, MINOR])?.section.split('\n')[0];
    expect(reversed).toBe('## 0.28.0 — 2026-09-21, title of rafa-1; title of rafa-2');
  });

  test('{title} leaves out a none fragment\'s title and writes a repeated title once', () => {
    const again = piece('rafa-1-2', 'patch', '2026-09-20', 'title of rafa-1');
    const heading = fold('0.27.0', [PATCH, NONE, again])?.section.split('\n')[0];
    expect(heading).toBe('## 0.27.1 — 2026-09-23, title of rafa-1');
  });

  test('{date} is the newest add date among all folded fragments, not the first or the last', () => {
    const early = piece('rafa-1', 'patch', '2026-09-20');
    const newest = piece('rafa-2', 'patch', '2026-10-02');
    const late = piece('rafa-3', 'patch', '2026-09-30');
    const heading = fold('0.27.0', [early, newest, late])?.section.split('\n')[0] ?? '';
    expect(heading.startsWith('## 0.27.1 — 2026-10-02,')).toBe(true);
  });

  test('{date} counts a none fragment\'s add date', () => {
    const heading = fold('0.27.0', [PATCH, NONE])?.section.split('\n')[0];
    expect(heading).toBe('## 0.27.1 — 2026-09-23, title of rafa-1');
  });

  test('renders a configured heading template', () => {
    const custom = createSemverByLevel({ heading: '### v{version} ({date}) {title} {unknown}' });
    const heading = custom.fold('1.0.0', [MINOR])?.section.split('\n')[0];
    expect(heading).toBe('### v1.1.0 (2026-09-21) title of rafa-2 {unknown}');
  });

  test('leaves out a none fragment\'s notes and exact repeats, and keeps notes with no area', () => {
    const noisy = piece('rafa-4', 'none', '2026-09-23', 'a docs tidy', ['- Docs: reworded a page']);
    const first = piece('rafa-1', 'patch', '2026-09-20', 'one', ['- Loop: waits for commits', 'a line with no area']);
    const repeat = piece('rafa-2', 'patch', '2026-09-21', 'two', ['- Loop: waits for commits']);
    const section = fold('0.27.0', [first, noisy, repeat])?.section ?? '';
    expect(section.split('\n').slice(2)).toEqual(['', '- Loop: waits for commits', '- a line with no area']);
  });

  test('the section carries no trailing newline', () => {
    expect(fold('0.27.0', [PATCH])?.section.endsWith('\n')).toBe(false);
  });

  test('does not change the fragments it folds', () => {
    const batch = [MINOR, PATCH];
    const before = JSON.stringify(batch);
    fold('0.27.0', batch);
    expect(JSON.stringify(batch)).toBe(before);
  });
});
