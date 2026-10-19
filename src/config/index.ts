/**
 * The `./config` subpath, `@open-tomato/rafa/config`: what a
 * `rafa.config.ts` or `rafa.config.mjs` imports to type its entries.
 *
 * - `Config`, the list of entries a config module exports, each a
 *   `ConfigEntry`, rafa's deep partial of the nested file shape
 *   `ConfigShape` (`entry.ts`, `shape.ts`).
 * - `defineConfig`, the identity, typed for its parameter.
 * - {@link defaults}, the one entry holding every setting's default.
 *
 * ## The defaults entry
 *
 * {@link defaults} is built from the registry (`src/config-registry.ts`):
 * each setting's file key, nested, holding its value from
 * `CONFIG_DEFAULTS` in the file's spelling ({@link fileValueOf}). A
 * setting whose default is null (`pr.base`, `hub.url`) is left out: no
 * reader accepts null, and an absent key is what null stands for.
 * `index.test.ts` reads every value back through its setting's reader
 * to the default it came from.
 *
 * Importing this module imports the registry, so the sections are
 * registered with core as `src/rafa.ts` and `src/index.ts` register
 * them. `ConfigShape` does not lean on that import for its keys:
 * `shape.ts` composes it from each section's exported interface by
 * `import type`, so the declaration emitted for `shape.ts` imports every
 * section's emitted `.d.ts` and `ConfigShape` names every section's keys
 * in the published declarations as in a program built from source
 * (`shape.test.ts` reads `ConfigShape['hub']['url']` as `string` from
 * declarations emitted over this file).
 */
import type { ConfigEntry } from './entry.js';
import type { ConfigSetting } from '@open-tomato/rafa/core/config';

import { CONFIG_DEFAULTS, SETTING_NAMES, SETTINGS } from '../config-registry.js';

import { entryOf } from './entry.js';

export type { Config, ConfigEntry } from './entry.js';
export type { ConfigShape } from './shape.js';

export { defineConfig } from './entry.js';

/** The settings a file spells as one comma-separated string and core resolves to a list. */
const COMMA_SEPARATED: ReadonlySet<ConfigSetting> = new Set<ConfigSetting>(['settingSources']);

/**
 * A resolved default in the file's spelling: a map as a plain mapping,
 * a comma-separated setting's list joined with `,`, any other value as
 * it is.
 *
 * @param setting - The setting the value is the default of.
 * @param value - Its value from `CONFIG_DEFAULTS`.
 * @returns The value a file would write for it.
 */
function fileValueOf(setting: ConfigSetting, value: unknown): unknown {
  if (value instanceof Map) return Object.freeze(Object.fromEntries(value));
  if (COMMA_SEPARATED.has(setting) && Array.isArray(value)) return value.join(',');
  return value;
}

/** Every setting's default, as one entry; see the module note. */
export const defaults: ConfigEntry = entryOf(
  SETTING_NAMES
    .filter((setting) => CONFIG_DEFAULTS[setting] !== null)
    .map((setting) => [SETTINGS[setting].key, fileValueOf(setting, CONFIG_DEFAULTS[setting])]),
);
