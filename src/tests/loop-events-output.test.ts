/**
 * `rafa loop start` spawned under `RAFA_OUTPUT=events`, over the scratch
 * repositories of `loop-scratch.ts`: every line it prints is a `rafa· `
 * line, in the order the loop reaches each event.
 */
import type { Scratch } from './loop-scratch.js';

import { afterAll, describe, expect, it } from 'bun:test';

import { PLAN_DONE, PLAN_OPEN, RUN_TIMEOUT, runLoopStart, scratchPlanter, SESSION_FLAGS, STUB, TASK } from './loop-scratch.js';

/** This file's scratch repositories, removed after its last case. */
const planter = scratchPlanter('rafa-loop-events-');

afterAll(planter.remove);

/** The branch every run here holds. */
const BRANCH = `feat/${STUB}`;

/** The lines a run under `RAFA_OUTPUT=events` printed, blank ones dropped. */
function eventLines(scratch: Scratch): { exitCode: number | null; lines: string[] } {
  const run = runLoopStart(scratch, 'events', SESSION_FLAGS);
  return { exitCode: run.exitCode, lines: run.stdout.split('\n').filter((line) => line !== '') };
}

/** The wrap-up's lines, the same after a task as with none: the phases, and `no pr` naming no provider, as the project config sets `pr.provider: none`. */
const WRAP_UP_LINES: readonly string[] = [
  'rafa· wrap-up          tests',
  'rafa· wrap-up          fragment',
  'rafa· wrap-up          session',
  'rafa· no pr            no pull request provider is configured',
  'rafa· wrap-up          release',
];

describe('a loop start run under RAFA_OUTPUT=events', () => {
  it('prints the task start and done, then the wrap-up phases and the pull request reading, and nothing else', () => {
    const { exitCode, lines } = eventLines(planter.plant({ branch: BRANCH, plan: PLAN_OPEN, claudeStdout: 'session says hi', claudeWork: 'work.txt' }));

    expect(exitCode).toBe(0);
    expect(lines).toEqual([
      `rafa· task 1/1 start   "${TASK}"`,
      expect.stringMatching(/^rafa· task 1\/1 done {4}\d+m$/),
      ...WRAP_UP_LINES,
    ]);
  }, RUN_TIMEOUT);

  it('prints a failed session as its error line and one task-blocked line', () => {
    const { exitCode, lines } = eventLines(planter.plant({ branch: BRANCH, plan: PLAN_OPEN, claudeExit: 3 }));

    expect(exitCode).toBe(0);
    expect(lines).toEqual([
      `rafa· task 1/1 start   "${TASK}"`,
      'rafa· error            ❌ Task failed (exit 3). Marked as blocked. Run again to retry.',
      'rafa· task 1/1 blocked session exited 3',
    ]);
  }, RUN_TIMEOUT);

  it('prints a refusal before any task as one rafa· error line, and nothing on stderr', () => {
    const scratch = planter.plant({ branch: BRANCH, plan: null });
    const run = runLoopStart(scratch, 'events', SESSION_FLAGS);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe('');
    expect(run.stdout.split('\n').filter((line) => line !== '')).toEqual([
      expect.stringMatching(/^rafa· error {12}❌ Plan file not found: /),
    ]);
  }, RUN_TIMEOUT);

  it('prints only the wrap-up for a plan with no open task', () => {
    const { exitCode, lines } = eventLines(planter.plant({ branch: BRANCH, plan: PLAN_DONE }));

    expect(exitCode).toBe(0);
    expect(lines).toEqual(WRAP_UP_LINES);
  }, RUN_TIMEOUT);
});
