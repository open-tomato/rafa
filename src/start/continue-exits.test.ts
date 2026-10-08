/**
 * Tests for `start/continue-exits.ts`: the three exit codes a
 * `--continue` run ends with are distinct, collide with no exit code
 * `rafa loop wait` answers (its reasons table, its timeout and its
 * missing session) and with none of the codes every command shares,
 * and a {@link LoopEnd} is the `CommandExit` the dispatcher reads.
 *
 * The collision check is read off `loop/wait-reasons.ts`'s own table,
 * never a copy, and a planted code taken from that table is its
 * control: the same check answers a collision for it.
 */
import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { WAIT_NO_SESSION_EXIT, WAIT_REASONS, WAIT_TIMEOUT_EXIT } from '../loop/wait-reasons.js';

import {
  CONTINUE_EXITS,
  DECISION_NEEDED_EXIT,
  DECISION_STOP_EXIT,
  LoopEnd,
  PASSED_OVER_EXIT,
} from './continue-exits.js';

/** The codes every command already spends: success, refusal, provider refusal, deadline. */
const SHARED_EXITS = [0, 1, 2, 3];

/** Every exit code `rafa loop wait` answers. */
const WAIT_EXITS = [...WAIT_REASONS.map((row) => row.exit), WAIT_TIMEOUT_EXIT, WAIT_NO_SESSION_EXIT];

/** The codes of `codes` also found among `taken`. */
function collisions(codes: readonly number[], taken: readonly number[]): readonly number[] {
  return codes.filter((code) => taken.includes(code));
}

describe('the --continue exit codes', () => {
  it('are three distinct codes, listed together', () => {
    expect(CONTINUE_EXITS).toEqual([DECISION_STOP_EXIT, DECISION_NEEDED_EXIT, PASSED_OVER_EXIT]);
    expect(new Set(CONTINUE_EXITS).size).toBe(3);
  });

  it('collide with no code loop wait answers, nor with the codes every command shares', () => {
    expect(collisions(CONTINUE_EXITS, WAIT_EXITS)).toEqual([]);
    expect(collisions(CONTINUE_EXITS, SHARED_EXITS)).toEqual([]);
  });

  it('reads a planted loop wait code as a collision, so the check above can fail', () => {
    const planted = WAIT_REASONS.find((row) => row.reason === 'blocked')?.exit ?? -1;

    expect(collisions([...CONTINUE_EXITS, planted], WAIT_EXITS)).toEqual([planted]);
  });
});

describe('LoopEnd', () => {
  it('is a CommandExit carrying its code and message', () => {
    const end = new LoopEnd(PASSED_OVER_EXIT, 'two tasks passed over');

    expect(end).toBeInstanceOf(CommandExit);
    expect(end.exitCode).toBe(PASSED_OVER_EXIT);
    expect(end.message).toBe('two tasks passed over');
    expect(end.name).toBe('LoopEnd');
  });
});
