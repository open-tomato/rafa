/**
 * The reading of a suite run that failed outside any test case, for the
 * runner's suite steps (`suite-step.ts`): the reading itself, its
 * reason, the sentence a blocker quotes the run's output in, and what
 * the recorded step keeps of it.
 *
 * ## The reading
 *
 * {@link failedOutsideAnyCase} is true for a run that exited nonzero and
 * listed no failing case. Three runs are left as they are, whatever
 * else they hold: one Bun found no test file for (`noTestFiles`,
 * `suite/run.ts`), which exits 1 on a project that has nothing to fail;
 * one ended by SIGINT, which is a stop and answers nothing about the
 * tree; and one that exited 0. A run that lists a failing case is not
 * this reading either: its failures are split against the baseline, and
 * the known ones block nothing.
 *
 * The exit code is the reading. No wording of Bun's stderr decides it,
 * and neither does the summary line, the error count or how the JUnit
 * file read, so the reading holds across the ways a run can fail with no
 * case to show for it.
 *
 * ## Why the baseline does not excuse it
 *
 * `verdictOf` (`suite-step.ts`) reads this as `StepVerdict.outsideCase`,
 * and a step holding it is red whatever the baseline holds (#945). The
 * two reds it had for a run with no failing case both missed one shape:
 * `unreported` asks for no summary line, and `newErrors` for more errors
 * outside any test than the baseline counted. A checkout whose
 * dependencies were never installed fails to load its test files on the
 * baseline run and on every run after it, so each step exited 1 with a
 * summary line and as many errors as the baseline, and read green.
 * Measured on bun 1.3.14 with two test files importing a package that is
 * not installed: exit code 1, `0 pass`, `2 fail`, `2 errors`,
 * `Ran 2 tests across 2 files.`, and no JUnit file written.
 *
 * A step red on this alone is not retaken: `retakeOnErrors` retakes on
 * an excess of errors only, and this reading is the same on the next
 * run. A step retaken on such an excess is settled on its retake, so a
 * retake at the baseline's count that still exits nonzero with no
 * failing case is red by this reading, and no `Intermittent` line is
 * printed for it.
 *
 * ## The sentence
 *
 * {@link outsideCaseText} is what `blockerText` (`suite-blocker.ts`)
 * writes for it: the exit code, {@link OUTSIDE_CASE_REASON}, and the end
 * of the run's `outputTail`. A blocker is one tracker line, so the quote
 * is kept to a few hundred characters: lines are taken from the tail's
 * end, each without its outer spaces and cut at
 * {@link TAIL_LINE_QUOTED_LENGTH} characters with `...` after the cut,
 * while their lengths sum to no more than {@link TAIL_QUOTED_LENGTH},
 * which one cut line never passes. They are written in the order Bun
 * printed them. When lines are left out the sentence says how many it
 * quotes of how many the step's record holds.
 * The cap is a sum of characters rather than a count of lines because
 * Bun ends its output with four short count lines, and the line worth
 * reading is the one before them. Lines are chosen by position alone,
 * as the tail itself is.
 *
 * A task step's or a stage fallback's two runs are folded into one
 * result (`task-always-run.ts`) whose tail is the first run's and then
 * the second's, so the sentence quotes the end of the second run, which
 * may be the one that passed. The recorded step holds both tails whole.
 *
 * ## The recorded step
 *
 * {@link outsideCaseRecord} is the pair of keys such a step carries on
 * the run record (`SessionStep`, `loop/sessions.ts`): `outsideCase: true`
 * and `outputTail`, every line of it. Every other step carries neither.
 *
 * ## The SIGINT exit code
 *
 * {@link SIGINT_STOP_CODE} is `SIGINT_EXIT_CODE` of `suite-step.ts`,
 * spelled here a second time so this module imports no value from the
 * module that calls it: `suite-blocker.ts` calls it too, and
 * `suite-step.ts` imports that one. `suite-outside-case.test.ts` reads
 * a run ended on `SIGINT_EXIT_CODE` through this module, so the two
 * cannot drift apart unseen.
 */
import type { StepVerdict } from './suite-blocker.js';
import type { SuiteResult } from '../suite/run.js';

import { constants } from 'node:os';

/** Why a step red on {@link failedOutsideAnyCase} is red, as its blocker and the lines about it say it. */
export const OUTSIDE_CASE_REASON = 'the run failed outside any test case';

/** The exit code of a run ended by SIGINT: 128 plus its number. See the module note. */
const SIGINT_STOP_CODE = 128 + constants.signals.SIGINT;

/** The most characters of the output tail {@link outsideCaseText} quotes, summed over the lines as quoted. */
export const TAIL_QUOTED_LENGTH = 300;

/** The most characters of one line of the tail {@link outsideCaseText} quotes; a longer one is cut there and ends in `...`. */
export const TAIL_LINE_QUOTED_LENGTH = 100;

/** What marks a quoted line cut at {@link TAIL_LINE_QUOTED_LENGTH}. */
const QUOTE_CUT_MARK = '...';

/**
 * True when `result` exited nonzero and listed no failing case, unless
 * Bun found no test file to run or the run ended on SIGINT. See the
 * module note.
 */
export function failedOutsideAnyCase(result: Pick<SuiteResult, 'exitCode' | 'failures' | 'noTestFiles'>): boolean {
  if (result.noTestFiles === true || result.exitCode === SIGINT_STOP_CODE) return false;
  return result.exitCode !== 0 && result.failures.length === 0;
}

/** `line` as the sentence quotes it: without its outer spaces, whole or cut at {@link TAIL_LINE_QUOTED_LENGTH}. */
function quotedLine(line: string): string {
  const text = line.trim();
  return text.length > TAIL_LINE_QUOTED_LENGTH
    ? `${text.slice(0, TAIL_LINE_QUOTED_LENGTH)}${QUOTE_CUT_MARK}`
    : text;
}

/**
 * The end of `tail` as quoted, in the order printed: the longest run of
 * its last lines that sums to {@link TAIL_QUOTED_LENGTH} characters at
 * most; none for an empty tail.
 */
function quotedTail(tail: readonly string[]): readonly string[] {
  const lines = tail.map(quotedLine);
  const fits = (from: number): boolean => lines.slice(from).reduce((sum, line) => sum + line.length, 0) <= TAIL_QUOTED_LENGTH;
  const from = lines.findIndex((_, index) => fits(index));
  return from === -1
    ? []
    : lines.slice(from);
}

/**
 * The blocker's sentences on a run that failed outside any test case:
 * its exit code, {@link OUTSIDE_CASE_REASON}, and the end of its output
 * tail, kept short for a tracker line. See the module note.
 */
export function outsideCaseText(result: Pick<SuiteResult, 'exitCode' | 'outputTail'>): string {
  const said = `bun test exited ${result.exitCode} and listed no failing test: ${OUTSIDE_CASE_REASON}.`;
  const quoted = quotedTail(result.outputTail);
  if (quoted.length === 0) return `${said} It printed nothing on stderr.`;
  const lines = quoted.map((line) => `"${line}"`).join(', ');
  const count = quoted.length < result.outputTail.length
    ? ` (${quoted.length} of the ${result.outputTail.length} lines on the step's record)`
    : '';
  return `${said} The last lines it printed: ${lines}${count}.`;
}

/** The keys a recorded step carries for {@link failedOutsideAnyCase}: both for a step holding it, neither for any other. */
export interface OutsideCaseRecord {
  readonly outsideCase?: true;
  readonly outputTail?: readonly string[];
}

/**
 * What the run record holds of `result` for a step whose `verdict` is
 * {@link failedOutsideAnyCase}: the mark and every line of the tail; no
 * key for any other step. See the module note.
 */
export function outsideCaseRecord(verdict: Pick<StepVerdict, 'outsideCase'>, result: Pick<SuiteResult, 'outputTail'>): OutsideCaseRecord {
  return verdict.outsideCase
    ? { outsideCase: true, outputTail: [...result.outputTail] }
    : {};
}
