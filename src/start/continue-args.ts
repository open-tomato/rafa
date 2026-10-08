/**
 * The `rafa loop start --continue` flags, read off the words of the
 * line before anything runs, and the two settings readings a
 * `--continue` run makes at start.
 *
 * ## The flags
 *
 *   - `--continue` hands a stop that would end the run to a decision
 *     (`start/continue-run.ts`): retry the task with a new approach,
 *     stop, jump over it, or defer it until a later task is done.
 *   - `--decide=retry|stop|jump|defer` names that decision on the line,
 *     applied once, to the first decision point the run meets, so no
 *     decision session is spawned for it. `--approach=<text>` goes with
 *     `--decide=retry` alone and is required by it; `--after=<line>`,
 *     a tracker line counted from one, goes with `--decide=defer` alone
 *     and is required by it.
 *   - `--force-wrap-up` wraps a run that ends with passed-over tasks
 *     up anyway, as a draft pull request.
 *
 * {@link readContinueArgs} reads the words before a `--`, the last of
 * two of a value flag, and refuses with exit code 1, before the run is
 * deferred or its session record opened: `--decide` or
 * `--force-wrap-up` without `--continue`, a strategy that is none of
 * the four, a bare value flag (the flags are read as `--flag=<value>`,
 * as `--retry` is), `--approach` anywhere but beside `--decide=retry`
 * and a missing or blank one there, and `--after` anywhere but beside
 * `--decide=defer`, a missing one there, and one that is no whole
 * number from 1.
 *
 * A directive is answered as the {@link ContinueDecision} a decision
 * session would have answered, its reason {@link DIRECTIVE_REASON}, so
 * the loop applies both through one path.
 *
 * ## The settings
 *
 * {@link configuredRetries} is the retry count a run opens when
 * `--retry` is not typed: `loop.retriesOnContinue` under `--continue`
 * and `loop.retries` otherwise; a run without `--continue` never reads
 * the first. {@link refuseUnusableCriteria} reads the criteria a
 * decision is made by (`start/decision-prompt.ts`) once, at start, and
 * refuses a `--continue` run whose `loop.continue.criteriaMode:
 * replace` names a missing or blank file, or whose criteria path cannot
 * be read, rather than meeting it on the run's first decision.
 */
import type { ContinueDecision, DecisionStrategy } from './decision-parse.js';
import type { LoopRetries } from '../config-schema-loop-retries.js';
import type { RafaConfig } from '../config-schema.js';

import { CommandExit } from '../cli/command.js';

import { DECISION_STRATEGIES } from './decision-parse.js';
import { resolveContinueCriteria } from './decision-prompt.js';
import { NOTHING_DISPATCHED } from './session.js';

/** The flag handing a stop to a decision. */
export const CONTINUE_FLAG = '--continue';

/** The flag naming the decision on the line. */
export const DECIDE_FLAG = '--decide';

/** The flag naming a `retry` directive's approach. */
export const APPROACH_FLAG = '--approach';

/** The flag naming the tracker line a `defer` directive waits on. */
export const AFTER_FLAG = '--after';

/** The flag wrapping up a run that ends with passed-over tasks. */
export const FORCE_WRAP_UP_FLAG = '--force-wrap-up';

/** The reason a directive carries, where a decision session writes its own. */
export const DIRECTIVE_REASON = `named on the line with ${DECIDE_FLAG}`;

/** What a line asks of `--continue`. */
export interface ContinueArgs {
  /** True under `--continue`. */
  readonly on: boolean;
  /** The decision `--decide` names, or null for none. */
  readonly directive: ContinueDecision | null;
  /** True under `--force-wrap-up`. */
  readonly forceWrapUp: boolean;
}

/** A line without `--continue`. */
export const CONTINUE_OFF: ContinueArgs = Object.freeze({ on: false, directive: null, forceWrapUp: false });

/** A line number as `--after` takes one: digits with no leading zero, no sign and no point. */
const LINE_NUMBER = /^[1-9][0-9]*$/;

/** Throws the refusal of a `--continue` line, `reason` and `hint` saying what is wrong. */
function refuse(reason: string, hint: string): never {
  throw new CommandExit(1, [`❌ Refusing ${reason}: ${hint}`, NOTHING_DISPATCHED].join('\n'));
}

/** The words before a `--`. */
function flagWords(args: readonly string[]): readonly string[] {
  const end = args.indexOf('--');
  return end === -1
    ? args
    : args.slice(0, end);
}

/** The last `flag=<value>` of `words`, or undefined; a bare `flag` is refused, naming `shape`. */
function lastValue(words: readonly string[], flag: string, shape: string): string | undefined {
  if (words.includes(flag)) refuse(`a bare ${flag}`, `it takes a value as ${flag}=<${shape}>.`);
  const prefix = `${flag}=`;
  // `findLast` is ES2023, past the `lib` the tsconfig sets.
  return [...words].reverse().find((word) => word.startsWith(prefix))
    ?.slice(prefix.length);
}

/** True when `value` is one of the four strategies. */
function isStrategy(value: string): value is DecisionStrategy {
  return (DECISION_STRATEGIES as readonly string[]).includes(value);
}

/** The strategy `--decide` names, or undefined; refuses any other value. */
function readStrategy(words: readonly string[]): DecisionStrategy | undefined {
  const typed = lastValue(words, DECIDE_FLAG, 'strategy');
  if (typed === undefined) return undefined;
  if (!isStrategy(typed)) {
    refuse(`${DECIDE_FLAG}=${typed}`, `it takes retry, stop, jump or defer as ${DECIDE_FLAG}=<strategy>.`);
  }
  return typed;
}

/** The `--after` line, or undefined; refuses a value that is no whole number from 1. */
function readAfter(words: readonly string[]): number | undefined {
  const typed = lastValue(words, AFTER_FLAG, 'line');
  if (typed === undefined) return undefined;
  if (!LINE_NUMBER.test(typed)) {
    refuse(`${AFTER_FLAG}=${typed}`, 'it takes a tracker line number from 1, as the decision prompt shows lines.');
  }
  return Number(typed);
}

/** The directive `strategy` names, with the approach and line it needs; refuses a pairing it does not. */
function directiveOf(
  strategy: DecisionStrategy | undefined,
  approach: string | undefined,
  after: number | undefined,
): ContinueDecision | null {
  if (approach !== undefined && strategy !== 'retry') {
    refuse(APPROACH_FLAG, `${APPROACH_FLAG} is read only beside ${DECIDE_FLAG}=retry.`);
  }
  if (after !== undefined && strategy !== 'defer') {
    refuse(AFTER_FLAG, `${AFTER_FLAG} is read only beside ${DECIDE_FLAG}=defer.`);
  }
  if (strategy === undefined) return null;
  if (strategy === 'retry') {
    const text = approach?.trim() ?? '';
    if (text === '') refuse(`${DECIDE_FLAG}=retry`, `${DECIDE_FLAG}=retry needs ${APPROACH_FLAG}=<text>, the new approach.`);
    return { strategy, reason: DIRECTIVE_REASON, approach: text };
  }
  if (strategy === 'defer') {
    if (after === undefined) refuse(`${DECIDE_FLAG}=defer`, `${DECIDE_FLAG}=defer needs ${AFTER_FLAG}=<line>, the task to run first.`);
    return { strategy, reason: DIRECTIVE_REASON, after };
  }
  return { strategy, reason: DIRECTIVE_REASON };
}

/**
 * What the words before a `--` ask of `--continue`; see the module note
 * for every line refused, each with exit code 1.
 */
export function readContinueArgs(args: readonly string[]): ContinueArgs {
  const words = flagWords(args);
  const on = words.includes(CONTINUE_FLAG);
  const forceWrapUp = words.includes(FORCE_WRAP_UP_FLAG);
  const strategy = readStrategy(words);
  const approach = lastValue(words, APPROACH_FLAG, 'text');
  const after = readAfter(words);

  if (!on) {
    if (strategy !== undefined) refuse(DECIDE_FLAG, `${DECIDE_FLAG} needs ${CONTINUE_FLAG}, the run it decides for.`);
    if (forceWrapUp) refuse(FORCE_WRAP_UP_FLAG, `${FORCE_WRAP_UP_FLAG} needs ${CONTINUE_FLAG}, the run that passes tasks over.`);
  }
  const directive = directiveOf(strategy, approach, after);
  return on
    ? { on, directive, forceWrapUp }
    : CONTINUE_OFF;
}

/**
 * The retries a run opens when `--retry` is not typed:
 * `loop.retriesOnContinue` under `--continue`, `loop.retries` otherwise.
 */
export function configuredRetries(
  config: Pick<RafaConfig, 'loopRetries' | 'loopRetriesOnContinue'>,
  continueOn: boolean,
): LoopRetries {
  return continueOn
    ? config.loopRetriesOnContinue
    : config.loopRetries;
}

/**
 * Throws `CommandExit` with exit code 1 when a `--continue` run's
 * criteria cannot be read, `root` being the project root the criteria
 * path is read from; returns for a run without `--continue`, whose
 * criteria nothing reads. See the module note.
 *
 * @throws Error when `extend` needs the bundled base criteria and it is missing.
 */
export function refuseUnusableCriteria(
  continueArgs: Pick<ContinueArgs, 'on'>,
  root: string,
  config: Pick<RafaConfig, 'loopContinueCriteria' | 'loopContinueCriteriaMode'>,
): void {
  if (!continueArgs.on) return;
  const reading = resolveContinueCriteria({
    root,
    path: config.loopContinueCriteria,
    mode: config.loopContinueCriteriaMode,
  });
  if (reading.ok) return;
  refuse(CONTINUE_FLAG, `${reading.refusal}. Write the criteria there, or set loop.continue.criteriaMode: extend.`);
}
