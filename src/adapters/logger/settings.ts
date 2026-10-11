/**
 * The logger's settings, as module state: what `logger.*` in the config
 * says, held where every logger of the process can read it (#950).
 *
 * The dispatcher builds a command's logger before the project is found,
 * and a command loads its config later. So the settings cannot be handed
 * to the logger when it is made: `loadConfig` (`src/config-load.ts`)
 * sets them here once a config is read, as it sets the effort store's,
 * and a logger reads them at each entry. Until then the default applies,
 * with the invocation's verbosity beside it.
 *
 * This module imports types alone, so `config-load.ts` can import it
 * without pulling an adapter in.
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
 * Bun runs every test file in one process and this is module state, so
 * a case that sets settings sets `null` after it.
 */
import type { LogLevel } from '../../ports/index.js';

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

/** The settings every logger reads now. */
let active: LoggerSettings = DEFAULT_LOGGER_SETTINGS;

/** Sets the settings every logger reads from here on; `null` puts the default back. */
export function setActiveLoggerSettings(settings: LoggerSettings | null): void {
  active = settings === null
    ? DEFAULT_LOGGER_SETTINGS
    : Object.freeze({ ...settings, modules: new Map(settings.modules) });
}

/** The settings every logger reads now. */
export function activeLoggerSettings(): LoggerSettings {
  return active;
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
