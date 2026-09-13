/**
 * The plan a run stamps onto the prompts it dispatches.
 *
 * Holds the run's active plan stub and answers, through
 * {@link withStamp}, whether a prompt is stamped at all. The marker
 * itself, and why it is appended below a prompt and never above it,
 * belong to `utils/plan-stamp.ts`. `start()` sets the stub once, after
 * the branch guard has let the run through.
 */
import { stampPrompt } from '../utils/plan-stamp.js';

/**
 * The plan this run is executing, or null when nothing set one.
 *
 * Module state rather than a threaded argument because it is read by
 * four prompt builders whose signatures are driven directly by tests,
 * and a fifth parameter on each would change every one of those call
 * sites to carry a value none of them is about. Null is the default
 * and {@link withStamp} is then the identity, so a builder called
 * from a test dispatches the exact bytes it dispatched before
 * stamping existed.
 */
let activePlanStub: string | null = null;

/** Sets the plan every prompt this run dispatches is stamped with. */
export function setActivePlanStub(stub: string | null): void {
  activePlanStub = stub;
}

/** Stamps a prompt with the active plan, or returns it unchanged. */
export function withStamp(prompt: string): string {
  return activePlanStub === null
    ? prompt
    : stampPrompt(activePlanStub, prompt);
}
