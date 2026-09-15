/**
 * The command rafa's dispatcher routes to: `RafaCommand`, the context it
 * runs with, and `CommandExit`, the one way it refuses.
 *
 * `.specs/cli-surface.md` declares `RafaCommand` as a superset of
 * `cli-core`'s `CliCommand`, so a `cli-core` command still loads. The
 * superset is spelled here over the copy in `./core/types.ts`.
 *
 * ## Routing keys
 *
 * `subject` and `action` are the words a line routes by: `rafa loop start`
 * runs the command whose subject is `loop` and whose action is `start`.
 * A command whose action is its subject is a top-level command, reached
 * by its one word: `usage`, with subject and action both `usage`. That is
 * open-tomato's rule for a single-token verb, which it registers with
 * tool and command equal. `name` is for display, and routes nothing.
 *
 * ## The context
 *
 * {@link RafaContext} is `CliContext` plus `argv`, the words of the line
 * after the last word the dispatcher routed by, as they were typed. The
 * phase 0 commands read their own flags, so a wrapper hands `argv` to
 * the parser it already has. `args` and `flags` are the rest of the
 * line read against the command's own `args` and `flags`, flags typed
 * ahead of the subject included.
 *
 * It also carries `registry`, the registry the dispatcher routed the line
 * through, every module mounted for the invocation included. `describe`
 * reads it, so the roster it gives is the dispatcher's own and never a
 * second one.
 *
 * And it carries `project`, the project the command runs in as
 * `resolveScope` answers it (`src/project/scope.ts`): its root, the home,
 * and both scopes' paths. A command runs inside a project unless it
 * declares `needsProject: false`. The dispatcher resolves the project
 * before any other command runs, and runs none outside a project, so
 * such a command's `project` is never null. For a command declaring
 * `needsProject: false`, as `init` and `describe` do, it resolves
 * nothing, and `project` is null inside a project as outside one.
 *
 * `run` takes a `RafaContext`, where `CliCommand.run` takes a
 * `CliContext`, so the interface extends `CliCommand` without its `run`.
 * A `RafaContext` is a `CliContext`, so a `run` written against
 * `CliContext` is assignable to this one.
 *
 * ## Refusing
 *
 * A command refuses by throwing {@link CommandExit} with an exit code. The
 * dispatcher is the only place that turns one into the process's exit
 * code and the invocation's terminal event. A `process.exitCode` a
 * command sets is not read, and a command setting one and returning is
 * a success to the dispatcher.
 *
 * ## The shape check
 *
 * {@link commandProblem} answers what keeps a value from being a
 * `RafaCommand`, for a roster the type checker never saw: a module's
 * command entry is imported at run time. It checks the shape and not
 * the content, so an empty `summary` or an empty `examples` list passes.
 * The registry refuses a core command it answers for, and the module
 * loader skips the file of a module command it answers for.
 *
 * ## Deprecated flags
 *
 * A flag a command declares is a {@link RafaFlagSpec}: a `FlagSpec` that
 * may carry `deprecated`, naming the spelling to type instead. The
 * dispatcher reads such a flag, typed bare, as that spelling and writes
 * one deprecation line (`dispatch.ts`), so `rafa effort report --json`
 * runs as `rafa effort report --output=json`. The field is declared here
 * rather than on `FlagSpec`, so the copy of `cli-core` in `./core/` keeps
 * the source's shape.
 */
import type { CliCommand, CliContext, FlagSpec } from './core/types.js';
import type { CommandRegistry } from './registry.js';
import type { ProjectFound } from '../project/scope.js';

import { describeValue } from '../config-sections.js';

/** What an action can render: text a person reads, NDJSON events, or the TUI. */
export const COMMAND_OUTPUTS = ['text', 'json', 'tui'] as const;

/** One of the three renderings an action declares. */
export type CommandOutput = (typeof COMMAND_OUTPUTS)[number];

/** One example a command's help lists. */
export interface CommandExample {
  /** The line as a person types it: `rafa loop start --plan=PLAN-x.md`. */
  readonly cmd: string;
  /** What the line does, in a sentence. */
  readonly note: string;
}

/** Why a command is deprecated, and what to type instead. */
export interface CommandDeprecation {
  /** The version the command was deprecated in. */
  readonly since: string;
  /** The spelling to use instead, after `rafa`: `loop start`. */
  readonly use: string;
}

/** What a deprecated flag is read as, which is also what to type instead. */
export interface FlagDeprecation {
  /**
   * The spelling to type instead, `--output=json`: the words, joined by
   * one space, the dispatcher reads the flag as.
   */
  readonly use: string;
}

/** A flag a rafa command declares: a `FlagSpec`, which may be a deprecated spelling. */
export interface RafaFlagSpec extends FlagSpec {
  /** Set when the flag is a deprecated spelling; see the module note. */
  readonly deprecated?: FlagDeprecation;
}

/** Everything a rafa command runs with. */
export interface RafaContext extends CliContext {
  /** The words after the last word the line was routed by, as typed. */
  readonly argv: readonly string[];
  /** The registry the line was routed through, every module mounted for the invocation included. */
  readonly registry: CommandRegistry;
  /** The project the command runs in, or null for a command declaring `needsProject: false`; see the module note. */
  readonly project: ProjectFound | null;
}

/** A command the dispatcher routes to by its subject and action. */
export interface RafaCommand extends Omit<CliCommand, 'run'> {
  /** The first routing word: `loop` in `rafa loop start`. */
  readonly subject: string;
  /** The second routing word: `start`. Equal to `subject` for a top-level command. */
  readonly action: string;
  /** One line for the subject's roster. `description` may be longer. */
  readonly summary: string;
  /** The flags, any of them a deprecated spelling. */
  flags: RafaFlagSpec[];
  /** The examples help lists. */
  readonly examples: readonly CommandExample[];
  /**
   * Whole other spellings of the command, each printing one deprecation
   * line when typed: `start` for `loop start`. Routed for a core command
   * only; a module's command is reached through an `exec` action alone.
   */
  readonly aliases?: readonly string[];
  /** What the action can render. */
  readonly outputs: readonly CommandOutput[];
  /** Set when the command itself is deprecated; typing it prints one deprecation line. */
  readonly deprecated?: CommandDeprecation;
  /** Out of every roster, and still dispatched. */
  readonly hidden?: boolean;
  /**
   * The action delegates to a module: the word after it names a module
   * mounted as `module/<name>`, and the word after that one of the
   * module's actions.
   */
  readonly exec?: true;
  /**
   * False for a command that runs outside a project too, which the
   * dispatcher resolves no project for: `init` and `describe`. Absent,
   * the command runs inside a project; see the module note.
   */
  readonly needsProject?: boolean;
  /** Runs the command. Throws {@link CommandExit} to refuse. */
  readonly run: (context: RafaContext) => Promise<void>;
}

/** The highest exit code a process can report. */
const MAX_EXIT_CODE = 255;

/**
 * Thrown by a command to end its invocation with an exit code: nonzero to
 * refuse, 0 to stop early as a success.
 *
 * The message, when it is not empty, is what the dispatcher tells the
 * reader: on stderr in text mode, in the terminal event in json mode.
 */
export class CommandExit extends Error {
  /** The exit code the invocation ends with, from 0 to 255. */
  readonly exitCode: number;

  /** Throws a `TypeError` when `exitCode` is not a whole number from 0 to 255. */
  constructor(exitCode: number, message = '') {
    super(message);
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > MAX_EXIT_CODE) {
      throw new TypeError(
        `CommandExit: exit code is ${describeValue(exitCode)}, expected a whole number from 0 to ${MAX_EXIT_CODE}`,
      );
    }
    this.name = 'CommandExit';
    this.exitCode = exitCode;
  }
}

/** A command as a record of unknown fields, for the shape check. */
type CommandFields = Partial<Record<keyof RafaCommand, unknown>>;

/** True when a value is a list whose every item passes `check`. */
function isListOf(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

/** True when a value is a mapping holding a string under each key. */
function hasStrings(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === 'string');
}

/**
 * True when a value is a word a line can route by: no space, no slash and
 * no leading dash. The slash is kept for the `module/<name>` mount keys,
 * so no subject is spelled as one.
 */
export function isRoutingWord(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s/-][^\s/]*$/.test(value);
}

/** True when a value is a named flag whose deprecation, when it has one, names its use. */
function isFlag(item: unknown): boolean {
  if (!hasStrings(item, ['name'])) return false;
  const { deprecated } = item as { readonly deprecated?: unknown };
  return deprecated === undefined || hasStrings(deprecated, ['use']);
}

/** The first field of a command failing its check, as a sentence, or null. */
function fieldProblem(fields: CommandFields): string | null {
  const checks: readonly (readonly [keyof RafaCommand, boolean, string])[] = [
    ['subject', isRoutingWord(fields.subject), 'a word with no space, no slash and no leading dash'],
    ['action', isRoutingWord(fields.action), 'a word with no space, no slash and no leading dash'],
    ['name', typeof fields.name === 'string', 'a string'],
    ['summary', typeof fields.summary === 'string', 'a string'],
    ['description', typeof fields.description === 'string', 'a string'],
    ['args', isListOf(fields.args, (item) => hasStrings(item, ['name'])), 'a list of named arguments'],
    ['flags', isListOf(fields.flags, isFlag), 'a list of named flags, each deprecation naming its use'],
    ['examples', isListOf(fields.examples, (item) => hasStrings(item, ['cmd', 'note'])), 'a list of examples'],
    [
      'outputs',
      isListOf(fields.outputs, (item) => (COMMAND_OUTPUTS as readonly unknown[]).includes(item)),
      `a list of ${COMMAND_OUTPUTS.join(', ')}`,
    ],
    [
      'aliases',
      fields.aliases === undefined || isListOf(fields.aliases, (item) => typeof item === 'string'),
      'absent or a list of strings',
    ],
    [
      'deprecated',
      fields.deprecated === undefined || hasStrings(fields.deprecated, ['since', 'use']),
      'absent or a mapping of since and use',
    ],
    ['hidden', fields.hidden === undefined || typeof fields.hidden === 'boolean', 'absent or a boolean'],
    [
      'needsProject',
      fields.needsProject === undefined || typeof fields.needsProject === 'boolean',
      'absent or a boolean',
    ],
    ['exec', fields.exec === undefined || fields.exec === true, 'absent or true'],
    ['run', typeof fields.run === 'function', 'a function'],
  ];
  const failed = checks.find(([, passes]) => !passes);
  if (failed === undefined) return null;
  const [key, , expected] = failed;
  return `${key} is ${describeValue(fields[key])}, expected ${expected}`;
}

/**
 * What keeps `value` from being a `RafaCommand`, as a sentence naming the
 * command when it can, or null when nothing does. See the module note.
 */
export function commandProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `a command is ${describeValue(value)}, expected a mapping`;
  }
  const fields = value as CommandFields;
  const problem = fieldProblem(fields);
  if (problem === null) return null;
  const named = isRoutingWord(fields.subject) && isRoutingWord(fields.action)
    ? `command "${commandSpelling(fields as Pick<RafaCommand, 'subject' | 'action'>)}"`
    : 'a command';
  return `${named}: ${problem}`;
}

/** True when a command is top-level: its action is its subject. */
export function isTopLevel(command: Pick<RafaCommand, 'subject' | 'action'>): boolean {
  return command.subject === command.action;
}

/** A command's canonical spelling after `rafa`: `loop start`, or `usage` for a top-level command. */
export function commandSpelling(command: Pick<RafaCommand, 'subject' | 'action'>): string {
  return isTopLevel(command)
    ? command.subject
    : `${command.subject} ${command.action}`;
}
