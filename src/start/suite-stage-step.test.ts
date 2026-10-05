/**
 * The stage step's module boundary: `suite-stage-step.ts` holds the code
 * and `suite-step.ts` re-exports it, so the two names are one function.
 * The stage step's behaviour is covered in `suite-step.test.ts`, which
 * imports it through that re-export.
 *
 * This file imports `suite-stage-step.ts` first, so the import cycle
 * between the two modules is entered from the side `suite-step.test.ts`
 * never enters it from; a binding read at load on either side would
 * throw here before any case ran.
 */
import { describe, expect, it } from 'bun:test';

import * as stageStep from './suite-stage-step.js';
import * as suiteStep from './suite-step.js';

describe('suite-stage-step', () => {
  it('is the function suite-step.ts re-exports, for both stage functions', () => {
    expect(suiteStep.runStageStep).toBe(stageStep.runStageStep);
    expect(suiteStep.runDueStageSteps).toBe(stageStep.runDueStageSteps);
  });

  it('is not some other suite-step function, so the identity above could fail', () => {
    expect(typeof stageStep.runStageStep).toBe('function');
    expect(stageStep.runStageStep).not.toBe(suiteStep.runPreWrapUpStep);
    expect(stageStep.runDueStageSteps).not.toBe(stageStep.runStageStep);
  });

  it('keeps its helpers private: only the two stage functions are exported', () => {
    expect(Object.keys(stageStep).sort()).toEqual(['runDueStageSteps', 'runStageStep']);
  });
});
