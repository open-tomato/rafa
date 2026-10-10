/**
 * The `logger` section of the config schema: the six keys the logger
 * reads (#950), each one's field, its default, its spec and its reader.
 * `config-schema.ts`'s `RafaConfig` extends {@link LoggerConfigSettings},
 * and its `CONFIG_DEFAULTS` and `SETTINGS` spread the objects below right
 * after the `errors` section. It has its own module for the reason
 * `config-schema-errors.ts` gives.
 *
 * ## The keys
 *
 *   - `logger.level` is the loudest ORDERED level written: `error`,
 *     `warn` (the default) or `debug`. `api` is refused here: it sits
 *     outside the order and has its own key.
 *   - `logger.modules` gives one module a level of its own, over
 *     `logger.level`: `modules: { board: { level: debug } }`. It is one
 *     of the map settings `config.ts` merges across layers, so the
 *     user's and the project's maps are joined by module name, the
 *     project's entry winning for a module both name. A module's mapping
 *     holds `level` today, and any other key is kept and warned about.
 *   - `logger.api` turns on `api` entries, the metadata of each request
 *     to a service. Off by default.
 *   - `logger.theme` is `default` or `plain`, which writes no colour.
 *   - `logger.callSite` names the calling file on `debug` lines.
 *   - `logger.kind` names the logger adapter, `console` by default. A
 *     kind nothing registered is not refused at load, since the registry
 *     an add-on fills is not at hand here: the active logger warns once
 *     and stays on `console` (`adapters/logger/active.ts`).
 *
 * ## When they take effect
 *
 * `loadConfig` hands {@link loggerSettingsOf} to the logger as soon as a
 * config is read (`config-load.ts`). A command's logger exists before
 * that, so until a command loads its config the defaults apply.
 *
 * None of the keys is a `CommandLineSetting`: the verbosity flags are the
 * command line's say over what is written.
 */
import type { LoggerSettings, LoggerTheme } from './adapters/logger/settings.js';
import type { SettingSpec } from './config-schema.js';
import type { Reader } from './config-sections.js';
import type { LogLevel } from './ports/index.js';

import { DEFAULT_LOGGER_KIND, LOG_LEVELS, LOGGER_THEMES } from './adapters/logger/settings.js';
import { mapOf } from './config-readers.js';
import { below, flag, isMapping, oneOf, refused, text } from './config-sections.js';

/** The `logger` settings. */
export interface LoggerConfigSettings {
  /** The logger adapter's kind. `logger.kind`. */
  loggerKind: string;
  /** The loudest ordered level written. `logger.level`. */
  loggerLevel: LogLevel;
  /** How lines are coloured. `logger.theme`. */
  loggerTheme: LoggerTheme;
  /** A level per module, over `logger.level`. `logger.modules`. */
  loggerModules: ReadonlyMap<string, LogLevel>;
  /** Whether a `debug` line names the calling file. `logger.callSite`. */
  loggerCallSite: boolean;
  /** Whether `api` entries are written. `logger.api`. */
  loggerApi: boolean;
}

/** The key a module's mapping reads. */
const MODULE_LEVEL_KEY = 'level';

/** What a module's entry is expected to be, in a refusal. */
const MODULE_EXPECTED = `a mapping holding ${MODULE_LEVEL_KEY}`;

/** One module's mapping: its `level`, any other key kept as an extra. */
const moduleLevel: Reader<LogLevel> = (raw, at) => {
  if (!isMapping(raw)) return refused(at, raw, MODULE_EXPECTED);
  const level = oneOf(LOG_LEVELS)(raw[MODULE_LEVEL_KEY], below(at, `.${MODULE_LEVEL_KEY}`));
  const extras = Object.entries(raw)
    .filter(([key]) => key !== MODULE_LEVEL_KEY)
    .map(([key, value]) => ({ key: `${at.key}.${key}`, value }));
  return { ...level, extras };
};

/** The defaults: the console logger at `warn`, nothing else turned on. */
export const LOGGER_DEFAULTS: Readonly<LoggerConfigSettings> = Object.freeze({
  loggerKind: DEFAULT_LOGGER_KIND,
  loggerLevel: 'warn',
  loggerTheme: 'default',
  loggerModules: new Map<string, LogLevel>(),
  loggerCallSite: false,
  loggerApi: false,
});

/** Every `logger` setting. */
export const LOGGER_SETTINGS: { readonly [K in keyof LoggerConfigSettings]: SettingSpec<K> } = {
  loggerKind: { key: 'logger.kind', read: text('an adapter kind, such as console'), cli: false },
  loggerLevel: { key: 'logger.level', read: oneOf(LOG_LEVELS), cli: false },
  loggerTheme: { key: 'logger.theme', read: oneOf(LOGGER_THEMES), cli: false },
  loggerModules: { key: 'logger.modules', read: mapOf(moduleLevel, MODULE_EXPECTED), cli: false },
  loggerCallSite: { key: 'logger.callSite', read: flag, cli: false },
  loggerApi: { key: 'logger.api', read: flag, cli: false },
};

/** The settings a logger reads, from a resolved config's `logger` fields. */
export function loggerSettingsOf(config: LoggerConfigSettings): LoggerSettings {
  return {
    kind: config.loggerKind,
    level: config.loggerLevel,
    theme: config.loggerTheme,
    modules: config.loggerModules,
    callSite: config.loggerCallSite,
    api: config.loggerApi,
  };
}
