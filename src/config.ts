/**
 * Reading rafa's settings: the phase 1 schema of `.rafa/config.yaml`.
 *
 * Every setting takes the value the COMMAND LINE gave it, else the
 * value the project's `.rafa/config.yaml` gave it, else the value the
 * user scope's `~/.rafa/config.yaml` gave it, else its default. Each
 * setting is ranked on its own, so a flag naming one leaves the others
 * to the files and a project file naming one leaves the others to the
 * user's, and {@link ResolvedConfig.sources} records which layer
 * answered each. That record keeps precedence observable when two
 * layers agree: a file spelling the default still reports `file`, where
 * the value alone could not tell a file that was read from one that was
 * skipped. `file` names the project's file, as it did when that was the
 * only file read, and `user` names the user scope's.
 *
 * This module is the pure half: text into a layer, layers into one
 * resolution. Finding and reading the two files, behind a home seam, is
 * `config-load.ts`. Scope resolution and `rafa init` are not here.
 *
 * ## Where the rules live
 *
 * The reader is three modules, and a name moving between them is a
 * refactor, never a change of behaviour. This file is the whole public
 * surface: everything the other two export that a caller reads is
 * re-exported here, so nothing outside the trio imports a sibling.
 *
 *   - `config-sections.ts` holds every rule about a VALUE: the readers,
 *     the closed lists of values, the prerequisite item and module
 *     source shapes, and why nothing is coerced.
 *   - `config-schema.ts` holds every rule about a KEY: {@link RafaConfig}
 *     and its file keys, {@link CONFIG_DEFAULTS}, {@link CONFIG_FILE},
 *     the setting specs, and the section and known-key indexes built off
 *     them. The four readings the spec leaves to the reader — open
 *     tracker kinds, empty prerequisite tiers, `version: 1` alone, and
 *     `loop.settingSources` as an ordered list — are argued there.
 *   - This module holds the rules about LAYERS: which layer answers a
 *     setting, what a file may carry, and what is refused.
 *
 * The split is what keeps each under the 800-line cap of
 * `context/source.md`, which no gate reads. Measured with `wc -l` at the
 * commit that split them: `config.ts` is 488 lines and
 * `config-schema.ts` is 330. A new setting is one field, one default and
 * one spec in `config-schema.ts`, and one line in {@link readLayer}'s
 * layer literal here; the literal is exhaustive on purpose, so a setting
 * added there and forgotten here does not compile.
 *
 * {@link parseConfigText} turns YAML text into one file layer and
 * {@link resolveConfig} ranks the layers. Both are pure, so every
 * precedence case is tested without a disk. The only read and the only
 * place that prints are in `config-load.ts`.
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
 * Every key here is looked up in the `Map` and the `Set`
 * `config-schema.ts` builds, never with `in` or an object index; the
 * reason is argued there.
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
 */
import type {
  CommandLineSetting,
  ConfigSetting,
  RafaConfig,
} from './config-schema.js';
import type {
  ConfigExtra,
  Mapping,
  ValueAt,
} from './config-sections.js';

import { join } from 'node:path';

import {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  isCommandLineSetting,
  knownKeysAbove,
  SECTIONS,
  SETTING_BY_KEY,
  SETTING_NAMES,
  SETTINGS,
} from './config-schema.js';
import {
  describeValue,
  isMapping,
  messageOf,
} from './config-sections.js';

export type {
  CommandLineSetting,
  ConfigSetting,
  RafaConfig,
} from './config-schema.js';
export { CONFIG_DEFAULTS, CONFIG_FILE } from './config-schema.js';
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
 * The layer that answered a setting: the command line, the project's
 * file, the user scope's file, or the default.
 */
export type ConfigSource = 'cli' | 'file' | 'user' | 'default';

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
  /** The project's parsed file, or null when there is none. */
  file?: ConfigFile | null;
  /** The user scope's parsed file, or null when there is none. */
  user?: ConfigFile | null;
}

/** Every setting resolved, with the layer each value came from. */
export interface ResolvedConfig {
  /** The value each setting resolved to. */
  config: RafaConfig;
  /** The layer that answered each setting. */
  sources: Readonly<Record<ConfigSetting, ConfigSource>>;
  /** The project's file consulted, or null when there was none. */
  path: string | null;
  /** The user scope's file consulted, or null when there was none. */
  userPath: string | null;
  /** The project file's unknown keys, retained. Empty with no file. */
  extras: readonly ConfigExtra[];
  /** The user file's unknown keys, retained. Empty with no file. */
  userExtras: readonly ConfigExtra[];
  /** One sentence per retained unknown key, the user file's first. */
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

/** One setting's answer, and the layer that gave it. */
interface Ranked<K extends ConfigSetting> {
  value: RafaConfig[K];
  source: ConfigSource;
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
 * Ranks the layers: for each setting, the command line over the
 * project's file, the project's over the user scope's, and the user's
 * over {@link CONFIG_DEFAULTS}.
 *
 * Pure. Warnings come back as data — one per unknown key either file
 * retained, the user file's first — and are never printed here. A command-line value no
 * setting accepts throws a {@link ConfigError} naming every one, and
 * is never downgraded to the file's value: an operator who mistyped a
 * flag asked for something, and running on something else is the
 * silent success the module note refuses.
 */
export function resolveConfig(layers: ConfigLayers = {}): ResolvedConfig {
  const file = layers.file ?? null;
  const user = layers.user ?? null;
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
    const fromUser = user?.values[setting];
    if (fromUser !== undefined) return { value: fromUser, source: 'user' };
    return { value: CONFIG_DEFAULTS[setting], source: 'default' };
  };
  const ranked = SETTING_NAMES.map((setting) => [setting, rank(setting)] as const);
  const warnings = [user, file].flatMap((layer) => layer === null
    ? []
    : layer.extras.map((extra) => unknownKeyWarning(extra.key, layer.path)));

  return {
    config: Object.fromEntries(
      ranked.map(([setting, { value }]) => [setting, value]),
    ) as unknown as RafaConfig,
    sources: Object.fromEntries(
      ranked.map(([setting, { source }]) => [setting, source]),
    ) as Record<ConfigSetting, ConfigSource>,
    path: file?.path ?? null,
    userPath: user?.path ?? null,
    extras: file?.extras ?? [],
    userExtras: user?.extras ?? [],
    warnings,
  };
}
