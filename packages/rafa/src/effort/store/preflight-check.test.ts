/**
 * Tests for the preflight check's types
 * (`packages/rafa/src/effort/store/preflight-check.ts`).
 *
 * The checks are built by hand, so the case imports its own module and
 * nothing of the `preflight` runner that re-exports it. Each closed set
 * is held by a value it admits beside one it refuses, which the type
 * step proves: a refusal that compiled would fail the `@ts-expect-error`.
 */

import type { CheckOutcome, PreflightCheck, PreflightTier } from './preflight-check.js';

import { describe, expect, it } from 'bun:test';

describe('PreflightCheck', () => {
  it('holds a failed required check with its failure', () => {
    const check: PreflightCheck = {
      tier: 'required',
      item: { kind: 'tool', name: 'bun', probe: null },
      outcome: 'fail',
      durationMs: 12,
      failure: 'presence check: bun not on PATH',
    };
    expect(check.failure).toBe('presence check: bun not on PATH');
  });

  it('admits the two tiers and refuses any other', () => {
    const tiers: PreflightTier[] = ['required', 'optional'];
    // @ts-expect-error a tier outside the closed set
    const refused: PreflightTier = 'advisory';
    expect([...tiers, refused]).toHaveLength(3);
  });

  it('admits the three outcomes and refuses a pending one', () => {
    const outcomes: CheckOutcome[] = ['pass', 'fail', 'timeout'];
    // @ts-expect-error `pending` is a pull request check's outcome, not a preflight's
    const refused: CheckOutcome = 'pending';
    expect([...outcomes, refused]).toHaveLength(4);
  });
});
