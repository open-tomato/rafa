/**
 * The schema half of rafa's settings: which settings exist, the file key
 * each is spelled with, the reader each value goes through, and what
 * each resolves to when no layer names it.
 *
 * This module answers questions about KEYS. `config.ts` ranks LAYERS —
 * text into a layer, layers into one resolution — and re-exports
 * {@link RafaConfig}, {@link CONFIG_DEFAULTS} and {@link CONFIG_FILE},
 * so nothing outside the pair imports this file. `config-sections.ts`
 * holds every rule about a VALUE: the readers, the closed lists, and
 * why nothing is coerced. `config-items.ts` holds the two item shapes
 * the `prerequisites` and `modules` lists read. `config-readers.ts` holds
 * `mapOf`, whose ruling is on a KEY — the names a map setting's file
 * spells below its own key — and the named readers the settings below
 * are read through, `directory`, `trackerKind`, `releaseFile`,
 * `tierPins` and `routeTable`, and the readers of the release plan's
 * keys. `config-schema-release.ts` holds the `pr` and `release`
 * sections and `dangerous.acceptVersionCollision`, and
 * `config-schema-tests.ts` the `tests` section and its reader,
 * `config-schema-triage.ts` the `triage` section and its readers, and
 * `config-schema-wrap-up.ts` the `loop.wrapUp` section and its reader,
 * all four spread in here, and `config-schema-board-project.ts` the
 * `board.project` limits and their readers, spread in after
 * `board.project.number`. `config-schema-hub.ts` holds the `hub`
 * section, its readers and the refusal of `effort.sync: service` with
 * no `hub.url`, spread in after `effort.sync`.
 *
 * The modules sit under the 800-line cap of `context/source.md`, which
 * no gate reads. Measured with `wc -l` at the commit that added the `pr`
 * section: `config-schema.ts` is 396 lines, `config.ts` 506 and
 * `config-sections.ts` 478. This module had reached 800 exactly when
 * those readers moved out to `config-readers.ts`, leaving it at 727.
 * At 780 its per-section readings — the `pr` section's through the
 * `learning` section's — moved out to `config-schema-readings.ts`, a
 * note that exports nothing, and the `pr` and `release` sections'
 * fields, defaults and specs moved out to `config-schema-release.ts`.
 *
 * ## The schema
 *
 * The block under "Config schema" in `.rafa/specs/phase-1-installable.md` is
 * the schema and its defaults. Each {@link RafaConfig} field names the
 * file key it holds, and {@link CONFIG_DEFAULTS} spells each default.
 * A field joins section and key in camel case where the key needs its
 * section to say what it is: `plan.dir` is `planDir`. Two fields drop
 * the section, the key naming the setting by itself: `inject`, named in
 * phase 0 before any other plan key existed, and `settingSources`.
 *
 * Four readings the spec leaves to this module; the readings each later
 * section's spec leaves are argued in `config-schema-readings.ts`:
 *
 *   - `tracker.default`, `tracker.fallback` and `learning.adapter`
 *     accept any kind name. Whether a kind has an adapter is the adapter
 *     registry's answer at selection, since an add-on brings kinds core
 *     has never heard of (`linear`, `remote`). `output.mode` stays
 *     closed: the spec names `text` and `json` and no add-on mode.
 *   - Both prerequisite tiers default to EMPTY. The items in the spec's
 *     block show the shape and are not defaults. As defaults, a required
 *     `GITHUB_TOKEN` and `gh auth status` would halt every run on a
 *     machine without them, even one on the `local` tracker. They would
 *     also have every scratch run probe the real home, and would name
 *     `mgrep` known-missing in every prompt.
 *   - `version` accepts `1` alone. A later number says the keys were
 *     written for a schema whose meaning moved, which a warning cannot
 *     cover. The parser reads `1.0`, `01` and `0x1` as the number 1.
 *   - `loop.settingSources` is the key finding 3 of the spec names. It
 *     resolves to a list in the order written, because the list is what
 *     a caller asks (does it include `user`?) and rebuilds the flag from.
 *   - `loop.worktreeDir` defaults to `.rafa/worktrees` and is never null:
 *     a relative value is read from the project root, not the checkout
 *     (`start/worktree-dir.ts`). It is no {@link CommandLineSetting}.
 *
 * ## The closed set
 *
 * {@link SETTINGS} is a mapped record over {@link ConfigSetting} rather
 * than a list, so the set is closed both ways: a field added to
 * {@link RafaConfig} without an entry there does not compile, and an
 * entry naming no field does not either. {@link SETTING_NAMES},
 * {@link SETTING_BY_KEY}, {@link SECTIONS} and the known-key index are
 * all read off it, so adding a setting is one field, one default, one
 * spec — in `config-schema-release.ts` for a `pr` or `release` key,
 * `config-schema-tests.ts` for a `tests` key,
 * `config-schema-triage.ts` for a `triage` key,
 * `config-schema-wrap-up.ts` for a `loop.wrapUp` key,
 * `config-schema-board-project.ts` for a `board.project` limit —
 * its reader in `config-sections.ts`, one line in `config.ts`'s
 * layer literal and one commented line in `project/scaffold.ts`'s
 * template, which `scaffold.test.ts` holds it to, and nothing else
 * beyond the readings its spec leaves, which go in
 * `config-schema-readings.ts`.
 *
 * Keys are looked up in a `Map` and a `Set`, never with `in` or an
 * object index. `Bun.YAML.parse` returns a key spelled `constructor`,
 * `toString` or `__proto__` as an ordinary own key, and an object
 * lookup would match it against `Object.prototype` instead.
 *
 * ## Defaults
 *
 * {@link CONFIG_DEFAULTS} spells every default once, frozen, with each
 * list in it frozen too. A map cannot be frozen, as "Map settings" in
 * `config-readers.ts` says, so each map default is one shared `Map` —
 * the empty `tiers` maps and the `routing` table alike — and the
 * promise that no caller edits it rests on its `ReadonlyMap` type. The
 * cutover runs one plan under `full` and again under `stage`; should
 * that comparison argue for `full`, the change is that one line.
 */
import type {
  ModuleSource,
  OptionalPrerequisiteItem,
  PrerequisiteItem,
} from './config-items.js';
import type { BoardProjectLimitSettings } from './config-schema-board-project.js';
import type { HubSettings } from './config-schema-hub.js';
import type {
  DangerousReleaseSettings,
  PrSettings,
  ReleaseSettings,
} from './config-schema-release.js';
import type { TestsSettings } from './config-schema-tests.js';
import type { TriageSettings } from './config-schema-triage.js';
import type { WrapUpSettings } from './config-schema-wrap-up.js';
import type {
  BoardRelationshipMode,
  ClaimsAhead,
  ClaimsStaleAfter,
  ClaudeSettingSource,
  ConfigVersion,
  InjectMode,
  LessonSwitch,
  OutputMode,
  Reader,
  RouteTarget,
  SkillResolverName,
  StoreBackend,
  SyncStrategy,
  TierPin,
  TierSwitch,
} from './config-sections.js';

import { join } from 'node:path';

import {
  MODULE_SOURCE_KEYS,
  moduleSource,
  OPTIONAL_ITEM_KEYS,
  optionalPrerequisite,
  REQUIRED_ITEM_KEYS,
  requiredPrerequisite,
} from './config-items.js';
import {
  directory,
  routeTable,
  tierPins,
  trackerKind,
} from './config-readers.js';
import {
  BOARD_PROJECT_LIMIT_DEFAULTS,
  BOARD_PROJECT_LIMIT_SETTINGS,
} from './config-schema-board-project.js';
import { HUB_DEFAULTS, HUB_SETTINGS } from './config-schema-hub.js';
import {
  DANGEROUS_RELEASE_DEFAULTS,
  DANGEROUS_RELEASE_SETTINGS,
  PR_DEFAULTS,
  PR_SETTINGS,
  RELEASE_DEFAULTS,
  RELEASE_SETTINGS,
} from './config-schema-release.js';
import { TESTS_DEFAULTS, TESTS_SETTINGS } from './config-schema-tests.js';
import { TRIAGE_DEFAULTS, TRIAGE_SETTINGS } from './config-schema-triage.js';
import { WRAP_UP_DEFAULTS, WRAP_UP_SETTINGS } from './config-schema-wrap-up.js';
import {
  BOARD_PROJECT_TEMPLATE_DEFAULT,
  BOARD_RELATIONSHIP_MODES,
  busyTimeoutMs,
  claimsAhead,
  claimsStaleAfter,
  CLAUDE_SETTING_SOURCES,
  confidence,
  CONFIG_VERSIONS,
  dayCount,
  flag,
  githubLogin,
  INJECT_MODES,
  issueNumber,
  lessonSwitch,
  listOf,
  oneOf,
  OUTPUT_MODES,
  projectNumber,
  projectUrl,
  recurrenceCount,
  skillResolverName,
  STORE_BACKENDS,
  subsetOf,
  SYNC_STRATEGIES,
  text,
  tierSwitch,
} from './config-sections.js';
import { DEFAULT_ROUTING } from './tiers/routing.js';

/**
 * The config file, relative to the directory it sits under: the project
 * root for the project's, the home directory for the user scope's.
 *
 * `join` rather than a literal, as `effort/store.ts` spells its own
 * directory, so a path built here compares equal to one a caller built
 * with `join` of its own.
 */
export const CONFIG_FILE = join('.rafa', 'config.yaml');

/**
 * Every setting, resolved. The module note maps each to its file key;
 * the `hub` fields are {@link HubSettings}', the `pr` and `release`
 * fields are {@link PrSettings}' and {@link ReleaseSettings}',
 * `dangerousAcceptVersionCollision` is {@link DangerousReleaseSettings}',
 * the `tests` fields are {@link TestsSettings}', the `triage` fields are
 * {@link TriageSettings}', `loopWrapUpRetries` is
 * {@link WrapUpSettings}', and the `board.project` limits are
 * {@link BoardProjectLimitSettings}'.
 */
export interface RafaConfig
  extends HubSettings, PrSettings, ReleaseSettings, DangerousReleaseSettings,
  TestsSettings, TriageSettings, WrapUpSettings, BoardProjectLimitSettings {
  /** The schema version the file was written for. `version`. */
  version: ConfigVersion;
  /** The backend the effort store writes through. `store`. */
  store: StoreBackend;
  /**
   * How long an effort store open waits for another process's write
   * lock, in milliseconds. `effort.busyTimeoutMs`.
   */
  effortBusyTimeoutMs: number;
  /** How the effort store travels between devices. `effort.sync`. */
  effortSync: SyncStrategy;
  /** How much of the plan a task prompt receives. `plan.inject`. */
  inject: InjectMode;
  /** Where plans are written and read. `plan.dir`. */
  planDir: string;
  /** Where specs are read. `specs.dir`. */
  specsDir: string;
  /** The tracker kind tried first. `tracker.default`. */
  trackerDefault: string;
  /** The tracker kinds tried next, in order. `tracker.fallback`. */
  trackerFallback: readonly string[];
  /** The learning adapter kind. `learning.adapter`. */
  learningAdapter: string;
  /** The least confidence a lesson tasks may use. `learning.bless.minConfidence`. */
  learningBlessMinConfidence: number;
  /** The distinct sources a lesson needs to be promotable. `learning.promote.after`. */
  learningPromoteAfter: number;
  /** The least confidence of a promotable lesson. `learning.promote.minConfidence`. */
  learningPromoteMinConfidence: number;
  /** How commands write their output. `output.mode`. */
  outputMode: OutputMode;
  /** Items whose failure halts a run. `prerequisites.required`. */
  prerequisitesRequired: readonly PrerequisiteItem[];
  /** Items whose failure is only named. `prerequisites.optional`. */
  prerequisitesOptional: readonly OptionalPrerequisiteItem[];
  /** Whether `.rafa/specs/` is tracked by git. `tracking.specs`. */
  trackingSpecs: boolean;
  /** Whether `.rafa/plans/` is tracked by git. `tracking.plans`. */
  trackingPlans: boolean;
  /** Whether all of `.rafa/` is tracked by git. `tracking.all`. */
  trackingAll: boolean;
  /** Where modules are installed from. `modules`. */
  modules: readonly ModuleSource[];
  /** The module names enabled. `allowList`. */
  allowList: readonly string[];
  /** What each spawned session loads settings from. `loop.settingSources`. */
  settingSources: readonly ClaudeSettingSource[];
  /**
   * The directory a loop adds its worktrees under, read from the
   * project root. `loop.worktreeDir`.
   */
  loopWorktreeDir: string;
  /**
   * The logins trusted with board text besides the repository's own
   * write-holders. `board.trustedAuthors`.
   */
  boardTrustedAuthors: readonly string[];
  /**
   * Where the board's epics and blockers are read and written: `labels`
   * (`epic:` labels, `spec:blocked` and `Blocked by:` lines) or `native`
   * (GitHub's sub-issue parent and blocked-by links).
   * `board.relationships`.
   */
  boardRelationships: BoardRelationshipMode;
  /**
   * The GitHub project `rafa init --board` copies the board's project
   * from, by URL. `board.project.template`.
   */
  boardProjectTemplate: string;
  /**
   * The number of the GitHub project the board is mirrored to, under the
   * repository's owner, or null for a repository with no project.
   * `board.project.number`.
   */
  boardProjectNumber: number | null;
  /**
   * The issue whose task list `plan create --next` reads its order off,
   * or null for the issue titled `Roadmap`. `roadmap.issue`.
   */
  roadmapIssue: number | null;
  /**
   * How long a `rafa:claimed` claim stands before another device may
   * take it over, or `disabled`. `claims.staleAfter`.
   */
  claimsStaleAfter: ClaimsStaleAfter;
  /** Whether a claim may reach one issue ahead. `claims.ahead`. */
  claimsAhead: ClaimsAhead;
  /**
   * The age in days past which `rafa cleanup` lists a branch as Stale.
   * `cleanup.staleDays`.
   */
  cleanupStaleDays: number;
  /**
   * The idle days past which `rafa cleanup` lists a worktree.
   * `cleanup.worktreeIdleDays`.
   */
  cleanupWorktreeIdleDays: number;
  /** Glob patterns naming branches `rafa cleanup` never lists. `cleanup.keep`. */
  cleanupKeep: readonly string[];
  /**
   * Whether check 4 of the readiness gate accepts every dangling and
   * suspect reference of a spec on every run, as `--accept-refs` does
   * on one. `dangerous.acceptStaleRefs`.
   */
  dangerousAcceptStaleRefs: boolean;
  /**
   * Whether `rafa self-update` replaces the install while a loop of the
   * project is live, where it otherwise waits for that loop to finish.
   * `dangerous.selfUpdateDuringLoop`.
   */
  dangerousSelfUpdateDuringLoop: boolean;
  /**
   * Whether a command that runs inside a project prints the one-line
   * since-last-command notice on stderr. `status.notice`.
   */
  statusNotice: boolean;
  /** Whether the tier rafa ships is loaded. `tiers.rafa`. */
  tiersRafa: TierSwitch;
  /**
   * Skills turned off (`false`) or pinned to the tier that serves them,
   * by name. `tiers.skills`.
   */
  tiersSkills: ReadonlyMap<string, TierPin>;
  /**
   * Agents turned off (`false`) or pinned to the tier that serves them,
   * by name. `tiers.agents`.
   */
  tiersAgents: ReadonlyMap<string, TierPin>;
  /**
   * The agent each task shape is routed to, or `false` for a shape
   * routed nowhere. `routing`.
   */
  routing: ReadonlyMap<string, RouteTarget>;
  /** The resolver that picks each task's skills at dispatch. `task.skills`. */
  taskSkills: SkillResolverName;
  /** Whether blessed lessons join each task's prompt. `task.lessons`. */
  taskLessons: LessonSwitch;
}

/** The name of one setting, as a field of {@link RafaConfig}. */
export type ConfigSetting = keyof RafaConfig;

/**
 * The settings a command line can name. A flag parser hands over
 * strings, so these are the settings the file spells as one string: a
 * list, a boolean or a mapping has no command-line spelling this module
 * would have to invent.
 */
export type CommandLineSetting = 'store' | 'inject' | 'planDir' | 'specsDir'
  | 'trackerDefault' | 'learningAdapter' | 'outputMode' | 'settingSources'
  | 'taskSkills';

/** What every setting resolves to when no layer names it. */
export const CONFIG_DEFAULTS: Readonly<RafaConfig> = Object.freeze({
  version: 1,
  store: 'sqlite',
  effortBusyTimeoutMs: 5000,
  effortSync: 'local',
  ...HUB_DEFAULTS,
  inject: 'stage',
  planDir: join('.rafa', 'plans'),
  specsDir: join('.rafa', 'specs'),
  trackerDefault: 'github',
  trackerFallback: Object.freeze(['local']),
  learningAdapter: 'local',
  learningBlessMinConfidence: 0.5,
  learningPromoteAfter: 3,
  learningPromoteMinConfidence: 0.7,
  outputMode: 'text',
  prerequisitesRequired: Object.freeze([]),
  prerequisitesOptional: Object.freeze([]),
  trackingSpecs: false,
  trackingPlans: false,
  trackingAll: false,
  modules: Object.freeze([]),
  allowList: Object.freeze([]),
  settingSources: Object.freeze<ClaudeSettingSource[]>(['project', 'local']),
  loopWorktreeDir: join('.rafa', 'worktrees'),
  ...WRAP_UP_DEFAULTS,
  ...PR_DEFAULTS,
  boardTrustedAuthors: Object.freeze([]),
  boardRelationships: 'labels',
  boardProjectTemplate: BOARD_PROJECT_TEMPLATE_DEFAULT,
  boardProjectNumber: null,
  ...BOARD_PROJECT_LIMIT_DEFAULTS,
  roadmapIssue: null,
  claimsStaleAfter: '3d',
  claimsAhead: 'off',
  ...TRIAGE_DEFAULTS,
  ...RELEASE_DEFAULTS,
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
  cleanupKeep: Object.freeze([]),
  dangerousAcceptStaleRefs: false,
  ...DANGEROUS_RELEASE_DEFAULTS,
  dangerousSelfUpdateDuringLoop: false,
  statusNotice: true,
  tiersRafa: 'on',
  tiersSkills: new Map<string, TierPin>(),
  tiersAgents: new Map<string, TierPin>(),
  routing: DEFAULT_ROUTING,
  taskSkills: 'planner',
  taskLessons: 'on',
  ...TESTS_DEFAULTS,
});

/** What the module knows about one setting. */
export interface SettingSpec<K extends ConfigSetting> {
  /** Where the file spells it, as a dotted path. */
  key: string;
  /** The reader deciding which raw values it accepts. */
  read: Reader<RafaConfig[K]>;
  /** Whether a command line can name it; checked against the type. */
  cli: K extends CommandLineSetting
    ? true
    : false;
  /** For a list of mappings, the keys each item reads. */
  itemKeys?: readonly string[];
}

/**
 * Every setting, by name, in the order problems are reported.
 *
 * A mapped record rather than a list so the set is closed: a field
 * added to {@link RafaConfig} without an entry here does not compile.
 */
export const SETTINGS: { readonly [K in ConfigSetting]: SettingSpec<K> } = {
  version: { key: 'version', read: oneOf(CONFIG_VERSIONS), cli: false },
  store: { key: 'store', read: oneOf(STORE_BACKENDS), cli: true },
  effortBusyTimeoutMs: { key: 'effort.busyTimeoutMs', read: busyTimeoutMs, cli: false },
  effortSync: { key: 'effort.sync', read: oneOf(SYNC_STRATEGIES), cli: false },
  ...HUB_SETTINGS,
  inject: { key: 'plan.inject', read: oneOf(INJECT_MODES), cli: true },
  planDir: { key: 'plan.dir', read: directory, cli: true },
  specsDir: { key: 'specs.dir', read: directory, cli: true },
  trackerDefault: { key: 'tracker.default', read: trackerKind, cli: true },
  trackerFallback: {
    key: 'tracker.fallback',
    read: listOf(trackerKind, 'tracker kind names'),
    cli: false,
  },
  learningAdapter: {
    key: 'learning.adapter',
    read: text('a learning adapter name'),
    cli: true,
  },
  learningBlessMinConfidence: { key: 'learning.bless.minConfidence', read: confidence, cli: false },
  learningPromoteAfter: { key: 'learning.promote.after', read: recurrenceCount, cli: false },
  learningPromoteMinConfidence: { key: 'learning.promote.minConfidence', read: confidence, cli: false },
  outputMode: { key: 'output.mode', read: oneOf(OUTPUT_MODES), cli: true },
  prerequisitesRequired: {
    key: 'prerequisites.required',
    read: listOf(requiredPrerequisite, 'prerequisite items'),
    cli: false,
    itemKeys: REQUIRED_ITEM_KEYS,
  },
  prerequisitesOptional: {
    key: 'prerequisites.optional',
    read: listOf(optionalPrerequisite, 'prerequisite items'),
    cli: false,
    itemKeys: OPTIONAL_ITEM_KEYS,
  },
  trackingSpecs: { key: 'tracking.specs', read: flag, cli: false },
  trackingPlans: { key: 'tracking.plans', read: flag, cli: false },
  trackingAll: { key: 'tracking.all', read: flag, cli: false },
  modules: {
    key: 'modules',
    read: listOf(moduleSource, 'module sources'),
    cli: false,
    itemKeys: MODULE_SOURCE_KEYS,
  },
  allowList: {
    key: 'allowList',
    read: listOf(text('a module name'), 'module names'),
    cli: false,
  },
  settingSources: {
    key: 'loop.settingSources',
    read: subsetOf(CLAUDE_SETTING_SOURCES),
    cli: true,
  },
  loopWorktreeDir: { key: 'loop.worktreeDir', read: directory, cli: false },
  ...WRAP_UP_SETTINGS,
  ...PR_SETTINGS,
  boardTrustedAuthors: {
    key: 'board.trustedAuthors',
    read: listOf(githubLogin, 'GitHub logins'),
    cli: false,
  },
  boardRelationships: {
    key: 'board.relationships',
    read: oneOf(BOARD_RELATIONSHIP_MODES),
    cli: false,
  },
  boardProjectTemplate: { key: 'board.project.template', read: projectUrl, cli: false },
  boardProjectNumber: { key: 'board.project.number', read: projectNumber, cli: false },
  ...BOARD_PROJECT_LIMIT_SETTINGS,
  roadmapIssue: { key: 'roadmap.issue', read: issueNumber, cli: false },
  claimsStaleAfter: { key: 'claims.staleAfter', read: claimsStaleAfter, cli: false },
  claimsAhead: { key: 'claims.ahead', read: claimsAhead, cli: false },
  ...TRIAGE_SETTINGS,
  ...RELEASE_SETTINGS,
  cleanupStaleDays: { key: 'cleanup.staleDays', read: dayCount, cli: false },
  cleanupWorktreeIdleDays: {
    key: 'cleanup.worktreeIdleDays',
    read: dayCount,
    cli: false,
  },
  cleanupKeep: {
    key: 'cleanup.keep',
    read: listOf(text('a glob pattern'), 'glob patterns'),
    cli: false,
  },
  dangerousAcceptStaleRefs: {
    key: 'dangerous.acceptStaleRefs',
    read: flag,
    cli: false,
  },
  ...DANGEROUS_RELEASE_SETTINGS,
  dangerousSelfUpdateDuringLoop: {
    key: 'dangerous.selfUpdateDuringLoop',
    read: flag,
    cli: false,
  },
  statusNotice: { key: 'status.notice', read: flag, cli: false },
  tiersRafa: { key: 'tiers.rafa', read: tierSwitch, cli: false },
  tiersSkills: { key: 'tiers.skills', read: tierPins, cli: false },
  tiersAgents: { key: 'tiers.agents', read: tierPins, cli: false },
  routing: { key: 'routing', read: routeTable, cli: false },
  taskSkills: { key: 'task.skills', read: skillResolverName, cli: true },
  taskLessons: { key: 'task.lessons', read: lessonSwitch, cli: false },
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
