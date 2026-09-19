/**
 * The schema half of rafa's settings: which settings exist, the file key
 * each is spelled with, the reader each value goes through, and what
 * each resolves to when no layer names it.
 *
 * This module answers questions about KEYS. `config.ts` ranks LAYERS —
 * text into a layer, layers into one resolution — and re-exports
 * {@link RafaConfig}, {@link CONFIG_DEFAULTS} and {@link CONFIG_FILE},
 * so nothing outside the pair imports this file. `config-sections.ts`
 * holds every rule about a VALUE: the readers, the closed lists, the
 * item shapes, and why nothing is coerced.
 *
 * The trio sits under the 800-line cap of `context/source.md`, which no
 * gate reads. Measured with `wc -l` at the commit that added the `pr`
 * section: `config-schema.ts` is 396 lines, `config.ts` 506 and
 * `config-sections.ts` 478.
 *
 * ## The schema
 *
 * The block under "Config schema" in `.specs/phase-1-installable.md` is
 * the schema and its defaults. Each {@link RafaConfig} field names the
 * file key it holds, and {@link CONFIG_DEFAULTS} spells each default.
 * A field joins section and key in camel case where the key needs its
 * section to say what it is: `plan.dir` is `planDir`. Two fields drop
 * the section, the key naming the setting by itself: `inject`, named in
 * phase 0 before any other plan key existed, and `settingSources`.
 *
 * Four readings the spec leaves to this module:
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
 *
 * ## The `pr` section
 *
 * `.specs/rafa-20-pr-commands.md` spells it `pr: { provider: gh | none,
 * mergeMethod: squash | merge | rebase, base: <default branch> }`, and
 * names `pr.resolveBudget` as what a `triage --resolve` session's
 * `--max-budget-usd` comes from. Four readings it leaves to this module:
 *
 *   - `pr.provider` and `pr.base` default to NULL, and null here means
 *     "nobody has said", not "off". The spec's default for the provider
 *     is `gh` when `origin` is a GitHub remote and `none` otherwise, and
 *     its default base is whatever the remote calls its default branch;
 *     neither is a value this module can spell, because both are read
 *     off the repository at use (`pr/provider.ts`). Writing either
 *     default as a literal would be the silent choice the config refuses
 *     everywhere else: `prBase: 'main'` would open a pull request into a
 *     branch that may not exist on a repository whose default is
 *     `master`. A file spelling `provider:` or `base:` with no value
 *     says nothing, as every null does, and resolves to the same null.
 *   - `pr.mergeMethod` defaults to `squash`, the first method the spec
 *     lists and the one the merge flow is written for: it deletes the
 *     local branch with `-D` because a squash leaves it unmerged in
 *     git's eyes.
 *   - `pr.resolveBudget` defaults to 2 US dollars, which the attempt
 *     guard's default of two attempts caps at 4 for one pull request.
 *     It is a number and not null: the spec has every resolve run carry
 *     `--max-budget-usd`, so a session with no budget is not a state
 *     this setting can be left in.
 *   - No `pr` setting is a {@link CommandLineSetting}. `pr merge` takes
 *     a `--method` flag, but that flag is the command's own argument for
 *     one merge, read by the command beside this setting, and not a
 *     layer over the config: a global `--merge-method` nobody typed
 *     would be a flag this module invented.
 *
 * ## The `board` section
 *
 * `.specs/rafa-20-pr-commands.md` names `board.trustedAuthors` as the
 * allow-list beside the permission reading `src/board/trust.ts` makes:
 * text off the board reaches an agent's prompt, so its author must hold
 * write access on the repository or be listed here. Two readings it
 * leaves to this module:
 *
 *   - It defaults to the EMPTY list, and empty is a working default
 *     rather than a placeholder: with nothing listed, the permission
 *     reading alone decides, which is the answer GitHub already holds
 *     for every member. A name here is for the author a permission
 *     lookup cannot speak for — a bot account, or a maintainer whose
 *     access is held through an organisation the endpoint does not
 *     report — and inventing one as a default would trust an account
 *     nobody named.
 *   - Each entry goes through `githubLogin` and not through `text`,
 *     because a login from this setting is spliced into the
 *     collaborators path; `config-sections.ts` records what that
 *     narrower shape refuses and why.
 *
 * ## The closed set
 *
 * {@link SETTINGS} is a mapped record over {@link ConfigSetting} rather
 * than a list, so the set is closed both ways: a field added to
 * {@link RafaConfig} without an entry there does not compile, and an
 * entry naming no field does not either. {@link SETTING_NAMES},
 * {@link SETTING_BY_KEY}, {@link SECTIONS} and the known-key index are
 * all read off it, so adding a setting is one field, one default, one
 * spec, its reader in `config-sections.ts`, one line in `config.ts`'s
 * layer literal and one commented line in `project/scaffold.ts`'s
 * template, which `scaffold.test.ts` holds it to, and nothing else.
 *
 * Keys are looked up in a `Map` and a `Set`, never with `in` or an
 * object index. `Bun.YAML.parse` returns a key spelled `constructor`,
 * `toString` or `__proto__` as an ordinary own key, and an object
 * lookup would match it against `Object.prototype` instead.
 *
 * ## Defaults
 *
 * {@link CONFIG_DEFAULTS} spells every default once, frozen, with each
 * list in it frozen too. The cutover runs one plan under `full` and
 * again under `stage`; should that comparison argue for `full`, the
 * change is that one line.
 */
import type {
  ClaudeSettingSource,
  ConfigVersion,
  InjectMode,
  MergeMethod,
  ModuleSource,
  OptionalPrerequisiteItem,
  OutputMode,
  PrerequisiteItem,
  PrProvider,
  Reader,
  StoreBackend,
} from './config-sections.js';

import { join } from 'node:path';

import {
  CLAUDE_SETTING_SOURCES,
  CONFIG_VERSIONS,
  flag,
  githubLogin,
  INJECT_MODES,
  listOf,
  mergeMethod,
  MODULE_SOURCE_KEYS,
  moduleSource,
  OPTIONAL_ITEM_KEYS,
  oneOf,
  optionalPrerequisite,
  OUTPUT_MODES,
  PR_PROVIDERS,
  REQUIRED_ITEM_KEYS,
  requiredPrerequisite,
  STORE_BACKENDS,
  subsetOf,
  text,
  usdAmount,
} from './config-sections.js';

/**
 * The config file, relative to the directory it sits under: the project
 * root for the project's, the home directory for the user scope's.
 *
 * `join` rather than a literal, as `effort/store.ts` spells its own
 * directory, so a path built here compares equal to one a caller built
 * with `join` of its own.
 */
export const CONFIG_FILE = join('.rafa', 'config.yaml');

/** Every setting, resolved. The module note maps each to its file key. */
export interface RafaConfig {
  /** The schema version the file was written for. `version`. */
  version: ConfigVersion;
  /** The backend the effort store writes through. `store`. */
  store: StoreBackend;
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
   * The provider every `pr` action goes through, or null to read it off
   * the `origin` remote. `pr.provider`.
   */
  prProvider: PrProvider | null;
  /** How `pr merge` merges, unless `--method` names another. `pr.mergeMethod`. */
  prMergeMethod: MergeMethod;
  /**
   * The branch a pull request is opened into, or null for whatever the
   * remote calls its default branch. `pr.base`.
   */
  prBase: string | null;
  /**
   * The budget in US dollars each `pr triage --resolve` session is
   * spawned with. `pr.resolveBudget`.
   */
  prResolveBudget: number;
  /**
   * The logins trusted with board text besides the repository's own
   * write-holders. `board.trustedAuthors`.
   */
  boardTrustedAuthors: readonly string[];
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
  | 'trackerDefault' | 'learningAdapter' | 'outputMode' | 'settingSources';

/** What every setting resolves to when no layer names it. */
export const CONFIG_DEFAULTS: Readonly<RafaConfig> = Object.freeze({
  version: 1,
  store: 'sqlite',
  inject: 'stage',
  planDir: join('.rafa', 'plans'),
  specsDir: join('.rafa', 'specs'),
  trackerDefault: 'github',
  trackerFallback: Object.freeze(['local']),
  learningAdapter: 'local',
  outputMode: 'text',
  prerequisitesRequired: Object.freeze([]),
  prerequisitesOptional: Object.freeze([]),
  trackingSpecs: false,
  trackingPlans: false,
  trackingAll: false,
  modules: Object.freeze([]),
  allowList: Object.freeze([]),
  settingSources: Object.freeze<ClaudeSettingSource[]>(['project', 'local']),
  prProvider: null,
  prMergeMethod: 'squash',
  prBase: null,
  prResolveBudget: 2,
  boardTrustedAuthors: Object.freeze([]),
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

/** The reader both directory settings share. */
const directory = text('a directory path');

/** The reader every tracker kind goes through. */
const trackerKind = text('a tracker kind name');

/**
 * Every setting, by name, in the order problems are reported.
 *
 * A mapped record rather than a list so the set is closed: a field
 * added to {@link RafaConfig} without an entry here does not compile.
 */
export const SETTINGS: { readonly [K in ConfigSetting]: SettingSpec<K> } = {
  version: { key: 'version', read: oneOf(CONFIG_VERSIONS), cli: false },
  store: { key: 'store', read: oneOf(STORE_BACKENDS), cli: true },
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
  prProvider: { key: 'pr.provider', read: oneOf(PR_PROVIDERS), cli: false },
  prMergeMethod: { key: 'pr.mergeMethod', read: mergeMethod, cli: false },
  prBase: { key: 'pr.base', read: text('a branch name'), cli: false },
  prResolveBudget: { key: 'pr.resolveBudget', read: usdAmount, cli: false },
  boardTrustedAuthors: {
    key: 'board.trustedAuthors',
    read: listOf(githubLogin, 'GitHub logins'),
    cli: false,
  },
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
