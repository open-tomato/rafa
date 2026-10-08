/**
 * The exit codes a `rafa loop start --continue` run ends with, and the
 * `CommandExit` it ends through.
 *
 * | Code | Name | The run ended because |
 * | --- | --- | --- |
 * | 20 | {@link DECISION_STOP_EXIT} | a decision said `stop` (a `retry` with no retry left, an unreadable decision and a decision session that failed read as one), or `--force-wrap-up` was refused on the pre-wrap-up step's new failures |
 * | 21 | {@link DECISION_NEEDED_EXIT} | under `--output=json`, a stop needed a decision the line did not name: the `decision-needed` event carries the prompt |
 * | 22 | {@link PASSED_OVER_EXIT} | every task left is one the run passed over, so no wrap-up ran and no pull request was opened |
 *
 * The codes start at 20 so that they collide with no code a command
 * already answers: 0 to 3 are shared (success, refusal, a provider's
 * refusal, a deadline), and `rafa loop wait` answers 10 to 16 and 2
 * (`loop/wait-reasons.ts`). A script running `loop start` and then
 * `loop wait` on it can tell the two apart by code alone.
 * `continue-exits.test.ts` reads that table, not a copy of it.
 *
 * A refused forced wrap-up shares 20 with a decision's `stop`: both
 * mean the run halted where a person has to look before it goes on,
 * and the line printed with it, and the `halt` event, name which. A
 * caller that branches on the code takes the same action for both.
 *
 * ## LoopEnd
 *
 * {@link LoopEnd} is the `CommandExit` a `--continue` run ends with. It
 * is thrown only once the run has emitted its own events for the end
 * (`decision`, `decision-needed` or `passed-over`, then the stop's
 * `task-blocked` or `halt`), so `start()`'s catch writes no `error`
 * event for it: the run did not end on an error, and `rafa loop wait`
 * then answers on the stop's own event.
 */
import { CommandExit } from '../cli/command.js';

/** A decision said `stop`, or a forced wrap-up was refused. */
export const DECISION_STOP_EXIT = 20;

/** Under `--output=json`, a stop needs a decision the line did not name. */
export const DECISION_NEEDED_EXIT = 21;

/** Every task left is passed over: no wrap-up, no pull request. */
export const PASSED_OVER_EXIT = 22;

/** The three codes, in the table's order. */
export const CONTINUE_EXITS: readonly number[] = Object.freeze([
  DECISION_STOP_EXIT,
  DECISION_NEEDED_EXIT,
  PASSED_OVER_EXIT,
]);

/** The end a `--continue` run chose, its events already emitted; see the module note. */
export class LoopEnd extends CommandExit {
  constructor(exitCode: number, message: string) {
    super(exitCode, message);
    this.name = 'LoopEnd';
  }
}
