/**
 * The registry's contract: the {@link CommandRegistry} the dispatcher
 * routes through, what it is built from, the subjects, aliases and
 * mounts it answers, and the {@link CommandFeature} one feature hands
 * the registry its subjects and commands in.
 *
 * The registry itself, `createCommandRegistry` and the refusals it
 * throws, stays the CLI's, in `packages/rafa/src/cli/registry.ts`, which
 * imports these names from here and re-exports them under the same
 * names. Core holds the contract alone, so `RafaContext` can name the
 * registry a command runs with without importing a file above core.
 *
 * Every name here is a type: the file imports `RafaCommand` from
 * `command.ts` beside it with `import type`, and nothing by value.
 */
import type { RafaCommand } from './command.js';

/** A subject: the first routing word, and what its roster line says. */
export interface SubjectSpec {
  /** The routing word, singular: `issue`. */
  readonly name: string;
  /** One line for the root roster. */
  readonly summary: string;
}

/** The commands one module's entry exports, mounted under `module/<name>`. */
export interface ModuleMount {
  /** The word typed after an `exec` action: `linear` in `rafa module exec linear next`. */
  readonly name: string;
  /** The file the commands were imported from. */
  readonly entry: string;
  /** The commands, each routed by its action. */
  readonly commands: readonly RafaCommand[];
}

/** One alias: the words it is typed as, the command it routes to, and whether it is kept for good. */
export interface CommandAlias {
  readonly words: readonly string[];
  readonly command: RafaCommand;
  /** True for one of the command's `lastingAliases`, which prints no deprecation line. */
  readonly lasting: boolean;
}

/** Whether a roster keeps hidden commands. */
export interface RosterOptions {
  /** Keeps the commands declaring `hidden`. Off by default. */
  readonly includeHidden?: boolean;
}

/** What a registry is built from. */
export interface CommandRegistryInput {
  /** The subjects, in roster order. */
  readonly subjects: readonly SubjectSpec[];
  /** The core commands, in roster order. */
  readonly commands: readonly RafaCommand[];
}

/**
 * What one feature contributes to a registry: its name, the subjects it
 * declares and the commands under them, each list in roster order. The
 * same two lists as a {@link CommandRegistryInput}, under the name that
 * says which feature they came from.
 */
export interface CommandFeature {
  /** The feature's name, which a load failure of one of its commands names. */
  readonly name: string;
  /** The subjects the feature declares, in roster order. */
  readonly subjects: readonly SubjectSpec[];
  /** The feature's commands, in roster order. */
  readonly commands: readonly RafaCommand[];
}

/** The subjects, commands, aliases and mounts the dispatcher routes through. Never changes once made. */
export interface CommandRegistry {
  /** The subjects, in the order declared. */
  readonly subjects: () => readonly SubjectSpec[];
  /** The subject a word names, as its name or its plural, or undefined. */
  readonly subjectOf: (word: string) => SubjectSpec | undefined;
  /** The core commands in the order declared, top-level ones included. */
  readonly commands: (options?: RosterOptions) => readonly RafaCommand[];
  /**
   * The commands under a subject's name, or under a mount's key
   * (`module/<name>`), in the order declared. Empty for a name holding
   * none, a top-level command's included.
   */
  readonly actionsOf: (subject: string, options?: RosterOptions) => readonly RafaCommand[];
  /** The command under a subject's name or a mount's key, and an action, or undefined. */
  readonly find: (subject: string, action: string) => RafaCommand | undefined;
  /** The top-level command a word names, or undefined. */
  readonly topLevel: (word: string) => RafaCommand | undefined;
  /** Every alias, longest first, in the order declared among equals. */
  readonly aliases: () => readonly CommandAlias[];
  /** The mounts, in the order mounted. */
  readonly mounts: () => readonly ModuleMount[];
  /** The mount a module name names, or undefined. */
  readonly mountOf: (name: string) => ModuleMount | undefined;
  /**
   * A new registry holding this one's mounts followed by `mount`, leaving
   * this one unchanged. Throws, answering no registry, on a mount the
   * module note refuses.
   */
  readonly mount: (mount: ModuleMount) => CommandRegistry;
}
