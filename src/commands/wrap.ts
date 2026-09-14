/**
 * A phase 0 command behind a `RafaCommand`: the declaration help and
 * `describe` read, over the function that has run the command since
 * phase 0.
 *
 * ## What a wrapper hands over
 *
 * The phase 0 commands (`src/plan.ts`, `src/start.ts`, `src/usage.ts`,
 * `src/effort/collect.ts` and `src/effort/report.ts`) read their own
 * command lines. A wrapper hands the function it runs the context's
 * `argv`, the words after the routing words as they were typed, copied
 * into a fresh array. So the function reads the words it read before
 * the dispatcher: `rafa loop start --plan=P.md` and its alias
 * `rafa start --plan=P.md` both hand `start` `['--plan=P.md']`.
 *
 * Nothing else in the context is handed on. The declaration's `flags`
 * spell what the phase 0 parser reads, for help and `describe`, and a
 * `default` declared there fills the context's `flags` and never reaches
 * the function, whose parser applies its own.
 *
 * ## How a wrapped command ends
 *
 * The function's promise is the command's, so whatever it throws is
 * thrown on to the dispatcher: a `CommandExit` ends the invocation with
 * its exit code, and anything else as `command_error`. `start` and
 * `plan` still call `process.exit` on a refusal, which ends the process
 * before the dispatcher writes a terminal event.
 */
import type { RafaCommand } from '../cli/command.js';

/** A phase 0 command: the words of its line in, its writes and its refusal out. */
export type PhaseZeroCommand = (args: string[]) => Promise<void>;

/** Everything a `RafaCommand` declares but `run`. */
export type CommandDeclaration = Omit<RafaCommand, 'run'>;

/**
 * The declaration as a frozen `RafaCommand` whose `run` hands `command`
 * the context's `argv`; see the module note.
 */
export function wrapPhaseZeroCommand(declaration: CommandDeclaration, command: PhaseZeroCommand): RafaCommand {
  const wrapped: RafaCommand = {
    ...declaration,
    run: (context) => command([...context.argv]),
  };
  return Object.freeze(wrapped);
}
