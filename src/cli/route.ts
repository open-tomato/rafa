/**
 * Reads a command line into what the dispatcher does with it: run a
 * command, answer a help request, or refuse.
 *
 * Routing is pure. It reads the words and the registry, and writes,
 * imports and runs nothing, so every rule below is held by a case with
 * no process around it.
 *
 * ## Routing words
 *
 * The routing words are the line's words that are not flags, read left
 * to right up to a `--`. A flag is a word opening with `-` that is longer
 * than `-`. A flag never takes the next word as its value while the line
 * is routed, so under `rafa -v loop start` the subject is `loop`, where
 * `parseArgs` would read `loop` as the verbosity. Ahead of the last
 * routing word a flag's value is joined with `=`: under
 * `rafa --output json loop start` the subject is `json`.
 *
 * ## What a line routes to
 *
 * With no routing word, the line asks for the root help. A first word of
 * `help` asks for help on the words after it, as a `--help` or `-h` flag
 * before any `--` does for the words around it.
 *
 * The words route to the command whose spelling is the longest match
 * among three: a subject, by its name or plural, and one of its actions;
 * a top-level command's one word; and a core command's alias. On equal
 * length the subject's action wins over a top-level command, and both
 * over an alias; the registry refuses an alias either would shadow.
 *
 * A command declaring `exec` reads on. The next word names a module
 * mounted as `module/<name>` and the word after it one of that module's
 * actions, which is what runs. With no word after the `exec` action, the
 * `exec` action runs itself.
 *
 * Refused, each with the words typed so far as the label: a first word
 * that is neither a subject, a top-level command nor an alias
 * (`unknown_subject`), a subject with no word after it
 * (`missing_action`), a subject with a word that is none of its actions
 * (`unknown_action`), a module word naming no mount (`unknown_module`),
 * and a mount with no action word or a word that is none of its actions
 * (`missing_action`, `unknown_action`). A message lists the actions a
 * roster shows, so a hidden action is never named in one, and still
 * routes.
 *
 * A help request routes the same words, and a refusal is still a
 * refusal. A subject alone asks for the subject's help before an alias
 * spelled as that subject is tried, so `rafa plan --help` is the `plan`
 * roster and not `plan create`'s help.
 *
 * ## What a route carries
 *
 * `line` is the whole line without the words routed by, `help` included:
 * what `assembleContext` reads the output mode, the verbosity, `args` and
 * `flags` from. `argv`, on a command route, is the words after the last
 * word routed by. `label` is what the start event calls the invocation:
 * the canonical spelling of the command run, with the module and its
 * action for a mounted one, `help` for a help request, and the words
 * typed for a refusal. `alias` is the routing words typed when an alias
 * routed the line, and null otherwise.
 */
import type { RafaCommand } from './command.js';
import type { CommandRegistry, ModuleMount, SubjectSpec } from './registry.js';

import { commandSpelling } from './command.js';
import { HELP_WORD, mountKey } from './registry.js';

/** The refusals a line routes to. */
export const ROUTE_REFUSALS = ['unknown_subject', 'missing_action', 'unknown_action', 'unknown_module'] as const;

/** One of the refusals a line routes to. */
export type RouteRefusalCode = (typeof ROUTE_REFUSALS)[number];

/** What a help request asks for, at one of the three levels. */
export type HelpRequest =
  | { readonly level: 'root' }
  | { readonly level: 'subject'; readonly subject: SubjectSpec }
  | {
    readonly level: 'action';
    readonly command: RafaCommand;
    /** The canonical spelling after `rafa`, a mounted action's module and action included. */
    readonly spelling: string;
    /** The mount the action came from, or null for a core command. */
    readonly module: ModuleMount | null;
  };

/** What every route carries. */
interface RouteBase {
  /** The line without the words routed by. */
  readonly line: readonly string[];
  /** What the start event calls the invocation. */
  readonly label: string;
}

/** A line asking for help. */
export interface HelpRoute extends RouteBase {
  readonly kind: 'help';
  readonly request: HelpRequest;
}

/** A line naming a command to run. */
export interface CommandRoute extends RouteBase {
  readonly kind: 'command';
  readonly command: RafaCommand;
  /** The mount the command came from, or null for a core command. */
  readonly module: ModuleMount | null;
  /** The routing words typed when an alias routed the line, or null. */
  readonly alias: string | null;
  /** The words after the last word routed by. */
  readonly argv: readonly string[];
}

/** A line the registry cannot route. */
export interface RefusalRoute extends RouteBase {
  readonly kind: 'refusal';
  readonly code: RouteRefusalCode;
  readonly message: string;
}

/** What a line routes to. */
export type Route = HelpRoute | CommandRoute | RefusalRoute;

/** The routing words of a line, where each sits in it, and whether a help flag was typed. */
interface LineWords {
  readonly positions: readonly number[];
  readonly words: readonly string[];
  readonly helpFlag: boolean;
}

/** How far a line's words resolved. `consumed` counts the routing words read. */
type Resolution =
  | {
    readonly kind: 'command';
    readonly command: RafaCommand;
    readonly consumed: number;
    readonly module: ModuleMount | null;
    readonly alias: string | null;
    readonly label: string;
  }
  | {
    readonly kind: 'refusal';
    readonly code: RouteRefusalCode;
    readonly message: string;
    readonly consumed: number;
    readonly label: string;
  };

/** True when a word is a flag: opening with `-` and longer than `-`. */
function isFlag(word: string): boolean {
  return word.length > 1 && word.startsWith('-');
}

/** Reads a line's routing words; see the module note. */
function readWords(argv: readonly string[]): LineWords {
  const positions: number[] = [];
  let helpFlag = false;
  for (const [index, word] of argv.entries()) {
    if (word === '--') break;
    if (!isFlag(word)) {
      positions.push(index);
    } else if (word === '--help' || word === '-h') {
      helpFlag = true;
    }
  }
  return { positions, words: positions.map((index) => argv[index] ?? ''), helpFlag };
}

/** The actions a roster shows, as a refusal lists them. */
function listed(commands: readonly RafaCommand[]): string {
  return commands.length === 0
    ? 'none'
    : commands.map((command) => command.action).join(', ');
}

/** A refusal after `consumed` routing words. */
function refusal(code: RouteRefusalCode, message: string, words: readonly string[], consumed: number): Resolution {
  return { kind: 'refusal', code, message, consumed, label: words.slice(0, consumed).join(' ') };
}

/** Resolves the words among core commands, subject actions and aliases; see the module note. */
function resolveCore(registry: CommandRegistry, words: readonly string[]): Resolution {
  const [first = '', second] = words;
  const subject = registry.subjectOf(first);
  const canonical = subject === undefined || second === undefined
    ? undefined
    : registry.find(subject.name, second);
  const topLevel = registry.topLevel(first);
  const alias = registry.aliases().find((held) => held.words.every((word, index) => words[index] === word));

  const candidates: Resolution[] = [];
  if (canonical !== undefined) candidates.push(commandResolution(canonical, 2, null));
  if (topLevel !== undefined) candidates.push(commandResolution(topLevel, 1, null));
  if (alias !== undefined) candidates.push(commandResolution(alias.command, alias.words.length, alias.words.join(' ')));
  const best = candidates.reduce<Resolution | undefined>(
    (held, candidate) => (held === undefined || candidate.consumed > held.consumed
      ? candidate
      : held),
    undefined,
  );
  if (best !== undefined) return best;

  if (subject === undefined) {
    return refusal('unknown_subject', `unknown subject or command "${first}"`, words, 1);
  }
  const actions = listed(registry.actionsOf(subject.name));
  return second === undefined
    ? refusal('missing_action', `"${subject.name}" needs an action; one of: ${actions}`, words, 1)
    : refusal('unknown_action', `"${subject.name}" has no action "${second}"; one of: ${actions}`, words, 2);
}

/** A command resolution, labelled by the command's canonical spelling. */
function commandResolution(command: RafaCommand, consumed: number, alias: string | null): Resolution {
  return { kind: 'command', command, consumed, module: null, alias, label: commandSpelling(command) };
}

/** Reads on past an `exec` action into the module it names; see the module note. */
function resolveExec(
  registry: CommandRegistry,
  words: readonly string[],
  exec: Extract<Resolution, { kind: 'command' }>,
): Resolution {
  const moduleWord = words[exec.consumed];
  const actionWord = words[exec.consumed + 1];
  if (moduleWord === undefined) return exec;

  const mount = registry.mountOf(moduleWord);
  if (mount === undefined) {
    const mounted = registry.mounts().map((held) => held.name);
    const names = mounted.length === 0
      ? 'none'
      : mounted.join(', ');
    return refusal('unknown_module', `no module "${moduleWord}" is mounted; mounted: ${names}`, words, exec.consumed + 1);
  }
  const key = mountKey(mount.name);
  const actions = listed(registry.actionsOf(key));
  if (actionWord === undefined) {
    return refusal('missing_action', `module "${mount.name}" needs an action; one of: ${actions}`, words, exec.consumed + 1);
  }
  const command = registry.find(key, actionWord);
  if (command === undefined) {
    return refusal(
      'unknown_action',
      `module "${mount.name}" has no action "${actionWord}"; one of: ${actions}`,
      words,
      exec.consumed + 2,
    );
  }
  const routed = `${mount.name} ${command.action}`;
  return {
    kind: 'command',
    command,
    consumed: exec.consumed + 2,
    module: mount,
    alias: exec.alias === null
      ? null
      : `${exec.alias} ${routed}`,
    label: `${exec.label} ${routed}`,
  };
}

/**
 * Routes a line's words through a registry: the command to run, the help
 * asked for, or the refusal. See the module note.
 */
export function routeLine(registry: CommandRegistry, argv: readonly string[]): Route {
  const { positions, words: allWords, helpFlag } = readWords(argv);
  const offset = allWords[0] === HELP_WORD
    ? 1
    : 0;
  const asksHelp = helpFlag || offset === 1;
  const words = allWords.slice(offset);
  const lineWithout = (consumed: number): readonly string[] => {
    const routed = new Set(positions.slice(0, offset + consumed));
    return argv.filter((_word, index) => !routed.has(index));
  };

  const [first] = words;
  if (first === undefined) {
    return { kind: 'help', request: { level: 'root' }, label: HELP_WORD, line: lineWithout(0) };
  }
  const subject = registry.subjectOf(first);
  if (asksHelp && words.length === 1 && subject !== undefined) {
    return { kind: 'help', request: { level: 'subject', subject }, label: HELP_WORD, line: lineWithout(1) };
  }

  const core = resolveCore(registry, words);
  const resolved = core.kind === 'command' && core.command.exec === true
    ? resolveExec(registry, words, core)
    : core;
  const line = lineWithout(resolved.consumed);
  if (resolved.kind === 'refusal') {
    return { kind: 'refusal', code: resolved.code, message: resolved.message, label: resolved.label, line };
  }
  if (asksHelp) {
    return {
      kind: 'help',
      request: { level: 'action', command: resolved.command, spelling: resolved.label, module: resolved.module },
      label: HELP_WORD,
      line,
    };
  }
  const last = positions[offset + resolved.consumed - 1] ?? -1;
  return {
    kind: 'command',
    command: resolved.command,
    module: resolved.module,
    alias: resolved.alias,
    label: resolved.label,
    line,
    argv: argv.slice(last + 1),
  };
}
