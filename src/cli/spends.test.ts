/**
 * Tests for the `spends` declaration (`src/cli/spends.ts`).
 *
 * Each of the four forms is held to pass the shape check, to its
 * condition and to its mark. Every malformed shape is spelled in full,
 * one thing changed at a time from a form that passes, so a refusal
 * cannot pass vacuously.
 *
 * Five mutations of `spends.ts` were driven on 2026-09-23, one run each
 * over this file, with the module restored byte-identical (sha256), and
 * each reddened at least one case: the flag spelling loosened to any
 * `--` prefix (3), the mark dropping its condition (1), a flag allowed
 * on `always` and `through` (2), an absent declaration refused (1), and
 * `what` left unchecked (5).
 */
import type { CommandSpend } from './spends.js';

import { describe, expect, it } from 'bun:test';

import {
  SPENDS_GLYPH,
  SPENDS_WHEN,
  spendsCondition,
  spendsMark,
  spendsProblem,
} from './spends.js';

const ALWAYS: CommandSpend = { when: 'always', what: 'one planning session' };
const WITH: CommandSpend = { when: 'with', flag: '--resolve', what: 'runs a small fixed plan through the loop' };
const UNLESS: CommandSpend = { when: 'unless', flag: '--no-model', what: 'one session per search' };
const THROUGH: CommandSpend = { when: 'through', what: 'when the step it runs is one of the above' };

describe('the four forms', () => {
  it('names exactly four values of when', () => {
    expect([...SPENDS_WHEN]).toEqual(['always', 'with', 'unless', 'through']);
  });

  it('passes the shape check for every form', () => {
    expect([ALWAYS, WITH, UNLESS, THROUGH].map(spendsProblem)).toEqual([null, null, null, null]);
  });

  it('gives each form its condition', () => {
    expect(spendsCondition(ALWAYS)).toBeNull();
    expect(spendsCondition(WITH)).toBe('with --resolve');
    expect(spendsCondition(UNLESS)).toBe('unless --no-model');
    expect(spendsCondition(THROUGH)).toBeNull();
  });

  it('gives each form its mark', () => {
    expect(SPENDS_GLYPH).toBe('🪙');
    expect(spendsMark(ALWAYS)).toBe('🪙');
    expect(spendsMark(WITH)).toBe('🪙 with --resolve');
    expect(spendsMark(UNLESS)).toBe('🪙 unless --no-model');
    expect(spendsMark(THROUGH)).toBe('🪙');
  });
});

describe('spendsProblem', () => {
  it('passes an absent declaration', () => {
    expect(spendsProblem(undefined)).toBeNull();
  });

  it('passes an empty what, reading shape and not content', () => {
    expect(spendsProblem({ when: 'always', what: '' })).toBeNull();
  });

  it.each([
    [null, 'spends is null, expected absent or a mapping'],
    [[], 'spends is a list, expected absent or a mapping'],
    ['always', 'spends is "always", expected absent or a mapping'],
    [true, 'spends is true, expected absent or a mapping'],
    [1, 'spends is 1, expected absent or a mapping'],
  ])('refuses %p as not a mapping', (value, message) => {
    expect(spendsProblem(value)).toBe(message);
  });

  it.each([
    [{ what: 'x' }, 'spends.when is undefined, expected one of always, with, unless, through'],
    [{ when: 'never', what: 'x' }, 'spends.when is "never", expected one of always, with, unless, through'],
    [{ when: 'Always', what: 'x' }, 'spends.when is "Always", expected one of always, with, unless, through'],
    [{ when: 1, what: 'x' }, 'spends.when is 1, expected one of always, with, unless, through'],
  ])('refuses a bad when in %p', (value, message) => {
    expect(spendsProblem(value)).toBe(message);
  });

  it.each(SPENDS_WHEN.map((when) => [when]))('refuses a %s declaration with no what', (when) => {
    const flag = when === 'with' || when === 'unless'
      ? { flag: '--x' }
      : {};
    expect(spendsProblem({ when, ...flag })).toBe('spends.what is undefined, expected a string');
    expect(spendsProblem({ when, what: ['x'], ...flag })).toBe('spends.what is a list, expected a string');
  });

  it.each([
    [undefined, 'undefined'],
    ['resolve', '"resolve"'],
    ['-r', '"-r"'],
    ['--', '"--"'],
    ['---resolve', '"---resolve"'],
    ['--re solve', '"--re solve"'],
    [' --resolve', '" --resolve"'],
    [true, 'true'],
    [['--resolve'], 'a list'],
  ])('refuses the flag %p on with and unless', (flag, shown) => {
    const message = `spends.flag is ${shown}, expected a flag as typed, starting with --`;
    expect(spendsProblem({ when: 'with', flag, what: 'x' })).toBe(message);
    expect(spendsProblem({ when: 'unless', flag, what: 'x' })).toBe(message);
  });

  it.each([['always'], ['through']])('refuses a flag on %s', (when) => {
    expect(spendsProblem({ when, flag: '--resolve', what: 'x' })).toBe(
      `spends.flag is "--resolve", expected absent when spends.when is "${when}"`,
    );
  });

  it('names when before what, and what before flag', () => {
    expect(spendsProblem({ when: 'sometimes', flag: 'x' })).toContain('spends.when');
    expect(spendsProblem({ when: 'with', flag: 'x' })).toContain('spends.what');
  });
});
