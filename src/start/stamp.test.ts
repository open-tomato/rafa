/**
 * Tests for the run's plan stamp state (`src/start/stamp.ts`).
 *
 * The two readings are each other's control. The identity case alone
 * passes a `withStamp` that never stamps, and the stamp case fails it;
 * the stamp case alone passes a `withStamp` that ignores a cleared
 * stub, and the clearing case fails that.
 *
 * Bun runs every test file in one process and the stub is module state,
 * so every case here that sets a stub is followed by a reset to null.
 * Without it, a suite running later would build stamped prompts.
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { planStubFromPrompt, stampPrompt } from '../utils/plan-stamp.js';

import { setActivePlanStub, withStamp } from './stamp.js';

const STUB = 'phase-0b-cutover-readiness';

/** A prompt of more than one line, its first line a classifier-style key. */
const PROMPT = 'Your scoped task is: do the thing\n\nThe body of the prompt.';

describe('withStamp', () => {
  afterEach(() => {
    setActivePlanStub(null);
  });

  it('returns the prompt unchanged while no stub has been set', () => {
    const dispatched = withStamp(PROMPT);

    expect(dispatched).toBe(PROMPT);
    expect(planStubFromPrompt(dispatched)).toBeNull();
  });

  it('appends the stamp of the active plan once a stub is set', () => {
    setActivePlanStub(STUB);

    const dispatched = withStamp(PROMPT);

    expect(dispatched).not.toBe(PROMPT);
    expect(dispatched).toBe(stampPrompt(STUB, PROMPT));
    expect(dispatched.startsWith(`${PROMPT}\n`)).toBe(true);
    expect(planStubFromPrompt(dispatched)).toBe(STUB);
  });

  it('returns to the identity when the stub is set back to null', () => {
    setActivePlanStub(STUB);
    setActivePlanStub(null);

    expect(withStamp(PROMPT)).toBe(PROMPT);
  });
});
