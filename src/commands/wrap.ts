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
 * One flag is left out of that copy: `--output`, which the dispatcher
 * reads for every command to choose the output mode. `effort collect` and
 * `effort report` refuse a word they do not read, so handed on it would
 * refuse the spelling the command tree gives json mode. Every word
 * `parseArgs` reads as that flag ahead of a `--` is dropped, by
 * `parseArgs`'s own rules: `--output=json`, `-output=json` and
 * `--no-output` alone, and `--output json` with its value. So
 * `rafa effort report --output=json --kind=task` hands `report`
 * `['--kind=task']`. The words from a `--` on are handed over whole.
 *
 * The function is also handed, after the words, the root of the project
 * the dispatcher resolved for the command (`RafaContext.project`): the
 * directory `start`, `plan`, `effort collect` and `effort report` act
 * on, in place of the git root of the working directory each took before,
 * and which `usage` ignores. A wrapped command runs inside a project, so
 * its declaration leaves `needsProject` unset. Run with a context holding
 * no project, it rejects before the function is called.
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
 * its exit code, and anything else as `command_error`. `start`, `plan`,
 * `effort collect` and `effort report` each throw one on a refusal, and
 * `start` also when a task is interrupted.
 */
import type { RafaCommand, RafaContext } from '../cli/command.js';

/** The global flag the dispatcher reads the output mode from, which no phase 0 command is handed. */
const OUTPUT_FLAG = 'output';

/** A phase 0 command: the words of its line and the project root in, its writes and its refusal out. */
export type PhaseZeroCommand = (args: string[], root: string) => Promise<void>;

/** Everything a `RafaCommand` declares but `run`. */
export type CommandDeclaration = Omit<RafaCommand, 'run'>;

/** A word as `parseArgs` reads a flag: the flag's name, and whether the next word is its value. */
interface FlagWord {
  readonly name: string;
  readonly takesNext: boolean;
}

/**
 * The flag `parseArgs` reads `word` as, `next` being the word after it,
 * or null for a word that is no flag. The rules are those of `readLine`
 * in `src/cli/core/parseArgs.ts`.
 */
function flagWord(word: string, next: string | undefined): FlagWord | null {
  const isLong = word.startsWith('--');
  if (!isLong && !(word.startsWith('-') && word.length > 1)) return null;
  const body = word.slice(isLong
    ? 2
    : 1);
  const eqIndex = body.indexOf('=');
  if (eqIndex !== -1) return { name: body.slice(0, eqIndex), takesNext: false };
  if (isLong && body.startsWith('no-') && body.length > 3) return { name: body.slice(3), takesNext: false };
  return { name: body, takesNext: next !== undefined && !next.startsWith('-') };
}

/** A fresh copy of `argv` without the words `parseArgs` reads as `--output`; see the module note. */
export function withoutOutputFlag(argv: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const word = argv[index] ?? '';
    if (word === '--') return [...kept, ...argv.slice(index)];
    const flag = flagWord(word, argv[index + 1]);
    if (flag?.name !== OUTPUT_FLAG) {
      kept.push(word);
    } else if (flag.takesNext) {
      index++;
    }
  }
  return kept;
}

/** The root of the project `context` carries, or an error naming the command `name` when it carries none. */
function projectRootOf(context: RafaContext, name: string): string {
  if (context.project === null) {
    throw new Error(`${name}: runs inside a rafa project, and its context carries none`);
  }
  return context.project.root;
}

/**
 * The declaration as a frozen `RafaCommand` whose `run` hands `command`
 * the context's `argv` without `--output`, then the root of the project
 * the context carries; see the module note.
 */
export function wrapPhaseZeroCommand(declaration: CommandDeclaration, command: PhaseZeroCommand): RafaCommand {
  const wrapped: RafaCommand = {
    ...declaration,
    run: async (context) => command(withoutOutputFlag(context.argv), projectRootOf(context, declaration.name)),
  };
  return Object.freeze(wrapped);
}
