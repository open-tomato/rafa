/**
 * The logger's settings: what `logger.*` in the config says, held where
 * every logger of the process can read it (#950).
 *
 * The dispatcher builds a command's logger before the project is found,
 * and a command loads its config later. So the settings cannot be handed
 * to the logger when it is made: `loadConfig`
 * (`src/core/config/config-load.ts`) calls core's load hook once a
 * config is read, as it sets the effort store's settings, and the hook
 * `src/config-registry.ts` sets hands the logger section's reading to
 * this module. A logger reads them at each entry. Until then the default
 * applies, with the invocation's verbosity beside it.
 *
 * This module imports types and `node:async_hooks` alone, so the
 * registry can import it without pulling an adapter in.
 *
 * ## Where they are held
 *
 * In two places, and {@link activeLoggerSettings} and
 * {@link setActiveLoggerSettings} both act on the first that applies:
 *
 *   - **A scope.** {@link runWithLoggerSettings} runs a function with
 *     settings of its own in an async scope, an `AsyncLocalStorage`
 *     (`node:async_hooks`). Inside that function, and in everything it
 *     awaits or starts, the reader answers the scope's settings and the
 *     setter replaces them. Once the function ends, however it ends,
 *     nothing of them is left. The dispatcher runs every command this
 *     way, starting from the defaults (`src/cli/dispatch.ts`), so the
 *     config a command loads sets that invocation's settings alone.
 *   - **The module-level value.** Outside every scope the reader answers
 *     one module-level value and the setter replaces it, the defaults
 *     until something sets another. A config loaded outside every
 *     command sets it, as the module loader (`src/modules/load.ts`) and
 *     the command hook (`src/status/hook.ts`) load one around an
 *     invocation; no command reads it.
 *
 * A scope belongs to one run, so runs need not nest to stay apart. Two
 * that overlap in one process, started together and awaited with
 * `Promise.all`, each read and set their own whichever ends first. A
 * scope opened inside another starts from the settings it is given,
 * never from the outer one's, and the outer one reads its own again
 * after it. A module-level value set and put back in a `finally` keeps
 * overlapping runs apart only while they nest (#927).
 *
 * ## A set made inside a scope
 *
 * It replaces that scope's settings, and never the module-level value.
 * This is where the settings differ from the active output
 * (`src/core/output/active.ts`), whose scope cannot be replaced from
 * inside it: the config naming the settings is loaded inside the run
 * that reads them, so the setter has to reach the run it is called in.
 * The scope therefore holds a cell, and a set swaps the frozen settings
 * the cell holds.
 *
 * ## What reads outside the scope
 *
 * A scope follows the awaits and the callbacks started inside it, by
 * where the code runs and not by where it was written: a function made
 * in one invocation and called from another reads the caller's. A
 * callback the runtime calls from elsewhere does not carry it, and reads
 * and sets the module-level value. Measured under bun 1.3.14, three
 * listeners registered inside a scope read the module-level settings: a
 * `process.on` signal listener when the signal arrived, an abort
 * listener that handler fired, and an abort listener an
 * `AbortSignal.timeout` fired. A timer, a microtask and the code after
 * an await read the scope's, and so did a signal listener wrapped with
 * `AsyncResource.bind` where it was registered.
 *
 * ## Which entries are on
 *
 * `error`, `warn` and `debug` are ordered, quietest first
 * ({@link LOG_LEVELS}). An entry is on when its level is at or quieter
 * than the threshold: the level its module has in `modules`, else
 * `level`. `debug` is also on from verbosity {@link DEBUG_VERBOSITY}.
 *
 * `api` sits outside that order. It is on when `api` is true or from
 * verbosity {@link API_VERBOSITY}, and nothing else turns it on: a
 * level of `debug` asks for rafa's own reasoning, never for the traffic
 * to a service.
 *
 * Bun runs every test file in one process and the module-level value is
 * module state, so a case that sets settings outside a scope sets `null`
 * after it.
 */
import type { LogLevel } from '../../ports/log-level.js';

import { AsyncLocalStorage } from 'node:async_hooks';

/** How a logger colours its lines. */
export type LoggerTheme = 'default' | 'plain';

/** The ordered levels, quietest first. `api` is not one of them. */
export const LOG_LEVELS: readonly LogLevel[] = Object.freeze(['error', 'warn', 'debug'] as const);

/** Every theme, in the order a refusal names them. */
export const LOGGER_THEMES: readonly LoggerTheme[] = Object.freeze(['default', 'plain'] as const);

/** The adapter kind core ships. */
export const DEFAULT_LOGGER_KIND = 'console';

/** The verbosity at and above which `debug` entries are on. */
export const DEBUG_VERBOSITY = 2;

/** The verbosity at and above which `api` entries are on. */
export const API_VERBOSITY = 3;

/** What a logger reads at each entry. */
export interface LoggerSettings {
  /** The adapter kind. `logger.kind`. */
  readonly kind: string;
  /** The loudest ordered level written. `logger.level`. */
  readonly level: LogLevel;
  /** How lines are coloured. `logger.theme`. */
  readonly theme: LoggerTheme;
  /** A level per module, over `level`. `logger.modules.<module>.level`. */
  readonly modules: ReadonlyMap<string, LogLevel>;
  /** Whether a `debug` line names the file that wrote it. `logger.callSite`. */
  readonly callSite: boolean;
  /** Whether `api` entries are written. `logger.api`. */
  readonly api: boolean;
}

/** The settings until a config is loaded. */
export const DEFAULT_LOGGER_SETTINGS: LoggerSettings = Object.freeze({
  kind: DEFAULT_LOGGER_KIND,
  level: 'warn',
  theme: 'default',
  modules: new Map<string, LogLevel>(),
  callSite: false,
  api: false,
});

/** The settings held in one place, a scope or the module level; a set swaps what it holds. */
interface SettingsCell {
  settings: LoggerSettings;
}

/** The settings of each run {@link runWithLoggerSettings} has in flight, by async scope. */
const scopes = new AsyncLocalStorage<SettingsCell>();

/** The module-level settings. */
const moduleLevel: SettingsCell = { settings: DEFAULT_LOGGER_SETTINGS };

/** A frozen copy of `settings`, or the defaults for `null`. */
function settingsOf(settings: LoggerSettings | null): LoggerSettings {
  return settings === null
    ? DEFAULT_LOGGER_SETTINGS
    : Object.freeze({ ...settings, modules: new Map(settings.modules) });
}

/** The cell a read or a set made here acts on: the scope's, else the module-level one. */
function cellHere(): SettingsCell {
  return scopes.getStore() ?? moduleLevel;
}

/**
 * Runs `run` with settings of its own in an async scope, starting from
 * `settings`, the defaults for `null`, and answers what `run` answers.
 * Inside `run` and whatever it awaits they are what is read and what a
 * set replaces, and nothing of them is left after it; see the module
 * note.
 */
export function runWithLoggerSettings<T>(settings: LoggerSettings | null, run: () => T): T {
  return scopes.run({ settings: settingsOf(settings) }, run);
}

/**
 * Sets the settings every logger reads from here on: those of the scope
 * this is called in, else the module-level ones. `null` puts the
 * defaults back. See the module note.
 */
export function setActiveLoggerSettings(settings: LoggerSettings | null): void {
  cellHere().settings = settingsOf(settings);
}

/** The settings a logger reads now: those of the scope this is read in, else the module-level ones. */
export function activeLoggerSettings(): LoggerSettings {
  return cellHere().settings;
}

/** Whether an entry at `level` from `module` is written; see the module note. */
export function levelEnabled(
  level: LogLevel,
  module: string | undefined,
  settings: LoggerSettings,
  verbosity: number,
): boolean {
  if (level === 'api') return settings.api || verbosity >= API_VERBOSITY;
  if (level === 'debug' && verbosity >= DEBUG_VERBOSITY) return true;
  const threshold = (module === undefined
    ? undefined
    : settings.modules.get(module)) ?? settings.level;
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(threshold);
}
