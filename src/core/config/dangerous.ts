/**
 * The dangerous listing: every `dangerous.*` key the active registry
 * holds, and the line each one set prints.
 *
 * A `dangerous.*` key is a person's consent to step off a check, given
 * once in a file and read on every run after. So a run that steps off
 * one says so: one pass line per key, after the config is loaded.
 *
 * ## The listing
 *
 * {@link dangerousKeys} reads the active registry (`section.ts`), not a
 * list of its own: core's section holds two of the keys and the
 * release section a third, and a section handed in later adds its own.
 * The registry refuses a second definition of a key already listed,
 * naming both packages, so the listing holds each key once.
 *
 * ## A pass line
 *
 * {@link dangerousPassLines} answers one line per dangerous key whose
 * resolved value is not its default, in registration order:
 *
 *     dangerous.<key>: <value> (<file>, entry <n>)
 *
 * The file and entry are the setting's `provenance`
 * (`config-origins.ts`), the entry zero-based as define-config counts
 * a module file's entries, a YAML file being entry 0. A file spelling
 * the default steps off nothing and prints nothing, although its
 * `sources` name the file. No dangerous key is a command-line setting
 * today; one that becomes one prints `(command line)` in place of the
 * file and entry.
 *
 * ## Once per invocation
 *
 * A command may load its config more than once, and the lines are not
 * among the load's `warnings`, which each load prints again.
 * {@link writeDangerousPassLines} writes through `loadConfig`'s warning
 * sink each line not yet written for the invocation it is handed. The
 * invocation is an object: `config-load.ts` hands the active output
 * (`core/output/active.ts`), one per command under the dispatcher, or
 * the sink itself when the caller passed one. The record is a
 * `WeakMap`, so an invocation that ends takes its record with it.
 */
import type { ConfigSetting } from './config-schema.js';
import type { ResolvedConfig } from './config.js';

import { describeValue } from './config-sections.js';
import { activeDefaults, activeSettings } from './section.js';

/** The namespace every dangerous key opens with. */
const DANGEROUS_PREFIX = 'dangerous.';

/** One dangerous setting: its name in `RafaConfig` and its file key. */
interface DangerousSetting {
  readonly setting: ConfigSetting;
  readonly key: string;
}

/** The lines already written, by invocation; see the module note. */
const written = new WeakMap<object, Set<string>>();

/** Every registered setting whose key opens with `dangerous.`, in registration order. */
function dangerousSettings(): readonly DangerousSetting[] {
  return Object.entries(activeSettings()).flatMap(([setting, spec]) => spec?.key.startsWith(DANGEROUS_PREFIX)
    ? [{ setting: setting as ConfigSetting, key: spec.key }]
    : []);
}

/**
 * Every key of the active registry that opens with `dangerous.`, in
 * registration order; see the module note.
 *
 * @returns The keys, such as `dangerous.acceptStaleRefs`; empty while
 *   no section is registered.
 */
export function dangerousKeys(): readonly string[] {
  return dangerousSettings().map(({ key }) => key);
}

/** True when two resolved values are the same value, a list or mapping compared by content. */
function sameValue(first: unknown, second: unknown): boolean {
  return Object.is(first, second) || JSON.stringify(first) === JSON.stringify(second);
}

/**
 * One pass line per dangerous key `resolved` holds off its default; see
 * the module note.
 *
 * @param resolved - A resolution `loadConfig` or `resolveConfig` answered.
 * @returns The lines, such as
 *   `dangerous.acceptStaleRefs: true (/repo/rafa.config.ts, entry 1)`.
 */
export function dangerousPassLines(resolved: ResolvedConfig): readonly string[] {
  const defaults = activeDefaults();
  return dangerousSettings().flatMap(({ setting, key }) => {
    const value: unknown = resolved.config[setting];
    if (sameValue(value, defaults[setting])) return [];
    const origin = resolved.provenance[setting] ?? null;
    const where = origin === null
      ? 'command line'
      : `${origin.file}, entry ${origin.entry}`;
    return [`${key}: ${describeValue(value)} (${where})`];
  });
}

/**
 * Writes through `warn` each of `resolved`'s pass lines not yet written
 * for `invocation`; see the module note.
 *
 * @param resolved - The resolution just loaded.
 * @param warn - The warning sink `loadConfig` writes through.
 * @param invocation - The object one invocation is known by.
 */
export function writeDangerousPassLines(
  resolved: ResolvedConfig,
  warn: (message: string) => void,
  invocation: object,
): void {
  const seen = written.get(invocation) ?? new Set<string>();
  written.set(invocation, seen);
  for (const line of dangerousPassLines(resolved)) {
    if (seen.has(line)) continue;
    seen.add(line);
    warn(line);
  }
}
