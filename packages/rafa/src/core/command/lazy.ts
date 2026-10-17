/**
 * A command whose module is imported when it runs, not when the roster
 * is built: {@link lazyCommand} over a {@link CommandDeclaration}.
 *
 * ## What is declared and what is loaded
 *
 * A declaration is a `RafaCommand` less its `run`: every field routing,
 * help, `describe` and the spend guard read, so a roster of lazy
 * commands is built, routed and rendered without importing one command
 * module. The lazy command is the declaration spread under a `run` of
 * its own, so it passes `commandProblem` (`command.ts` beside this
 * file) as the declaration's fields stand.
 *
 * Its `run` awaits `load()`, typically `() => import('./x.js')`, and
 * holds the module's default export to a command: one `commandProblem`
 * accepts, whose subject and action are the declaration's. It then hands
 * the context to that command's `run` and settles as that `run`
 * settles, a `CommandExit` it throws included. The loaded command's
 * other fields are not compared with the declaration's: the dispatcher
 * routed, parsed and guarded by the declaration's before `run` was
 * called.
 *
 * ## Refusing
 *
 * A load that rejects, a default export `commandProblem` refuses, and a
 * default export spelled as another command each refuse with
 * `CommandExit(1, message)`, the message reading
 * `feature "<feature>": command "<spelling>" failed to load: <reason>`.
 * The spelling is `commandSpelling`'s, so a top-level command reads as
 * its one word, as every other refusal naming a command spells it. The
 * reason is the rejection's message, the shape check's sentence, or the
 * spelling the export has against the one declared.
 *
 * Nothing is cached here: a second run calls `load()` again, and the
 * module loader's own cache answers it.
 */
import type { RafaCommand, RafaContext } from './command.js';

import { messageOf } from '../config/config-sections.js';

import { CommandExit, commandProblem, commandSpelling } from './command.js';

/** A command less its `run`: what a feature declares for a command it loads when run. */
export type CommandDeclaration = Omit<RafaCommand, 'run'>;

/** What a command module's import resolves to: the command is its default export. */
type CommandModule = { readonly default?: unknown } | null | undefined;

/** The exit code a lazy command refuses with when its module does not load as declared. */
const LOAD_FAILED_EXIT = 1;

/**
 * The command a module's default export is, or the reason it is none of
 * the declared one.
 *
 * @param declaration - The declared command, whose subject and action the export must carry.
 * @param loaded - The module the load resolved to.
 * @returns The command, or the reason as a sentence.
 */
function heldCommand(declaration: CommandDeclaration, loaded: CommandModule): RafaCommand | string {
  const exported = loaded?.default;
  const problem = commandProblem(exported);
  if (problem !== null) return `the default export is no command: ${problem}`;
  const command = exported as RafaCommand;
  if (command.subject !== declaration.subject || command.action !== declaration.action) {
    return `the default export is command "${commandSpelling(command)}", expected "${commandSpelling(declaration)}"`;
  }
  return command;
}

/**
 * A command spreading `declaration` under a `run` that loads the
 * command and delegates to it. See the module note.
 *
 * @param declaration - Every field of the command but its `run`.
 * @param load - Imports the command's module, whose default export is the command.
 * @param feature - The name of the feature the command belongs to, which a refusal names.
 * @returns The lazy command.
 */
export function lazyCommand(
  declaration: CommandDeclaration,
  load: () => Promise<CommandModule>,
  feature: string,
): RafaCommand {
  const refusal = (reason: string): CommandExit => new CommandExit(
    LOAD_FAILED_EXIT,
    `feature "${feature}": command "${commandSpelling(declaration)}" failed to load: ${reason}`,
  );
  const run = async (context: RafaContext): Promise<void> => {
    let loaded: CommandModule;
    try {
      loaded = await load();
    } catch (error) {
      throw refusal(`the import rejected: ${messageOf(error)}`);
    }
    const command = heldCommand(declaration, loaded);
    if (typeof command === 'string') throw refusal(command);
    await command.run(context);
  };
  return { ...declaration, run };
}
