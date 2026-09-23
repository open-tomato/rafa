/**
 * The two sources the inventory reads outside the three trees: Claude
 * Code's plugins and rafa's loaded add-on modules.
 *
 * `trees.ts` reads the project, rafa and user tiers; this module reads
 * what sits beside them, into the same {@link SourceItem} rows, and
 * leaves precedence, `shadowed-by:` and `visibleToLoop` to where every
 * source is gathered. Each reader answers a {@link SourceReading}: the
 * rows it could read and one {@link SourceWarning} per source it could
 * not, so an unreadable source is a row a person sees and never a silent
 * gap in the list.
 *
 * ## Plugins: the record Claude Code keeps, and the version it was read at
 *
 * Claude Code records the plugins it installed in the user scope, at
 * {@link INSTALLED_PLUGINS_PATH} under the home. That file is Claude
 * Code's own and no published contract, so this reader was written
 * against one measured reading of it and records which:
 * {@link PLUGINS_CLI_VERSION} is the Claude Code version, and
 * {@link PLUGINS_RECORD_VERSION} the file's own `version` key, as
 * `BUILT_IN_AGENTS_CLI_VERSION` in `agents/roster.ts` records the
 * roster it copied. A record under any other `version` is one warning
 * row naming both numbers, not a guess at a shape this module has not
 * seen. Measured on 2.1.280 (2026-09-23), the file reads:
 *
 * ```json
 * {
 *   "version": 2,
 *   "plugins": {
 *     "superpowers@claude-plugins-official": [
 *       { "scope": "user", "installPath": "/…/superpowers/6.4.1", "version": "6.4.1" }
 *     ]
 *   }
 * }
 * ```
 *
 * A key is `<plugin>@<marketplace>`, and the plugin's source is
 * `plugin:<plugin>`, the part before the last `@`. Each key holds a list
 * of installs; the first whose `scope` is `user`, or whose `scope` is
 * `project` or `local` with a `projectPath` equal to this project's
 * root, is the one read, and a key with none that applies here is not a
 * source here at all. Inside `installPath`, skills are `skills/` read by
 * the skill checker as `trees.ts` reads a tier, and agents are `agents/`
 * read by the roster's reading, both with no project root.
 *
 * ## Plugin names are namespaced
 *
 * Claude Code names a plugin's skill `<plugin>:<skill>`. That is
 * measured, not assumed: the init message of a `claude -p
 * --output-format stream-json` session on 2.1.280 lists
 * `superpowers:brainstorming` in `skills`. So a plugin row's name is
 * `<plugin>:<name its place implies>`, which is also why a plugin item
 * never shares a name with a project or user one. Agents are given the
 * same prefix; no loaded plugin carried an agent in that measurement,
 * so for agents the prefix is the documented form, not a measured one.
 *
 * What this reader does not read, each a known gap rather than a
 * silent one: a `plugin.json` naming extra `skills` or `agents` paths
 * beside the default directories, and `enabledPlugins` in the settings
 * files, which decides whether an installed plugin loads at all and is
 * the disabled reading's (`disabled.ts`), not a source's.
 *
 * ## Add-ons: the loaded modules' own manifests
 *
 * An add-on is a rafa module `modules/load.ts` answered `loaded`. Its
 * `package.json` is read again and its `rafa` manifest validated with
 * `validateManifest`, since `ConfiguredModule` carries the types a
 * manifest lists and not the directories it provides; a manifest that
 * no longer reads clean is a warning row, since it did when the module
 * was loaded. `provides.skills` and `provides.agents` are resolved
 * against the module directory, and each is read as a plugin's is, its
 * source `addon:<name>` and its names bare: rafa places an add-on's
 * files itself, with no namespace. A module that is `refused` or
 * `disabled` is not a source: `rafa module list` already says why.
 *
 * ## What one warning row covers
 *
 * One per source, whatever broke first:
 *
 *   - `plugins`: the record exists but is not readable, not JSON, not
 *     a mapping, under another `version`, or has no `plugins` mapping.
 *     An absent record is no warning: a home that installed no plugin.
 *   - `plugin:<name>`: an install entry that is not a mapping or names
 *     no `installPath`, or an `installPath` that is not a directory.
 *   - `addon:<name>`: a module with no directory, a `package.json` that
 *     does not read, a manifest that does not validate, or a `skills` or
 *     `agents` path that resolves outside the module or is not a
 *     directory there.
 *
 * A plugin holding neither `skills/` nor `agents/` (an LSP plugin, an
 * MCP-only one) reads as no rows and no warning: it is readable and
 * holds nothing the inventory lists. A plugin that is partly read keeps
 * none of its rows, so a warning row always stands for the whole source.
 *
 * Nothing here throws, and nothing reads the real home unless it is
 * handed it: every path comes from {@link PluginSeams}.
 */
import type { InventoryKind, InventorySource } from './record.js';
import type { SourceItem, TreeSeams } from './trees.js';
import type { ModuleState } from '../modules/load.js';
import type { ManifestProvides, ManifestSeams } from '../modules/manifest.js';

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { readAgentDirectory } from '../agents/roster.js';
import { checkDirectory } from '../check/run.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';
import { RUNNING_MANIFEST_SEAMS, validateManifest } from '../modules/manifest.js';

import { byName, skillItem, sourceItem } from './trees.js';

/** Where Claude Code records its installed plugins, under the home. */
export const INSTALLED_PLUGINS_PATH = join('.claude', 'plugins', 'installed_plugins.json');

/** The Claude Code version the plugin reader was written against. */
export const PLUGINS_CLI_VERSION = '2.1.280';

/** The `version` of `installed_plugins.json` the reader was written against. */
export const PLUGINS_RECORD_VERSION = 2;

/** Where a plugin or add-on keeps its skills and agents, under its own directory. */
export const PLUGIN_SKILLS_DIR = 'skills';
export const PLUGIN_AGENTS_DIR = 'agents';

/** Which source a warning row stands for: the plugin record itself, or one plugin or add-on. */
export type WarningSource = 'plugins' | `plugin:${string}` | `addon:${string}`;

/** One source the inventory could not read. */
export interface SourceWarning {
  readonly source: WarningSource;
  /** The file or directory that did not read. */
  readonly path: string;
  /** Why, as one sentence fragment. */
  readonly reason: string;
}

/** What one reader found: the rows it read, and a warning per source it could not. */
export interface SourceReading {
  readonly items: readonly SourceItem[];
  readonly warnings: readonly SourceWarning[];
}

/** One plugin install that applies to this project, from the record. */
export interface InstalledPlugin {
  /** The record's key, `<plugin>@<marketplace>`. */
  readonly key: string;
  /** The plugin's name: the key before its last `@`. */
  readonly name: string;
  readonly scope: string;
  /** The absolute directory it is installed in. */
  readonly installPath: string;
  /** The install's `version`, or null when the record gives none. */
  readonly version: string | null;
}

/** The plugins the record holds, and a warning per unreadable entry. */
export interface InstalledPlugins {
  /** The record's path, whether or not it exists. */
  readonly path: string;
  readonly plugins: readonly InstalledPlugin[];
  readonly warnings: readonly SourceWarning[];
}

/** What the plugin and add-on readers are resolved against. */
export interface PluginSeams extends TreeSeams {
  /** What a re-read manifest is held to. The running rafa when left out. */
  readonly manifest?: ManifestSeams;
}

/** What the add-on reader reads of a configured module; `ConfiguredModule` satisfies it. */
export interface AddonModule {
  readonly name: string | null;
  readonly directory: string | null;
  readonly state: ModuleState;
}

/** The scopes an install is recorded under that tie it to one project. */
const PROJECT_SCOPES: readonly string[] = ['project', 'local'];

/** A reading with nothing in it. */
const EMPTY_READING: SourceReading = { items: [], warnings: [] };

/** A reading that is one warning row. */
function warned(source: WarningSource, path: string, reason: string): SourceReading {
  return { items: [], warnings: [{ source, path, reason }] };
}

/** Whether a directory sits at `path`. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A string value at `key`, or null. */
function stringAt(entry: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = Object.hasOwn(entry, key)
    ? entry[key]
    : undefined;
  return typeof value === 'string'
    ? value
    : null;
}

/** The plugin name of a record key: the part before its last `@`, or the whole key. */
export function pluginName(key: string): string {
  const at = key.lastIndexOf('@');
  return at > 0
    ? key.slice(0, at)
    : key;
}

/** Whether an install entry applies to the project at `projectRoot`. */
function appliesHere(entry: Readonly<Record<string, unknown>>, projectRoot: string | null): boolean {
  const scope = stringAt(entry, 'scope');
  if (scope === 'user') return true;
  if (scope === null || !PROJECT_SCOPES.includes(scope)) return false;
  const projectPath = stringAt(entry, 'projectPath');
  return projectRoot !== null && projectPath !== null && resolve(projectPath) === resolve(projectRoot);
}

/** One record key's installs as the plugin that applies here, a warning, or nothing. */
function readInstall(
  key: string,
  raw: unknown,
  path: string,
  projectRoot: string | null,
): InstalledPlugin | SourceWarning | null {
  const name = pluginName(key);
  const source: WarningSource = `plugin:${name}`;
  if (!Array.isArray(raw) || !raw.every(isMapping)) {
    return { source, path, reason: `record entry "${key}" is ${describeValue(raw)}, expected a list of installs` };
  }

  const entry = raw.find((install) => appliesHere(install, projectRoot));
  if (entry === undefined) return null;

  const installPath = stringAt(entry, 'installPath');
  if (installPath === null || !isAbsolute(installPath)) {
    return { source, path, reason: `record entry "${key}" names no absolute installPath` };
  }

  return { key, name, scope: stringAt(entry, 'scope') ?? 'user', installPath, version: stringAt(entry, 'version') };
}

/** The record's text parsed, or the reason it does not parse. */
function parseRecord(text: string): { readonly value: unknown } | { readonly reason: string } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { reason: `is not JSON: ${messageOf(error)}` };
  }
}

/** The record's `plugins` mapping, or the reason there is none this reader can read. */
function recordPlugins(value: unknown): Readonly<Record<string, unknown>> | string {
  if (!isMapping(value)) return `is ${describeValue(value)}, expected a mapping`;

  const version = Object.hasOwn(value, 'version')
    ? value.version
    : undefined;
  if (version !== PLUGINS_RECORD_VERSION) {
    return `has version ${describeValue(version)}; this reader was written against version ${PLUGINS_RECORD_VERSION} (Claude Code ${PLUGINS_CLI_VERSION})`;
  }

  const plugins = Object.hasOwn(value, 'plugins')
    ? value.plugins
    : undefined;
  return isMapping(plugins)
    ? plugins
    : `has plugins ${describeValue(plugins)}, expected a mapping`;
}

/**
 * The installs `~/.claude/plugins/installed_plugins.json` records that
 * apply to this project, sorted by name. An absent record is no plugins
 * and no warning; an unreadable one is one `plugins` warning. See the
 * module note.
 */
export function readInstalledPlugins(seams: PluginSeams): InstalledPlugins {
  const path = join(seams.home, INSTALLED_PLUGINS_PATH);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const absent = isMapping(error) && Object.hasOwn(error, 'code') && error.code === 'ENOENT';
    const warnings: SourceWarning[] = absent
      ? []
      : [{ source: 'plugins', path, reason: `does not read: ${messageOf(error)}` }];
    return { path, plugins: [], warnings };
  }

  const parsed = parseRecord(text);
  const plugins = 'reason' in parsed
    ? parsed.reason
    : recordPlugins(parsed.value);
  if (typeof plugins === 'string') {
    return { path, plugins: [], warnings: [{ source: 'plugins', path, reason: plugins }] };
  }

  const read = Object.entries(plugins)
    .map(([key, raw]) => readInstall(key, raw, path, seams.projectRoot))
    .filter((install) => install !== null);

  return {
    path,
    plugins: read
      .filter((install): install is InstalledPlugin => 'installPath' in install)
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
    warnings: read.filter((install): install is SourceWarning => 'reason' in install),
  };
}

/** How a source's rows are named: bare, or with its plugin's prefix. */
type Naming = (name: string) => string;

/** The skills and agents under one source's two directories, rows named by `naming`. */
function readHeld(
  source: InventorySource,
  dirs: Readonly<Record<InventoryKind, string | null>>,
  naming: Naming,
  seams: PluginSeams,
): readonly SourceItem[] {
  const skillsDir = dirs.skill;
  const skills = skillsDir === null
    ? []
    : checkDirectory(skillsDir, 'skill', { projectRoot: null, pathDirs: seams.pathDirs }).reports
      .filter((report) => report.isFile)
      .map((report) => skillItem(report, source, skillsDir));

  const agents = dirs.agent === null
    ? []
    : readAgentDirectory(dirs.agent)
      .map((file) => sourceItem('agent', source, file.name, file.path, null));

  return byName([...skills, ...agents].map((item) => ({ ...item, name: naming(item.name) })));
}

/** A directory under `base` when one sits there, else null. */
function presentDir(base: string, name: string): string | null {
  const dir = join(base, name);
  return isDirectory(dir)
    ? dir
    : null;
}

/** One installed plugin's skills and agents, or one warning row. See the module note. */
export function readPluginSource(plugin: InstalledPlugin, seams: PluginSeams): SourceReading {
  const source: InventorySource = `plugin:${plugin.name}`;
  if (!isDirectory(plugin.installPath)) {
    return warned(source, plugin.installPath, 'installPath is not a directory');
  }

  const dirs = {
    skill: presentDir(plugin.installPath, PLUGIN_SKILLS_DIR),
    agent: presentDir(plugin.installPath, PLUGIN_AGENTS_DIR),
  };
  try {
    const items = readHeld(source, dirs, (name) => `${plugin.name}:${name}`, seams);
    return { items, warnings: [] };
  } catch (error) {
    return warned(source, plugin.installPath, `does not read: ${messageOf(error)}`);
  }
}

/** Every plugin the record holds for this project, read, with the record's own warnings first. */
export function readPlugins(seams: PluginSeams): SourceReading {
  const record = readInstalledPlugins(seams);
  const readings = record.plugins.map((plugin) => readPluginSource(plugin, seams));

  return {
    items: readings.flatMap((reading) => reading.items),
    warnings: [...record.warnings, ...readings.flatMap((reading) => reading.warnings)],
  };
}

/** A `provides` directory: absent, resolved inside the module, or refused with a reason. */
type ProvidedDir =
  | { readonly dir: string | null }
  | { readonly reason: string };

/** A manifest's `provides` directory resolved inside the module, or the reason it is not. */
function providedDir(directory: string, provided: string | undefined, kind: string): ProvidedDir {
  if (provided === undefined) return { dir: null };

  const dir = resolve(directory, provided);
  const inside = relative(directory, dir);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    return { reason: `manifest ${kind} "${provided}" resolves outside the module directory` };
  }
  return isDirectory(dir)
    ? { dir }
    : { reason: `manifest ${kind} "${provided}" is not a directory in the module` };
}

/** The directories a manifest provides, as written. */
type Provided = Pick<ManifestProvides, 'skills' | 'agents'>;

/** The module's `rafa` manifest, re-read, or the reason it no longer reads clean. */
function readManifest(directory: string, seams: PluginSeams): Provided | string {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as unknown;
  } catch (error) {
    return `package.json does not read: ${messageOf(error)}`;
  }

  const manifest = isMapping(raw) && Object.hasOwn(raw, 'rafa')
    ? raw.rafa
    : undefined;
  try {
    const validation = validateManifest(manifest, 'rafa', seams.manifest ?? RUNNING_MANIFEST_SEAMS);
    return validation.ok
      ? validation.manifest.provides
      : `manifest does not validate: ${validation.problems.join('; ')}`;
  } catch (error) {
    return `manifest does not validate: ${messageOf(error)}`;
  }
}

/** A module the add-on reader reads: loaded, and named. */
type NamedAddon = AddonModule & { readonly name: string };

/** One loaded add-on's skills and agents, or one warning row. See the module note. */
export function readAddonSource(module: NamedAddon, seams: PluginSeams): SourceReading {
  const source: InventorySource = `addon:${module.name}`;
  const directory = module.directory;
  if (directory === null || !isDirectory(directory)) {
    return warned(source, directory ?? module.name, 'the module has no directory to read');
  }

  const provides = readManifest(directory, seams);
  if (typeof provides === 'string') return warned(source, join(directory, 'package.json'), provides);

  const skill = providedDir(directory, provides.skills, 'skills');
  if ('reason' in skill) return warned(source, directory, skill.reason);
  const agent = providedDir(directory, provides.agents, 'agents');
  if ('reason' in agent) return warned(source, directory, agent.reason);

  try {
    const items = readHeld(source, { skill: skill.dir, agent: agent.dir }, (name) => name, seams);
    return { items, warnings: [] };
  } catch (error) {
    return warned(source, directory, `does not read: ${messageOf(error)}`);
  }
}

/** Every `loaded` module's skills and agents; a refused or disabled one is no source. */
export function readAddons(modules: readonly AddonModule[], seams: PluginSeams): SourceReading {
  const readings = modules
    .filter((module): module is NamedAddon => module.state === 'loaded' && module.name !== null)
    .map((module) => readAddonSource(module, seams));

  return readings.length === 0
    ? EMPTY_READING
    : {
      items: readings.flatMap((reading) => reading.items),
      warnings: readings.flatMap((reading) => reading.warnings),
    };
}
