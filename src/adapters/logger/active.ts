/**
 * The logger this process writes its diagnostics through (#950), held
 * as module state beside the active output (`../output/active.ts`), for
 * the same reason: a module far from any command still has somewhere to
 * warn.
 *
 * Until something sets another, it is a console logger at verbosity 0
 * with no colour, writing through the active output. The dispatcher
 * sets one per command, made with that invocation's verbosity and
 * colour, and puts the previous one back afterwards
 * ({@link setActiveLogger} answers the state to restore).
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
 * Bun runs every test file in one process, and this is module state: a
 * case that sets a logger sets `null` after it.
 */
import type { Logger } from '../../ports/index.js';

import { messageOf } from '../../config-sections.js';
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

/** What is active now. */
let state: ActiveLoggerState = NOTHING_SET;

/** The loggers the resolver answered, by kind, for the state active now. */
let resolved: ReadonlyMap<string, Logger> = new Map();

/** The kinds the resolver refused, for the state active now. */
let refused: ReadonlySet<string> = new Set();

/** Makes `next` the state, forgetting what the previous resolver answered. */
function become(next: ActiveLoggerState): void {
  state = next;
  resolved = new Map();
  refused = new Set();
}

/**
 * Sets the logger this process writes through, and how a kind other
 * than console is made. `null` puts the default back. Answers what was
 * active, for {@link restoreActiveLogger}.
 */
export function setActiveLogger(logger: Logger | null, resolver: LoggerResolver | null = null): ActiveLoggerState {
  const previous = state;
  become(Object.freeze({ logger, resolver }));
  return previous;
}

/** Puts back a state {@link setActiveLogger} answered. */
export function restoreActiveLogger(previous: ActiveLoggerState): void {
  become(previous);
}

/** The logger this process writes through; see the module note. */
export function activeLogger(): Logger {
  const base = state.logger ?? DEFAULT_LOGGER;
  const kind = activeLoggerSettings().kind;
  if (kind === DEFAULT_LOGGER_KIND || state.resolver === null || refused.has(kind)) return base;

  const known = resolved.get(kind);
  if (known !== undefined) return known;
  try {
    const made = state.resolver(kind);
    resolved = new Map([...resolved, [kind, made]]);
    return made;
  } catch (error) {
    refused = new Set([...refused, kind]);
    activeOutput().warn(
      `logger: no adapter of kind ${JSON.stringify(kind)}: ${messageOf(error)}; using ${DEFAULT_LOGGER_KIND}`,
    );
    return base;
  }
}
