/**
 * The section contract: how a slice of the config schema is handed to
 * core, and the registry core reads the merged slices from.
 *
 * A {@link ConfigSection} is one package's part of the schema: its
 * `settings` (each setting's file key, reader and command-line flag, as
 * a partial of the record `config-merged.ts` builds today), its
 * `defaults` (a partial of {@link RafaConfig}), and the cross-key
 * `checks` run over the resolved config. {@link registerConfigSections}
 * merges sections into the active registry, which {@link activeSettings},
 * {@link activeDefaults} and {@link activeChecks} answer. Core names no
 * section here: the list of sections lives outside `src/core/`, in the
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
