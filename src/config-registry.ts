/**
 * The registry: the twelve sections of the config schema, handed to
 * core when this module is imported, and the merged schema read off
 * them, {@link SETTINGS}, {@link CONFIG_DEFAULTS}, {@link SETTING_NAMES},
 * {@link SETTING_BY_KEY}, {@link SECTIONS} and {@link knownKeysAbove}.
 *
 * Core declares the section contract (`src/core/config/section.ts`) and
 * names no section. This module, outside `src/core/`, is the one place
 * the twelve are listed, {@link CONFIG_SECTIONS}: core's own
 * (`CORE_SECTION`) and the eleven files `src/config-schema-*.ts`.
 * Importing it calls `registerConfigSections` with that list, once, so
 * `activeSettings()` and `activeDefaults()` answer every setting.
 * `src/rafa.ts` and `src/index.ts` import it ahead of every other
 * import, before anything that loads a config; core never imports it.
 * A refused registration throws at import, naming what it refused.
 *
 * ## The order
 *
 * {@link SETTINGS} keeps the order the schema has always reported
 * problems in, which is not the order of the list: core's settings are
 * taken in runs, and each section's settings are spread whole between
 * two of them, so `hub.url` follows `effort.sync` and the `board.project`
 * limits follow `board.project.number`. The `release` section is spread
 * in three parts, its `pr`, `release` and `dangerous.` keys, each where
 * its keys have always stood. The registry `registerConfigSections`
 * builds holds core's section first and the eleven in the list's order;
 * `config-registry.test.ts` holds that both hold the same settings, as
 * the same specs, and the same defaults, as the same values.
 *
 * ## The closed set
 *
 * {@link SETTINGS} is a mapped record over `ConfigSetting` built from
 * each section file's typed settings, so a field added to `RafaConfig`
 * without a spec in some section does not compile. The indexes are all
 * read off it. Keys are looked up in a `Map`, never with `in` or an
 * object index: `Bun.YAML.parse` returns a key spelled `constructor` or
 * `__proto__` as an ordinary own key, and an object lookup would match
 * it against `Object.prototype` instead.
 *
 * ## Beside the core barrel
 *
 * The core barrel `src/core/config/index.ts` still exports the six
 * names, built by `src/core/config/config-merged.ts`, until their
 * importers move here. The two builds spread the same section objects,
 * so each default is the same value in both; the two records and the
 * two default objects are different objects. `src/index.ts` publishes
 * this module's {@link CONFIG_DEFAULTS}.
 */
import type {
  ConfigSection,
  ConfigSetting,
  CoreSection,
  CoreSetting,
  RafaConfig,
  SettingSpec,
} from './core/config/index.js';

import {
  BOARD_PROJECT_LIMIT_DEFAULTS,
  BOARD_PROJECT_LIMIT_SETTINGS,
  BOARD_PROJECT_SECTION,
} from './config-schema-board-project.js';
import { ERRORS_DEFAULTS, ERRORS_SECTION, ERRORS_SETTINGS } from './config-schema-errors.js';
import { HUB_DEFAULTS, HUB_SECTION, HUB_SETTINGS } from './config-schema-hub.js';
import { ISSUES_DEFAULTS, ISSUES_SECTION, ISSUES_SETTINGS } from './config-schema-issues.js';
import { LOGGER_DEFAULTS, LOGGER_SECTION, LOGGER_SETTINGS } from './config-schema-logger.js';
import {
  LOOP_CONTINUE_DEFAULTS,
  LOOP_CONTINUE_SECTION,
  LOOP_CONTINUE_SETTINGS,
} from './config-schema-loop-continue.js';
import {
  LOOP_RETRIES_DEFAULTS,
  LOOP_RETRIES_SECTION,
  LOOP_RETRIES_SETTINGS,
} from './config-schema-loop-retries.js';
import {
  DANGEROUS_RELEASE_DEFAULTS,
  DANGEROUS_RELEASE_SETTINGS,
  PR_DEFAULTS,
  PR_SETTINGS,
  RELEASE_DEFAULTS,
  RELEASE_SECTION,
  RELEASE_SETTINGS,
} from './config-schema-release.js';
import { TESTS_DEFAULTS, TESTS_SECTION, TESTS_SETTINGS } from './config-schema-tests.js';
import { TRIAGE_DEFAULTS, TRIAGE_SECTION, TRIAGE_SETTINGS } from './config-schema-triage.js';
import { WRAP_UP_DEFAULTS, WRAP_UP_SECTION, WRAP_UP_SETTINGS } from './config-schema-wrap-up.js';
import { CORE_SECTION, registerConfigSections } from './core/config/index.js';

/** The twelve sections, core's first, in the order they are registered. */
export const CONFIG_SECTIONS: readonly ConfigSection[] = Object.freeze([
  CORE_SECTION,
  HUB_SECTION,
  LOOP_RETRIES_SECTION,
  LOOP_CONTINUE_SECTION,
  WRAP_UP_SECTION,
  RELEASE_SECTION,
  BOARD_PROJECT_SECTION,
  TRIAGE_SECTION,
  ERRORS_SECTION,
  LOGGER_SECTION,
  ISSUES_SECTION,
  TESTS_SECTION,
]);

registerConfigSections(CONFIG_SECTIONS);

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
export const SETTINGS: { readonly [K in ConfigSetting]: SettingSpec<K> } = Object.freeze({
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
});

/** Every setting name, read off the closed record above. */
export const SETTING_NAMES: readonly ConfigSetting[] = Object.freeze(Object.keys(SETTINGS) as ConfigSetting[]);

/** Setting names by the dotted key the file spells them with. */
export const SETTING_BY_KEY: ReadonlyMap<string, ConfigSetting> = new Map(
  SETTING_NAMES.map((setting): [string, ConfigSetting] => [
    SETTINGS[setting].key,
    setting,
  ]),
);

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
 *
 * @param key - A dotted key a file spelled, `modules[0].kind` included.
 * @returns The path the keys sit under, `''` for the top, and the keys.
 */
export function knownKeysAbove(key: string): [string, readonly string[]] {
  for (let parent = parentOf(key); parent !== ''; parent = parentOf(parent)) {
    const names = KNOWN_UNDER.get(parent.replace(TRAILING_INDEX, '[]'));
    if (names !== undefined) return [parent, names];
  }
  return ['', KNOWN_UNDER.get('') ?? []];
}
