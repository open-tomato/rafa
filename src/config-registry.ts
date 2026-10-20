/**
 * The registry: the fifteen sections of the config schema, handed to
 * core when {@link registerCoreConfigSections} is called, and the merged schema read off
 * them, {@link SETTINGS}, {@link CONFIG_DEFAULTS}, {@link SETTING_NAMES},
 * {@link SETTING_BY_KEY}, {@link SECTIONS} and {@link knownKeysAbove}.
 *
 * Core declares the section contract (`packages/rafa/src/core/config/section.ts`) and
 * names no section. This module, outside `packages/rafa/src/core/`, is the one place
 * the fifteen are listed, {@link CONFIG_SECTIONS}: core's own
 * (`CORE_SECTION`) and the fourteen files `config-schema-*.ts` that
 * each export one, under `src/` (ten) or, for four, under `packages/rafa/src/`.
 *
 * Importing it registers nothing. {@link registerCoreConfigSections}
 * calls `registerConfigSections` once, with that list cut into the runs
 * {@link SETTINGS} holds (see the order below), so `activeSettings()`
 * and `activeDefaults()` answer every setting; a registration core
 * refuses throws from the call, naming what it refused. The root is
 * called, never imported for its effect: under `"sideEffects": false`
 * in a manifest, `bun build` drops an import kept for its effect alone.
 * The root manifest declares no such field today, since bun 1.3.14's
 * split build breaks under it (#1213).
 * `src/rafa.ts` and `src/index.ts` call it as they load, after their
 * imports, ahead of `registerCoreAdapters` and before anything that
 * loads a config; core never imports this module. Until something calls
 * it, `loadConfig` refuses, naming this module. `bun test` calls it once
 * for the test process, from `src/tests/preload.ts`; a child process a
 * test spawns runs no preload, and calls the root itself. A second call
 * finds every setting registered already and registers nothing.
 *
 * The call also sets core's load hook (`setConfigLoadHook` in
 * `packages/rafa/src/core/config/section.ts`) to {@link handConfigToLogger}, so every
 * config `loadConfig` resolves hands the logger its `logger` settings
 * without core importing the logger's section file. It sets core's
 * template hook too (`setConfigTemplateHook`, same file) to
 * `templateEntry` from `src/config/templates.ts`, so the loader reads a
 * template a file names by calling the active hook, and core imports no
 * template file.
 *
 * ## The order
 *
 * {@link SETTINGS} keeps the order the schema has always reported
 * problems in, which is not the order of the list: core's settings are
 * taken in runs, and each section's settings are spread whole between
 * two of them, so `hub.url` follows `effort.sync` and the `board.project`
 * limits follow `board.project.number`. The `release` section is spread
 * in three parts, its `pr`, `release` and `dangerous.` keys, each where
 * its keys have always stood.
 *
 * Core reads every setting in the order it was registered: a layer, a
 * resolution, and the keys a warning about an unknown key lists. So the
 * sections are registered cut into the runs {@link SETTINGS} holds them
 * in (`inSettingOrder`), each cut under its section's package and a
 * section's checks on its first cut, and core's registry holds every
 * setting in this order. Registering the list whole would put core's
 * forty-five first, and the warning recorded in
 * `src/tests/fixtures/config-parity/` would list `hub` after `task`.
 * `config-registry.test.ts` holds that the registry holds the same
 * settings, in the same order, as the same specs, and the same defaults,
 * as the same values.
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
 * ## Beside core
 *
 * This module is the one place the six names are built: the core barrel
 * `packages/rafa/src/core/config/index.ts` exports none of them, and a file outside
 * `packages/rafa/src/core/` imports them from here. A feature file reads
 * the whole {@link SETTINGS} or {@link CONFIG_DEFAULTS} record off the
 * registration instead, through core's `registeredSettings()` and
 * `registeredDefaults()`, so it imports nothing of the root.
 * Core reads the registered
 * settings and defaults through `activeSettings()` and
 * `activeDefaults()`, and the key indexes through `activeSettingByKey()`,
 * `activeSectionPaths()` and `activeKnownKeysAbove()`, all in
 * `packages/rafa/src/core/config/section.ts`. Those follow registration order, which
 * is the order here, so they answer what {@link SETTING_BY_KEY},
 * {@link SECTIONS} and {@link knownKeysAbove} answer.
 * `src/index.ts` publishes this module's {@link CONFIG_DEFAULTS}.
 */
import type {
  ConfigSection,
  ConfigSetting,
  CoreSection,
  CoreSetting,
  RafaConfig,
  SettingSpec,
} from '@open-tomato/rafa/core/config';

import { setActiveLoggerSettings } from '@open-tomato/rafa/adapters/logger/settings';
import { BUGS_DEFAULTS, BUGS_SECTION, BUGS_SETTINGS } from '@open-tomato/rafa/config-schema-bugs';
import { ERRORS_DEFAULTS, ERRORS_SECTION, ERRORS_SETTINGS } from '@open-tomato/rafa/config-schema-errors';
import { FEATURES_DEFAULTS, FEATURES_SECTION, FEATURES_SETTINGS } from '@open-tomato/rafa/config-schema-features';
import {
  LOGGER_DEFAULTS,
  LOGGER_SECTION,
  LOGGER_SETTINGS,
  loggerSettingsOf,
} from '@open-tomato/rafa/config-schema-logger';
import {
  activeSettings,
  CORE_SECTION,
  registerConfigSections,
  setConfigLoadHook,
  setConfigTemplateHook,
} from '@open-tomato/rafa/core/config';

import { templateEntry } from './config/templates.js';
import {
  BOARD_PROJECT_LIMIT_DEFAULTS,
  BOARD_PROJECT_LIMIT_SETTINGS,
  BOARD_PROJECT_SECTION,
} from './config-schema-board-project.js';
import { CHECKS_DEFAULTS, CHECKS_SECTION, CHECKS_SETTINGS } from './config-schema-checks.js';
import { HUB_DEFAULTS, HUB_SECTION, HUB_SETTINGS } from './config-schema-hub.js';
import { ISSUES_DEFAULTS, ISSUES_SECTION, ISSUES_SETTINGS } from './config-schema-issues.js';
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

/** The fifteen sections, core's first, in the order they are registered. */
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
  BUGS_SECTION,
  LOGGER_SECTION,
  ISSUES_SECTION,
  TESTS_SECTION,
  CHECKS_SECTION,
  FEATURES_SECTION,
]);

/**
 * The hook `loadConfig` calls with every config it resolves: it hands
 * the logger its `logger` settings, read through the logger section's
 * `loggerSettingsOf`. Set by {@link registerCoreConfigSections}, beside
 * the registration.
 */
export function handConfigToLogger(config: Readonly<RafaConfig>): void {
  setActiveLoggerSettings(loggerSettingsOf(config));
}

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

/** Core's settings from the second consent to `templates`, before `tests`. */
const CORE_TAIL = [
  'dangerousSelfUpdateDuringLoop',
  'statusNotice',
  'tiersRafa',
  'tiersSkills',
  'tiersAgents',
  'routing',
  'taskSkills',
  'taskLessons',
  'mergeDuplicates',
  'namingBranch',
  'templates',
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
  ...BUGS_DEFAULTS,
  ...LOGGER_DEFAULTS,
  ...ISSUES_DEFAULTS,
  ...run(CORE_VALUES, CORE_CLEANUP),
  ...DANGEROUS_RELEASE_DEFAULTS,
  ...run(CORE_VALUES, CORE_TAIL),
  ...TESTS_DEFAULTS,
  ...CHECKS_DEFAULTS,
  ...FEATURES_DEFAULTS,
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
  ...BUGS_SETTINGS,
  ...LOGGER_SETTINGS,
  ...ISSUES_SETTINGS,
  ...run(CORE_SPECS, CORE_CLEANUP),
  ...DANGEROUS_RELEASE_SETTINGS,
  ...run(CORE_SPECS, CORE_TAIL),
  ...TESTS_SETTINGS,
  ...CHECKS_SETTINGS,
  ...FEATURES_SETTINGS,
});

/** Every setting name, read off the closed record above. */
export const SETTING_NAMES: readonly ConfigSetting[] = Object.freeze(Object.keys(SETTINGS) as ConfigSetting[]);

/** One run of consecutive setting names a single section defines. */
interface Cut {
  readonly section: ConfigSection;
  readonly names: readonly ConfigSetting[];
}

/**
 * `sections` cut into the runs `names` holds them in: one cut per run of
 * consecutive names one section defines, each under its section's
 * package, the first cut of a section carrying its checks. Registered in
 * this order, the registry core reads holds every setting in the order
 * of `names`. Throws on a name no section defines.
 *
 * @param sections - The sections to cut, each defining its own names.
 * @param names - Every setting, in the order to register them.
 * @returns The cuts, as sections, in the order of `names`.
 */
function inSettingOrder(
  sections: readonly ConfigSection[],
  names: readonly ConfigSetting[],
): ConfigSection[] {
  const cuts = names.reduce<readonly Cut[]>((runs, name) => {
    const section = sections.find((candidate) => Object.hasOwn(candidate.settings, name));
    if (section === undefined) throw new Error(`rafa config registry: no section defines setting ${name}`);
    const last = runs.at(-1);
    return last?.section === section
      ? [...runs.slice(0, -1), { section, names: [...last.names, name] }]
      : [...runs, { section, names: [name] }];
  }, []);
  return cuts.map(({ section, names: run }, index) => ({
    package: section.package,
    settings: Object.fromEntries(run.map((name) => [name, section.settings[name]])),
    defaults: Object.fromEntries(run.map((name) => [name, section.defaults[name]])),
    checks: cuts.findIndex((cut) => cut.section === section) === index
      ? section.checks ?? []
      : [],
  }));
}

/** Whether core's registry holds every setting of {@link SETTINGS}, each as the same spec. */
function holdsCoreSections(): boolean {
  const active = activeSettings();
  return SETTING_NAMES.every((name) => active[name] === SETTINGS[name]);
}

/**
 * Registers {@link CONFIG_SECTIONS} with core, cut into the runs
 * {@link SETTINGS} holds them in, sets core's load hook to
 * {@link handConfigToLogger}, and sets core's template hook to
 * `templateEntry` (`src/config/templates.ts`).
 *
 * When core's registry holds every setting already, each as the same
 * spec, it registers nothing and leaves both hooks as they are, so the
 * preload and an entry may both call it in one process. Throws what
 * `registerConfigSections` throws on a section core refuses, such as a
 * setting another package registered first, leaving the registry and
 * both hooks as they were.
 */
export function registerCoreConfigSections(): void {
  if (holdsCoreSections()) return;
  registerConfigSections(inSettingOrder(CONFIG_SECTIONS, SETTING_NAMES));
  setConfigLoadHook(handConfigToLogger);
  setConfigTemplateHook(templateEntry);
}

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
