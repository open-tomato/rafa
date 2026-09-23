/**
 * The ENDING the six commands of the cycle finish with: the hint
 * `./hint.ts` words, put as a question where there is a terminal to
 * answer it, and the action run on a yes.
 *
 * `pr merge`, `pr wait`, `pr triage`, `plan create`, `issue ready` and
 * `loop start` each call {@link endWithNextStep} as the last thing they
 * do, and each declares {@link HINT_FLAG_SPEC} so `--no-hint` turns it
 * off. Two things live here rather than in `./hint.ts` and rather than
 * six times over:
 *
 *  - the QUESTION being put and the action being run, which
 *    `./hint.ts` deliberately does neither of: it words the ending and
 *    reads the state, and nothing in it opens a prompter or calls a
 *    command;
 *  - the one flag declaration, so the six spell `--no-hint` once and
 *    the help of all six reads the same.
 *
 * ## A yes runs the step, through the same call `rafa next` makes
 *
 * The question is the one `rafa next` would put ({@link nextQuestion}),
 * so answering it has to do what `rafa next` does with a yes: run the
 * state's action by calling the registered command that does it
 * ({@link runAction}). Printing a question and then doing nothing with
 * the answer would make the ending a line that lies.
 *
 * It runs ONE step and stops. `rafa next` is the chain — read, run,
 * read again — and this is an ending: the command that is finishing has
 * done its own work, the hint names the one thing that follows, and
 * whoever wants the rest of the cycle types `rafa next`. So there is no
 * second reading here, and none of the chain's guards is needed.
 *
 * The action writes through {@link actionOutput}, the caller's output
 * with `result` taken. One invocation gives exactly one result and the
 * dispatcher refuses a second (`src/cli/dispatch.ts`), and that result
 * belongs to the command that is ending — `pr merge`'s merge, `pr
 * wait`'s verdict — not to the step its ending ran.
 *
 * ## What travels out, and what does not
 *
 * The READING never fails the command it ends: every throw on that path
 * is swallowed in `./hint.ts`, which is where the reasoning for it is.
 * What an ACTION throws is thrown on, as it is under `rafa next`: a
 * person answered yes to a named command, that command refused or
 * failed, and its own message and exit code are what says so. The work
 * the ending command did is already done and already reported by then,
 * so nothing is undone and nothing is hidden.
 *
 * ## Where each of the six puts it
 *
 * At the end of a run that DID its work: after the merge and its
 * clean-up, after checks that settled green, after an assessment that
 * ended 0, after the plan was written, after the label went on, after
 * the loop finished. Two endings are left without one on purpose:
 *
 *  - a run whose own question was answered NO, or that had no terminal
 *    to put it on. Nothing moved, so the state still proposes what that
 *    command was — a declined `rafa pr merge` would end by asking
 *    `Merge #41 into \`main\`? [y/N]` again, which is the answer it was
 *    just given put back as a question.
 *  - a run ending in a refusal, which carries its own report and its
 *    own next step: `pr wait` on a red pull request names
 *    `rafa pr triage <n>` in the message of the `CommandExit` it throws,
 *    and a hint printed ahead of that throw would print before the
 *    report it belongs under.
 *
 * ## An action is never ended by a hint of its own
 *
 * `rafa next` runs those same six commands as its actions, and it reads
 * the state again itself after each one. So `./actions.ts` turns the
 * flag off in the context it builds for an action, and a merge run by
 * the chain ends once, with the chain's reading, rather than twice.
 */
import type { NextHintSeams, NextStepHint } from './hint.js';
import type { RafaCommand, RafaContext, RafaFlagSpec } from '../cli/command.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { Output } from '../ports/index.js';

import { createLinePrompter } from '../cli/prompt/confirm.js';
import { answeredYes } from '../start/branch-decision.js';

import { runAction } from './actions.js';
import { HINT_FLAG, nextStepHint } from './hint.js';

/**
 * The flag each of the six declares, so `--no-hint` suppresses the
 * ending. Boolean and defaulting to true, which is what makes
 * `--no-hint` read as false for it (`src/cli/core/parseArgs.ts`).
 */
export const HINT_FLAG_SPEC: RafaFlagSpec = Object.freeze({
  name: HINT_FLAG,
  description: 'Ends by naming the one step that follows, asking it where there is a terminal to answer on;'
    + ' `--no-hint` reads nothing and prints nothing.',
  type: 'boolean',
  default: true,
});

/**
 * The output an action writes through: the caller's, with `result`
 * taken rather than passed on.
 *
 * One invocation gives exactly ONE result and the dispatcher refuses a
 * second (`src/cli/dispatch.ts`). The result of an invocation that ends
 * with a hint is the ENDING command's — `pr merge`'s merge, `pr wait`'s
 * verdict — and the result of a `rafa next` invocation is its report,
 * so neither may hand on the one its step gives. The step's lines still
 * go through, which in json mode is a log event each, so what it did is
 * on the stream either way; what is dropped is its payload.
 *
 * It lives here because both callers reach it from here: this module
 * for the one step an ending runs, and `src/commands/next.ts` for every
 * step of its chain.
 */
export function actionOutput(output: Output): Output {
  return Object.freeze({ ...output, result: () => undefined });
}

/** How an ending reaches the state, the terminal and the prompter; each left out is the system's own. */
export interface NextEndingSeams extends NextHintSeams {
  /** Opens the prompter the question is put through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams a command ending with a hint runs with: the system's own, every one. */
export const DEFAULT_ENDING_SEAMS: NextEndingSeams = Object.freeze({});

/** What one ending came to. */
export interface NextEnding {
  /** The hint it was read off: the question put, or the command printed. */
  readonly hint: NextStepHint;
  /** Whether the question was put. */
  readonly asked: boolean;
  /** Whether the step was run. */
  readonly ran: boolean;
}

/**
 * Ends the command by naming the one step that follows: the rafa
 * command printed where there is no terminal, and the question put and
 * the step run on a yes where there is one.
 *
 * Answers null, having said nothing, wherever {@link nextStepHint}
 * does: `--no-hint`, a state proposing no command, a reading that
 * failed and a reading that outran its two seconds.
 */
export async function endWithNextStep(
  context: RafaContext,
  seams: NextEndingSeams = DEFAULT_ENDING_SEAMS,
): Promise<NextEnding | null> {
  const hint = await nextStepHint(context, seams);
  if (hint === null) return null;
  if (hint.kind !== 'question') return Object.freeze({ hint, asked: false, ran: false });

  const open = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const prompter = open();
  let taken: boolean;
  try {
    taken = answeredYes(await prompter.ask(hint.line));
  } finally {
    prompter.close();
  }
  if (!taken) return Object.freeze({ hint, asked: true, ran: false });

  await runAction({ ...context, output: actionOutput(context.output) }, hint.state);
  return Object.freeze({ hint, asked: true, ran: true });
}

/**
 * `command` with the ending after its own run: the wrapper for a
 * command that has no ending of its own to place, which is the two
 * wrapped phase 0 commands of the six — `plan create` and `loop start`,
 * whose work is a function this tree hands a line to rather than a
 * `run` with branches in it.
 *
 * The inner run is awaited FIRST, so a refusal it throws travels out
 * with no hint read: a plan that was not written and a loop that would
 * not start have moved nothing, and the ending is for a command that
 * did its work. The flag is the command's own to declare
 * ({@link HINT_FLAG_SPEC}), since it is part of the help it publishes.
 */
export function endingWith(command: RafaCommand, seams: NextEndingSeams = DEFAULT_ENDING_SEAMS): RafaCommand {
  return Object.freeze({
    ...command,
    run: async (context: RafaContext) => {
      await command.run(context);
      await endWithNextStep(context, seams);
    },
  });
}
