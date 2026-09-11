/**
 * Reading rafa's phase-0 settings: `store` and `plan.inject`.
 *
 * Two settings, three layers, one rule. A setting takes the value the
 * COMMAND LINE gave it, else the value `.rafa/config.yaml` gave it,
 * else its default — `sqlite` for `store`, `stage` for `plan.inject`.
 * Each setting is ranked on its own, so a flag naming one leaves the
 * other to the file, and {@link ResolvedConfig.sources} records which
 * layer answered each. That record is what keeps precedence observable
 * when two layers agree: a file spelling the default still reports
 * `file`, where the value alone could not tell a file that was read
 * from one that was skipped.
 *
 * The surface is minimal on purpose. Phase 1 owns scope resolution — a
 * user-level config beside the project's, `rafa init` — and the full
 * schema. This module answers the two questions phase 0 asks, from the
 * one file phase 0 reads, under a root its caller supplies.
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
 *     lands in {@link ConfigFile.extras} under its dotted path
 *     (`tracker`, `plan.depth`) with the value it carried, and acts on
 *     nothing. A file written for a later phase names keys this one
 *     has never heard of; refusing them would make every addition to
 *     the schema a breaking change for older installs. That is the
 *     reason `utils/declaration.ts` keeps an unrecognised declaration
 *     key in its `extras`, and it holds here unchanged.
 *   - An UNUSABLE value for a key this module DOES answer to is
 *     refused with a {@link ConfigError}. `store: postgres` asks for a
 *     backend nothing here provides, and falling back to the default
 *     would write rows into a store other than the one the operator
 *     named — a silent success, the failure the collector refuses an
 *     unrecognised argument to prevent. Every problem is collected
 *     before the throw, so one run names all of them.
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
 * dependency. Five of its behaviours shape the rules above, each read
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
 * {@link CONFIG_DEFAULTS} spells both defaults once. The cutover runs
 * one plan under `full` and again under `stage`; should that
 * comparison argue for `full`, the change is that one line.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The config file, relative to the repo root.
 *
 * `join` rather than a literal, as `effort/store.ts` spells its own
 * directory, so a path built here compares equal to one a caller built
 * with `join` of its own.
 */
export const CONFIG_FILE = join('.rafa', 'config.yaml');

/** Backends the effort store can be selected as. */
export const STORE_BACKENDS = ['sqlite', 'ndjson'] as const;

/** One of the two effort-store backends. */
export type StoreBackend = (typeof STORE_BACKENDS)[number];

/** How much of the plan a task session is handed, widest first. */
export const INJECT_MODES = ['full', 'stage', 'task'] as const;

/** One of the three injection modes. */
export type InjectMode = (typeof INJECT_MODES)[number];

/** Every setting phase 0 reads, resolved. */
export interface RafaConfig {
  /** The backend the effort store writes through. File key `store`. */
  store: StoreBackend;
  /**
   * How much of the plan a task prompt receives. File key
   * `plan.inject`; the field drops the section, so a caller reads
   * `config.inject`.
   */
  inject: InjectMode;
}

/** The name of one setting, as a field of {@link RafaConfig}. */
export type ConfigSetting = keyof RafaConfig;

/** The layer that answered a setting. */
export type ConfigSource = 'cli' | 'file' | 'default';

/** What every setting resolves to when no layer names it. */
export const CONFIG_DEFAULTS: Readonly<RafaConfig> = Object.freeze({
  store: 'sqlite',
  inject: 'stage',
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
 * string included.
 */
export type ConfigOverrides = {
  readonly [K in ConfigSetting]?: string | undefined;
};

/** One key the file carried that names no setting. */
export interface ConfigExtra {
  /** Dotted path from the top of the file: `tracker`, `plan.depth`. */
  key: string;
  /**
   * The value exactly as the parser returned it. Never serialised
   * here: a YAML alias can make it cyclic.
   */
  value: unknown;
}

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
  /** Every value it accepts, in the order a refusal lists them. */
  values: readonly RafaConfig[K][];
}

/**
 * Every setting, by name.
 *
 * A mapped record rather than a list so the set is closed: a field
 * added to {@link RafaConfig} without an entry here does not compile.
 */
const SETTINGS: { readonly [K in ConfigSetting]: SettingSpec<K> } = {
  store: { key: 'store', values: STORE_BACKENDS },
  inject: { key: 'plan.inject', values: INJECT_MODES },
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

/** The file keys a warning lists as the ones this version reads. */
const KNOWN_KEYS = [...SETTING_BY_KEY.keys()].join(', ');

/** A plain mapping, as the parser returns one. */
type Mapping = Readonly<Record<string, unknown>>;

/** True for a mapping; false for a list, a scalar or null. */
function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value as a refusal quotes it. Never serialises a collection. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return String(value);
}

/** The message of whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** The value `setting` accepts that `raw` is, or null when it is none. */
function acceptedValue<K extends ConfigSetting>(
  setting: K,
  raw: unknown,
): RafaConfig[K] | null {
  const accepted = SETTINGS[setting].values.find((value) => value === raw);
  return accepted ?? null;
}

/**
 * Narrows one raw value per setting into a layer. Undefined is
 * silence; any other value the setting does not accept becomes a
 * problem, prefixed with the label `labelOf` gives the setting.
 */
function readLayer(
  rawOf: (setting: ConfigSetting) => unknown,
  labelOf: (setting: ConfigSetting) => string,
): { layer: ConfigLayer; problems: string[] } {
  const problems: string[] = [];
  const read = <K extends ConfigSetting>(
    setting: K,
  ): RafaConfig[K] | undefined => {
    const raw = rawOf(setting);
    if (raw === undefined) return undefined;

    const accepted = acceptedValue(setting, raw);
    if (accepted !== null) return accepted;

    const expected = SETTINGS[setting].values.join(', ');
    problems.push(
      `${labelOf(setting)} is ${describeValue(raw)}, expected one of: ${expected}`,
    );
    return undefined;
  };

  const layer: ConfigLayer = { store: read('store'), inject: read('inject') };
  return { layer, problems };
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
 * key is none of these: it is retained in {@link ConfigFile.extras}.
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
  const { layer, problems } = readLayer(
    (setting) => sorted.named.get(setting),
    (setting) => `${path}: ${SETTINGS[setting].key}`,
  );
  const all = [...sorted.problems, ...problems];
  if (all.length > 0) throw new ConfigError(all);

  return { path, values: layer, extras: sorted.extras };
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

/** The command line over the file, the file over the default. */
function rank<K extends ConfigSetting>(
  setting: K,
  cli: RafaConfig[K] | undefined,
  file: RafaConfig[K] | undefined,
): Ranked<K> {
  if (cli !== undefined) return { value: cli, source: 'cli' };
  if (file !== undefined) return { value: file, source: 'file' };
  return { value: CONFIG_DEFAULTS[setting], source: 'default' };
}

/** The sentence an operator reads about one retained unknown key. */
function unknownKeyWarning(key: string, path: string): string {
  const quoted = JSON.stringify(key);
  return `rafa config: unknown key ${quoted} in ${path} has no effect `
    + `in this version (known keys: ${KNOWN_KEYS})`;
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
    (setting) => overrides[setting],
    (setting) => `command line: ${setting}`,
  );
  if (problems.length > 0) throw new ConfigError(problems);

  const store = rank('store', cli.store, file?.values.store);
  const inject = rank('inject', cli.inject, file?.values.inject);
  const warnings = file === null
    ? []
    : file.extras.map((extra) => unknownKeyWarning(extra.key, file.path));

  return {
    config: { store: store.value, inject: inject.value },
    sources: { store: store.source, inject: inject.source },
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
