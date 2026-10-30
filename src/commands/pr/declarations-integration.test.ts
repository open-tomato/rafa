/**
 * The `pr` declarations as values: `pr wait`'s `--timeout` description
 * spells core's `DEFAULT_CI_TIMEOUT_MIN`; and `pr wait`, `pr merge` and
 * `pr triage` declare core's `HINT_FLAG_SPEC` itself, not a copy.
 *
 * These cases import `declarations.ts`, and so reach core's command
 * entry; the cases that read its source for what it imports stay in
 * `declarations.test.ts` beside this file.
 */
import { describe, expect, it } from 'bun:test';

import { DEFAULT_CI_TIMEOUT_MIN, HINT_FLAG_SPEC } from '@open-tomato/rafa/core/command';
import {
  MERGE_DANGEROUS_PHRASES,
  PR_MERGE_DECLARATION,
  PR_SUBJECT,
  PR_TRIAGE_DECLARATION,
  PR_WAIT_DECLARATION,
  WAIT_TIMEOUT_FLAG,
} from '@open-tomato/rafa-pr/commands/pr/declarations';

describe('the values declarations.ts declares and copies', () => {
  it('declares HINT_FLAG_SPEC itself on pr wait, pr merge and pr triage, and an equal copy would not pass', () => {
    const declarations = [PR_WAIT_DECLARATION, PR_MERGE_DECLARATION, PR_TRIAGE_DECLARATION];
    const copy = Object.freeze({ ...HINT_FLAG_SPEC });

    expect(declarations.map((declaration) => declaration.flags.includes(HINT_FLAG_SPEC))).toEqual([true, true, true]);
    expect(declarations.map((declaration) => declaration.flags.includes(copy))).toEqual([false, false, false]);
  });

  it('spells the loop\'s own CI deadline in pr wait\'s --timeout description', () => {
    const timeout = PR_WAIT_DECLARATION.flags.find((flag) => flag.name === WAIT_TIMEOUT_FLAG);

    expect(timeout?.description).toBe(
      `How many minutes to wait before giving up. ${DEFAULT_CI_TIMEOUT_MIN} when it is left out.`,
    );
    expect(timeout?.description).not.toContain(`${DEFAULT_CI_TIMEOUT_MIN + 1} when`);
  });
});

describe('the pr declarations', () => {
  it('puts pr merge\'s dangerous phrases on its declaration', () => {
    expect(PR_MERGE_DECLARATION.dangerous).toBe(MERGE_DANGEROUS_PHRASES);
    expect(Object.keys(MERGE_DANGEROUS_PHRASES)).toEqual(['dangerous.acceptVersionCollision']);
  });

  it('puts pr triage\'s spends on its declaration', () => {
    expect(PR_TRIAGE_DECLARATION.spends).toEqual({ when: 'with', flag: '--resolve', what: 'runs a small fixed plan through the loop' });
  });

  it('names the pr subject', () => {
    expect(PR_SUBJECT.name).toBe('pr');
    expect(Object.isFrozen(PR_SUBJECT)).toBe(true);
  });
});
