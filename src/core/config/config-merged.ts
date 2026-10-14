/**
 * The merged schema: core's section and the eleven section files spread
 * into one record of every setting, the defaults of every setting, and
 * the key indexes read off them, {@link SETTINGS}, {@link CONFIG_DEFAULTS},
 * {@link SETTING_NAMES}, {@link SETTING_BY_KEY}, {@link SECTIONS} and
 * {@link knownKeysAbove}. This module answers questions about KEYS.
 * `config.ts` ranks LAYERS and reads every key through the names here.
 *
 * `config-schema.ts` declares core's fields of `RafaConfig` and exports
 * nothing merged, and `core-section.ts` holds core's specs and defaults.
 * This module is where the slices meet, with no runtime registration:
 * it imports each section file by value, as `config-schema.ts` did
 * before core's keys moved out, and the order of {@link SETTINGS} is
 * the order that module spelled. The section registry
 * (`registerConfigSections` in `section.ts`) is not read here.
 *
 * ## Where each slice comes from
 *
 * `config-schema-release.ts` holds the `pr` and `release` sections and
 * `dangerous.acceptVersionCollision`, `config-schema-tests.ts` the
 * `tests` section, `config-schema-triage.ts` the `triage` section,
 * `config-schema-errors.ts` the `errors` section,
 * `config-schema-logger.ts` the `logger` section,
 * `config-schema-issues.ts` the `issues` section,
 * `config-schema-wrap-up.ts` `loop.wrapUp`,
 * `config-schema-loop-retries.ts` `loop.retries`,
 * `config-schema-loop-continue.ts` the four keys `loop start --continue`
 * reads, `config-schema-board-project.ts` the `board.project` limits,
 * spread in after `board.project.number`, and `config-schema-hub.ts` the
 * `hub` section, spread in after `effort.sync`. Each file exports its
 * fields as an interface of its own and adds it to `RafaConfig` with a
 * `declare module` on `config-schema.ts`, beside the `ConfigSection` it
 * exports; this module names none of those interfaces. Core's settings
 * are taken in the runs the section files sit between, so a key keeps
 * its place.
 *
 * ## The closed set
 *
 * {@link SETTINGS} is a mapped record over `ConfigSetting` rather than a
 * list, so a field added to `RafaConfig` without a spec here does not
 * compile. {@link SETTING_NAMES}, {@link SETTING_BY_KEY}, {@link SECTIONS}
 * and the known-key index are all read off it, so adding a setting is
 * one field, one default, one spec — in `core-section.ts` for a core
 * key, beside its field in `config-schema.ts`, or in the section file
 * its key belongs to — its text and value for both the project and the
 * user layer in `src/tests/config-layers.test.ts`, its reader in
 * `config-sections.ts`, one line in `config.ts`'s layer literal and one
 * commented line in `project/scaffold.ts`'s template, which
 * `scaffold.test.ts` holds it to, and nothing else beyond the readings
 * its spec leaves, which go in `config-schema-readings.ts`. A core key
 * also takes its place in one of the runs below.
 *
 * Keys are looked up in a `Map` and a `Set`, never with `in` or an
 * object index. `Bun.YAML.parse` returns a key spelled `constructor`,
 * `toString` or `__proto__` as an ordinary own key, and an object
 * lookup would match it against `Object.prototype` instead.
 *
 * ## Defaults
 *
 * {@link CONFIG_DEFAULTS} holds every default once, frozen: each is the
 * value its section spelled, so a list is the frozen list and a map the
 * one shared `Map` the section holds.
 */
import type {
  CommandLineSetting,
  ConfigSetting,
  RafaConfig,
  SettingSpec,
} from './config-schema.js';
import type { CoreSection, CoreSetting } from './core-section.js';

import {
  BOARD_PROJECT_LIMIT_DEFAULTS,
  BOARD_PROJECT_LIMIT_SETTINGS,
} from '../../config-schema-board-project.js';
import { ERRORS_DEFAULTS, ERRORS_SETTINGS } from '../../config-schema-errors.js';
import { HUB_DEFAULTS, HUB_SETTINGS } from '../../config-schema-hub.js';
import { ISSUES_DEFAULTS, ISSUES_SETTINGS } from '../../config-schema-issues.js';
import { LOGGER_DEFAULTS, LOGGER_SETTINGS } from '../../config-schema-logger.js';
import { LOOP_CONTINUE_DEFAULTS, LOOP_CONTINUE_SETTINGS } from '../../config-schema-loop-continue.js';
import { LOOP_RETRIES_DEFAULTS, LOOP_RETRIES_SETTINGS } from '../../config-schema-loop-retries.js';
import {
  DANGEROUS_RELEASE_DEFAULTS,
  DANGEROUS_RELEASE_SETTINGS,
  PR_DEFAULTS,
  PR_SETTINGS,
  RELEASE_DEFAULTS,
  RELEASE_SETTINGS,
} from '../../config-schema-release.js';
import { TESTS_DEFAULTS, TESTS_SETTINGS } from '../../config-schema-tests.js';
import { TRIAGE_DEFAULTS, TRIAGE_SETTINGS } from '../../config-schema-triage.js';
import { WRAP_UP_DEFAULTS, WRAP_UP_SETTINGS } from '../../config-schema-wrap-up.js';

import { CORE_SECTION } from './core-section.js';

/** Core's settings up to `effort.sync`, before the `hub` section. */
const CORE_HEAD = ['version', 'store', 'effortBusyTimeoutMs', 'effortSync'] as const;

/** Core's settings from `plan.inject` to `loop.worktreeDir`, before the `loop` sections and `pr`. */
const CORE_PLAN_TO_LOOP = [
  'inject',
  'planDir',
  'specsDir',
  'trackerDefault',
  'trackerFallback',
  'learningAdapter',
  'learningBlessMinConfidence',
  'learningPromoteAfter',
  'learningPromoteMinConfidence',
  'outputMode',
  'prerequisitesRequired',
  'prerequisitesOptional',
  'trackingSpecs',
  'trackingPlans',
  'trackingAll',
  'modules',
  'allowList',
  'settingSources',
  'loopWorktreeDir',
] as const;

/** Core's `board` settings, before the `board.project` limits. */
const CORE_BOARD = [
  'boardTrustedAuthors',
  'boardRelationships',
  'boardProjectTemplate',
  'boardProjectNumber',
] as const;

/** Core's `roadmap` and `claims` settings, before `triage`. */
const CORE_CLAIMS = ['roadmapIssue', 'claimsStaleAfter', 'claimsAhead'] as const;

/** Core's `cleanup` settings and the first consent, before `release`'s consent. */
const CORE_CLEANUP = [
  'cleanupStaleDays',
  'cleanupWorktreeIdleDays',
  'cleanupKeep',
  'dangerousAcceptStaleRefs',
] as const;

/** Core's settings from the second consent to `task.lessons`, before `tests`. */
const CORE_TAIL = [
  'dangerousSelfUpdateDuringLoop',
  'statusNotice',
  'tiersRafa',
  'tiersSkills',
  'tiersAgents',
  'routing',
  'taskSkills',
  'taskLessons',
] as const;

/**
 * The entries of `record` named in `names`, in that order.
 *
 * @param record - Core's settings or defaults.
 * @param names - The run of core's names to take.
 * @returns A new object holding those entries alone.
 */
function run<T extends object, K extends keyof T & CoreSetting>(record: T, names: readonly K[]): Pick<T, K> {
  return Object.fromEntries(names.map((name) => [name, record[name]])) as Pick<T, K>;
}

/** Core's specs, typed for the runs. */
const CORE_SPECS: CoreSection['settings'] = CORE_SECTION.settings;

/** Core's defaults, typed for the runs. */
const CORE_VALUES: CoreSection['defaults'] = CORE_SECTION.defaults;

/** What every setting resolves to when no layer names it. */
export const CONFIG_DEFAULTS: Readonly<RafaConfig> = Object.freeze({
  ...run(CORE_VALUES, CORE_HEAD),
  ...HUB_DEFAULTS,
  ...run(CORE_VALUES, CORE_PLAN_TO_LOOP),
  ...LOOP_RETRIES_DEFAULTS,
  ...LOOP_CONTINUE_DEFAULTS,
  ...WRAP_UP_DEFAULTS,
  ...PR_DEFAULTS,
  ...run(CORE_VALUES, CORE_BOARD),
  ...BOARD_PROJECT_LIMIT_DEFAULTS,
  ...run(CORE_VALUES, CORE_CLAIMS),
  ...TRIAGE_DEFAULTS,
  ...RELEASE_DEFAULTS,
  ...ERRORS_DEFAULTS,
  ...LOGGER_DEFAULTS,
  ...ISSUES_DEFAULTS,
  ...run(CORE_VALUES, CORE_CLEANUP),
  ...DANGEROUS_RELEASE_DEFAULTS,
  ...run(CORE_VALUES, CORE_TAIL),
  ...TESTS_DEFAULTS,
});

/**
 * Every setting, by name, in the order problems are reported.
 *
 * A mapped record rather than a list so the set is closed: a field
 * added to `RafaConfig` without an entry here does not compile.
 */
export const SETTINGS: { readonly [K in ConfigSetting]: SettingSpec<K> } = {
  ...run(CORE_SPECS, CORE_HEAD),
  ...HUB_SETTINGS,
  ...run(CORE_SPECS, CORE_PLAN_TO_LOOP),
  ...LOOP_RETRIES_SETTINGS,
  ...LOOP_CONTINUE_SETTINGS,
  ...WRAP_UP_SETTINGS,
  ...PR_SETTINGS,
  ...run(CORE_SPECS, CORE_BOARD),
  ...BOARD_PROJECT_LIMIT_SETTINGS,
  ...run(CORE_SPECS, CORE_CLAIMS),
  ...TRIAGE_SETTINGS,
  ...RELEASE_SETTINGS,
  ...ERRORS_SETTINGS,
  ...LOGGER_SETTINGS,
  ...ISSUES_SETTINGS,
  ...run(CORE_SPECS, CORE_CLEANUP),
  ...DANGEROUS_RELEASE_SETTINGS,
  ...run(CORE_SPECS, CORE_TAIL),
  ...TESTS_SETTINGS,
};

/** Every setting name, read off the closed record above. */
export const SETTING_NAMES = Object.keys(SETTINGS) as ConfigSetting[];

/** Setting names by the dotted key the file spells them with. */
export const SETTING_BY_KEY: ReadonlyMap<string, ConfigSetting> = new Map(
  SETTING_NAMES.map((setting): [string, ConfigSetting] => [
    SETTINGS[setting].key,
    setting,
  ]),
);

/** True for a setting a command line can name. */
export function isCommandLineSetting(
  setting: ConfigSetting,
): setting is CommandLineSetting {
  return SETTINGS[setting].cli;
}

/** `plan.inject` → `['plan']`; `a.b.c` → `['a', 'a.b']`; `store` → `[]`. */
function sectionsOf(key: string): string[] {
  const parts = key.split('.');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('.'));
}

/** Every dotted prefix a setting sits under: the sections a file opens. */
export const SECTIONS: ReadonlySet<string> = new Set(
  [...SETTING_BY_KEY.keys()].flatMap(sectionsOf),
);

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
 * The keys known under each path, in schema order: `''` for the top
 * level, a section's path, and `<list>[]` for any item of a list of
 * mappings.
 */
const KNOWN_UNDER: ReadonlyMap<string, readonly string[]> = (() => {
  const known = new Map<string, string[]>();
  const add = (parent: string, name: string): void => {
    const names = known.get(parent) ?? [];
    if (!names.includes(name)) known.set(parent, [...names, name]);
  };
  for (const setting of SETTING_NAMES) {
    const { key, itemKeys } = SETTINGS[setting];
    const parts = key.split('.');
    parts.forEach((part, index) => add(parts.slice(0, index).join('.'), part));
    for (const name of itemKeys ?? []) add(`${key}[]`, name);
  }
  return known;
})();

/**
 * The nearest path above `key` with known keys, and those keys. An
 * item path such as `modules[0]` looks up `modules[]`.
 */
export function knownKeysAbove(key: string): [string, readonly string[]] {
  for (let parent = parentOf(key); parent !== ''; parent = parentOf(parent)) {
    const names = KNOWN_UNDER.get(parent.replace(TRAILING_INDEX, '[]'));
    if (names !== undefined) return [parent, names];
  }
  return ['', KNOWN_UNDER.get('') ?? []];
}
