/**
 * The section contract: how a slice of the config schema is handed to
 * core, and the registry core reads the merged slices from.
 *
 * A {@link ConfigSection} is one package's part of the schema: its
 * `settings` (each setting's file key, reader and command-line flag, as
 * a partial of the record of every setting, {@link SettingsRecord}), its
 * `defaults` (a partial of {@link RafaConfig}), and the cross-key
 * `checks` run over the resolved config. {@link registerConfigSections}
 * merges sections into the active registry, which {@link activeSettings},
 * {@link activeDefaults} and {@link activeChecks} answer, and the key
 * indexes below are read off. Core names no section here: the list of
 * sections lives outside `src/core/`, in `src/config-registry.ts`, the
 * module that calls {@link registerConfigSections}.
 *
 * This file imports types alone, so it loads first in any order and can
 * be imported by value from the loader and from every section file
 * without closing a runtime cycle.
 *
 * ## The refusals
 *
 * A registration that breaks one of three rules throws a
 * {@link ConfigSectionError} listing every problem it found, one
 * sentence each, and leaves the active registry as it was:
 *
 *   - A setting name registered by one section and again by another, in
 *     this call or an earlier one. The sentence names both packages, the
 *     one holding the name first.
 *   - A file key opening with `dangerous.` defined by one section and
 *     again by another, under the same setting name or a different one.
 *     A `dangerous.*` key is a person's consent to a risk, so a second
 *     package defining it could widen what that consent was given for;
 *     the sentence names both packages. A setting name registered twice
 *     with a `dangerous.` key reads both sentences.
 *   - A {@link RafaConfig} field no section defines: a default given for
 *     a field no registered section has a setting for, or a setting no
 *     registered section gives a default for. The sentence names the
 *     package that gave the half it has. Types are erased at runtime, so
 *     a field declared on {@link RafaConfig} that no section mentions at
 *     all is out of this module's reach; the module that lists the
 *     sections is where a complete set is held.
 *
 * The completeness rule reads the registry as it would stand after the
 * call, so a section whose setting and default come in two calls is
 * refused at the first. A section's package must be a non-empty string,
 * since every refusal names one.
 *
 * Only a `dangerous.` key is refused when two sections define it under
 * two setting names. Another file key defined twice is not refused here.
 *
 * ## A registry is a value
 *
 * {@link mergeConfigSections} answers a new {@link ConfigSectionRegistry}
 * and leaves the one it was handed unchanged; each section is copied and
 * frozen as it is accepted, so editing a section object afterwards
 * changes nothing registered. The active registry is the one
 * module-level value: {@link registerConfigSections} replaces it with a
 * merge and answers the one it replaced, and
 * {@link restoreConfigSections} puts one back. Bun runs every test file
 * in one process, so a case that registers puts the previous registry
 * back in a `finally`, or every file bun runs later reads its sections.
 * {@link EMPTY_CONFIG_REGISTRY} is the registry before any registration.
 *
 * ## The key indexes
 *
 * `config.ts` sorts a file's keys through three indexes of the active
 * registry's settings: {@link activeSettingByKey}, the setting each
 * dotted file key names; {@link activeSectionPaths}, every dotted prefix
 * a setting sits under, which are the sections a file may open; and
 * {@link activeKnownKeysAbove}, the keys a warning about an unknown key
 * lists. Each is built on first read and kept per registry, so a
 * registration or a restore is read at once and a registry is indexed
 * once. Keys are looked up in a `Map` and a `Set`, never with `in` or an
 * object index: `Bun.YAML.parse` returns a key spelled `constructor`,
 * `toString` or `__proto__` as an ordinary own key, and an object lookup
 * would match it against `Object.prototype` instead.
 *
 * The indexes follow registration order: the keys under a path are
 * listed in the order their settings were registered. The registry
 * registers its sections cut into the order the schema has always
 * reported problems in, so a warning lists the keys it always listed;
 * `src/config-registry.test.ts` holds the indexes to the registry's own.
 *
 * ## The load hook
 *
 * A setting core resolves can be read by a module outside `src/core/`
 * that core must not import: the logger's settings are read through
 * `loggerSettingsOf` in `src/config-schema-logger.ts`. So the module that
 * lists the sections also hands core one {@link ConfigLoadHook} with
 * {@link setConfigLoadHook}, and `loadConfig` (`config-load.ts`) calls
 * {@link activeConfigLoadHook} with every config it resolves, before it
 * prints the config's warnings. The hook is a module-level value of its
 * own, beside the registry rather than in it: restoring a registry
 * leaves the hook as it was, and a case that sets one puts the previous
 * hook back in a `finally`, as a case that registers does.
 */
import type {
  ConfigSetting,
  RafaConfig,
  SettingSpec,
} from './config-schema.js';
import type { ConfigSource } from './config.js';

/** Every setting's spec, by name: the record a section hands a part of. */
export type SettingsRecord = { readonly [K in ConfigSetting]: SettingSpec<K> };

/** What a section's check reads: the resolved values, their layers and the files read. */
export interface ConfigCheckInput {
  /** The value each setting resolved to. */
  readonly config: Readonly<RafaConfig>;
  /** The layer that answered each setting. */
  readonly sources: Readonly<Record<ConfigSetting, ConfigSource>>;
  /** The project's file consulted, or null when there was none. */
  readonly path: string | null;
  /** The user scope's file consulted, or null when there was none. */
  readonly userPath: string | null;
}

/**
 * A cross-key refusal: the problems the resolved config holds, one
 * sentence each, or an empty list when it holds none.
 */
export type ConfigCheck = (input: ConfigCheckInput) => readonly string[];

/** One package's slice of the config schema. */
export interface ConfigSection {
  /** The package the section belongs to, named by every refusal. */
  readonly package: string;
  /** The specs of the settings the section defines. */
  readonly settings: Partial<SettingsRecord>;
  /** The default of each setting the section defines. */
  readonly defaults: Partial<RafaConfig>;
  /** The cross-key refusals run over the resolved config. */
  readonly checks?: readonly ConfigCheck[];
}

/** The sections merged so far, and what core reads off them. */
export interface ConfigSectionRegistry {
  /** Every section accepted, copied and frozen, in registration order. */
  readonly sections: readonly ConfigSection[];
  /** Every setting's spec, in registration order. */
  readonly settings: Readonly<Partial<SettingsRecord>>;
  /** Every setting's default. */
  readonly defaults: Readonly<Partial<RafaConfig>>;
  /** Every section's checks, in registration order. */
  readonly checks: readonly ConfigCheck[];
}

/**
 * A registration refused: a setting name or a `dangerous.` key defined
 * twice, a field no section defines, or a section with no package name.
 */
export class ConfigSectionError extends Error {
  /** Every problem found, one sentence each. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`rafa config sections: ${problems.join('; ')}`);
    this.name = 'ConfigSectionError';
    this.problems = problems;
  }
}

/** The registry before any registration: no section, setting, default or check. */
export const EMPTY_CONFIG_REGISTRY: ConfigSectionRegistry = Object.freeze({
  sections: Object.freeze([]),
  settings: Object.freeze({}),
  defaults: Object.freeze({}),
  checks: Object.freeze([]),
});

/** The prefix of a file key that records a person's consent. */
const DANGEROUS_PREFIX = 'dangerous.';

/** A value as a refusal quotes it. */
function quoted(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** A copy of `section`, frozen with each of its parts. */
function frozenCopy(section: ConfigSection): ConfigSection {
  return Object.freeze({
    package: section.package,
    settings: Object.freeze({ ...section.settings }),
    defaults: Object.freeze({ ...section.defaults }),
    checks: Object.freeze([...(section.checks ?? [])]),
  });
}

/** The package holding each setting name, and each `dangerous.` key, across `sections`. */
interface Owners {
  readonly names: Map<string, string>;
  readonly dangerousKeys: Map<string, string>;
}

/** Records the setting names and `dangerous.` keys of `section` in `owners`. */
function recordOwners(owners: Owners, section: ConfigSection): void {
  for (const [name, spec] of Object.entries(section.settings)) {
    if (!owners.names.has(name)) owners.names.set(name, section.package);
    const key = spec?.key;
    if (key?.startsWith(DANGEROUS_PREFIX) === true && !owners.dangerousKeys.has(key)) {
      owners.dangerousKeys.set(key, section.package);
    }
  }
}

/** The sentences refusing what `section` defines again, read against `owners`. */
function collisionsOf(owners: Owners, section: ConfigSection): string[] {
  return Object.entries(section.settings).flatMap(([name, spec]) => {
    const problems: string[] = [];
    const nameOwner = owners.names.get(name);
    if (nameOwner !== undefined) {
      problems.push(
        `setting ${name} is registered by package ${quoted(nameOwner)}`
          + ` and again by package ${quoted(section.package)}`,
      );
    }
    const key = spec?.key;
    const keyOwner = key === undefined
      ? undefined
      : owners.dangerousKeys.get(key);
    if (keyOwner !== undefined) {
      problems.push(
        `${key} is defined by package ${quoted(keyOwner)} and again by package ${quoted(section.package)};`
          + ' a dangerous. key is a person\'s consent and one package defines it',
      );
    }
    return problems;
  });
}

/** The sentences refusing a field the merged sections give one half of. */
function unpairedOf(sections: readonly ConfigSection[]): string[] {
  const specified = new Set(sections.flatMap((section) => Object.keys(section.settings)));
  const defaulted = new Set(sections.flatMap((section) => Object.keys(section.defaults)));
  return sections.flatMap((section) => [
    ...Object.keys(section.defaults)
      .filter((name) => !specified.has(name))
      .map((name) => `package ${quoted(section.package)} gives a default for ${name},`
        + ' a RafaConfig field no section defines a setting for'),
    ...Object.keys(section.settings)
      .filter((name) => !defaulted.has(name))
      .map((name) => `package ${quoted(section.package)} defines setting ${name},`
        + ' a RafaConfig field no section gives a default for'),
  ]);
}

/**
 * A new registry holding `registry`'s sections and then `sections`, or a
 * {@link ConfigSectionError} listing every problem found; see the module
 * note. `registry` is left unchanged either way.
 */
export function mergeConfigSections(
  registry: ConfigSectionRegistry,
  sections: readonly ConfigSection[],
): ConfigSectionRegistry {
  const owners: Owners = { names: new Map(), dangerousKeys: new Map() };
  for (const section of registry.sections) recordOwners(owners, section);

  const problems: string[] = [];
  const accepted: ConfigSection[] = [];
  for (const section of sections) {
    if (typeof section.package !== 'string' || section.package === '') {
      problems.push(`a section's package is ${quoted(section.package)}; expected a non-empty package name`);
    }
    const copy = frozenCopy(section);
    problems.push(...collisionsOf(owners, copy));
    recordOwners(owners, copy);
    accepted.push(copy);
  }
  const merged = [...registry.sections, ...accepted];
  problems.push(...unpairedOf(merged));
  if (problems.length > 0) throw new ConfigSectionError(problems);

  return Object.freeze({
    sections: Object.freeze(merged),
    settings: Object.freeze(merged.reduce<Partial<SettingsRecord>>(
      (all, section) => ({ ...all, ...section.settings }),
      {},
    )),
    defaults: Object.freeze(merged.reduce<Partial<RafaConfig>>(
      (all, section) => ({ ...all, ...section.defaults }),
      {},
    )),
    checks: Object.freeze(merged.flatMap((section) => section.checks ?? [])),
  });
}

/** The module-level registry the readers below answer. */
let active: ConfigSectionRegistry = EMPTY_CONFIG_REGISTRY;

/**
 * Merges `sections` into the active registry, or throws a
 * {@link ConfigSectionError} and leaves it unchanged. Answers the
 * registry it replaced, for {@link restoreConfigSections}.
 */
export function registerConfigSections(sections: readonly ConfigSection[]): ConfigSectionRegistry {
  const previous = active;
  active = mergeConfigSections(previous, sections);
  return previous;
}

/** Makes `registry` the active one: what {@link registerConfigSections} answered, or {@link EMPTY_CONFIG_REGISTRY}. */
export function restoreConfigSections(registry: ConfigSectionRegistry): void {
  active = registry;
}

/** Every registered setting's spec, in registration order. */
export function activeSettings(): Readonly<Partial<SettingsRecord>> {
  return active.settings;
}

/** Every registered setting's default. */
export function activeDefaults(): Readonly<Partial<RafaConfig>> {
  return active.defaults;
}

/** Every registered section's checks, in registration order. */
export function activeChecks(): readonly ConfigCheck[] {
  return active.checks;
}

/** The key indexes read off one registry's settings; see the module note. */
interface KeyIndex {
  /** Setting names by the dotted key a file spells them with. */
  readonly settingByKey: ReadonlyMap<string, ConfigSetting>;
  /** Every dotted prefix a setting sits under: the sections a file opens. */
  readonly sectionPaths: ReadonlySet<string>;
  /** The keys known under each path, `''` for the top and `<list>[]` for an item. */
  readonly knownUnder: ReadonlyMap<string, readonly string[]>;
}

/** `plan.inject` → `['plan']`; `a.b.c` → `['a', 'a.b']`; `store` → `[]`. */
function prefixesOf(key: string): string[] {
  const parts = key.split('.');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('.'));
}

/** The indexes of `registry`'s settings, in registration order. */
function keyIndexOf(registry: ConfigSectionRegistry): KeyIndex {
  const settingByKey = new Map<string, ConfigSetting>();
  const knownUnder = new Map<string, string[]>();
  const add = (parent: string, name: string): void => {
    const names = knownUnder.get(parent) ?? [];
    if (!names.includes(name)) knownUnder.set(parent, [...names, name]);
  };
  for (const [name, spec] of Object.entries(registry.settings)) {
    if (spec === undefined) continue;
    settingByKey.set(spec.key, name as ConfigSetting);
    const parts = spec.key.split('.');
    parts.forEach((part, index) => add(parts.slice(0, index).join('.'), part));
    for (const item of spec.itemKeys ?? []) add(`${spec.key}[]`, item);
  }
  const sectionPaths = new Set([...settingByKey.keys()].flatMap(prefixesOf));
  return { settingByKey, sectionPaths, knownUnder };
}

/** The indexes built so far, one per registry, so a registry is indexed once. */
const keyIndexes = new WeakMap<ConfigSectionRegistry, KeyIndex>();

/** The indexes of the active registry, built on first read. */
function activeKeyIndex(): KeyIndex {
  const cached = keyIndexes.get(active);
  if (cached !== undefined) return cached;
  const built = keyIndexOf(active);
  keyIndexes.set(active, built);
  return built;
}

/** Every registered setting's name, by the dotted key a file spells it with. */
export function activeSettingByKey(): ReadonlyMap<string, ConfigSetting> {
  return activeKeyIndex().settingByKey;
}

/** Every dotted prefix a registered setting sits under: the sections a file opens. */
export function activeSectionPaths(): ReadonlySet<string> {
  return activeKeyIndex().sectionPaths;
}

/** The path a key sits under: `plan` for `plan.depth`, `''` at the top. */
function parentOf(key: string): string {
  const cut = key.lastIndexOf('.');
  return cut < 0
    ? ''
    : key.slice(0, cut);
}

/** Matches a list index closing a path: `[0]` in `modules[0]`. */
const TRAILING_INDEX = /\[\d+\]$/;

/**
 * The nearest path above `key` with registered keys, and those keys, in
 * registration order. An item path such as `modules[0]` looks up the
 * item keys of `modules`.
 *
 * @param key - A dotted key a file spelled, `modules[0].kind` included.
 * @returns The path the keys sit under, `''` for the top, and the keys.
 */
export function activeKnownKeysAbove(key: string): [string, readonly string[]] {
  const { knownUnder } = activeKeyIndex();
  for (let parent = parentOf(key); parent !== ''; parent = parentOf(parent)) {
    const names = knownUnder.get(parent.replace(TRAILING_INDEX, '[]'));
    if (names !== undefined) return [parent, names];
  }
  return ['', knownUnder.get('') ?? []];
}

/**
 * What `loadConfig` hands every config it resolves to, before printing
 * its warnings: the reading of settings a module outside `src/core/`
 * acts on. See the module note.
 */
export type ConfigLoadHook = (config: Readonly<RafaConfig>) => void;

/** The module-level hook {@link activeConfigLoadHook} answers. */
let loadHook: ConfigLoadHook | null = null;

/**
 * Makes `hook` the one `loadConfig` calls, or clears it with null.
 * Answers the hook it replaced, for a caller to put back.
 */
export function setConfigLoadHook(hook: ConfigLoadHook | null): ConfigLoadHook | null {
  const previous = loadHook;
  loadHook = hook;
  return previous;
}

/** The hook `loadConfig` calls with every config it resolves, or null when none is set. */
export function activeConfigLoadHook(): ConfigLoadHook | null {
  return loadHook;
}
