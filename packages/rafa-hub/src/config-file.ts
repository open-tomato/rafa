/**
 * The hub's config file: where it is, which of its two forms it is
 * written in, and the load of the `.ts` form, `rafa-hub.config.ts`,
 * through `createLoader` from `@open-tomato/define-config`, as the
 * client's `loadScope` (`packages/rafa/src/core/config/config-load.ts`)
 * loads a project's `rafa.config.ts`, read into the one frozen
 * `HubConfig` a `rafa-hub.yaml` file reads to (#1659).
 *
 * ## The file and its form
 *
 * {@link readHubConfig} reads the file the `RAFA_HUB_CONFIG` variable
 * names, a relative name resolved against the working directory, and
 * answers the config with the form it was read in and the file read,
 * as a {@link HubConfigReading}. {@link locateHubConfig} decides which
 * file that is, in this order:
 *
 *   - {@link HUB_CONFIG_MODULE_FILE} and {@link HUB_CONFIG_YAML_FILE}
 *     both in the named file's directory refuse the start, naming both
 *     paths, whichever of the two (or neither) is named: one directory
 *     holds one config, never two to choose between.
 *   - A named `.ts` file is the `.ts` form, loaded as below.
 *   - A named `.ts` file that is missing, beside a
 *     {@link HUB_CONFIG_YAML_FILE}, reads that YAML file as the
 *     fallback, so a volume written before #1659 keeps starting once the
 *     default names `rafa-hub.config.ts`.
 *   - A named `.ts` file with neither beside it is refused naming the
 *     `.ts` path, the file to write.
 *   - Any other name is the YAML form, read as before #1659 by
 *     `parseHubConfig` (`config.ts`).
 *
 * Readings the spec leaves to this module: a path "holds" a file when it
 * names a regular file, so a directory carrying either name is no file;
 * the both-files rule looks only for those two names, so a named
 * `hub.config.ts` beside a `rafa-hub.yaml` loads; and a name ending in
 * neither `.ts` nor `.yaml` (`hub.yml`) is still read as YAML, as every
 * name was before.
 *
 * ## The YAML warning
 *
 * {@link yamlConfigWarning} answers, for a reading in the YAML form, the
 * one warning a serving start logs (`config.yaml`, in `bin.ts`): the
 * file read, {@link HUB_YAML_DROPPED_IN} as the release that stops
 * reading YAML, and the `.ts` file to write. For the fallback that is
 * the named `.ts` file; for a named YAML file it is
 * {@link HUB_CONFIG_MODULE_FILE} in that file's directory, which
 * `RAFA_HUB_CONFIG` then has to name. Either way the YAML file is to be
 * removed, since the two names in one directory refuse the start. A
 * reading in the `.ts` form answers null. `rafa-hub install` and
 * `rafa-hub health` read through {@link readHubConfig} as well and log
 * no warning: the reading carries none, and only the serving start asks
 * for it.
 *
 * ## The load
 *
 * {@link loadHubConfigFile} hands the loader one layer, `hub`, whose
 * directory is the file's and whose one lookup name is the file's own,
 * with {@link hubSectionSchemas} as its `schema`, `duplicates: 'error'`
 * and `reload: true`. The loader imports the module and takes its
 * `default` export, one mapping or a list of them as `defineConfig`
 * answers, and merges it into one value. That value is read by
 * `readHubDocument` (`config.ts`), the reader a parsed YAML file goes
 * through, so both forms refuse in the same sentences, in the same
 * order, and answer the same `HubConfig`.
 *
 * ## The section schemas
 *
 * {@link hubSectionSchemas} answers one Standard Schema V1 schema per
 * section the file holds, `hub` and `dangerous`, each at its own path.
 * Each `validate` calls `readHubDocument` on the least document holding
 * its section, `{ hub }`, or `{ hub: {}, dangerous }` (since `dangerous`
 * is read only beside a `hub` mapping), and answers one issue per problem
 * about its own section's keys: those opening `<path>: <section>` or
 * `<path>: <section>.`. A section left out (`null`, as the loader hands a
 * missing subtree to its schema) is silence: the whole document's
 * reading refuses a missing `hub`, and `dangerous` is optional.
 *
 * ## Refusals
 *
 * Every refusal is one {@link HubConfigError} holding every problem
 * found, in this order:
 *
 *   - A path that names no `.ts` file, by its extension.
 *   - A directory the loader cannot search, naming the path the loader
 *     names (`cannot be looked up`), as the client's loader does.
 *   - No file at the path: the hub's config file could not be read.
 *   - A value import that does not resolve, naming the file and the
 *     specifier, in the shape of the client's `missingModuleProblem`
 *     (`config-load-module.ts`) and written here, since the hub imports
 *     nothing of the client: `<path>: imports <specifier>, which cannot
 *     be found from this file`, then, for a package, where to install it,
 *     and for the hub's own package the `import type` form, which needs
 *     nothing at run time. An `import type` is erased before the file
 *     runs, so it loads with nothing installed.
 *   - Any other module that cannot be loaded (it throws, does not
 *     compile, has no default export, or exports no mapping), naming it
 *     and the loader's message (`cannot be loaded (…)`).
 *   - What `readHubDocument` refuses over the merged value, then each key
 *     two entries of the file set (`duplicate-key`), opening with the
 *     path.
 *
 * ## Readings the spec leaves to this module
 *
 *   - The merge reads `false` as the removal of a key, so `false` never
 *     reaches the merged value, while `hub.auth.cacheFor: false` and
 *     `hub.index.rebuildAfterPush: false` are values the hub reads. Each
 *     `false` the merge removed is set back from the provenance, unless a
 *     later entry removed or replaced a mapping above it, as the client's
 *     `restoredMapping` does; the hub's readers then judge it, so a
 *     `false` where none is taken is refused rather than read as left
 *     out. The provenance joins a path at its dots, so a `false` under a
 *     key spelled with a dot is not set back, as in the client.
 *   - The section schemas run inside the loader, over the merged value
 *     before any `false` is set back. Their issues are the readers'
 *     problems over that value, so when the whole document's reading
 *     refuses, its problems stand alone: a schema issue then repeats one,
 *     or reads a `false` as a key left out. Read clean, the document
 *     still refuses with any issue the schemas raise. Measured on
 *     2026-11-27: the two keys where `false` is a value are also clean
 *     when left out, so a clean document raises no issue today.
 *   - `duplicates` is `error`, not the client's `warn`: the hub's file
 *     has no `merge.duplicates` to choose a level, and a key two entries
 *     set is a value the operator did not see win.
 *   - `reload` is on, as in the client, so a file edited since it was
 *     first imported in this process is read as it now stands. Only the
 *     file is evaluated again; a module it imports stays cached.
 *   - A merge directive the file writes (`$replace`, `$layer`) is the
 *     loader's and never reaches the readers, as in a project's file.
 */
import type { HubConfig } from './config.js';
import type { Diagnostic, LoadResult, Provenance, StandardSchemaV1 } from '@open-tomato/define-config';

import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { createLoader } from '@open-tomato/define-config';

import { HUB_CONFIG_ENV, HubConfigError, parseHubConfig, readHubDocument } from './config.js';

/** The one layer the hub's config file is loaded as. */
export const HUB_CONFIG_LAYER = 'hub';

/** The extension of the config module this file loads. */
export const HUB_CONFIG_MODULE_EXTENSION = '.ts';

/** The name of the hub's config file in its `.ts` form. */
export const HUB_CONFIG_MODULE_FILE = 'rafa-hub.config.ts';

/** The name of the hub's config file in its YAML form, read beside a missing `.ts` file. */
export const HUB_CONFIG_YAML_FILE = 'rafa-hub.yaml';

/** The release that stops reading the hub's config file in its YAML form. */
export const HUB_YAML_DROPPED_IN = 'rafa 1.0.0';

/** The form a hub config file is written in. */
export type HubConfigForm = 'ts' | 'yaml';

/** The file {@link locateHubConfig} chose and the form it is read in. */
export interface HubConfigLocation {
  /** The form the file is read in. */
  readonly form: HubConfigForm;
  /** The file, absolute: the named one, or the YAML fallback beside it. */
  readonly path: string;
}

/** What {@link readHubConfig} answers: the config, and the file and form it was read from. */
export interface HubConfigReading extends HubConfigLocation {
  /** The config the file names. */
  readonly config: HubConfig;
}

/** The hub's own package, whose types a config file imports. */
export const HUB_PACKAGE = '@open-tomato/rafa-hub';

/** The vendor every schema built here names. */
export const HUB_SCHEMA_VENDOR = 'rafa-hub';

/** The sections of the hub's config file a schema judges, in the order they are validated. */
export const HUB_SCHEMA_SECTIONS: readonly HubSchemaSectionName[] = Object.freeze(['hub', 'dangerous']);

/** A section of the hub's config file a schema judges. */
export type HubSchemaSectionName = 'hub' | 'dangerous';

/**
 * One pair of `createLoader`'s `schema` list: the key path of the
 * section, outermost key first, and the schema it must satisfy.
 */
export type HubSchemaSection = readonly [path: readonly string[], schema: StandardSchemaV1];

/** A mapping, as the merged value holds one. */
type Mapping = Readonly<Record<string, unknown>>;

/** Whether `raw` is a mapping, rather than a list, a scalar or null. */
function isMapping(raw: unknown): raw is Mapping {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** The message of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** The least document `readHubDocument` reads `section`, holding `value`, in. */
function documentOf(section: HubSchemaSectionName, value: unknown): Mapping {
  return section === 'hub'
    ? { hub: value }
    : { hub: {}, dangerous: value };
}

/**
 * The problems `readHubDocument` finds in `document`, read from `path`,
 * or none when it reads clean. A throw other than {@link HubConfigError}
 * is no refusal and is thrown on.
 */
function problemsOf(document: unknown, path: string): readonly string[] {
  try {
    readHubDocument(document, path);
    return [];
  } catch (error) {
    if (error instanceof HubConfigError) return error.problems;
    throw error;
  }
}

/** A schema whose `validate` judges `section` through `readHubDocument`; see the module note. */
function sectionSchema(path: string, section: HubSchemaSectionName): StandardSchemaV1 {
  const owns = (problem: string): boolean => problem.startsWith(`${path}: ${section} `)
    || problem.startsWith(`${path}: ${section}.`);
  const validate = (value: unknown): StandardSchemaV1.Result<unknown> => {
    if (value === undefined || value === null) return { value };

    const issues = problemsOf(documentOf(section, value), path)
      .filter(owns)
      .map((message): StandardSchemaV1.Issue => ({ message, path: [] }));
    return issues.length === 0
      ? { value }
      : { issues };
  };
  return Object.freeze({
    '~standard': Object.freeze({ version: 1 as const, vendor: HUB_SCHEMA_VENDOR, validate }),
  });
}

/**
 * The `[path, schema]` list `createLoader`'s `schema` option takes for
 * the hub's config file at `path`: one pair per section of
 * {@link HUB_SCHEMA_SECTIONS}, each validating synchronously through
 * `readHubDocument`, every issue a sentence opening with `path`.
 *
 * @param path - The config file, as each issue names it.
 * @returns One frozen pair per section.
 */
export function hubSectionSchemas(path: string): readonly HubSchemaSection[] {
  return Object.freeze(HUB_SCHEMA_SECTIONS.map((section): HubSchemaSection => Object.freeze([
    Object.freeze([section]),
    sectionSchema(path, section),
  ] as const)));
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

/**
 * The refusal of the config file at `path` importing `specifier`, which
 * cannot be found from it: the file, the specifier and, for a package,
 * where to install it.
 *
 * @param path - The config file.
 * @param specifier - The import it could not resolve.
 * @returns One problem sentence.
 */
export function missingImportProblem(path: string, specifier: string): string {
  const installed = packageOf(specifier);
  const install = installed === null
    ? ''
    : `; the hub resolves it from this file's directory up, so install ${installed} there (bun add ${installed})`;
  const typesOnly = installed === HUB_PACKAGE
    ? `, or import its types alone (import type { HubConfigFile } from '${HUB_PACKAGE}'), which need nothing at run time`
    : '';
  return `${path}: imports ${specifier}, which cannot be found from this file${install}${typesOnly}`;
}

/** The refusal a `load-failed` diagnostic for the file at `path` turns into. */
function loadRefusal(path: string, diagnostic: Diagnostic): HubConfigError {
  const missing = /Cannot find (?:module|package) ['"]([^'"]+)['"]/.exec(diagnostic.message);
  return missing?.[1] === undefined
    ? new HubConfigError([`${path}: cannot be loaded (${diagnostic.message})`])
    : new HubConfigError([missingImportProblem(path, missing[1])]);
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
 * The merged value of the file with each `false` the merge removed set
 * back; see "Readings" in the module note.
 *
 * @param result - What define-config's loader read off the file.
 * @returns The document `readHubDocument` reads.
 */
export function restoredDocument({ config, provenance }: Pick<LoadResult, 'config' | 'provenance'>): Mapping {
  const removed = [...provenance]
    .flatMap(([path, records]) => {
      const last = records.at(-1);
      return path === '' || last?.kind !== 'remove' || wipedAbove(path, last.entry, provenance)
        ? []
        : [path.split('.')];
    })
    .sort((first, second) => first.length - second.length);
  return removed.reduce(withFalseAt, config);
}

/** Runs the loader over the file at `path`; a lookup that fails other than by absence is refused naming the path. */
async function loadModule(path: string): Promise<LoadResult> {
  const dir = dirname(path);
  const loader = createLoader({
    lookup: [basename(path)],
    layers: [{ layer: HUB_CONFIG_LAYER, dir }],
    schema: hubSectionSchemas(path),
    duplicates: 'error',
    reload: true,
  });
  try {
    return await loader.load(dir);
  } catch (error) {
    const at = (error as { path?: unknown } | null)?.path;
    const where = typeof at === 'string'
      ? at
      : dir;
    throw new HubConfigError([`${where}: cannot be looked up (${messageOf(error)})`]);
  }
}

/**
 * Loads the hub's config module at `path`, a relative path resolved
 * against the working directory, through `createLoader` with
 * {@link hubSectionSchemas}, and reads its merged default export with
 * `readHubDocument` into a frozen `HubConfig`.
 *
 * @param path - The `.ts` config file.
 * @returns The config the file names.
 * @throws {HubConfigError} With every problem found; see "Refusals" in
 *   the module note.
 */
export async function loadHubConfigFile(path: string): Promise<HubConfig> {
  const file = resolve(path);
  if (extname(file) !== HUB_CONFIG_MODULE_EXTENSION) {
    throw new HubConfigError([`${file}: is not a ${HUB_CONFIG_MODULE_EXTENSION} file; expected the hub's config module, rafa-hub.config.ts`]);
  }

  const result = await loadModule(file);
  if (result.sources.length === 0) {
    throw new HubConfigError([`${file}: the hub's config file could not be read: no file at this path`]);
  }
  const failure = result.diagnostics.find((diagnostic) => diagnostic.code === 'load-failed');
  if (failure !== undefined) throw loadRefusal(file, failure);

  const merged = result.diagnostics
    .filter((diagnostic) => diagnostic.level === 'error' && diagnostic.code !== 'schema')
    .map((diagnostic) => `${file}: ${diagnostic.message}`);
  const schema = result.diagnostics
    .filter((diagnostic) => diagnostic.code === 'schema')
    .map((diagnostic) => diagnostic.message);
  const config = readOrRefuse(restoredDocument(result), file, merged);
  if (merged.length > 0) throw new HubConfigError(merged);
  if (schema.length > 0) throw new HubConfigError(schema);

  return config;
}

/** `readHubDocument` over `document`, its refusal followed by the `merged` problems. */
function readOrRefuse(document: Mapping, path: string, merged: readonly string[]): HubConfig {
  try {
    return readHubDocument(document, path);
  } catch (error) {
    if (error instanceof HubConfigError) throw new HubConfigError([...error.problems, ...merged]);
    throw error;
  }
}

/** Whether `path` names a regular file; anything that cannot be read as one is none. */
async function holdsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Which file the hub reads for the name `named`, a relative name resolved
 * against the working directory, and in which form; see "The file and
 * its form" in the module note.
 *
 * @param named - The path `RAFA_HUB_CONFIG` names.
 * @returns The file to read and its form.
 * @throws {HubConfigError} When the named file's directory holds both
 *   {@link HUB_CONFIG_MODULE_FILE} and {@link HUB_CONFIG_YAML_FILE},
 *   naming both, or when a named `.ts` file is missing with no YAML file
 *   beside it, naming the `.ts` path.
 */
export async function locateHubConfig(named: string): Promise<HubConfigLocation> {
  const path = resolve(named);
  const dir = dirname(path);
  const module = join(dir, HUB_CONFIG_MODULE_FILE);
  const yaml = join(dir, HUB_CONFIG_YAML_FILE);
  const [moduleHeld, yamlHeld] = await Promise.all([holdsFile(module), holdsFile(yaml)]);
  if (moduleHeld && yamlHeld) {
    throw new HubConfigError([
      `${module} and ${yaml}: both are the hub's config file, in one directory; expected one, `
      + `so move what ${HUB_CONFIG_YAML_FILE} holds into ${HUB_CONFIG_MODULE_FILE} and remove ${HUB_CONFIG_YAML_FILE}`,
    ]);
  }
  if (extname(path) !== HUB_CONFIG_MODULE_EXTENSION) return { form: 'yaml', path };

  const namedHeld = path === module
    ? moduleHeld
    : await holdsFile(path);
  if (namedHeld) return { form: 'ts', path };
  if (yamlHeld) return { form: 'yaml', path: yaml };

  throw new HubConfigError([
    `${path}: the hub's config file could not be read: no file at this path, and no ${HUB_CONFIG_YAML_FILE} beside it to read instead`,
  ]);
}

/** Reads the YAML config file at `path` with `parseHubConfig`; a file that cannot be read is refused naming it. */
async function readYamlFile(path: string): Promise<HubConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new HubConfigError([`${path}: the hub's config file could not be read: ${messageOf(error)}`]);
  }
  return parseHubConfig(text, path);
}

/**
 * Reads the hub's config from the file `env[`{@link HUB_CONFIG_ENV}`]`
 * names, chosen by {@link locateHubConfig}: a `.ts` file through
 * {@link loadHubConfigFile}, a YAML file through `parseHubConfig`.
 *
 * @param env - The environment holding `RAFA_HUB_CONFIG`.
 * @returns The frozen config, with the file it was read from and its form.
 * @throws {HubConfigError} When the variable is unset or empty, for
 *   either refusal of {@link locateHubConfig}, when the file cannot be
 *   read, and for every problem its reader finds.
 */
export async function readHubConfig(env: Readonly<Record<string, string | undefined>> = process.env): Promise<HubConfigReading> {
  const named = env[HUB_CONFIG_ENV];
  if (named === undefined || named.trim() === '') {
    throw new HubConfigError([`${HUB_CONFIG_ENV} is not set; expected the path of the hub's config file, such as ${HUB_CONFIG_MODULE_FILE}`]);
  }

  const { form, path } = await locateHubConfig(named);
  const config = form === 'ts'
    ? await loadHubConfigFile(path)
    : await readYamlFile(path);
  return Object.freeze({ config, form, path });
}

/**
 * The warning a serving start logs for a config read in the YAML form,
 * named or as the fallback beside a missing `.ts` file, or null for one
 * read in the `.ts` form; see "The YAML warning" in the module note.
 *
 * @param named - The path `RAFA_HUB_CONFIG` names, as the reading was asked for.
 * @param reading - The file read and its form, as {@link readHubConfig} answers them.
 * @returns One sentence naming the YAML file, the `.ts` file to write and
 *   {@link HUB_YAML_DROPPED_IN}, or null.
 */
export function yamlConfigWarning(named: string, reading: HubConfigLocation): string | null {
  if (reading.form !== 'yaml') return null;

  const fallback = extname(named) === HUB_CONFIG_MODULE_EXTENSION;
  const module = fallback
    ? resolve(named)
    : join(dirname(reading.path), HUB_CONFIG_MODULE_FILE);
  const rename = fallback
    ? ''
    : `, and name it in ${HUB_CONFIG_ENV}`;
  return `${reading.path}: the hub's config is read from YAML, which ${HUB_YAML_DROPPED_IN} stops reading; `
    + `write what it holds to ${module} as its default export, remove ${basename(reading.path)}${rename}`;
}
