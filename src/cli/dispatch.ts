/**
 * The dispatcher: one invocation of rafa, from the words of its line to
 * its exit code, with exactly one `start` and one terminal `result`
 * event.
 *
 * ## One invocation
 *
 *   1. Every module command entry the caller names is imported and
 *      mounted (`modules.ts`), each failure kept as a warning.
 *   2. The line is routed (`route.ts`): a command, a help request or a
 *      refusal.
 *   3. The context is assembled from the line without its routing
 *      words, each deprecated flag typed read as the spelling it is
 *      deprecated for, against the routed command's `args` and `flags`.
 *      A spec `parseArgs` refuses is the `invalid_spec` refusal, and the
 *      context is assembled again without it so the refusal can be told.
 *   4. The start event is written, then each module warning at warn
 *      level.
 *   5. The route is settled. A help request writes the help text; a
 *      refusal writes nothing yet. A command needing a project has it
 *      resolved first, and outside one ends as the `no_project` refusal
 *      without running (see "The project"). A command that runs prints
 *      its deprecation lines when it has any and runs with its context's
 *      output set as the active output (`src/adapters/output/active.ts`)
 *      in the invocation's output mode, the output and the mode active
 *      before being put back once it ends. Its context's `registry` is
 *      the one the line was routed through, with every module that loaded
 *      mounted on it, and its `project` the project resolved for it.
 *   6. The terminal result event is written, and the exit code answered.
 *
 * The dispatcher sets no `process.exitCode` and calls no
 * `process.exit`: it answers the exit code, and its caller ends the
 * process with it.
 *
 * ## The events, by mode
 *
 * In json mode the start and result events are written as NDJSON through
 * the context's output. In text mode neither is written, so a person
 * reads only what the command prints: a failure's message goes to stderr
 * as one line, and a result a command gave is written as the `text`
 * adapter writes one. Help is text only: in json mode a help request
 * writes its two events and no text. Either way the terminal event is
 * answered with the exit code, in {@link DispatchOutcome}.
 *
 * ## What a command writes through
 *
 * The context's output passes every `info`, `warn`, `error` and `debug`
 * line and every `step` and `log` event to the output assembled for the
 * invocation. It holds a command's `result` payload for the terminal
 * event instead of writing it, and refuses a second one. It refuses a
 * `start` or a `result` handed to `emit`, which are the dispatcher's
 * alone. A refusal throws inside the command, which ends as the
 * `command_error` failure.
 *
 * ## How a command ends
 *
 *   - It returns: ok, with the payload it gave, if any.
 *   - It throws `CommandExit` with 0: ok, with that payload. A message is
 *     written as an `info` line.
 *   - It throws `CommandExit` with another code: that exit code and the
 *     `command_exit` error. The message, when not empty, is the stderr
 *     line in text mode, written as the command gave it, and the error's
 *     message in json mode, where an empty one reads `exit code <n>`.
 *   - It throws anything else: exit code 1, the `command_error` error
 *     with the thrown message, `rafa: <message>` on stderr in text mode,
 *     and the stack as a `debug` line.
 *
 * A refusal from routing, `invalid_spec` or `no_project` ends with exit
 * code 1 and `rafa: <message>` on stderr in text mode. A terminal event
 * that cannot be written, such as a payload `JSON.stringify` refuses, is
 * replaced by the `result_unwritable` failure with exit code 1.
 *
 * ## The project
 *
 * A command runs inside a project unless it declares
 * `needsProject: false` (`command.ts`), as `init` and `describe` do.
 * Once its spec is read, `resolveScope` (`src/project/scope.ts`) walks up
 * from the working directory, {@link DispatchOptions.cwd}, to the first
 * directory holding `.rafa/config.yaml`, passing over the home,
 * {@link DispatchOptions.home}. The project found is the context's
 * `project`. With none, the invocation ends as the `no_project` refusal
 * with exit code 1 and the `rafa init` hint the walk answers as its
 * message, and the command never runs, so it prints no deprecation line.
 * A working directory or a home the walk refuses, a relative path or a
 * start that does not resolve, ends the same way with the walk's message.
 *
 * A help request, a routing refusal, `invalid_spec` and a command
 * declaring `needsProject: false` read neither the working directory nor
 * the home, so each answers outside a project as it does inside one, and
 * such a command runs with `project` null.
 *
 * ## Deprecation lines
 *
 * A command reached through one of its aliases, or declaring
 * `deprecated`, writes one line to stderr before it runs, in either
 * mode: `rafa: "rafa start" is deprecated; use "rafa loop start"`, with
 * ` since <version>` after `deprecated` and the declared `use` when the
 * command declares one. A help request names a command without running
 * it, and prints none.
 *
 * A flag declaring `deprecated` (`command.ts`) is read as its `use` when
 * it is typed bare ahead of any `--`, spelled `--<name>` or `-<name>`, or
 * so for one of its aliases, which `parseArgs` reads alike. The words of
 * `use` take the typed word's place in the line the context is assembled
 * from, so `rafa effort report --json` runs in json mode, as
 * `rafa effort report --output=json` does, and the command's `argv` keeps
 * the words as typed. Such a flag writes one line to stderr before the
 * command runs, after the command's own and however often it is typed:
 *
 *   rafa: "rafa effort report --json" is deprecated; use "rafa effort report --output=json"
 */
import type { RafaCommand, RafaContext, RafaFlagSpec } from './command.js';
import type { CliContext } from './core/types.js';
import type { ModuleCommandEntry, ModuleImporter } from './modules.js';
import type { CommandRegistry } from './registry.js';
import type { CommandRoute, HelpRequest, Route, RouteRefusalCode } from './route.js';
import type { OutputStream } from '../adapters/output/stream.js';
import type { CliEvent, CliEventResult, Output } from '../ports/index.js';
import type { ProjectFound } from '../project/scope.js';

import { homedir } from 'node:os';

import { activeOutput, activeOutputMode, setActiveOutput } from '../adapters/output/active.js';
import { resolveScope, ScopeError } from '../project/scope.js';

import { CommandExit } from './command.js';
import { assembleContext } from './core/assembleContext.js';
import { loadModuleCommands } from './modules.js';
import { ROUTE_REFUSALS, routeLine } from './route.js';

/** What every refusal the dispatcher throws opens with. */
const REFUSAL = 'dispatcher';

/** Every code a failed terminal event carries. */
export const DISPATCH_ERROR_CODES = [
  ...ROUTE_REFUSALS,
  'invalid_spec',
  'no_project',
  'command_exit',
  'command_error',
  'result_unwritable',
] as const;

/** One of the codes a failed terminal event carries. */
export type DispatchErrorCode = (typeof DISPATCH_ERROR_CODES)[number];

/** Renders the text a help request writes. */
export type HelpRenderer = (request: HelpRequest, registry: CommandRegistry) => string;

/** What {@link dispatch} runs an invocation with. */
export interface DispatchOptions {
  /** The core subjects and commands. Modules are mounted on it for this invocation. */
  readonly registry: CommandRegistry;
  /** The module command entries to import and mount. Defaults to none. */
  readonly modules?: readonly ModuleCommandEntry[];
  /** Imports one module entry. Defaults to a dynamic import of the file. */
  readonly importModule?: ModuleImporter;
  /** The environment the context reads. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the output, help and results are written. Defaults to `process.stdout`. */
  readonly stdout?: OutputStream;
  /** Where deprecation and failure lines are written. Defaults to `process.stderr`. */
  readonly stderr?: OutputStream;
  /** Aborted when the invocation is asked to stop. */
  readonly signal?: AbortSignal;
  /** The clock the start and result events are stamped from. Defaults to the system clock. */
  readonly now?: () => Date;
  /** Renders help. Defaults to {@link renderUsage}. */
  readonly renderHelp?: HelpRenderer;
  /**
   * The directory a command's project is resolved from, absolute.
   * Defaults to `process.cwd()`, read only for a command running inside
   * a project; see the module note.
   */
  readonly cwd?: string;
  /**
   * The home the walk passes over, absolute. Defaults to `homedir()`,
   * read only for a command running inside a project.
   */
  readonly home?: string;
}

/** How an invocation ended: its exit code and its terminal event, written or not. */
export interface DispatchOutcome {
  readonly exitCode: number;
  readonly result: CliEventResult;
}

/** The options with their defaults filled. */
interface Settings {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly signal: AbortSignal | undefined;
  readonly now: () => Date;
  readonly renderHelp: HelpRenderer;
  /** The working directory, read only when a command needs a project. */
  readonly cwd: () => string;
  /** The home, read only when a command needs a project. */
  readonly home: () => string;
}

/** How a route settled, before its terminal event is built. */
interface Ending {
  readonly exitCode: number;
  /** The payload a command gave, or null. */
  readonly payload: { readonly value: unknown } | null;
  readonly error: { readonly code: DispatchErrorCode; readonly message: string } | null;
  /** The line text mode writes to stderr, or null. */
  readonly stderrLine: string | null;
}

/** An output that holds a command's result, and the payload it holds. */
interface GuardedOutput {
  readonly output: Output;
  readonly payload: () => { readonly value: unknown } | null;
}

/**
 * The help the dispatcher writes when its caller names no renderer: one
 * usage line for the level asked. The three-level renderer is
 * `src/cli/help.ts`'s, and a caller hands it in.
 */
export function renderUsage(request: HelpRequest): string {
  switch (request.level) {
    case 'root':
      return 'usage: rafa <subject> <action> [args] [flags]\n';
    case 'subject':
      return `usage: rafa ${request.subject.name} <action> [args] [flags]\n`;
    case 'action':
      return `usage: rafa ${request.spelling} [args] [flags]\n`;
  }
}

/** The line a command's deprecation writes, or null when it has none; see the module note. */
export function deprecationLine(route: CommandRoute): string | null {
  const { command: { deprecated }, alias, label } = route;
  if (alias === null && deprecated === undefined) return null;
  const since = deprecated === undefined
    ? ''
    : ` since ${deprecated.since}`;
  return `rafa: "rafa ${alias ?? label}" is deprecated${since}; use "rafa ${deprecated?.use ?? label}"`;
}

/** A deprecated flag a line typed: the word as typed, and the spelling it is deprecated for. */
export interface DeprecatedFlagTyped {
  readonly typed: string;
  readonly use: string;
}

/** A command route's line as the context reads it, and the deprecated flags typed in it. */
export interface DeprecatedFlagReading {
  /** The line, each deprecated flag typed replaced by the words of its `use`. */
  readonly line: readonly string[];
  /** Each deprecated flag typed, once, in the order first typed. */
  readonly typed: readonly DeprecatedFlagTyped[];
}

/** Each spelling `parseArgs` reads a deprecated flag of `flags` by, mapped to the flag. */
function deprecatedSpellings(flags: readonly RafaFlagSpec[]): ReadonlyMap<string, RafaFlagSpec> {
  const spellings = new Map<string, RafaFlagSpec>();
  for (const flag of flags.filter((declared) => declared.deprecated !== undefined)) {
    for (const word of [flag.name, ...(flag.aliases ?? [])]) {
      spellings.set(`-${word}`, flag);
      spellings.set(`--${word}`, flag);
    }
  }
  return spellings;
}

/** A command route's line read for its deprecated flags; see the module note. */
export function readDeprecatedFlags(route: CommandRoute): DeprecatedFlagReading {
  const spellings = deprecatedSpellings(route.command.flags);
  const line: string[] = [];
  const typed = new Map<string, DeprecatedFlagTyped>();
  let flagsEnded = false;
  for (const word of route.line) {
    flagsEnded = flagsEnded || word === '--';
    const flag = flagsEnded
      ? undefined
      : spellings.get(word);
    if (flag?.deprecated === undefined) {
      line.push(word);
      continue;
    }
    line.push(...flag.deprecated.use.split(' '));
    if (!typed.has(flag.name)) typed.set(flag.name, { typed: word, use: flag.deprecated.use });
  }
  return { line, typed: [...typed.values()] };
}

/** The line a deprecated flag typed writes to stderr; see the module note. */
export function deprecatedFlagLine(route: CommandRoute, flag: DeprecatedFlagTyped): string {
  return `rafa: "rafa ${route.label} ${flag.typed}" is deprecated; use "rafa ${route.label} ${flag.use}"`;
}

/** What was thrown, as a message. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** A failure with exit code 1 and the `rafa: <message>` stderr line. */
function failure(code: DispatchErrorCode, message: string): Ending {
  return { exitCode: 1, payload: null, error: { code, message }, stderrLine: `rafa: ${message}` };
}

/** A success, carrying the payload a command gave. */
function success(payload: { readonly value: unknown } | null): Ending {
  return { exitCode: 0, payload, error: null, stderrLine: null };
}

/** The output a command writes through; see the module note. */
function guardOutput(base: Output): GuardedOutput {
  let held: { readonly value: unknown } | null = null;
  const output: Output = Object.freeze({
    info: (message: string) => {
      base.info(message);
    },
    warn: (message: string) => {
      base.warn(message);
    },
    error: (message: string) => {
      base.error(message);
    },
    debug: (message: string) => {
      base.debug(message);
    },
    emit: (event: CliEvent) => {
      if (event.type === 'start' || event.type === 'result') {
        throw new Error(`${REFUSAL}: a command emits no ${event.type} event; the dispatcher writes the one each invocation has`);
      }
      base.emit(event);
    },
    result: (value: unknown) => {
      if (held !== null) throw new Error(`${REFUSAL}: refused a second result; a command gives exactly one`);
      held = Object.freeze({ value });
    },
  });
  return { output, payload: () => held };
}

/** The context for a route, and the `invalid_spec` message when its command's spec was refused. */
function assemble(route: Route, settings: Settings): { base: CliContext; problem: string | null } {
  const argv = route.kind === 'command'
    ? readDeprecatedFlags(route).line
    : route.line;
  const options = { argv, env: settings.env, stream: settings.stdout, signal: settings.signal };
  if (route.kind !== 'command') return { base: assembleContext(options), problem: null };
  try {
    return { base: assembleContext({ ...options, spec: route.command }), problem: null };
  } catch (error) {
    return {
      base: assembleContext(options),
      problem: `command "${route.label}" declares arguments or flags that cannot be read: ${messageOf(error)}`,
    };
  }
}

/** Runs a routed command with its context; see the module note. */
async function runCommand(
  route: CommandRoute,
  base: CliContext,
  registry: CommandRegistry,
  project: ProjectFound | null,
  settings: Settings,
): Promise<Ending> {
  const deprecation = deprecationLine(route);
  if (deprecation !== null) settings.stderr.write(`${deprecation}\n`);
  for (const flag of readDeprecatedFlags(route).typed) settings.stderr.write(`${deprecatedFlagLine(route, flag)}\n`);

  const guarded = guardOutput(base.output);
  const context: RafaContext = Object.freeze({
    ...base,
    output: guarded.output,
    argv: Object.freeze([...route.argv]),
    registry,
    project,
  });
  const previous = activeOutput();
  const previousMode = activeOutputMode();
  setActiveOutput(guarded.output, base.outputMode);
  try {
    await route.command.run(context);
    return success(guarded.payload());
  } catch (error) {
    if (!(error instanceof CommandExit)) {
      if (error instanceof Error && error.stack !== undefined) base.output.debug(error.stack);
      return failure('command_error', messageOf(error));
    }
    if (error.exitCode === 0) {
      if (error.message !== '') base.output.info(error.message);
      return success(guarded.payload());
    }
    return {
      exitCode: error.exitCode,
      payload: null,
      error: {
        code: 'command_exit',
        message: error.message === ''
          ? `exit code ${error.exitCode}`
          : error.message,
      },
      stderrLine: error.message === ''
        ? null
        : error.message,
    };
  } finally {
    setActiveOutput(previous, previousMode);
  }
}

/** Where a command runs: in a project, outside any for one needing none, or refused with a message. */
type Placement =
  | { readonly kind: 'placed'; readonly project: ProjectFound | null }
  | { readonly kind: 'refused'; readonly message: string };

/** Resolves the project a command runs in; see the module note. */
function placeCommand(command: RafaCommand, settings: Settings): Placement {
  if (command.needsProject === false) return { kind: 'placed', project: null };
  try {
    const scope = resolveScope(settings.cwd(), { home: settings.home() });
    return scope.found
      ? { kind: 'placed', project: scope }
      : { kind: 'refused', message: scope.hint };
  } catch (error) {
    if (!(error instanceof ScopeError)) throw error;
    return { kind: 'refused', message: error.message };
  }
}

/** Runs a command whose spec was read in the project it needs, or ends as `no_project`; see the module note. */
async function settleCommand(
  route: CommandRoute,
  base: CliContext,
  registry: CommandRegistry,
  settings: Settings,
): Promise<Ending> {
  const placement = placeCommand(route.command, settings);
  return placement.kind === 'refused'
    ? failure('no_project', placement.message)
    : runCommand(route, base, registry, placement.project, settings);
}

/** Settles a route into how the invocation ends; see the module note. */
async function settle(
  route: Route,
  base: CliContext,
  problem: string | null,
  registry: CommandRegistry,
  settings: Settings,
): Promise<Ending> {
  switch (route.kind) {
    case 'help':
      if (base.outputMode === 'text') settings.stdout.write(settings.renderHelp(route.request, registry));
      return success(null);
    case 'refusal':
      return failure(route.code satisfies RouteRefusalCode, route.message);
    case 'command':
      return problem === null
        ? settleCommand(route, base, registry, settings)
        : failure('invalid_spec', problem);
  }
}

/** The terminal event an ending is told as. */
function resultEvent(ending: Ending, now: () => Date): CliEventResult {
  const ts = now().toISOString();
  if (ending.error !== null) return { type: 'result', ok: false, error: { ...ending.error }, ts };
  return ending.payload === null
    ? { type: 'result', ok: true, ts }
    : { type: 'result', ok: true, data: ending.payload.value, ts };
}

/** Writes an ending's terminal event, or in text mode what a person reads of it. */
function writeEnding(ending: Ending, event: CliEventResult, base: CliContext, settings: Settings): void {
  if (base.outputMode === 'json') {
    base.output.emit(event);
    return;
  }
  if (ending.stderrLine !== null) settings.stderr.write(`${ending.stderrLine}\n`);
  if (ending.payload !== null) base.output.result(ending.payload.value);
}

/** Writes the terminal event, falling back to `result_unwritable`, and answers the outcome. */
function finish(ending: Ending, base: CliContext, settings: Settings): DispatchOutcome {
  const event = resultEvent(ending, settings.now);
  try {
    writeEnding(ending, event, base, settings);
    return { exitCode: ending.exitCode, result: event };
  } catch (error) {
    const fallback = failure('result_unwritable', `the result could not be written: ${messageOf(error)}`);
    const fallbackEvent = resultEvent(fallback, settings.now);
    writeEnding(fallback, fallbackEvent, base, settings);
    return { exitCode: fallback.exitCode, result: fallbackEvent };
  }
}

/**
 * Runs one invocation of rafa over the words of its line, `process.argv`
 * without the runtime and the script, and answers its exit code and
 * terminal event. See the module note.
 */
export async function dispatch(argv: readonly string[], options: DispatchOptions): Promise<DispatchOutcome> {
  const settings: Settings = {
    env: options.env ?? process.env,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    signal: options.signal,
    now: options.now ?? (() => new Date()),
    renderHelp: options.renderHelp ?? renderUsage,
    cwd: () => options.cwd ?? process.cwd(),
    home: () => options.home ?? homedir(),
  };
  const loaded = await loadModuleCommands(options.registry, options.modules ?? [], options.importModule);
  const route = routeLine(loaded.registry, argv);
  const { base, problem } = assemble(route, settings);

  if (base.outputMode === 'json') {
    base.output.emit({ type: 'start', command: route.label, ts: settings.now().toISOString() });
  }
  for (const warning of loaded.warnings) base.output.warn(warning);

  let ending: Ending;
  try {
    ending = await settle(route, base, problem, loaded.registry, settings);
  } catch (error) {
    ending = failure('command_error', messageOf(error));
  }
  return finish(ending, base, settings);
}
