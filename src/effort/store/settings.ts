/**
 * The settings every effort store open reads: one module-level value
 * with a setter, as `adapters/output/active.ts` holds the active
 * output, rather than an argument threaded through the dozen callers of
 * `withSqliteStore`, none of which has anything to say about locks.
 *
 * The one setting is `effort.busyTimeoutMs`, which `withSqliteStore`
 * sets as `PRAGMA busy_timeout` on every open. `loadConfig`
 * (`config-load.ts`) hands this module the resolved value each time it
 * resolves the config, so every command that reads its config opens
 * the store with the value the operator gave. Until then, and after
 * {@link setActiveStoreSettings} with `null`, the value is the config
 * default, read off `CONFIG_DEFAULTS` so the number is spelled once.
 *
 * The setter refuses a value the config reader would refuse, with a
 * `RangeError`, so a caller that built its settings by hand cannot put
 * `0` (no wait at all), a fraction or `NaN` into the PRAGMA. SQLite
 * would take `NaN` and a negative as no wait, the failure the key
 * exists to prevent.
 *
 * Bun runs every test file in one process, and this is module state: a
 * case that sets a value sets `null` after it, or every file bun runs
 * later opens its stores with that case's timeout.
 */
import { CONFIG_DEFAULTS } from '../../config-schema.js';
import {
  BUSY_TIMEOUT_MAX_MS,
  BUSY_TIMEOUT_MIN_MS,
  isBusyTimeoutMs,
} from '../../config-sections.js';

/** What every effort store open reads. */
export interface StoreSettings {
  /** How long an open waits for another process's write lock, in ms. */
  readonly busyTimeoutMs: number;
}

/** The settings in force while nothing has set any. */
const DEFAULT_STORE_SETTINGS: StoreSettings = Object.freeze({
  busyTimeoutMs: CONFIG_DEFAULTS.effortBusyTimeoutMs,
});

/** The settings in force now. */
let active: StoreSettings = DEFAULT_STORE_SETTINGS;

/**
 * Sets the settings every later open reads; `null` puts the default
 * back. Throws a `RangeError`, setting nothing, for a busy timeout
 * outside the whole numbers the config accepts.
 */
export function setActiveStoreSettings(settings: StoreSettings | null): void {
  if (settings === null) {
    active = DEFAULT_STORE_SETTINGS;
    return;
  }
  if (!isBusyTimeoutMs(settings.busyTimeoutMs)) {
    throw new RangeError(
      `effort store: busy timeout ${String(settings.busyTimeoutMs)} is not a whole number `
        + `of milliseconds from ${String(BUSY_TIMEOUT_MIN_MS)} to ${String(BUSY_TIMEOUT_MAX_MS)}`,
    );
  }
  active = Object.freeze({ busyTimeoutMs: settings.busyTimeoutMs });
}

/** The settings every open reads now; see the module note. */
export function activeStoreSettings(): StoreSettings {
  return active;
}
