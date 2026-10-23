/**
 * Tests for lesson identity and the merge constants.
 *
 * `actionHash` is read against a literal digest that
 * `printf '%s' 'run bun install before the first test' | shasum -a 256`
 * produced on 2026-09-25, so the case is about SHA-256 of the trimmed,
 * lower-cased action and not about the module agreeing with itself.
 * Each equality case is paired with a control that must differ: a hash
 * or key that answered one constant for every input would pass the
 * equality cases alone.
 */

import { describe, expect, test } from 'bun:test';

import {
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  GAP,
  SOURCE_STEP,
  actionHash,
  triggerKey,
} from './identity.js';

/** The action the literal digest below was computed from. */
const ACTION = 'run bun install before the first test';

/** `shasum -a 256` of {@link ACTION}. */
const DIGEST = '5f0c5ea6823c32a7751dd6cba240fbf8d099a3c40b313c33d3e98e251dfc3ddc';

describe('actionHash', () => {
  test('is the hex SHA-256 of the action', () => {
    expect(actionHash(ACTION)).toBe(DIGEST);
  });

  test('is equal across case', () => {
    expect(actionHash(ACTION.toUpperCase())).toBe(DIGEST);
    expect(actionHash('Run Bun Install Before The First Test')).toBe(DIGEST);
  });

  test('is equal across surrounding whitespace', () => {
    expect(actionHash(`  ${ACTION}\t`)).toBe(DIGEST);
    expect(actionHash(`\n\n${ACTION}\n`)).toBe(DIGEST);
  });

  test('is equal across case and surrounding whitespace together', () => {
    expect(actionHash(`\n  ${ACTION.toUpperCase()}  \n`)).toBe(DIGEST);
  });

  test('differs when the words differ', () => {
    expect(actionHash('run bun install after the first test')).not.toBe(DIGEST);
  });

  test('keeps inner whitespace, as the spec spells it', () => {
    expect(actionHash('run bun  install before the first test')).not.toBe(DIGEST);
  });
});

describe('triggerKey', () => {
  test('trims, lower-cases and collapses whitespace runs', () => {
    expect(triggerKey('  When Running\t\tBUN TEST\n under  a worktree '))
      .toBe('when running bun test under a worktree');
  });

  test('is equal across case and surrounding whitespace', () => {
    expect(triggerKey('\n WHEN RUNNING BUN TEST ')).toBe(triggerKey('when running bun test'));
  });

  test('leaves an already-normal trigger as it is', () => {
    expect(triggerKey('when running bun test')).toBe('when running bun test');
  });

  test('differs when the words differ', () => {
    expect(triggerKey('when running bun build')).not.toBe(triggerKey('when running bun test'));
  });
});

describe('the merge constants', () => {
  test('hold the spec\'s numbers', () => {
    expect(GAP).toBe(0.10);
    expect(SOURCE_STEP).toBe(0.05);
    expect(CONFIDENCE_MIN).toBe(0.3);
    expect(CONFIDENCE_MAX).toBe(0.9);
  });

  test('leave room for the gap inside the range', () => {
    expect(CONFIDENCE_MIN).toBeLessThan(CONFIDENCE_MAX - GAP);
  });
});
