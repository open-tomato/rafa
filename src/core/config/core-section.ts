/**
 * Core's own slice of the config schema, handed in as a
 * {@link ConfigSection} like any other: {@link CORE_SECTION}, the
 * settings `config-schema.ts` declares on `RafaConfig` with their file
 * keys, readers and defaults, and {@link CONFIG_FILE}, the file they are
 * read from.
 *
 * `config-schema.ts` declares the fields and this module answers what
 * each one is spelled with and what it resolves to when no layer names
 * it. `config-sections.ts` holds every rule about a VALUE: the readers,
 * the closed lists, and why nothing is coerced. `config-items.ts` holds
 * the two item shapes the `prerequisites` and `modules` lists read.
 * `config-readers.ts` holds `mapOf` and the named readers the settings
 * below are read through: `directory`, `trackerKind`, `tierPins` and
 * `routeTable`. The eleven section files `src/config-schema-*.ts` hold
 * the other packages' settings; core names none of them here.
 *
 * ## The schema
 *
 * The block under "Config schema" in `.rafa/specs/phase-1-installable.md` is
 * the schema and its defaults. Each field names the file key it holds,
 * and {@link CORE_SECTION}'s `defaults` spells each default. A field
 * joins section and key in camel case where the key needs its section to
 * say what it is: `plan.dir` is `planDir`. Two fields drop the section,
 * the key naming the setting by itself: `inject`, named in phase 0
 * before any other plan key existed, and `settingSources`.
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
 *     (`start/worktree-dir.ts`). It is no `CommandLineSetting`.
 *
 * ## Defaults
 *
 * Every default is spelled once, frozen, with each list in it frozen
 * too. A map cannot be frozen, as "Map settings" in `config-readers.ts`
 * says, so each map default is one shared `Map` — the empty `tiers` maps
 * and the `routing` table alike — and the promise that no caller edits
 * it rests on its `ReadonlyMap` type. The cutover runs one plan under
 * `full` and again under `stage`; should that comparison argue for
 * `full`, the change is that one line.
 *
 * ## The set is held two ways
 *
 * The settings and the defaults are typed over the same names,
 * {@link CoreSetting}, so a setting with no default, or a default with no
 * setting, does not compile. That the names are exactly the fields `config-schema.ts`
 * declares is held by `core-section.test.ts`, which reads them off that
 * file's source: a type cannot tell a field declared there from one a
 * section file adds to `RafaConfig`.
 */
import type {
  ModuleSource,
  OptionalPrerequisiteItem,
  PrerequisiteItem,
} from './config-items.js';
import type { RafaConfig, SettingSpec } from './config-schema.js';
import type { ClaudeSettingSource, TierPin } from './config-sections.js';
import type { ConfigSection } from './section.js';

import { dirname, join } from 'node:path';

import { DEFAULT_ROUTING } from '../../tiers/routing.js';

import {
  MODULE_SOURCE_KEYS,
  moduleSource,
  OPTIONAL_ITEM_KEYS,
  optionalPrerequisite,
  REQUIRED_ITEM_KEYS,
  requiredPrerequisite,
} from './config-items.js';
import {
  branchTemplate,
  DEFAULT_BRANCH_TEMPLATE,
  directory,
  routeTable,
  tierPins,
  trackerKind,
} from './config-readers.js';
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
  duplicatesLevel,
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

/**
 * The config file, relative to the directory it sits under: the project
 * root for the project's, the home directory for the user scope's.
 *
 * `join` rather than a literal, as `effort/store/ndjson-files.ts` spells
 * its own directory, so a path built here compares equal to one a
 * caller built with `join` of its own.
 */
export const CONFIG_FILE: string = join('.rafa', 'config.yaml');

/**
 * The directory a scope keeps its files in, relative to the project
 * root or the home: `.rafa`. Taken from `CONFIG_FILE`, so the two
 * cannot name different directories.
 */
export const SCOPE_DIR: string = dirname(CONFIG_FILE);

/** The package name core's section is registered under, which every refusal names. */
const CORE_PACKAGE = 'core';

/**
 * The name of one of core's own settings: every field `config-schema.ts`
 * declares on `RafaConfig`, in the order problems are reported. Spelled
 * rather than read off a value, since `isolatedDeclarations` asks every
 * exported type to be written out.
 */
export type CoreSetting =
  | 'version'
  | 'store'
  | 'effortBusyTimeoutMs'
  | 'effortSync'
  | 'inject'
  | 'planDir'
  | 'specsDir'
  | 'trackerDefault'
  | 'trackerFallback'
  | 'learningAdapter'
  | 'learningBlessMinConfidence'
  | 'learningPromoteAfter'
  | 'learningPromoteMinConfidence'
  | 'outputMode'
  | 'prerequisitesRequired'
  | 'prerequisitesOptional'
  | 'trackingSpecs'
  | 'trackingPlans'
  | 'trackingAll'
  | 'modules'
  | 'allowList'
  | 'settingSources'
  | 'loopWorktreeDir'
  | 'boardTrustedAuthors'
  | 'boardRelationships'
  | 'boardProjectTemplate'
  | 'boardProjectNumber'
  | 'roadmapIssue'
  | 'claimsStaleAfter'
  | 'claimsAhead'
  | 'cleanupStaleDays'
  | 'cleanupWorktreeIdleDays'
  | 'cleanupKeep'
  | 'dangerousAcceptStaleRefs'
  | 'dangerousSelfUpdateDuringLoop'
  | 'statusNotice'
  | 'tiersRafa'
  | 'tiersSkills'
  | 'tiersAgents'
  | 'routing'
  | 'taskSkills'
  | 'taskLessons'
  | 'mergeDuplicates'
  | 'namingBranch';

/** Core's section: its package, the spec and the default of each of its settings, and no check. */
export interface CoreSection extends ConfigSection {
  /** Each of core's settings, by name, in the order problems are reported. */
  readonly settings: { readonly [K in CoreSetting]: SettingSpec<K> };
  /** What each of core's settings resolves to when no layer names it. */
  readonly defaults: Readonly<Pick<RafaConfig, CoreSetting>>;
}

/** Each of core's settings, by name, in the order problems are reported. */
const CORE_SPECS: CoreSection['settings'] = {
  version: { key: 'version', read: oneOf(CONFIG_VERSIONS), cli: false },
  store: { key: 'store', read: oneOf(STORE_BACKENDS), cli: true },
  effortBusyTimeoutMs: { key: 'effort.busyTimeoutMs', read: busyTimeoutMs, cli: false },
  effortSync: { key: 'effort.sync', read: oneOf(SYNC_STRATEGIES), cli: false },
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
  roadmapIssue: { key: 'roadmap.issue', read: issueNumber, cli: false },
  claimsStaleAfter: { key: 'claims.staleAfter', read: claimsStaleAfter, cli: false },
  claimsAhead: { key: 'claims.ahead', read: claimsAhead, cli: false },
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
  dangerousSelfUpdateDuringLoop: {
    key: 'dangerous.selfUpdateDuringLoop',
    read: flag,
    cli: false,
  },
  statusNotice: { key: 'status.notice', read: flag, cli: false },
  tiersRafa: { key: 'tiers.rafa', read: tierSwitch, cli: false },
  tiersSkills: { key: 'tiers.skills', read: tierPins, cli: false, map: true },
  tiersAgents: { key: 'tiers.agents', read: tierPins, cli: false, map: true },
  routing: { key: 'routing', read: routeTable, cli: false, map: true },
  taskSkills: { key: 'task.skills', read: skillResolverName, cli: true },
  taskLessons: { key: 'task.lessons', read: lessonSwitch, cli: false },
  mergeDuplicates: { key: 'merge.duplicates', read: duplicatesLevel, cli: false },
  namingBranch: { key: 'naming.branch', read: branchTemplate, cli: false },
};

/** What each of core's settings resolves to when no layer names it; see "Defaults" above. */
const CORE_DEFAULTS: CoreSection['defaults'] = Object.freeze({
  version: 1,
  store: 'sqlite',
  effortBusyTimeoutMs: 5000,
  effortSync: 'local',
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
  prerequisitesRequired: Object.freeze<PrerequisiteItem[]>([]),
  prerequisitesOptional: Object.freeze<OptionalPrerequisiteItem[]>([]),
  trackingSpecs: false,
  trackingPlans: false,
  trackingAll: false,
  modules: Object.freeze<ModuleSource[]>([]),
  allowList: Object.freeze([]),
  settingSources: Object.freeze<ClaudeSettingSource[]>(['project', 'local']),
  loopWorktreeDir: join('.rafa', 'worktrees'),
  boardTrustedAuthors: Object.freeze([]),
  boardRelationships: 'labels',
  boardProjectTemplate: BOARD_PROJECT_TEMPLATE_DEFAULT,
  boardProjectNumber: null,
  roadmapIssue: null,
  claimsStaleAfter: '3d',
  claimsAhead: 'off',
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
  cleanupKeep: Object.freeze([]),
  dangerousAcceptStaleRefs: false,
  dangerousSelfUpdateDuringLoop: false,
  statusNotice: true,
  tiersRafa: 'on',
  tiersSkills: new Map<string, TierPin>(),
  tiersAgents: new Map<string, TierPin>(),
  routing: DEFAULT_ROUTING,
  taskSkills: 'planner',
  taskLessons: 'on',
  mergeDuplicates: 'warn',
  namingBranch: DEFAULT_BRANCH_TEMPLATE,
});

/**
 * Core's own settings, handed in as a section: package `core`, every
 * setting `config-schema.ts` declares with its spec and its default, and
 * no cross-key check. Frozen, with its settings record.
 */
export const CORE_SECTION: CoreSection = Object.freeze({
  package: CORE_PACKAGE,
  settings: Object.freeze(CORE_SPECS),
  defaults: CORE_DEFAULTS,
});
