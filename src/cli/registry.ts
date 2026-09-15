/**
 * The dispatcher's registry: the subjects, the commands under them and
 * beside them, their aliases, and the modules mounted under
 * `module/<name>`.
 *
 * `.specs/cli-surface.md` builds help and `describe` from "the
 * dispatcher's registry (not a second one)", so this one value answers
 * all three: the dispatcher routes through it, and the two rosters read
 * it.
 *
 * ## What a registry holds
 *
 *   - Subjects, each a {@link SubjectSpec}: the routing word and the
 *     summary its roster line carries. A subject is also reached by its
 *     plural, the name with an `s` added: `issues` for `issue`,
 *     `modules` for `module`. No subject in the tree has an irregular
 *     plural.
 *   - Core commands, each a `RafaCommand` under a declared subject, or
 *     top-level when its action is its subject.
 *   - Aliases: each whole other spelling a core command declares, read
 *     as the words it splits into on whitespace.
 *   - Mounts, each a {@link ModuleMount}: the commands one module's
 *     entry exports, keyed under `module/<name>` ({@link mountKey}) and
 *     reached only through an `exec` action. A mounted command's own
 *     subject and aliases route nothing, so the same command registers
 *     under its subject unchanged once the module is promoted into core.
 *
 * ## What it refuses
 *
 * A registry is built from code, so everything that would make a
 * spelling unreachable or ambiguous throws when it is built, naming
 * what collided. `help` is refused as a subject, a top-level command
 * and an alias's first word, because the dispatcher reads that word as
 * a help request. Refused as well: a second subject of one name, a
 * subject spelled as another's plural; a command `commandProblem`
 * answers for; a command under an undeclared subject; a second command
 * of one spelling; a top-level command spelled as a subject or its
 * plural; an alias that is not words, one claimed twice, one spelled as
 * a top-level command, and one spelled as a subject and one of its
 * actions, each of which the command itself would win.
 *
 * An alias spelled as a subject alone is accepted, as `plan` for
 * `plan create` is. It answers for every line under that subject whose
 * next word is no action of it, the bare subject included.
 *
 * A mount is refused when its name is not a word, it is mounted twice,
 * or one of its commands fails `commandProblem`, declares `exec`, or
 * repeats an action. A module name may hold a slash, as a scoped package
 * name does. The module loader turns each refusal into a warning naming
 * the entry file.
 *
 * ## A registry is a value
 *
 * {@link CommandRegistry.mount} answers a new registry and leaves the
 * one it was called on unchanged, as `src/adapters/registry.ts` does and
 * for its reason: bun runs every test file in one process. The lists a
 * registry answers are frozen copies of what it was handed.
 */
import type { RafaCommand } from './command.js';

import { describeValue } from '../config-sections.js';

import { commandProblem, commandSpelling, isRoutingWord, isTopLevel } from './command.js';

/** What every refusal opens with. */
const REFUSAL = 'command registry';

/** The word the dispatcher reads as a help request, never as a routing word. */
export const HELP_WORD = 'help';

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

/** One alias: the words it is typed as, and the command it routes to. */
export interface CommandAlias {
  readonly words: readonly string[];
  readonly command: RafaCommand;
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

/** Looks a command up by subject and action. */
type FindCommand = (subject: string, action: string) => RafaCommand | undefined;

/** The key a module's commands are held under: `module/linear`. */
export function mountKey(name: string): string {
  return `module/${name}`;
}

/** The plural a subject is also reached by. */
export function pluralOf(name: string): string {
  return `${name}s`;
}

/** The commands of a list a roster keeps, as a frozen list. */
function rosterOf(commands: readonly RafaCommand[], options: RosterOptions = {}): readonly RafaCommand[] {
  return Object.freeze(options.includeHidden === true
    ? [...commands]
    : commands.filter((command) => command.hidden !== true));
}

/** Refuses a word the dispatcher reads as a help request. */
function refuseHelpWord(word: string, as: string): void {
  if (word === HELP_WORD) throw new Error(`${REFUSAL}: "${HELP_WORD}" is read as a help request, not ${as}`);
}

/** Subjects by name and by plural, refusing a collision. */
function indexSubjects(subjects: readonly SubjectSpec[]): ReadonlyMap<string, SubjectSpec> {
  const names = new Map<string, SubjectSpec>();
  for (const subject of subjects) {
    if (!isRoutingWord(subject.name) || typeof subject.summary !== 'string') {
      throw new TypeError(
        `${REFUSAL}: a subject has name ${describeValue(subject.name)} and summary ${describeValue(subject.summary)},`
          + ' expected a word with no space, no slash and no leading dash, and a string',
      );
    }
    refuseHelpWord(subject.name, 'a subject');
    if (names.has(subject.name)) throw new Error(`${REFUSAL}: subject "${subject.name}" is declared twice`);
    names.set(subject.name, subject);
  }
  const words = new Map(names);
  for (const subject of subjects) {
    const plural = pluralOf(subject.name);
    if (names.has(plural)) {
      throw new Error(`${REFUSAL}: subject "${plural}" is spelled as the plural of subject "${subject.name}"`);
    }
    words.set(plural, subject);
  }
  return words;
}

/** Commands by subject and action, refusing a command the module note refuses. */
function indexCommands(
  commands: readonly RafaCommand[],
  subjects: ReadonlyMap<string, SubjectSpec>,
): ReadonlyMap<string, ReadonlyMap<string, RafaCommand>> {
  const bySubject = new Map<string, Map<string, RafaCommand>>();
  for (const command of commands) {
    const problem = commandProblem(command);
    if (problem !== null) throw new TypeError(`${REFUSAL}: ${problem}`);
    const spelling = commandSpelling(command);
    if (isTopLevel(command)) {
      refuseHelpWord(command.subject, 'a command');
      if (subjects.has(command.subject)) {
        throw new Error(`${REFUSAL}: top-level command "${spelling}" is spelled as a subject`);
      }
    } else if (subjects.get(command.subject)?.name !== command.subject) {
      throw new Error(`${REFUSAL}: command "${spelling}" is under subject "${command.subject}", which is not declared`);
    }
    const actions = bySubject.get(command.subject) ?? new Map<string, RafaCommand>();
    if (actions.has(command.action)) throw new Error(`${REFUSAL}: command "${spelling}" is declared twice`);
    actions.set(command.action, command);
    bySubject.set(command.subject, actions);
  }
  return bySubject;
}

/** The top-level command a word names through `find`, or undefined. */
function topLevelOf(find: FindCommand, word: string): RafaCommand | undefined {
  const command = find(word, word);
  return command !== undefined && isTopLevel(command)
    ? command
    : undefined;
}

/** The command an alias's words are already the spelling of, or undefined. */
function shadowOf(
  words: readonly string[],
  find: FindCommand,
  subjects: ReadonlyMap<string, SubjectSpec>,
): RafaCommand | undefined {
  const [first = '', second] = words;
  if (words.length === 1) return topLevelOf(find, first);
  const subject = subjects.get(first);
  if (words.length !== 2 || subject === undefined || second === undefined) return undefined;
  return find(subject.name, second);
}

/** Every alias, longest first, refusing one the module note refuses. */
function indexAliases(
  commands: readonly RafaCommand[],
  find: FindCommand,
  subjects: ReadonlyMap<string, SubjectSpec>,
): readonly CommandAlias[] {
  const claimed = new Map<string, RafaCommand>();
  const aliases: CommandAlias[] = [];
  for (const command of commands) {
    const spelling = commandSpelling(command);
    for (const alias of command.aliases ?? []) {
      const words = Object.freeze(alias.trim().split(/\s+/));
      const typed = words.join(' ');
      if (!words.every(isRoutingWord)) {
        throw new Error(
          `${REFUSAL}: command "${spelling}" has alias ${describeValue(alias)},`
            + ' expected words with no slash and no leading dash',
        );
      }
      refuseHelpWord(words[0] ?? '', 'the first word of an alias');
      const owner = claimed.get(typed);
      if (owner !== undefined) {
        throw new Error(`${REFUSAL}: alias "${typed}" is claimed by "${commandSpelling(owner)}" and by "${spelling}"`);
      }
      const shadow = shadowOf(words, find, subjects);
      if (shadow !== undefined) {
        throw new Error(`${REFUSAL}: alias "${typed}" of "${spelling}" is spelled as command "${commandSpelling(shadow)}"`);
      }
      claimed.set(typed, command);
      aliases.push(Object.freeze({ words, command }));
    }
  }
  return Object.freeze(aliases.sort((a, b) => b.words.length - a.words.length));
}

/** Throws unless a mount can be held beside `held`; see the module note. */
function checkMount(mount: ModuleMount, held: readonly ModuleMount[]): void {
  if (typeof mount.name !== 'string' || !/^[^\s-]\S*$/.test(mount.name)) {
    throw new TypeError(`${REFUSAL}: a module is named ${describeValue(mount.name)}, expected a word with no leading dash`);
  }
  const label = `module "${mount.name}"`;
  if (held.some((other) => other.name === mount.name)) throw new Error(`${REFUSAL}: ${label} is mounted twice`);
  if (!Array.isArray(mount.commands)) {
    throw new TypeError(`${REFUSAL}: ${label} has commands ${describeValue(mount.commands)}, expected a list`);
  }
  const actions = new Set<string>();
  for (const command of mount.commands) {
    const problem = commandProblem(command);
    if (problem !== null) throw new TypeError(`${REFUSAL}: ${label}: ${problem}`);
    if (command.exec === true) {
      throw new Error(`${REFUSAL}: ${label}: action "${command.action}" declares exec, and a mounted action delegates to nothing`);
    }
    if (actions.has(command.action)) throw new Error(`${REFUSAL}: ${label}: action "${command.action}" is declared twice`);
    actions.add(command.action);
  }
}

/** Builds a registry over lists already copied, refusing anything the module note refuses. */
function build(
  subjectList: readonly SubjectSpec[],
  commands: readonly RafaCommand[],
  mounts: readonly ModuleMount[],
): CommandRegistry {
  const subjects = indexSubjects(subjectList);
  const bySubject = indexCommands(commands, subjects);
  mounts.forEach((mount, index) => {
    checkMount(mount, mounts.slice(0, index));
  });
  const mountsByName = new Map(mounts.map((mount) => [mount.name, mount]));
  const mounted = new Map(mounts.map((mount) => [
    mountKey(mount.name),
    new Map(mount.commands.map((command) => [command.action, command])),
  ]));

  const find: FindCommand = (subject, action) => (bySubject.get(subject) ?? mounted.get(subject))?.get(action);
  const aliases = indexAliases(commands, find, subjects);

  const registry: CommandRegistry = {
    subjects: () => subjectList,
    subjectOf: (word) => subjects.get(word),
    commands: (options) => rosterOf(commands, options),
    actionsOf: (subject, options) => {
      const mountedActions = mounted.get(subject);
      if (mountedActions !== undefined) return rosterOf([...mountedActions.values()], options);
      const actions = [...(bySubject.get(subject)?.values() ?? [])].filter((command) => !isTopLevel(command));
      return rosterOf(actions, options);
    },
    find,
    topLevel: (word) => topLevelOf(find, word),
    aliases: () => aliases,
    mounts: () => mounts,
    mountOf: (name) => mountsByName.get(name),
    mount: (mount) => {
      // Checked before the copy, which would otherwise spread a commands value that is no list.
      checkMount(mount, mounts);
      return build(subjectList, commands, Object.freeze([
        ...mounts,
        Object.freeze({ name: mount.name, entry: mount.entry, commands: Object.freeze([...mount.commands]) }),
      ]));
    },
  };
  return Object.freeze(registry);
}

/**
 * Makes a registry holding `input`'s subjects and core commands, and no
 * mount. Throws, answering no registry, on anything the module note
 * refuses.
 */
export function createCommandRegistry(input: CommandRegistryInput): CommandRegistry {
  return build(Object.freeze([...input.subjects]), Object.freeze([...input.commands]), Object.freeze([]));
}
