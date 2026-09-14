/**
 * Reading rafa's settings: the phase 1 schema of `.rafa/config.yaml`.
 *
 * Every setting takes the value the COMMAND LINE gave it, else the
 * value `.rafa/config.yaml` gave it, else its default. Each setting is
 * ranked on its own, so a flag naming one leaves the others to the file,
 * and {@link ResolvedConfig.sources} records which layer answered each.
 * That record keeps precedence observable when two layers agree: a file
 * spelling the default still reports `file`, where the value alone could
 * not tell a file that was read from one that was skipped.
 *
 * This module answers from one file, under a root its caller supplies.
 * Scope resolution, the user-level `~/.rafa/config.yaml` and `rafa init`
 * are not here.
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
 * Every rule about a VALUE lives in `config-sections.ts`: the readers,
 * the closed lists of values, the prerequisite item and module source
 * shapes, and why nothing is coerced. This module holds the rules about KEYS and LAYERS.
 *
 * ## Where the rules live
 *
 * {@link parseConfigText} turns YAML text into one file layer and
 * {@link resolveConfig} ranks the layers. Both are pure, so every
 * precedence case is tested without a disk. {@link readConfigFile} is
 * the only read, and {@link loadConfig} the only place that prints.
 *
 * ## Unknown keys and unusable values
 *
 * The two are treated differently, and the difference is who the file
 * was written for.
 *
 *   - An UNKNOWN key is retained and warned about, never refused. It
 *     lands in {@link ConfigFile.extras} under its path (`nonesuch`,
 *     `plan.depth`, `prerequisites.required[0].timeout`) with the value
 *     it carried, and acts on nothing. A file written for a later phase
 *     names keys this one has never heard of; refusing them would make
 *     every addition to the schema a breaking change for older
 *     installs. That is the reason `utils/declaration.ts` keeps an
 *     unrecognised declaration key in its `extras`, and it holds here
 *     unchanged. The warning lists the keys known where the unknown one
 *     sits: the top level's, a section's, or an item's.
 *   - An UNUSABLE value for a key this module DOES answer to is
 *     refused with a {@link ConfigError}. `store: postgres` asks for a
 *     backend nothing here provides, and falling back to the default
 *     would write rows into a store other than the one the operator
 *     named — a silent success, the failure the collector refuses an
 *     unrecognised argument to prevent. Every problem is collected
 *     before the throw, so one run names all of them. A section that is
 *     not a mapping is one: `tracker: linear` is refused, where a
 *     phase 0 file could carry it as an unknown key.
 *
 * A file is judged whole, whatever the command line says. A flag that
 * outranks an unusable file value does not excuse it, because the next
 * run without the flag reads it.
 *
 * A `null` value says nothing; it is neither a value nor a problem.
 * YAML makes `null` of a key whose children are all commented out —
 * `plan:` above `  # inject: full` parses to `{ plan: null }` — and
 * refusing it would punish the commonest edit a config file receives.
 *
 * A setting's dotted path is built by joining keys, so `plan.inject`
 * written flat at the top level reaches the same setting as `inject`
 * nested under `plan`. Both spellings are accepted, and a file giving
 * one setting in both is refused: they are different YAML keys, so the
 * parser keeps both, and letting one win would be a silent choice.
 *
 * Keys are looked up in a `Map` and a `Set`, never with `in` or an
 * object index. The parser returns a YAML key spelled `constructor`,
 * `toString` or `__proto__` as an ordinary own key, and an object
 * lookup would match it against `Object.prototype` instead.
 *
 * ## The parser, measured on bun 1.3.14
 *
 * `Bun.YAML.parse` is the whole parser; the repo takes no YAML
 * dependency. Six of its behaviours shape the rules above, each read
 * off the parser rather than its documentation:
 *
 *   - An empty file, a whitespace-only one, a comment-only one and a
 *     bare `---` all parse to `null`, and read as a file that says
 *     nothing.
 *   - A multi-document stream parses to a LIST of documents, which is
 *     refused with every other top level that is not a mapping.
 *   - A duplicated key is not an error: the last occurrence wins and
 *     the first leaves no trace, so nothing here can warn about it.
 *   - Malformed YAML throws a `SyntaxError` whose message carries no
 *     line or column. The refusal names the file; it cannot name the
 *     line.
 *   - A child indented with a TAB is not an error either: `plan:` over
 *     a tab-indented `inject: full` parses as `plan: null` beside a
 *     top-level `inject`. The unknown-key warning is the only signal
 *     that edit produces.
 *   - `yes` and `on` parse as strings, and `True` and `TRUE` as the
 *     boolean. So a `tracking` flag spelled `yes` is refused rather
 *     than read as true.
 *
 * ## Existence
 *
 * "When the file exists" is decided with `existsSync`, and the choice
 * is measured rather than habitual: `Bun.file(path).exists()` answers
 * false for a DIRECTORY, so a `.rafa/config.yaml` that is one would
 * pass for no config and the run would go on at defaults. Only absence
 * is absorbed — the rule `effort/store.ts` applies to its own files —
 * and anything at the path that cannot be read is refused.
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
  ConfigExtra,
  ConfigVersion,
  InjectMode,
  Mapping,
  ModuleSource,
  OptionalPrerequisiteItem,
  OutputMode,
  PrerequisiteItem,
  Reader,
  StoreBackend,
  ValueAt,
} from './config-sections.js';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CLAUDE_SETTING_SOURCES,
  CONFIG_VERSIONS,
  describeValue,
  flag,
  INJECT_MODES,
  isMapping,
  listOf,
  MODULE_SOURCE_KEYS,
  moduleSource,
  OPTIONAL_ITEM_KEYS,
  oneOf,
  optionalPrerequisite,
  OUTPUT_MODES,
  REQUIRED_ITEM_KEYS,
  requiredPrerequisite,
  STORE_BACKENDS,
  subsetOf,
  text,
} from './config-sections.js';

export type {
  ClaudeSettingSource,
  ConfigExtra,
  ConfigVersion,
  InjectMode,
  ModuleSource,
  ModuleSourceKind,
  OptionalPrerequisiteItem,
  OutputMode,
  PrerequisiteItem,
  PrerequisiteKind,
  StoreBackend,
} from './config-sections.js';
export {
  CLAUDE_SETTING_SOURCES,
  CONFIG_VERSIONS,
  INJECT_MODES,
  MODULE_SOURCE_KINDS,
  OUTPUT_MODES,
  PREREQUISITE_KINDS,
  STORE_BACKENDS,
} from './config-sections.js';

/**
 * The config file, relative to the repo root.
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

/** The layer that answered a setting. */
export type ConfigSource = 'cli' | 'file' | 'default';

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
});

/**
 * One layer's say on every setting: a value, or undefined for silence.
 *
 * Every key is REQUIRED, with undefined standing for silence, so a
 * setting added to {@link RafaConfig} is a compile error wherever a
 * layer is built rather than a setting some layer forgot.
 */
export type ConfigLayer = {
  readonly [K in ConfigSetting]: RafaConfig[K] | undefined;
};

/**
 * Command-line values as a flag parser hands them over: the raw string,
 * or undefined when the flag was not given. {@link resolveConfig}
 * validates them and refuses what the file would refuse, an empty
 * string included. A key naming no {@link CommandLineSetting} is not
 * read.
 */
export type ConfigOverrides = {
  readonly [K in CommandLineSetting]?: string | undefined;
};

/** What one config file said. */
export interface ConfigFile {
  /** The file, as the caller named it. */
  path: string;
  /** Its value for each setting, or undefined where it said nothing. */
  values: ConfigLayer;
  /** Every key that names no setting and opens no section. */
  extras: readonly ConfigExtra[];
}

/** The layers {@link resolveConfig} ranks, highest first. */
export interface ConfigLayers {
  /** Command-line values. Absent is the same as no flag given. */
  cli?: ConfigOverrides;
  /** The parsed file, or null when there is none. */
  file?: ConfigFile | null;
}

/** Every setting resolved, with the layer each value came from. */
export interface ResolvedConfig {
  /** The value each setting resolved to. */
  config: RafaConfig;
  /** The layer that answered each setting. */
  sources: Readonly<Record<ConfigSetting, ConfigSource>>;
  /** The file consulted, or null when there was none. */
  path: string | null;
  /** The file's unknown keys, retained. Empty with no file. */
  extras: readonly ConfigExtra[];
  /** One sentence per retained unknown key, for an operator to read. */
  warnings: readonly string[];
}

/**
 * A config the loop cannot run on: unreadable, not YAML, not a
 * mapping, or naming a value a setting does not accept.
 *
 * Its own class so a caller can tell a refusal it should print and
 * exit on from a fault it should not swallow.
 */
export class ConfigError extends Error {
  /** Every problem found, one sentence each. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[], options?: ErrorOptions) {
    super(`rafa config: ${problems.join('; ')}`, options);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** What the module knows about one setting. */
interface SettingSpec<K extends ConfigSetting> {
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
const SETTINGS: { readonly [K in ConfigSetting]: SettingSpec<K> } = {
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
};

/** Every setting name, read off the closed record above. */
const SETTING_NAMES = Object.keys(SETTINGS) as ConfigSetting[];

/** Setting names by the dotted key the file spells them with. */
const SETTING_BY_KEY: ReadonlyMap<string, ConfigSetting> = new Map(
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
const SECTIONS: ReadonlySet<string> = new Set(
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
function knownKeysAbove(key: string): [string, readonly string[]] {
  for (let parent = parentOf(key); parent !== ''; parent = parentOf(parent)) {
    const names = KNOWN_UNDER.get(parent.replace(TRAILING_INDEX, '[]'));
    if (names !== undefined) return [parent, names];
  }
  return ['', KNOWN_UNDER.get('') ?? []];
}

/** The message of whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** A layer read, with what its readers found. */
interface LayerReading {
  layer: ConfigLayer;
  problems: readonly string[];
  extras: readonly ConfigExtra[];
}

/**
 * Reads one raw value per setting into a layer. Undefined is silence;
 * any other value goes through the setting's reader at the place
 * `atOf` names.
 */
function readLayer(
  rawOf: (setting: ConfigSetting) => unknown,
  atOf: (setting: ConfigSetting) => ValueAt,
): LayerReading {
  const problems: string[] = [];
  const extras: ConfigExtra[] = [];
  const read = <K extends ConfigSetting>(
    setting: K,
  ): RafaConfig[K] | undefined => {
    const raw = rawOf(setting);
    if (raw === undefined) return undefined;

    const reading = SETTINGS[setting].read(raw, atOf(setting));
    problems.push(...reading.problems);
    extras.push(...reading.extras);
    return reading.value;
  };

  const layer: ConfigLayer = {
    version: read('version'),
    store: read('store'),
    inject: read('inject'),
    planDir: read('planDir'),
    specsDir: read('specsDir'),
    trackerDefault: read('trackerDefault'),
    trackerFallback: read('trackerFallback'),
    learningAdapter: read('learningAdapter'),
    outputMode: read('outputMode'),
    prerequisitesRequired: read('prerequisitesRequired'),
    prerequisitesOptional: read('prerequisitesOptional'),
    trackingSpecs: read('trackingSpecs'),
    trackingPlans: read('trackingPlans'),
    trackingAll: read('trackingAll'),
    modules: read('modules'),
    allowList: read('allowList'),
    settingSources: read('settingSources'),
  };
  return { layer, problems, extras };
}

/**
 * Every key in `mapping` as a dotted path, descending into each
 * section that holds a mapping. A section holding anything else is
 * yielded as itself, for the caller to judge.
 */
function* entriesOf(mapping: Mapping, prefix: string): Generator<ConfigExtra> {
  for (const [name, value] of Object.entries(mapping)) {
    const key = prefix === ''
      ? name
      : `${prefix}.${name}`;
    if (SECTIONS.has(key) && isMapping(value)) yield* entriesOf(value, key);
    else yield { key, value };
  }
}

/** A document's keys, sorted into what they are. */
interface SortedKeys {
  /** The raw non-null value of each setting the document named. */
  named: ReadonlyMap<ConfigSetting, unknown>;
  /** Keys naming no setting and opening no section, retained. */
  extras: readonly ConfigExtra[];
  /** Sections that are not mappings, and settings given twice. */
  problems: readonly string[];
}

/** Sorts every key of a parsed document. See the module note. */
function sortKeys(document: Mapping, path: string): SortedKeys {
  const named = new Map<ConfigSetting, unknown>();
  const seen = new Set<ConfigSetting>();
  const extras: ConfigExtra[] = [];
  const problems: string[] = [];

  for (const entry of entriesOf(document, '')) {
    const setting = SETTING_BY_KEY.get(entry.key);
    if (setting !== undefined) {
      if (seen.has(setting)) {
        problems.push(`${path}: ${entry.key} is given more than once`);
      } else if (entry.value !== null) {
        named.set(setting, entry.value);
      }
      seen.add(setting);
      continue;
    }

    if (!SECTIONS.has(entry.key)) {
      extras.push(entry);
      continue;
    }
    // A section reaches here only when it holds no mapping.
    if (entry.value !== null) {
      const found = describeValue(entry.value);
      problems.push(`${path}: ${entry.key} must be a mapping, found ${found}`);
    }
  }

  return { named, extras, problems };
}

/** Parses YAML, refusing text that is not YAML with the file named. */
function parseYaml(text: string, path: string): unknown {
  try {
    return Bun.YAML.parse(text);
  } catch (error) {
    const problem = `${path}: not valid YAML (${messageOf(error)})`;
    throw new ConfigError([problem], { cause: error });
  }
}

/** The config file's path under `root`. */
export function configFilePath(root: string): string {
  return join(root, CONFIG_FILE);
}

/**
 * Reads config text into one file layer. Pure: `path` only labels the
 * layer and the refusals.
 *
 * Throws a {@link ConfigError} naming every problem the text has — not
 * YAML, not a mapping at the top, a section that is not a mapping, a
 * setting given twice, a value a setting does not accept. An unknown
 * key is none of these: it is retained in {@link ConfigFile.extras},
 * the keys an item carried after the keys of the document.
 */
export function parseConfigText(text: string, path: string): ConfigFile {
  const document = parseYaml(text, path) ?? {};
  if (!isMapping(document)) {
    const found = describeValue(document);
    throw new ConfigError([
      `${path}: expected a mapping at the top level, found ${found}`,
    ]);
  }

  const sorted = sortKeys(document, path);
  const read = readLayer(
    (setting) => sorted.named.get(setting),
    (setting) => ({
      label: `${path}: ${SETTINGS[setting].key}`,
      key: SETTINGS[setting].key,
    }),
  );
  const all = [...sorted.problems, ...read.problems];
  if (all.length > 0) throw new ConfigError(all);

  return { path, values: read.layer, extras: [...sorted.extras, ...read.extras] };
}

/**
 * Reads `.rafa/config.yaml` under `root`, or answers null when nothing
 * is at that path. Anything there that cannot be read — a directory,
 * a file without read permission — is refused with a
 * {@link ConfigError} rather than read as absent; see the module note.
 */
export function readConfigFile(root: string): ConfigFile | null {
  const path = configFilePath(root);
  if (!existsSync(path)) return null;

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const problem = `${path}: cannot be read (${messageOf(error)})`;
    throw new ConfigError([problem], { cause: error });
  }
  return parseConfigText(text, path);
}

/** One setting's answer, and the layer that gave it. */
interface Ranked<K extends ConfigSetting> {
  value: RafaConfig[K];
  source: ConfigSource;
}

/** True for a setting a command line can name. */
function isCommandLineSetting(setting: ConfigSetting): setting is CommandLineSetting {
  return SETTINGS[setting].cli;
}

/** The sentence an operator reads about one retained unknown key. */
function unknownKeyWarning(key: string, path: string): string {
  const quoted = JSON.stringify(key);
  const [under, names] = knownKeysAbove(key);
  const where = under === ''
    ? ''
    : ` under ${under}`;
  return `rafa config: unknown key ${quoted} in ${path} has no effect `
    + `in this version (known keys${where}: ${names.join(', ')})`;
}

/**
 * Ranks the layers: for each setting, the command line over the file
 * and the file over {@link CONFIG_DEFAULTS}.
 *
 * Pure. Warnings come back as data — one per unknown key the file
 * retained — and are never printed here. A command-line value no
 * setting accepts throws a {@link ConfigError} naming every one, and
 * is never downgraded to the file's value: an operator who mistyped a
 * flag asked for something, and running on something else is the
 * silent success the module note refuses.
 */
export function resolveConfig(layers: ConfigLayers = {}): ResolvedConfig {
  const file = layers.file ?? null;
  const overrides = layers.cli ?? {};
  const { layer: cli, problems } = readLayer(
    (setting) => isCommandLineSetting(setting)
      ? overrides[setting]
      : undefined,
    (setting) => ({ label: `command line: ${setting}`, key: setting }),
  );
  if (problems.length > 0) throw new ConfigError(problems);

  const rank = <K extends ConfigSetting>(setting: K): Ranked<K> => {
    const fromCli = cli[setting];
    if (fromCli !== undefined) return { value: fromCli, source: 'cli' };
    const fromFile = file?.values[setting];
    if (fromFile !== undefined) return { value: fromFile, source: 'file' };
    return { value: CONFIG_DEFAULTS[setting], source: 'default' };
  };
  const ranked = SETTING_NAMES.map((setting) => [setting, rank(setting)] as const);
  const warnings = file === null
    ? []
    : file.extras.map((extra) => unknownKeyWarning(extra.key, file.path));

  return {
    config: Object.fromEntries(
      ranked.map(([setting, { value }]) => [setting, value]),
    ) as unknown as RafaConfig,
    sources: Object.fromEntries(
      ranked.map(([setting, { source }]) => [setting, source]),
    ) as Record<ConfigSetting, ConfigSource>,
    path: file?.path ?? null,
    extras: file?.extras ?? [],
    warnings,
  };
}

/** The default warning sink. */
function printWarning(message: string): void {
  console.warn(message);
}

/**
 * Reads the config under `root`, ranks it against `cli`, and prints a
 * warning per unknown key through `warn`.
 *
 * The file is read and judged before the command line is looked at,
 * so a run with problems in both reports the file's first.
 */
export function loadConfig(
  root: string,
  cli: ConfigOverrides = {},
  warn: (message: string) => void = printWarning,
): ResolvedConfig {
  const resolved = resolveConfig({ cli, file: readConfigFile(root) });
  for (const warning of resolved.warnings) warn(warning);
  return resolved;
}
