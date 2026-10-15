/**
 * The config sections as Standard Schema V1 schemas: what the loader
 * hands `createLoader` from `@open-tomato/define-config` to validate the
 * merged config with.
 *
 * {@link schemaOf} turns one {@link ConfigSection} into a
 * `StandardSchemaV1` whose `validate` reads the merged mapping, the
 * nested file shape after every entry of every layer has merged, through
 * the section's readers. {@link schemaSectionsOf} answers the
 * `[path, schema]` list `createLoader`'s `schema` option takes, one pair
 * per section.
 *
 * ## What `validate` reads
 *
 * For each setting the section defines, `validate` follows the setting's
 * dotted key (`plan.inject` → `plan`, then `inject`) down the merged
 * mapping through own keys alone, so a key spelled `constructor` or
 * `__proto__` is read as data and never matched against
 * `Object.prototype`. A key that is absent, or that holds `null`, is
 * silence, as `config.ts` reads a YAML file; so is a key under a parent
 * that is not a mapping. Any other value goes through the setting's
 * reader with the dotted key as its label.
 *
 * ## What it answers
 *
 * Each sentence a reader refuses a value with is one issue, its
 * `message` the sentence and its `path` the setting's key split at its
 * dots: a reader refusing `plan.inject: later` reads back as an issue at
 * `['plan', 'inject']`. The issues follow the section's setting order
 * and each reader's own order. With no issue, `validate` answers the
 * mapping it was handed, unchanged: the readers judge values here, and
 * what a value resolves to is still `resolveConfig`'s answer.
 *
 * Three things are not issues here, since no reader decides them: a key
 * naming no setting (the readers' extras and the unknown keys of the
 * file alike), a section key holding something other than a mapping, and
 * a section's cross-key `checks`, which read the resolved config rather
 * than the merged mapping.
 *
 * ## The path
 *
 * A section's keys span namespaces (core's own reach `plan`, `loop`,
 * `pr` and more), so every pair {@link schemaSectionsOf} answers has the
 * empty path, which names the whole value, and each issue carries the
 * full key path. `validateSections` prefixes an issue's path with its
 * section's path, so the empty path leaves the key path as it is.
 *
 * `validate` is synchronous, as `createLoader` requires of a schema.
 */
import type { ConfigSetting, SettingSpec } from './config-schema.js';
import type { ConfigSection } from './section.js';
import type { StandardSchemaV1 } from '@open-tomato/define-config';

import { isMapping } from './config-sections.js';

/** The vendor every schema built here names. */
export const SCHEMA_VENDOR = 'rafa';

/**
 * One pair of `createLoader`'s `schema` list: the key path of the
 * subtree, outermost key first, and the schema that subtree must
 * satisfy. The empty path names the whole value.
 */
export type ConfigSchemaSection = readonly [path: readonly string[], schema: StandardSchemaV1];

/** What the walk down a dotted key found: the raw value, or nothing there. */
type Found = { readonly found: true; readonly raw: unknown } | { readonly found: false };

/** Nothing at the key, or nothing that is not `null`. */
const NOTHING: Found = Object.freeze({ found: false });

/** The value at `path` in `value`, read through own keys alone; see the module note. */
function valueAt(value: unknown, path: readonly string[]): Found {
  let current = value;
  for (const part of path) {
    if (!isMapping(current) || !Object.hasOwn(current, part)) return NOTHING;
    current = current[part];
  }
  return current === undefined || current === null
    ? NOTHING
    : { found: true, raw: current };
}

/** The issues `spec`'s reader raises over the value at its key in `value`. */
function issuesOf(value: unknown, spec: SettingSpec<ConfigSetting>): StandardSchemaV1.Issue[] {
  const path = spec.key.split('.');
  const at = valueAt(value, path);
  if (!at.found) return [];
  const reading = spec.read(at.raw, { label: spec.key, key: spec.key });
  return reading.problems.map((message) => ({ message, path }));
}

/**
 * A Standard Schema V1 schema whose `validate` runs `section`'s readers
 * over the merged mapping and answers one issue per refusal at the
 * refused key's path; see the module note.
 *
 * @param section - The section whose settings' readers judge the value.
 * @returns A schema validating synchronously, vendor {@link SCHEMA_VENDOR}.
 */
export function schemaOf(section: ConfigSection): StandardSchemaV1 {
  const specs = Object.values(section.settings)
    .filter((spec) => spec !== undefined) as SettingSpec<ConfigSetting>[];
  const validate = (value: unknown): StandardSchemaV1.Result<unknown> => {
    const issues = specs.flatMap((spec) => issuesOf(value, spec));
    return issues.length === 0
      ? { value }
      : { issues };
  };
  return Object.freeze({
    '~standard': Object.freeze({ version: 1, vendor: SCHEMA_VENDOR, validate }),
  });
}

/**
 * The `[path, schema]` list `createLoader`'s `schema` option takes: one
 * pair per section, in the order given, each at the empty path.
 *
 * @param sections - The sections to validate the merged config with.
 * @returns One frozen pair per section.
 */
export function schemaSectionsOf(sections: readonly ConfigSection[]): readonly ConfigSchemaSection[] {
  return Object.freeze(sections.map(
    (section): ConfigSchemaSection => Object.freeze([Object.freeze([]), schemaOf(section)] as const),
  ));
}
