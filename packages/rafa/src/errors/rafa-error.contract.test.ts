/**
 * The first-frame contract of `RafaError`: the stack of an error starts
 * in the module that threw it. The case runs over the real class and over
 * a control built wrong on purpose, which captures its stack inside a
 * helper of this file, so that helper's frame comes first. Bun already
 * leaves a constructor's own frames out, so a control that merely skipped
 * the capture would pass; this one must fail.
 */
import { describe, expect, it } from 'bun:test';

import { throwControl, throwFixtureError } from './fixtures/throwing-module.js';

const FIXTURE_FILE = 'throwing-module.ts';

/** The helper the control captures in: its frame is the first one. */
function captureHere(target: Error): void {
  Error.captureStackTrace(target);
}

class ControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlError';
    captureHere(this);
  }
}

/** The first `at` line of the stack of whatever `thrower` throws. */
function firstFrame(thrower: () => never): string {
  try {
    thrower();
  } catch (error) {
    const lines = String((error as Error).stack).split('\n');
    return lines.find((line) => line.trimStart().startsWith('at ')) ?? '';
  }
  throw new Error('the thrower did not throw');
}

/** The first-frame case: true when the first frame names the fixture. */
function firstFrameNamesFixture(thrower: () => never): boolean {
  return firstFrame(thrower).includes(FIXTURE_FILE);
}

describe('the RafaError first-frame contract', () => {
  it('starts the stack of a RafaError subclass in the module that threw it', () => {
    const frame = firstFrame(throwFixtureError);

    expect(frame).toContain(FIXTURE_FILE);
    expect(frame).toContain('throwFixtureError');
  });

  it('fails the same case for a control that captures its stack inside a helper', () => {
    const frame = firstFrame(() => throwControl(ControlError));

    expect(firstFrameNamesFixture(() => throwControl(ControlError))).toBe(false);
    expect(frame).toContain('captureHere');
    expect(frame).toContain('rafa-error.contract.test.ts');
  });
});
