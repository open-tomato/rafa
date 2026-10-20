/**
 * Finding and reading rafa's config files, two per scope, and printing
 * what they warn about: the disk half of the config, over the pure half
 * in `config.ts`, which reads each file's document and ranks the layers.
 *
 * The file is `config-load.ts` and not `config/load.ts` for the reason
 * `config-sections.ts` gives: while both sat in `src/`, a `src/config/`
 * directory beside `config.ts` would have set the trap
 * `context/source.md` records for `./plan`. The helpers a module file is
 * read through sit beside it in `config-load-module.ts`.
 *
 * ## Two scopes, two layers each
 *
 * The PROJECT scope sits at the repo root and the USER scope at
 * `~/.rafa/`, the two scopes of `.rafa/specs/phase-1-installable.md`.
 * Each is read from two places, its MODULE place and its LOCAL place
 * over it:
 *
 * | Scope   | Directory | Module place, first that is a file      | Local place          |
 * |---------|-----------|-----------------------------------------|----------------------|
 * | user    | `~/.rafa` | `rafa.config.ts`, `rafa.config.mjs`     | `config.yaml`        |
 * | project | the root  | `rafa.config.ts`, `rafa.config.mjs`     | `.rafa/config.yaml`  |
 *
 * The YAML file of each scope is where it always was. Each place has a
 * loader of its own: `createLoader` from `@open-tomato/define-config`
 * shares one lookup list across its layers, and the two places of a
 * scope are two layers that list could not tell apart. {@link loadConfig}
 * hands the four files to `resolveConfig`: the project's YAML file as
 * `local`, its module file as `file`, the user scope's YAML file as
 * `userLocal` and its module file as `user`. `resolveConfig` ranks them
 * in that order key by key, each over the default: a setting no file
 * answers resolves to its default with source `default`, and no record
 * names it in `provenance`. The defaults are laid under there, not as an
 * entry of any file.
 *
 * A module file (`.ts` or `.mjs`) goes through `import()`, which is why
 * {@link loadConfig} is asynchronous. Its default export is a list of
 * entries or one entry, merged in order by define-config's `merge`; a
 * YAML file is one entry. `reload` is on, so a process that loads its
 * config twice sees an edit to a module file as it sees one to a YAML
 * file, at the cost of one module kept per distinct content.
 *
 * ## The local layer
 *
 * A scope's module file is the person's file: they write it, it may be
 * tracked, and rafa never writes it. Its YAML file is the scope's LOCAL
 * layer, read over the module file key by key: the file rafa writes
 * (`rafa config set`, and `pr.base` from `stretch start` and
 * `stretch end`). It is the interim form of #893's local layer, until
 * #893's generated file under `.rafa/` replaces it. No file shadows
 * another, so a scope holding both reads both: a key set in both
 * resolves to the YAML file's value, and every key the YAML file leaves
 * out to the module file's.
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
 * spelling; a file is refused with the reading's problems, or with the
 * schema's where the reading found none. No file reaches that second
 * refusal while both judge through the same readers: turned off, it
 * reddens no case of `config-load.test.ts`. It is the guard against the
 * two drifting apart.
 *
 * ## Templates
 *
 * A file holding `templates` reads each template it names as an entry
 * ahead of its own: the active template hook (`activeConfigTemplateHook`,
 * `section.ts`) answers the entry a name stands for, and
 * `layTemplatesUnder` (`config.ts`) lays each under the file, a later
 * name over an earlier one. Each of the four files has its own templates
 * laid under it alone, so a file's own keys outrank its templates, and
 * a YAML file's templates outrank its scope's module file, as the
 * project's module file's templates outrank the user's files. A setting
 * a template answered and no file outranked reports source `template`,
 * its `provenance` naming the template and the file that named it. The
 * entries are laid here, after define-config's merge of the file: the
 * loader reads a file's entries and nothing else, and a template's
 * `false` is a value, as a YAML file's is, with no removal to set back.
 *
 * Each template's entry is judged as a file is, labelled with the file
 * and the template, and a key in it that names no setting is refused
 * rather than warned about: the template is rafa's, not the operator's.
 * A name the hook does not know is refused naming the file and the names
 * the hook carries (`ConfigTemplateHook.names`), and so is a `templates`
 * key naming any template while no hook is set, the known names then
 * none. Core imports no template: `src/config-registry.ts` sets the hook.
 *
 * ## Refusals
 *
 * Every refusal is a {@link ConfigError}, and each file is judged whole,
 * whatever outranks it: an unusable `store` in the user's file is refused
 * even where the project's names one, because the next project without
 * one would run on it. The user scope is read and judged first, then the
 * project's, each its module file before its YAML file; then a key set
 * twice in one file, and the command line last.
 *
 *   - `flows` and `steps` in either file of the user scope, naming the
 *     layer and the file: a flow is a project's decision. In the project
 *     scope both are unknown keys until #119 defines them.
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
 * `merge.duplicates`, the highest of the four files naming one deciding:
 * `warn` prints it, `error` refuses the load with every one, `allow`
 * drops it. The level is read off the files' mappings rather than a
 * setting, so one load decides it: define-config's loader takes its
 * `duplicates` option before it reads a file.
 *
 * A root that IS the home, compared after symlinks are followed, is read
 * as the project scope alone. Read as both, it would read
 * `~/.rafa/config.yaml` twice and warn twice about each unknown key.
 *
 * ## The project's two files alone
 *
 * {@link readProjectScope} reads the project scope's two places as
 * {@link loadConfig} does, templates laid and every refusal raised, and
 * answers the two files without ranking them: no user scope is read, no
 * warning is printed, the load hook is not called and the store's
 * settings are not touched. It is for a caller that reads the project's
 * files and no command's config, such as a script under `scripts/`;
 * like {@link loadConfig}, it needs the registry's sections registered.
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
 * applies to its own files — so a place whose loader found no file,
 * while something stands at one of its names, is refused naming it: a
 * `.rafa/config.yaml` that is a directory would otherwise pass for no
 * config, and the run would go on at defaults. {@link readConfigFile}
 * reads the YAML file alone by the same rule, deciding existence with
 * `existsSync`: `Bun.file(path).exists()` answers false for a directory.
 */
import type { ConfigScopeName } from './config-origins.js';
import type { DuplicatesLevel, Mapping } from './config-sections.js';
import type { ConfigFile, ConfigOverrides, ResolvedConfig, TemplateLayer } from './config.js';
import type { Diagnostic, LoadResult } from '@open-tomato/define-config';

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';

import { createLoader } from '@open-tomato/define-config';

import { setActiveStoreSettings } from '../../effort/store/settings.js';
import { activeOutput } from '../output/active.js';

import { entriesOf, missingModuleProblem, restoredMapping } from './config-load-module.js';
import { describeValue, DUPLICATE_LEVELS, isMapping, messageOf } from './config-sections.js';
import {
  CONFIG_FILE,
  ConfigError,
  configFilePath,
  layTemplatesUnder,
  parseConfigDocument,
  parseConfigText,
  readConfigDocument,
  resolveConfig,
} from './config.js';
import { writeDangerousPassLines } from './dangerous.js';
import { activeConfigLoadHook, activeConfigTemplateHook, activeSections, activeSettings } from './section.js';
import { schemaSectionsOf } from './standard-schema.js';

/** The two directories {@link loadConfig} reads a config file under. */
export interface ConfigRoots {
  /** The project root: its scope's files sit here and under its `.rafa/`. */
  readonly root: string;
  /** The home directory: the user scope's files sit under its `.rafa/`. */
  readonly home: string;
}

/** The project scope's two files, each read with its templates laid under; see {@link readProjectScope}. */
export interface ProjectScopeFiles {
  /** The project's YAML file, its local layer, or null when there is none. */
  readonly local: ConfigFile | null;
  /** The project's module file, `rafa.config.ts` or `rafa.config.mjs`, or null when there is none. */
  readonly file: ConfigFile | null;
}

/** The module files a scope's module place is looked up for, in order. */
const MODULE_FILES: readonly string[] = ['rafa.config.ts', 'rafa.config.mjs'];

/** The keys only a project's file may hold; see the module note. */
const PROJECT_ONLY_KEYS: readonly string[] = ['flows', 'steps'];

/** One place of a scope to read: its scope, its directory and its lookup names. */
interface ScopePlace {
  readonly layer: ConfigScopeName;
  readonly dir: string;
  readonly lookup: readonly string[];
}

/** One scope's two places: its module file's, and its YAML file's over it. */
interface ScopePlaces {
  readonly layer: ConfigScopeName;
  readonly module: ScopePlace;
  readonly local: ScopePlace;
}

/** What the YAML host loader made of one file: its document, or the refusal. */
type YamlRead = { readonly document: unknown } | { readonly error: unknown };

/** One place, read and judged. */
interface ScopeReading {
  /** The file read, or null when the place holds none. */
  readonly file: ConfigFile | null;
  /** The file's mapping, as {@link ScopeReading.file} was read from. */
  readonly mapping: Mapping;
  /** One line per key two entries of the file set, the file named. */
  readonly duplicates: readonly string[];
}

/** One scope's two places, read and judged. */
interface ScopeReadings {
  readonly module: ScopeReading;
  readonly local: ScopeReading;
}

/** A place that holds no file. */
const NO_FILE: ScopeReading = Object.freeze({
  file: null,
  mapping: Object.freeze({}),
  duplicates: Object.freeze([]),
});

/** A scope that holds no file in either place. */
const NO_SCOPE: ScopeReadings = Object.freeze({ module: NO_FILE, local: NO_FILE });

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

/** The two places of the scope `layer` under `dir`, the YAML file `yaml` there its local place. */
function placesOf(layer: ConfigScopeName, dir: string, yaml: string): ScopePlaces {
  return {
    layer,
    module: { layer, dir, lookup: MODULE_FILES },
    local: { layer, dir, lookup: [yaml] },
  };
}

/** The project scope's two places under `root`. */
function projectPlaces(root: string): ScopePlaces {
  return placesOf('project', root, CONFIG_FILE);
}

/**
 * The scopes to read, the user's first: none for the user when the home
 * is the root. Refuses a home that is not an absolute path; see the
 * module note.
 */
function scopesOf({ root, home }: ConfigRoots): readonly ScopePlaces[] {
  if (!isAbsolute(home)) {
    throw new ConfigError([
      `home directory is ${describeValue(home)}, expected an absolute path`,
    ]);
  }
  const project = projectPlaces(root);
  if (isSameDirectory(root, home)) return [project];
  return [placesOf('user', join(home, dirname(CONFIG_FILE)), basename(CONFIG_FILE)), project];
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
 * Refuses a place whose loader found no file while something stands at
 * one of its lookup names; see the module note.
 */
function refuseUnreadableName(place: ScopePlace): void {
  for (const name of place.lookup) {
    const path = join(place.dir, name);
    if (existsSync(path)) readOrRefuse(path);
  }
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

/**
 * One template's entry read as `place`'s file is, labelled with the file
 * at `path` and the template, and refused for a key that names no
 * setting; see "Templates" in the module note.
 */
function readTemplate(place: ScopePlace, path: string, name: string, entry: Mapping): TemplateLayer {
  const label = `${path} (template ${name})`;
  refuseProjectOnlyKeys(place, label, entry);
  const read = readConfigDocument(entry, label);
  if (read.extras.length > 0) {
    throw new ConfigError(read.extras.map((extra) => `${label}: ${extra.key} names no setting`));
  }
  return { name, values: read.values };
}

/** The refusal of the template names in `unknown`, which the file at `path` gives; see the module note. */
function unknownTemplates(path: string, unknown: readonly string[]): ConfigError {
  const hook = activeConfigTemplateHook();
  const known = hook?.names ?? [];
  const listed = known.length === 0
    ? 'none'
    : known.join(', ');
  const why = hook === null
    ? 'but no template hook is set to read it'
    : 'which no template holds';
  return new ConfigError(unknown.map((name) => `${path}: templates names ${JSON.stringify(name)}, ${why} `
    + `(known templates: ${listed})`));
}

/**
 * `file` with each template its `templates` key names laid under its
 * own keys, read through the active template hook; see "Templates" in
 * the module note.
 */
function withNamedTemplates(place: ScopePlace, file: ConfigFile): ConfigFile {
  const names = file.values.templates ?? [];
  if (names.length === 0) return file;
  const hook = activeConfigTemplateHook();
  const found = names.map((name) => ({ name, entry: hook?.(name) ?? null }));
  const unknown = found.filter(({ entry }) => entry === null).map(({ name }) => name);
  if (unknown.length > 0) throw unknownTemplates(file.path, unknown);
  return layTemplatesUnder(file, found.flatMap(({ name, entry }) => entry === null
    ? []
    : [readTemplate(place, file.path, name, entry)]));
}

/** Reads and judges the file of one place of a scope, its templates laid under; see the module note. */
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
    file: withNamedTemplates(place, yaml === undefined
      ? { ...read, entries: entriesOf(result.provenance) }
      : read),
    mapping: isMapping(document)
      ? document
      : {},
    duplicates: result.diagnostics
      .filter((diagnostic) => diagnostic.code === 'duplicate-key')
      .map((diagnostic) => `${path}: ${diagnostic.message}`),
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
 * `merge.duplicates` of the highest file naming one, or a
 * {@link ConfigError} with every one at `error`.
 *
 * @param readings - The places read, lowest ranked first.
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

/**
 * The default warning sink: the active output's `warn`
 * (`core/output/active.ts`), read at each warning, so a command
 * under the dispatcher warns through its invocation's output.
 */
function printWarning(message: string): void {
  activeOutput().warn(message);
}

/** Refuses a read by `caller` while no config section is registered. */
function requireRegisteredSections(caller: string): void {
  if (Object.keys(activeSettings()).length === 0) {
    throw new Error(`no config section is registered: call registerCoreConfigSections from src/config-registry.ts before ${caller}`);
  }
}

/** Reads and judges one scope's two places, its module file first. */
async function readPlaces(places: ScopePlaces): Promise<ScopeReadings> {
  const module = await readScope(places.module);
  const local = await readScope(places.local);
  return { module, local };
}

/**
 * Reads the project scope's two files under `root`, each with the
 * templates it names laid under it, and answers them unranked: no user
 * scope, no warning printed, no load hook called and no store setting
 * touched. Every refusal {@link loadConfig} raises for either file is
 * raised here, a key set twice in one file at the `merge.duplicates`
 * of the two files included. See the module note.
 *
 * @param root - The project root: the module file sits here and the
 *   YAML file under its `.rafa/`.
 * @returns The YAML file as `local` and the module file as `file`, each
 *   null when the project holds none.
 * @throws {ConfigError} For a file the load refuses.
 * @throws {Error} When no config section is registered.
 */
export async function readProjectScope(root: string): Promise<ProjectScopeFiles> {
  requireRegisteredSections('readProjectScope');
  const { module, local } = await readPlaces(projectPlaces(root));
  duplicateWarnings([module, local]);
  return { local: local.file, file: module.file };
}

/**
 * Reads the user scope's two files under `roots.home` and the project's
 * two under `roots.root`, ranks the four against `cli`, and prints a
 * warning per key set twice in one file and per unknown key through
 * `warn`, the active output's `warn` when none is given. After them it
 * writes one pass line per `dangerous.*` key set off its default
 * (`dangerous.ts`), once per invocation: the active output's when
 * `warn` is the default, the sink's own when one is given.
 *
 * Each scope's YAML file is its local layer, ranked over its module
 * file key by key: the project's as `local` over its module file as
 * `file`, the user scope's as `userLocal` over its module file as
 * `user`. See "The local layer" in the module note.
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
 * Each file has the templates its `templates` key names laid under its
 * own keys, read through the active template hook; a name the hook does
 * not know is refused. See "Templates" in the module note.
 *
 * The files are read and judged before the command line is looked at,
 * the user's first and each scope's module file before its YAML file,
 * so a run with problems in every layer reports the first file's alone.
 * See the module note for the home, the lookup and every refusal.
 *
 * @returns The resolution, with `provenance` naming the file and entry
 *   of each setting a file answered.
 */
export async function loadConfig(
  roots: ConfigRoots,
  cli: ConfigOverrides = {},
  warn: (message: string) => void = printWarning,
): Promise<ResolvedConfig> {
  requireRegisteredSections('loadConfig');
  const readings = new Map<ConfigScopeName, ScopeReadings>();
  for (const places of scopesOf(roots)) readings.set(places.layer, await readPlaces(places));
  const user = readings.get('user') ?? NO_SCOPE;
  const project = readings.get('project') ?? NO_SCOPE;
  const duplicates = duplicateWarnings([user.module, user.local, project.module, project.local]);
  const resolved = resolveConfig({
    cli,
    local: project.local.file,
    file: project.module.file,
    userLocal: user.local.file,
    user: user.module.file,
  });
  const loaded: ResolvedConfig = { ...resolved, warnings: [...duplicates, ...resolved.warnings] };
  activeConfigLoadHook()?.(loaded.config);
  for (const warning of loaded.warnings) warn(warning);
  writeDangerousPassLines(loaded, warn, warn === printWarning
    ? activeOutput()
    : warn);
  setActiveStoreSettings({ busyTimeoutMs: loaded.config.effortBusyTimeoutMs });
  return loaded;
}
