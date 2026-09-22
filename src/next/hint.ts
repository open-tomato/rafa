/**
 * The ending every command in the cycle finishes with: where the
 * project stands now that the command has done its work, said as the
 * ONE thing that follows.
 *
 * `pr merge`, `pr wait`, `pr triage`, `plan create`, `issue ready` and
 * `loop start` each end by calling {@link nextStepHint}, and the text
 * they end with is this module's and no command's own. That is the
 * point of one function: six endings worded in six places would drift,
 * and the question a hint puts has to be the question `rafa next`
 * puts, since both are the same decision about the same state.
 * {@link nextQuestion} and {@link commandWords} live here for that
 * reason and `src/commands/next.ts` takes them from here.
 *
 * ## One reading, and no chain
 *
 * The state is read ONCE. `rafa next` reads it again after every
 * action, because it is driving the cycle and each action moves the
 * project on; a hint is an ENDING, so it reads where the command it
 * closes has left the project, says the one thing that follows and is
 * done. Nothing here runs an action, opens a prompter or spawns a
 * line, which is also why a hint needs none of the guards the chain
 * carries — no repeat check, no cap: one reading cannot repeat itself.
 *
 * ## The question, and the command
 *
 * What the hint answers with depends on whether there is anybody to
 * answer it:
 *
 *  - With a terminal the hint is a QUESTION — {@link nextQuestion},
 *    the very words `rafa next` would put — and it is answered, not
 *    printed. So this function hands it back as
 *    {@link NextStepHint.line} with `kind` `question` and prints
 *    nothing: a `[y/N]` written to a stream nobody reads an answer
 *    from is a line that lies about what happens next. The caller
 *    puts it through the prompter it already asks its own questions
 *    with, and carries {@link NextStepHint.state} into
 *    `runAction` on a yes.
 *  - Without one — a loop task, a pipe, a CI step — there is no
 *    question to put, so the hint is the rafa COMMAND that does it,
 *    printed through the caller's output: {@link hintLine}, the
 *    proposal and the words a person types after `rafa`. That line
 *    is what a non-terminal run leaves behind for whoever reads the
 *    log.
 *
 * Either way it names a rafa command and never a tool: every action of
 * the table IS a registered command (`./actions.ts`), and the states
 * that run none — the two pre-conditions and the three rows proposing
 * prose — answer no hint at all. A hint that has nothing to name says
 * nothing, which is what keeps the ending of an ordinary command
 * silent rather than chatty.
 *
 * ## Two seconds, and then nothing
 *
 * The reading reaches the board and the pull request provider, which
 * reach the network. A hint is the last thing a command that has
 * already done its work does, so it may not make that command wait:
 * {@link HINT_TIMEOUT_MS} is the whole budget, and the read that loses
 * the race is left to settle on its own while the hint answers null
 * and says nothing. Two seconds of silence beats a merge that appears
 * to hang.
 *
 * ## A hint never fails the command it ends
 *
 * Every throw is swallowed. Composing the sources refuses a repository
 * whose `pr.provider` is not `gh` with exit 2 and a config that cannot
 * be used with exit 1 (`./sources.ts`), the provider throws when `gh`
 * could not be asked, and none of those is a hint's to raise: the
 * command has already merged the pull request or written the plan, and
 * ending it with an exit code over a line it was going to print would
 * report a failure that did not happen. The same reasoning silences
 * the composition's config warnings — the command that is ending read
 * the same config and has warned already.
 *
 * It is swallowed in two places, and both are needed:
 * {@link readWithin} answers null for a reading that rejected, since
 * that is the same "nothing to say" a reading that outran its two
 * seconds leaves, and the `catch` around the whole of
 * {@link nextStepHint} takes what is thrown AFTER the reading — the
 * defect `actionInvocation` raises over a row proposing an action the
 * state names no pull request, issue or plan for (`./actions.ts`).
 * The second is what `hint.test.ts` plants a defective state for; with
 * only a rejecting reading to drive it, it would read as dead code.
 *
 * ## `--no-hint`
 *
 * Each of the six declares a boolean `hint` flag defaulting to true,
 * and {@link wantsHint} is what reads it here, so `--no-hint`
 * suppresses the ending without the six spelling the flag six times.
 * A suppressed hint reads nothing at all: the flag is asked before the
 * sources are composed, so it costs no `gh` call. The flag is `hint`
 * rather than `next` because `plan create` declares `next` already and
 * `src/cli/core/parseArgs.ts` reads `--no-<name>` as false for a
 * declared flag, so `--no-next` means something else there.
 */
import type { NextInvocation } from './actions.js';
import type { NextSourceSeams } from './sources.js';
import type { NextState } from './state.js';
import type { RafaContext } from '../cli/command.js';
import type { Output } from '../ports/index.js';

import { actionInvocation } from './actions.js';
import { openNextSources } from './sources.js';
import { readNextState } from './state.js';

/** The flag each of the six commands declares to let a hint be turned off. */
export const HINT_FLAG = 'hint';

/** How long the reading may take before the hint gives up and says nothing. */
export const HINT_TIMEOUT_MS = 2_000;

/** The mark the printed hint opens with, as `rafa next`'s proposal line does. */
const HINT_MARK = '👉';

/** The word the printed hint names what follows with. */
const HINT_LEAD = 'Next:';

/** The command and the words it runs with, as a person types them after `rafa`. */
export function commandWords(invocation: NextInvocation): string {
  return [invocation.command, ...invocation.argv].join(' ');
}

/** The proposal as a sentence opens: its first letter upper-cased, everything else left alone. */
function capitalised(text: string): string {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

/** The question one proposal is put as, spelled `[y/N]` and ending in a space to type after. */
export function nextQuestion(state: NextState): string {
  return `${capitalised(state.proposal)}? [y/N] `;
}

/** The line a run with no terminal is left with: what follows, and the command that does it. */
export function hintLine(state: NextState, invocation: NextInvocation): string {
  return `${HINT_MARK} ${HINT_LEAD} ${state.proposal} — rafa ${commandWords(invocation)}`;
}

/**
 * Whether the hint was asked for: true unless `--no-hint` turned it
 * off. Total, and never a refusal — a flag value nothing declares is
 * no reason to fail a command that has done its work.
 */
export function wantsHint(flags: RafaContext['flags']): boolean {
  const value = flags[HINT_FLAG];
  return value !== false && value !== 'false';
}

/** Whether the line is the question to put, or the command already printed. */
export type NextHintKind = 'question' | 'command';

/** The one step a command ends by naming; see the module note for the two kinds. */
export interface NextStepHint {
  /** `question` for a terminal, which the caller puts; `command` for the line already printed. */
  readonly kind: NextHintKind;
  /** The whole state it was read off, which a caller that goes on to run the action hands to `runAction`. */
  readonly state: NextState;
  /** The command that action runs, and the words it runs with. */
  readonly invocation: NextInvocation;
  /** The question to put, or the line that was printed. */
  readonly line: string;
}

/** How the hint reaches the state, the terminal and the clock; each left out is the system's own. */
export interface NextHintSeams extends NextSourceSeams {
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Reads the one state. The sources composed off the context when left out. */
  readonly readState?: () => Promise<NextState>;
  /** Resolves once the hint has waited `ms`, which ends it. A real timer when left out. */
  readonly expire?: (ms: number) => Promise<void>;
}

/** The seams a command ending with a hint runs with: the system's own, every one. */
export const DEFAULT_HINT_SEAMS: NextHintSeams = Object.freeze({});

/** Waits `ms` on a timer that holds nothing open: the hint has already answered by then. */
function afterDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/** An output writing nothing, which the composition is handed; see the module note. */
function silenced(): Output {
  return Object.freeze({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    emit: () => undefined,
    result: () => undefined,
  });
}

/** The state, or null where reading it failed or took longer than the hint has. */
async function readWithin(read: () => Promise<NextState>, expire: (ms: number) => Promise<void>): Promise<NextState | null> {
  const reading = Promise.resolve()
    .then(read)
    .then((state: NextState) => ({ state }), () => null);
  const raced = await Promise.race([reading, expire(HINT_TIMEOUT_MS).then(() => null)]);
  return raced === null
    ? null
    : raced.state;
}

/**
 * Where the project stands now, as the one step that follows: the
 * question to put where there is a terminal to answer it, and the rafa
 * command printed where there is not.
 *
 * Answers null, having said nothing, for a `--no-hint` run, a state
 * proposing no command, a reading that failed and a reading that
 * outran {@link HINT_TIMEOUT_MS}. See the module note for each.
 */
export async function nextStepHint(
  context: RafaContext,
  seams: NextHintSeams = DEFAULT_HINT_SEAMS,
): Promise<NextStepHint | null> {
  if (!wantsHint(context.flags)) return null;

  try {
    const read = seams.readState
      ?? ((): Promise<NextState> => readNextState(openNextSources({ ...context, output: silenced() }, seams)));
    const state = await readWithin(read, seams.expire ?? afterDelay);
    if (state === null) return null;

    const invocation = actionInvocation(state);
    if (invocation === null) return null;

    const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
    if (isTerminal()) {
      return Object.freeze({ kind: 'question', state, invocation, line: nextQuestion(state) });
    }

    const line = hintLine(state, invocation);
    context.output.info(line);
    return Object.freeze({ kind: 'command', state, invocation, line });
  } catch {
    return null;
  }
}
