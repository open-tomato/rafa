/**
 * The logger this process writes its diagnostics through (#950), held
 * beside the active output (`../output/active.ts`), for the same reason:
 * a module far from any command still has somewhere to warn.
 *
 * Until something sets another, it is a console logger at verbosity 0
 * with no colour, writing through the active output. The dispatcher
 * runs every command with a logger of its own, made with that
 * invocation's verbosity and colour, in a scope
 * (`src/cli/dispatch.ts`), and sets no module-level logger.
 *
 * ## Where it is held
 *
 * In two places, and {@link activeLogger}, {@link setActiveLogger} and
 * {@link restoreActiveLogger} all act on the first that applies:
 *
 *   - **A scope.** {@link runWithActiveLogger} runs a function with a
 *     logger and a resolver of its own in an async scope, an
 *     `AsyncLocalStorage` (`node:async_hooks`). Inside that function,
 *     and in everything it awaits or starts, the reader answers the
 *     scope's logger and the setters replace it. Once the function ends,
 *     however it ends, nothing of it is left.
 *   - **The module-level value.** Outside every scope the reader answers
 *     one module-level logger and the setters replace it, the default
 *     until something sets another. No module but a test sets it.
 *
 * A scope belongs to one run, so runs need not nest to stay apart. Two
 * that overlap in one process, started together and awaited with
 * `Promise.all`, each read their own logger whichever ends first. A
 * scope opened inside another reads the inner logger inside and the
 * outer one after. A module-level value set and put back in a `finally`
 * keeps overlapping runs apart only while they nest (#927).
 *
 * ## A set made inside a scope
 *
 * It replaces that scope's logger and resolver, and never the
 * module-level ones. {@link setActiveLogger} answers the state that
 * scope held, and {@link restoreActiveLogger} puts a state back in the
 * scope it is called in, so the pair is called in one scope. The rule
 * is the one the settings follow (`./settings.ts`), which a run has to
 * set from inside itself when it loads its config. The logger follows
 * it too, so one rule covers both: a reader and a setter act on the
 * same place, the innermost scope when inside one.
 *
 * ## Another kind
 *
 * `logger.kind` is read from the settings at each call, because the
 * config that names it is loaded after the logger is set. While it says
 * `console`, the logger set is the one answered. For any other kind the
 * resolver given with the logger is asked once, and what it answers is
 * kept for that kind. A resolver that throws, as the registry does for
 * a kind nothing registered, is reported once through the active
 * output's `warn` and the console logger stays in use: a diagnostic
 * channel that cannot be made must never end the run it reports on.
 *
 * What a resolver answered and what it refused are kept with the logger
 * they belong to, in the scope or at module level, and forgotten when
 * that logger is replaced. So each scope asks its own resolver once and
 * warns once, whatever another scope asked.
 *
 * ## What reads outside the scope
 *
 * A scope follows the awaits and the callbacks started inside it, by
 * where the code runs and not by where it was written: a function made
 * in one invocation and called from another reads the caller's. A
 * callback the runtime calls from elsewhere does not carry it, and reads
 * and sets the module-level logger. Measured under bun 1.3.14, three
 * listeners registered inside a scope read the module-level logger: a
 * `process.on` signal listener when the signal arrived, an abort
 * listener that handler fired, and an abort listener an
 * `AbortSignal.timeout` fired. A timer, a microtask and the code after
 * an await read the scope's, and so did a signal listener wrapped with
 * `AsyncResource.bind` where it was registered.
 *
 * Bun runs every test file in one process, and the module-level value
 * is module state: a case that sets a logger outside a scope sets
 * `null` after it.
 */
import type { Logger } from '../../ports/index.js';

import { AsyncLocalStorage } from 'node:async_hooks';

import { messageOf } from '../../core/config/sections.js';
import { activeOutput } from '../output/active.js';

import { createConsoleLogger } from './console.js';
import { activeLoggerSettings, DEFAULT_LOGGER_KIND } from './settings.js';

/** Makes the logger of a kind other than console; throws when it cannot. */
export type LoggerResolver = (kind: string) => Logger;

/** What is active: the logger set, and how another kind is made. */
export interface ActiveLoggerState {
  /** The logger set, or null for the default. */
  readonly logger: Logger | null;
  /** How a kind other than console is made, or null when it cannot be. */
  readonly resolver: LoggerResolver | null;
}

/** The logger active while nothing is set. */
const DEFAULT_LOGGER: Logger = createConsoleLogger();

/** The state while nothing is set. */
const NOTHING_SET: ActiveLoggerState = Object.freeze({ logger: null, resolver: null });

/**
 * A logger held in one place, a scope or the module level, with what its
 * resolver answered. A set swaps the three; each is frozen or read-only.
 */
interface LoggerCell {
  /** The logger set and its resolver. */
  state: ActiveLoggerState;
  /** The loggers the resolver answered, by kind, for `state`. */
  resolved: ReadonlyMap<string, Logger>;
  /** The kinds the resolver refused, for `state`. */
  refused: ReadonlySet<string>;
}

/** A cell holding `state`, with nothing asked of its resolver yet. */
function cellOf(state: ActiveLoggerState): LoggerCell {
  return { state, resolved: new Map(), refused: new Set() };
}

/** The logger of each run {@link runWithActiveLogger} has in flight, by async scope. */
const scopes = new AsyncLocalStorage<LoggerCell>();

/** The module-level logger. */
const moduleLevel: LoggerCell = cellOf(NOTHING_SET);

/** The cell a read or a set made here acts on: the scope's, else the module-level one. */
function cellHere(): LoggerCell {
  return scopes.getStore() ?? moduleLevel;
}

/** Makes `next` the state of the cell here, forgetting what the previous resolver answered. */
function become(next: ActiveLoggerState): void {
  Object.assign(cellHere(), cellOf(next));
}

/**
 * Runs `run` with `logger` as the active logger, and `resolver` as how
 * a kind other than console is made, in an async scope of its own, and
 * answers what `run` answers. `null` for the logger is the default one.
 * Inside `run` and whatever it awaits they are what is read and what a
 * set replaces, and nothing of them is left after it; see the module
 * note.
 */
export function runWithActiveLogger<T>(logger: Logger | null, resolver: LoggerResolver | null, run: () => T): T {
  return scopes.run(cellOf(Object.freeze({ logger, resolver })), run);
}

/**
 * Sets the logger written through, and how a kind other than console is
 * made: those of the scope this is called in, else the module-level
 * ones. `null` puts the default back. Answers what was active there, for
 * {@link restoreActiveLogger}.
 */
export function setActiveLogger(logger: Logger | null, resolver: LoggerResolver | null = null): ActiveLoggerState {
  const previous = cellHere().state;
  become(Object.freeze({ logger, resolver }));
  return previous;
}

/** Puts back a state {@link setActiveLogger} answered, in the scope this is called in, else at module level. */
export function restoreActiveLogger(previous: ActiveLoggerState): void {
  become(previous);
}

/** The logger to write through: the one of the scope this is read in, else the module-level one; see the module note. */
export function activeLogger(): Logger {
  const cell = cellHere();
  const { state } = cell;
  const base = state.logger ?? DEFAULT_LOGGER;
  const kind = activeLoggerSettings().kind;
  if (kind === DEFAULT_LOGGER_KIND || state.resolver === null || cell.refused.has(kind)) return base;

  const known = cell.resolved.get(kind);
  if (known !== undefined) return known;
  try {
    const made = state.resolver(kind);
    cell.resolved = new Map([...cell.resolved, [kind, made]]);
    return made;
  } catch (error) {
    cell.refused = new Set([...cell.refused, kind]);
    activeOutput().warn(
      `logger: no adapter of kind ${JSON.stringify(kind)}: ${messageOf(error)}; using ${DEFAULT_LOGGER_KIND}`,
    );
    return base;
  }
}
