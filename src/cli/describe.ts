/**
 * The roster rafa gives a program: `describe`'s schema 2 document, built
 * from the dispatcher's registry with the actions modules provide.
 *
 * `.specs/cli-surface.md` asks for one roster "for people, agents and the
 * TUI, built from the dispatcher's registry (not a second one), including
 * module-provided actions". {@link describeRegistry} builds it. It reads
 * the registry and the version it is handed and nothing else, as
 * `help.ts` does, so every command the document names is one the same
 * registry dispatches. `rafa describe` hands it the registry its own line
 * was routed through (`RafaContext.registry`), which holds every module
 * the invocation mounted.
 *
 * ## The document
 *
 * `schemaVersion` is {@link DESCRIBE_SCHEMA_VERSION} and `binary` is
 * {@link DESCRIBE_BINARY}. `subjects` lists each subject in the order
 * declared, with its summary and its actions, and `commands` lists the
 * top-level commands in the order declared. Every subject is listed, as
 * the root help lists every one.
 *
 * An action and a top-level command are described alike, as a
 * {@link DescribedAction}. Every field is on every entry, with `null` or
 * an empty list for what a declaration leaves out, so a reader written in
 * another language, as the TUI is, reads one shape:
 *
 *   - `name`: the words typed after the subject, `start` for
 *     `loop start`, or a top-level command's one word.
 *   - `summary`, `description`, `examples` and `outputs`, as declared.
 *   - `args` and `flags`: each with `required` a boolean and `default`
 *     its value or null, and each flag with its `aliases` as a list. An
 *     argument has no `aliases`, since `parseArgs` refuses one declaring
 *     any.
 *   - `aliases`: the whole other spellings, each as the words it is typed
 *     as joined by one space.
 *   - `deprecated`: `{ since, use }`, or null.
 *   - `module`: the name of the module the action comes from, or null
 *     for a core command.
 *
 * ## The actions modules provide
 *
 * A mounted action is reached only through an `exec` action
 * (`route.ts`), so it is described where it is typed. Its entry follows
 * the actions of the subject holding the `exec` action, or the top-level
 * commands when the `exec` action is one, and its `name` is the words
 * after the subject: `exec linear next` under `module`, typed
 * `rafa module exec linear next`. Its `module` is the mount's name and its
 * `aliases` is empty, since a mounted command's own aliases route
 * nothing. Each `exec` action lists every mount, in the order mounted,
 * and each mount its actions in the order it exports them.
 *
 * A mount no visible `exec` action reaches is in no entry. With no `exec`
 * action nothing routes to it, and the document names only what
 * dispatches.
 *
 * ## Hidden commands
 *
 * A hidden command is in no roster, and the document is one: it is left
 * out whether it is a subject's action, a top-level command or a mounted
 * action. A hidden `exec` action takes the actions typed through it out
 * with it.
 */
import type { CommandDeprecation, CommandExample, CommandOutput, RafaCommand } from './command.js';
import type { ArgSpec, FlagSpec } from './core/types.js';
import type { CommandRegistry } from './registry.js';

import { isTopLevel } from './command.js';
import { mountKey } from './registry.js';

/** The schema of the document {@link describeRegistry} builds. */
export const DESCRIBE_SCHEMA_VERSION = 2;

/** The binary the document describes. */
export const DESCRIBE_BINARY = 'rafa';

/** A positional argument, as the document describes it. */
export interface DescribedArg {
  readonly name: string;
  readonly description: string;
  readonly type: ArgSpec['type'];
  /** False when the declaration leaves `required` out. */
  readonly required: boolean;
  /** The declared default, or null when there is none. */
  readonly default: string | boolean | number | null;
}

/** A flag, as the document describes it. */
export interface DescribedFlag extends DescribedArg {
  /** The other spellings of the flag, empty when it declares none. */
  readonly aliases: readonly string[];
}

/** An action under a subject, or a top-level command, as the document describes it. */
export interface DescribedAction {
  /** The words typed after the subject, or a top-level command's one word. */
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly args: readonly DescribedArg[];
  readonly flags: readonly DescribedFlag[];
  readonly examples: readonly CommandExample[];
  readonly outputs: readonly CommandOutput[];
  /** The whole other spellings, each as typed; empty for a mounted action. */
  readonly aliases: readonly string[];
  readonly deprecated: CommandDeprecation | null;
  /** The module the action comes from, or null for a core command. */
  readonly module: string | null;
}

/** A subject and its actions, as the document describes them. */
export interface DescribedSubject {
  readonly name: string;
  readonly summary: string;
  readonly actions: readonly DescribedAction[];
}

/** What `rafa describe` gives: schema 2 of the roster. */
export interface DescribeDocument {
  readonly schemaVersion: typeof DESCRIBE_SCHEMA_VERSION;
  readonly binary: typeof DESCRIBE_BINARY;
  readonly version: string;
  readonly subjects: readonly DescribedSubject[];
  readonly commands: readonly DescribedAction[];
}

/** An argument as the document describes it. */
function describeArg(arg: ArgSpec): DescribedArg {
  return {
    name: arg.name,
    description: arg.description,
    type: arg.type,
    required: arg.required === true,
    default: arg.default ?? null,
  };
}

/** A flag as the document describes it. */
function describeFlag(flag: FlagSpec): DescribedFlag {
  return { ...describeArg(flag), aliases: [...(flag.aliases ?? [])] };
}

/** An alias as typed: its words joined by one space. */
function typedAlias(alias: string): string {
  return alias
    .trim()
    .split(/\s+/)
    .join(' ');
}

/** A command as the document describes it, under the name given; see the module note. */
function describeCommand(command: RafaCommand, name: string, module: string | null): DescribedAction {
  const { deprecated } = command;
  return {
    name,
    summary: command.summary,
    description: command.description,
    args: command.args.map(describeArg),
    flags: command.flags.map(describeFlag),
    examples: command.examples.map(({ cmd, note }) => ({ cmd, note })),
    outputs: [...command.outputs],
    aliases: module === null
      ? (command.aliases ?? []).map(typedAlias)
      : [],
    deprecated: deprecated === undefined
      ? null
      : { since: deprecated.since, use: deprecated.use },
    module,
  };
}

/** Every visible mounted action, named as typed through `exec`: its word, the module and the action. */
function mountedThrough(exec: RafaCommand, registry: CommandRegistry): DescribedAction[] {
  return registry.mounts().flatMap((mount) => registry.actionsOf(mountKey(mount.name)).map((command) => describeCommand(
    command,
    `${exec.action} ${mount.name} ${command.action}`,
    mount.name,
  )));
}

/** Visible commands described by their action, then the mounted actions each `exec` among them reaches. */
function describeRoster(commands: readonly RafaCommand[], registry: CommandRegistry): DescribedAction[] {
  return [
    ...commands.map((command) => describeCommand(command, command.action, null)),
    ...commands.filter((command) => command.exec === true).flatMap((exec) => mountedThrough(exec, registry)),
  ];
}

/**
 * The schema 2 document for `registry`, stamped with `version`: its
 * subjects with their actions, its top-level commands, and the actions
 * its mounts provide. See the module note.
 */
export function describeRegistry(registry: CommandRegistry, version: string): DescribeDocument {
  return {
    schemaVersion: DESCRIBE_SCHEMA_VERSION,
    binary: DESCRIBE_BINARY,
    version,
    subjects: registry.subjects().map((subject) => ({
      name: subject.name,
      summary: subject.summary,
      actions: describeRoster(registry.actionsOf(subject.name), registry),
    })),
    commands: describeRoster(registry.commands().filter(isTopLevel), registry),
  };
}
