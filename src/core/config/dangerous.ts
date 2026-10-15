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
 * ## The command's phrase
 *
 * A command may say what it does under a key: `RafaCommand.dangerous`
 * (`src/core/command/command.ts`) maps a `dangerous.*` key to a phrase,
 * such as `a release guard reading collision merges anyway` for
 * `dangerous.acceptVersionCollision`. The pass line of a key the
 * running command declares ends with it:
 *
 *     dangerous.<key>: <value> (<file>, entry <n>); <phrase>
 *
 * and a key it does not declare prints the bare line. The phrases are
 * held as the active output is (`core/output/active.ts`): the
 * dispatcher runs every command inside {@link runWithDangerousPhrases}
 * with the command's own, beside the running-command record
 * (`src/cli/running.ts`), in an async scope that ends with the run, so
 * two invocations overlapping in one process each read their own and
 * nothing outlives either. {@link setDangerousPhrases} sets them at
 * module level, read outside every scope, and answers the phrases it
 * replaced for {@link restoreDangerousPhrases}: a test standing in for
 * a dispatch puts them back in a `finally`, since bun runs every test
 * file in one process. {@link dangerousPhrases} reads the scope's, else
 * the module-level ones.
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

import { AsyncLocalStorage } from 'node:async_hooks';

import { describeValue } from './config-sections.js';
import { activeDefaults, activeSettings } from './section.js';

/** The namespace every dangerous key opens with. */
const DANGEROUS_PREFIX = 'dangerous.';

/** One dangerous setting: its name in `RafaConfig` and its file key. */
interface DangerousSetting {
  readonly setting: ConfigSetting;
  readonly key: string;
}

/** What a command does under each `dangerous.*` key it declares, by key. */
export type DangerousPhrases = Readonly<Record<string, string>>;

/** The phrases while no command declares any. */
const NO_PHRASES: DangerousPhrases = Object.freeze({});

/** The phrases of each run {@link runWithDangerousPhrases} has in flight, by async scope. */
const phraseScopes = new AsyncLocalStorage<DangerousPhrases>();

/** The module-level phrases; see the module note. */
let modulePhrases: DangerousPhrases = NO_PHRASES;

/** A frozen copy of `phrases`, or the empty phrases for `undefined`. */
function phrasesOf(phrases: DangerousPhrases | undefined): DangerousPhrases {
  return phrases === undefined
    ? NO_PHRASES
    : Object.freeze({ ...phrases });
}

/**
 * Runs `run` with `phrases` as the running command's in an async scope
 * of its own, and answers what `run` answers; see the module note.
 *
 * @param phrases - The command's `dangerous` field, absent for none.
 * @param run - The command's run.
 * @returns What `run` answers.
 */
export function runWithDangerousPhrases<T>(phrases: DangerousPhrases | undefined, run: () => T): T {
  return phraseScopes.run(phrasesOf(phrases), run);
}

/**
 * Sets `phrases` at module level; see the module note.
 *
 * @param phrases - The phrases to set, absent for none.
 * @returns The module-level phrases replaced, for {@link restoreDangerousPhrases}.
 */
export function setDangerousPhrases(phrases: DangerousPhrases | undefined): DangerousPhrases {
  const previous = modulePhrases;
  modulePhrases = phrasesOf(phrases);
  return previous;
}

/**
 * Puts back phrases {@link setDangerousPhrases} answered.
 *
 * @param previous - The phrases it answered.
 */
export function restoreDangerousPhrases(previous: DangerousPhrases): void {
  modulePhrases = previous;
}

/**
 * The running command's phrases: the scope's, else the module-level ones.
 *
 * @returns The phrases by key, empty when none is declared.
 */
export function dangerousPhrases(): DangerousPhrases {
  return phraseScopes.getStore() ?? modulePhrases;
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
 *   `dangerous.acceptStaleRefs: true (/repo/rafa.config.ts, entry 1)`,
 *   each ending with `; <phrase>` for a key the running command declares.
 */
export function dangerousPassLines(resolved: ResolvedConfig): readonly string[] {
  const defaults = activeDefaults();
  const phrases = dangerousPhrases();
  return dangerousSettings().flatMap(({ setting, key }) => {
    const value: unknown = resolved.config[setting];
    if (sameValue(value, defaults[setting])) return [];
    const origin = resolved.provenance[setting] ?? null;
    const where = origin === null
      ? 'command line'
      : `${origin.file}, entry ${origin.entry}`;
    const phrase = Object.hasOwn(phrases, key)
      ? `; ${phrases[key]}`
      : '';
    return [`${key}: ${describeValue(value)} (${where})${phrase}`];
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
