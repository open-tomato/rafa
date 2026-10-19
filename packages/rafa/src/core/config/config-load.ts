/**
 * Finding and reading rafa's config files, one per scope, and printing
 * what they warn about: the disk half of the config, over the pure half
 * in `config.ts`, which reads each file's document and ranks the layers.
 *
 * The file is `config-load.ts` and not `config/load.ts` for the reason
 * `config-sections.ts` gives: while both sat in `src/`, a `src/config/`
 * directory beside `config.ts` would have set the trap
 * `context/source.md` records for `./plan`.
 *
 * ## Two scopes, one file each
 *
 * The PROJECT scope sits at the repo root and the USER scope at
 * `~/.rafa/`, the two scopes of `.rafa/specs/phase-1-installable.md`.
 * Each is read from one file, the first of three that is a file:
 *
 * | Scope   | Directory | Looked up, in order                                        |
 * |---------|-----------|------------------------------------------------------------|
 * | user    | `~/.rafa` | `rafa.config.ts`, `rafa.config.mjs`, `config.yaml`         |
 * | project | the root  | `rafa.config.ts`, `rafa.config.mjs`, `.rafa/config.yaml`   |
 *
 * The YAML file of each scope is where it always was. The lists differ,
 * so each scope has a loader of its own: `createLoader` from
 * `@open-tomato/define-config` shares one lookup list across its layers.
 * {@link loadConfig} hands both files to `resolveConfig`, which ranks the
 * project's over the user's key by key, each over the default: a setting
 * neither file answers resolves to its default with source `default`,
 * and no record names it in `provenance`. The defaults are laid under
 * here, not as an entry of either file.
 *
 * A module file (`.ts` or `.mjs`) goes through `import()`, which is why
 * {@link loadConfig} is asynchronous. Its default export is a list of
 * entries or one entry, merged in order by define-config's `merge`; a
 * YAML file is one entry. `reload` is on, so a process that loads its
 * config twice sees an edit to a module file as it sees one to a YAML
 * file, at the cost of one module kept per distinct content.
 *
 * ## Shadowed files
 *
 * A scope holding a module file and its YAML file is read from the
 * module file alone. The YAML file is named in `shadowed` and warned
 * about once per load, since its keys stopped applying without a word.
 *
 * ## Reading a scope's file
 *
 * A file's mapping is read through `readConfigDocument` (`config.ts`),
 * the reading a YAML file has always had: unknown keys retained and
 * warned about, a setting given in two spellings refused, every value
 * judged by its reader. A YAML file's mapping is its document as the
 * host loader parsed it, the tab refusal of `parseConfigDocument` ahead
 * of `Bun.YAML.parse`, so a project on YAML reads exactly as it did.
 *
 * A module file's mapping is the merged value, with one repair. `merge`
 * treats `false` as "remove the key", and the merged value holds no
 * trace of it, but in rafa's files `false` is a value: `loop.tracking:
 * false`, or `routing.<shape>: false` shadowing a lower layer's route.
 * So every key whose last provenance record is `remove` is set back to
 * `false`, unless a later entry removed or replaced a mapping above it.
 * Within one file the later entry still wins. At an id of a keyed map
 * the map's own reader decides: `routing` and the `tiers` pins take
 * `false` as a value, so it is set back and shadows a lower layer's row
 * as a YAML file's does; `logger.modules` refuses it, so there it stays
 * the removal `src/config/entry.ts` documents, dropping what an earlier
 * entry gave that module.
 *
 * The section schemas (`standard-schema.ts`) validate the merged value
 * too. Their issues are the readers' own sentences, and a subset of what
 * `readConfigDocument` finds, which also judges a `false` and a flat
 * spelling; a scope is refused with the reading's problems, or with the
 * schema's where the reading found none. No file reaches that second
 * refusal while both judge through the same readers: turned off, it
 * reddens no case of `config-load.test.ts`. It is the guard against the
 * two drifting apart.
 *
 * ## Refusals
 *
 * Every refusal is a {@link ConfigError}, and each file is judged whole,
 * whatever outranks it: an unusable `store` in the user's file is refused
 * even where the project's names one, because the next project without
 * one would run on it. The user scope is read and judged first, then the
 * project's, then a key set twice in one file, and the command line last.
 *
 *   - `flows` and `steps` in the user layer, naming the layer and the
 *     file: a flow is a project's decision. In the project layer both are
 *     unknown keys until #119 defines them.
 *   - A module file that imports a module it cannot find, naming the
 *     file, the module and the install. A file whose rafa is installed
 *     globally finds no `@open-tomato/rafa` at run time; `import type`
 *     is erased before the file runs and needs nothing.
 *   - Any other file that cannot be loaded, naming it.
 *
 * ## Duplicates
 *
 * Two entries of one file setting one key is a `duplicate-key`
 * diagnostic, raised at `warn`. The level is then taken from the merged
 * `merge.duplicates`, the project file's over the user file's: `warn`
 * prints it, `error` refuses the load with every one, `allow` drops it.
 * The level is read off the files' mappings rather than a setting, so
 * one load decides it: define-config's loader takes its `duplicates`
 * option before it reads a file.
 *
 * A root that IS the home, compared after symlinks are followed, is read
 * as the project scope alone. Read as both, it would read
 * `~/.rafa/config.yaml` twice and warn twice about each unknown key.
 *
 * ## The home is a seam
 *
 * {@link loadConfig} takes the home as an argument and never looks it
 * up. A command entry passes `homedir()`, and a test passes a directory
 * of its own. There is no default, so a caller that leaves the home out
 * fails loudly rather than reading the real `~/.rafa/`: measured on bun
 * 1.3.14, `isAbsolute(undefined)` throws a `TypeError`. That is what
 * holds the suite off the operator's home.
 *
 * A home that is not an absolute path is refused with a
 * {@link ConfigError}. Measured on bun 1.3.14, `homedir()` hands a
 * relative `HOME` back as written, `HOME=rel/home` answering `rel/home`,
 * and a file read under it would be whatever the working directory
 * holds at that path. An empty `HOME` never arrives here: `homedir()`
 * answers the account's home for it.
 *
 * ## The store's settings
 *
 * {@link loadConfig} is the one place a command's config is resolved
 * from its files, so it is where the effort store learns its
 * `effort.busyTimeoutMs`: every call sets the store's active settings
 * to the value it resolved. The store opens far below any config, in
 * the dozen writers and readers that call `withSqliteStore`, and a
 * value threaded down to each would be an argument none of them uses.
 * A command that never loads its config opens its store with the
 * default.
 *
 * ## Existence
 *
 * define-config's lookup passes over a directory at a lookup name. Only
 * absence is absorbed here — the rule `effort/store/ndjson-files.ts`
 * applies to its own files — so a scope whose loader found no file, while something
 * stands at one of its names, is refused naming it: a
 * `.rafa/config.yaml` that is a directory would otherwise pass for no
 * config, and the run would go on at defaults. {@link readConfigFile}
 * reads the YAML file alone by the same rule, deciding existence with
 * `existsSync`: `Bun.file(path).exists()` answers false for a directory.
 */
import type { ConfigScopeName, ShadowedFile } from './config-origins.js';
import type { DuplicatesLevel, Mapping } from './config-sections.js';
import type { ConfigFile, ConfigOverrides, ConfigSetting, ResolvedConfig } from './config.js';
import type { Diagnostic, LoadResult, Provenance } from '@open-tomato/define-config';

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';

import { createLoader } from '@open-tomato/define-config';

import { setActiveStoreSettings } from '../../effort/store/settings.js';
import { activeOutput } from '../output/active.js';

import { describeValue, DUPLICATE_LEVELS, isMapping, messageOf } from './config-sections.js';
import {
  CONFIG_FILE,
  ConfigError,
  configFilePath,
  parseConfigDocument,
  parseConfigText,
  readConfigDocument,
  resolveConfig,
} from './config.js';
import { writeDangerousPassLines } from './dangerous.js';
import { activeConfigLoadHook, activeSections, activeSettingByKey, activeSettings } from './section.js';
import { schemaSectionsOf } from './standard-schema.js';

/** The two directories {@link loadConfig} reads a config file under. */
export interface ConfigRoots {
  /** The project root: its scope's files sit here and under its `.rafa/`. */
  readonly root: string;
  /** The home directory: the user scope's files sit under its `.rafa/`. */
  readonly home: string;
}

/** The module files a scope is looked up for, ahead of its YAML file. */
const MODULE_FILES: readonly string[] = ['rafa.config.ts', 'rafa.config.mjs'];

/** The package a config module imports its types from. */
const RAFA_PACKAGE = '@open-tomato/rafa';

/** The keys only a project's file may hold; see the module note. */
const PROJECT_ONLY_KEYS: readonly string[] = ['flows', 'steps'];

/** One scope to read: its layer, its directory and its lookup names, the YAML file last. */
interface ScopePlace {
  readonly layer: ConfigScopeName;
  readonly dir: string;
  readonly lookup: readonly string[];
}

/** What the YAML host loader made of one file: its document, or the refusal. */
type YamlRead = { readonly document: unknown } | { readonly error: unknown };

/** One scope, read and judged. */
interface ScopeReading {
  /** The file read, or null when the scope holds none. */
  readonly file: ConfigFile | null;
  /** The file's mapping, as {@link ScopeReading.file} was read from. */
  readonly mapping: Mapping;
  /** One line per key two entries of the file set, the file named. */
  readonly duplicates: readonly string[];
  /** The YAML file the module file left unread, or null. */
  readonly shadowed: ShadowedFile | null;
}

/** A scope that holds no file. */
const NO_FILE: ScopeReading = Object.freeze({
  file: null,
  mapping: Object.freeze({}),
  duplicates: Object.freeze([]),
  shadowed: null,
});

/**
 * Reads `.rafa/config.yaml` under `root`, or answers null when nothing
 * is at that path. Anything there that cannot be read — a directory,
 * a file without read permission — is refused with a
 * {@link ConfigError} rather than read as absent; see the module note.
 * Reads the YAML file alone: {@link loadConfig} is what looks up a
 * scope's module files.
 */
export function readConfigFile(root: string): ConfigFile | null {
  const path = configFilePath(root);
  if (!existsSync(path)) return null;
  return parseConfigText(readOrRefuse(path), path);
}

/** The text at `path`, or a {@link ConfigError} naming why it cannot be read. */
function readOrRefuse(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const problem = `${path}: cannot be read (${messageOf(error)})`;
    throw new ConfigError([problem], { cause: error });
  }
}

/**
 * True when both paths name one existing directory, symlinks followed.
 * A path that does not resolve holds no config file, so reading it as
 * a directory of its own reads nothing twice.
 */
function isSameDirectory(first: string, second: string): boolean {
  try {
    return realpathSync(first) === realpathSync(second);
  } catch {
    return false;
  }
}

/**
 * The scopes to read, the user's first: none for the user when the home
 * is the root. Refuses a home that is not an absolute path; see the
 * module note.
 */
function scopesOf({ root, home }: ConfigRoots): readonly ScopePlace[] {
  if (!isAbsolute(home)) {
    throw new ConfigError([
      `home directory is ${describeValue(home)}, expected an absolute path`,
    ]);
  }
  const project: ScopePlace = { layer: 'project', dir: root, lookup: [...MODULE_FILES, CONFIG_FILE] };
  if (isSameDirectory(root, home)) return [project];
  const user: ScopePlace = {
    layer: 'user',
    dir: join(home, dirname(CONFIG_FILE)),
    lookup: [...MODULE_FILES, basename(CONFIG_FILE)],
  };
  return [user, project];
}

/**
 * The host loader for `.yaml`: the document `parseConfigDocument`
 * parses, held in `held` by path with any refusal, and handed to the
 * loader as one entry. A document that is not a mapping is handed over
 * as an empty one, so the loader reads no list of documents as entries;
 * `readConfigDocument` refuses it from `held`.
 */
function yamlLoader(held: Map<string, YamlRead>): (text: string, path: string) => unknown {
  return (text, path) => {
    try {
      const document = parseConfigDocument(text, path);
      held.set(path, { document });
      return isMapping(document)
        ? document
        : {};
    } catch (error) {
      held.set(path, { error });
      throw error;
    }
  };
}

/** True for a YAML file, read by the host loader rather than `import()`. */
function isYamlFile(path: string): boolean {
  return extname(path) === '.yaml';
}

/**
 * The package a bare specifier installs, or null for a relative, an
 * absolute or a `node:` one.
 */
function packageOf(specifier: string): string | null {
  if (/^(?:[./]|node:)/.test(specifier)) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : parts[0] ?? null;
}

/** The refusal of a module file importing `specifier`, which cannot be found from it. */
function missingModuleProblem(path: string, specifier: string): string {
  const installed = packageOf(specifier);
  const install = installed === null
    ? ''
    : `; install ${installed} in the project (bun add -d ${installed})`;
  const typesOnly = installed === RAFA_PACKAGE
    ? `, or import its types alone (import type { Config } from '${RAFA_PACKAGE}/config'), which need nothing at run time`
    : '';
  return `${path}: imports ${specifier}, which cannot be found from this file${install}${typesOnly}`;
}

/** The {@link ConfigError} a `load-failed` diagnostic for the file at `path` turns into. */
function loadRefusal(path: string, diagnostic: Diagnostic, held: YamlRead | undefined): ConfigError {
  if (held !== undefined && 'error' in held) {
    return held.error instanceof ConfigError
      ? held.error
      : new ConfigError([`${path}: ${messageOf(held.error)}`], { cause: held.error });
  }
  if (isYamlFile(path)) {
    // The host loader never ran, so reading the file failed: read it
    // again for the error itself, as `readConfigFile` names it.
    readOrRefuse(path);
    return new ConfigError([`${path}: ${diagnostic.message}`]);
  }
  const missing = /Cannot find (?:module|package) ['"]([^'"]+)['"]/.exec(diagnostic.message);
  return missing?.[1] === undefined
    ? new ConfigError([`${path}: cannot be loaded (${diagnostic.message})`])
    : new ConfigError([missingModuleProblem(path, missing[1])]);
}

/**
 * Refuses a scope whose loader found no file while something stands at
 * one of its lookup names; see the module note.
 */
function refuseUnreadableName(place: ScopePlace): void {
  for (const name of place.lookup) {
    const path = join(place.dir, name);
    if (existsSync(path)) readOrRefuse(path);
  }
}

/** True when a later entry than `entry` removed or replaced a mapping above `path`. */
function wipedAbove(path: string, entry: number, provenance: Provenance): boolean {
  const parts = path.split('.');
  return parts.some((_, depth) => {
    const records = provenance.get(parts.slice(0, depth).join('.')) ?? [];
    return records.some((record) => record.entry > entry && record.kind !== 'set');
  });
}

/** `mapping` with `false` at `path`, where every mapping above it stands and the key is absent. */
function withFalseAt(mapping: Mapping, path: readonly string[]): Mapping {
  const [head, ...rest] = path;
  if (head === undefined) return mapping;
  const present = Object.hasOwn(mapping, head);
  if (rest.length === 0) {
    return present
      ? mapping
      : { ...mapping, [head]: false };
  }
  const child = present
    ? mapping[head]
    : undefined;
  return isMapping(child)
    ? { ...mapping, [head]: withFalseAt(child, rest) }
    : mapping;
}

/**
 * False when `path` is an id of a keyed map whose reader refuses `false`
 * there, such as `logger.modules.<module>`: a `false` at such an id
 * removes it, as `src/config/entry.ts` documents. True anywhere else.
 */
function isFalseAValueAt(path: readonly string[]): boolean {
  const setting = activeSettingByKey().get(path.slice(0, -1).join('.'));
  const spec = setting === undefined
    ? undefined
    : activeSettings()[setting];
  const id = path.at(-1);
  if (spec === undefined || id === undefined) return true;
  return spec.read({ [id]: false }, { label: spec.key, key: spec.key }).problems.length === 0;
}

/** A module file's merged value with each `false` the merge removed set back; see the module note. */
function restoredMapping({ config, provenance }: LoadResult): Mapping {
  const removed = [...provenance]
    .flatMap(([path, records]) => {
      const last = records.at(-1);
      return path === '' || last?.kind !== 'remove' || wipedAbove(path, last.entry, provenance)
        ? []
        : [path.split('.')];
    })
    .filter(isFalseAValueAt)
    .sort((first, second) => first.length - second.length);
  return removed.reduce(withFalseAt, config);
}

/**
 * The last entry that touched each registered setting of a module file,
 * its key or a key below it: what `provenance` names.
 */
function entriesOf(provenance: Provenance): ReadonlyMap<ConfigSetting, number> {
  const entries = new Map<ConfigSetting, number>();
  for (const [setting, spec] of Object.entries(activeSettings())) {
    if (spec === undefined) continue;
    const below = `${spec.key}.`;
    for (const [path, records] of provenance) {
      if (path !== spec.key && !path.startsWith(below)) continue;
      const last = Math.max(...records.map((record) => record.entry));
      entries.set(setting as ConfigSetting, Math.max(last, entries.get(setting as ConfigSetting) ?? 0));
    }
  }
  return entries;
}

/** Refuses `flows` or `steps` in the user layer, naming the layer and the file. */
function refuseProjectOnlyKeys(place: ScopePlace, path: string, mapping: Mapping): void {
  if (place.layer !== 'user') return;
  const keys = Object.keys(mapping);
  const found = PROJECT_ONLY_KEYS.filter((name) => keys.some((key) => key === name || key.startsWith(`${name}.`)));
  if (found.length === 0) return;
  throw new ConfigError(found.map((name) => `${path}: ${name} is refused in the user layer; `
    + `${name} are a project's decision and belong in the project's config file`));
}

/** The YAML file a module file at `path` leaves unread in `place`, or null. */
function shadowedBy(place: ScopePlace, path: string): ShadowedFile | null {
  if (isYamlFile(path)) return null;
  const yaml = join(place.dir, place.lookup.at(-1) ?? CONFIG_FILE);
  try {
    return statSync(yaml).isFile()
      ? Object.freeze({ layer: place.layer, path: yaml, by: path })
      : null;
  } catch {
    return null;
  }
}

/**
 * Runs `place`'s loader. A lookup that fails other than by absence, a
 * directory it cannot search, is refused naming the path.
 */
async function loadScope(place: ScopePlace, held: Map<string, YamlRead>): Promise<LoadResult> {
  const loader = createLoader({
    lookup: place.lookup,
    layers: [{ layer: place.layer, dir: place.dir }],
    schema: schemaSectionsOf(activeSections()),
    loaders: { '.yaml': yamlLoader(held) },
    duplicates: 'warn',
    reload: true,
  });
  try {
    return await loader.load(place.dir);
  } catch (error) {
    const at = (error as { path?: unknown } | null)?.path;
    const where = typeof at === 'string'
      ? at
      : place.dir;
    throw new ConfigError([`${where}: cannot be looked up (${messageOf(error)})`], { cause: error });
  }
}

/** Reads and judges one scope's file; see the module note. */
async function readScope(place: ScopePlace): Promise<ScopeReading> {
  const held = new Map<string, YamlRead>();
  const result = await loadScope(place, held);
  const source = result.sources[0];
  if (source === undefined) {
    refuseUnreadableName(place);
    return NO_FILE;
  }
  const { path } = source;
  const failure = result.diagnostics.find((diagnostic) => diagnostic.code === 'load-failed');
  if (failure !== undefined) throw loadRefusal(path, failure, held.get(path));

  const yaml = held.get(path);
  const document = yaml !== undefined && 'document' in yaml
    ? yaml.document
    : restoredMapping(result);
  if (isMapping(document)) refuseProjectOnlyKeys(place, path, document);
  const read = readConfigDocument(document, path);
  const schema = result.diagnostics.filter((diagnostic) => diagnostic.code === 'schema');
  if (schema.length > 0) throw new ConfigError(schema.map((diagnostic) => `${path}: ${diagnostic.message}`));

  return {
    file: yaml === undefined
      ? { ...read, entries: entriesOf(result.provenance) }
      : read,
    mapping: isMapping(document)
      ? document
      : {},
    duplicates: result.diagnostics
      .filter((diagnostic) => diagnostic.code === 'duplicate-key')
      .map((diagnostic) => `${path}: ${diagnostic.message}`),
    shadowed: shadowedBy(place, path),
  };
}

/** The `merge.duplicates` a mapping names, nested or flat, or undefined. */
function duplicatesLevelIn(mapping: Mapping): DuplicatesLevel | undefined {
  const section = Object.hasOwn(mapping, 'merge')
    ? mapping.merge
    : undefined;
  const raw = Object.hasOwn(mapping, 'merge.duplicates')
    ? mapping['merge.duplicates']
    : isMapping(section) && Object.hasOwn(section, 'duplicates')
      ? section.duplicates
      : undefined;
  return DUPLICATE_LEVELS.find((level) => level === raw);
}

/**
 * The duplicate-key lines to warn about at the merged level, the
 * project file's `merge.duplicates` over the user file's, or a
 * {@link ConfigError} with every one at `error`.
 */
function duplicateWarnings(readings: readonly ScopeReading[]): readonly string[] {
  const level = [...readings].reverse()
    .map((reading) => duplicatesLevelIn(reading.mapping))
    .find((named) => named !== undefined) ?? 'warn';
  const lines = readings.flatMap((reading) => reading.duplicates);
  if (level === 'allow' || lines.length === 0) return [];
  if (level === 'error') throw new ConfigError(lines);
  return lines.map((line) => `rafa config: ${line}`);
}

/** The sentence an operator reads about one shadowed YAML file. */
function shadowWarning({ layer, path, by }: ShadowedFile): string {
  return `rafa config: ${path} is not read: ${by} holds the ${layer} scope's config, `
    + `so move its keys into ${basename(by)} and remove it`;
}

/**
 * The default warning sink: the active output's `warn`
 * (`core/output/active.ts`), read at each warning, so a command
 * under the dispatcher warns through its invocation's output.
 */
function printWarning(message: string): void {
  activeOutput().warn(message);
}

/**
 * Reads the user scope's file under `roots.home` and the project's
 * under `roots.root`, ranks both against `cli`, and prints a warning
 * per shadowed YAML file, per key set twice in one file and per unknown
 * key through `warn`, the active output's `warn` when none is given.
 * After them it writes one pass line per `dangerous.*` key set off its
 * default (`dangerous.ts`), once per invocation: the active output's
 * when `warn` is the default, the sink's own when one is given.
 *
 * The resolved config is handed to the load hook (`activeConfigLoadHook`
 * in `section.ts`) before any warning is printed. The registry,
 * `src/config-registry.ts`, sets that hook to hand the logger
 * (`adapters/logger/settings.ts`) its `logger` settings, so a
 * `logger.level` of `error` also quiets the warnings of the load that
 * set it. With no hook set the logger keeps the settings it had.
 *
 * The resolved `effort.busyTimeoutMs` is handed to the effort store
 * (`effort/store/settings.ts`), so every store open after this call
 * waits that long for a lock.
 *
 * The files are read and judged before the command line is looked at,
 * the user's first, so a run with problems in all three reports the
 * user file's alone. See the module note for the home, the lookup and
 * every refusal.
 *
 * @returns The resolution, with `provenance` naming the file and entry
 *   of each setting a file answered, and `shadowed` the YAML files a
 *   module file left unread.
 */
export async function loadConfig(
  roots: ConfigRoots,
  cli: ConfigOverrides = {},
  warn: (message: string) => void = printWarning,
): Promise<ResolvedConfig> {
  if (Object.keys(activeSettings()).length === 0) {
    throw new Error('no config section is registered: call registerCoreConfigSections from src/config-registry.ts before loadConfig');
  }
  const places = scopesOf(roots);
  const readings = new Map<ConfigScopeName, ScopeReading>();
  for (const place of places) readings.set(place.layer, await readScope(place));
  const all = [...readings.values()];
  const duplicates = duplicateWarnings(all);
  const resolved = resolveConfig({
    cli,
    file: readings.get('project')?.file ?? null,
    user: readings.get('user')?.file ?? null,
  });
  const shadowed = all.flatMap((reading) => reading.shadowed ?? []);
  const loaded: ResolvedConfig = {
    ...resolved,
    shadowed,
    warnings: [...shadowed.map(shadowWarning), ...duplicates, ...resolved.warnings],
  };
  activeConfigLoadHook()?.(loaded.config);
  for (const warning of loaded.warnings) warn(warning);
  writeDangerousPassLines(loaded, warn, warn === printWarning
    ? activeOutput()
    : warn);
  setActiveStoreSettings({ busyTimeoutMs: loaded.config.effortBusyTimeoutMs });
  return loaded;
}
