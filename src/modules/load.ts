/**
 * Loads the modules `allowList:` names from the sources `modules:` gives:
 * each manifest validated, each adapter registered, and each command
 * entry handed to the dispatcher to mount under `module/<name>`.
 *
 * `.specs/modules-and-addons.md` lists what core carries from phase 1 so
 * phase 7 adds modules without touching core's shape: an adapter registry
 * populated "from enabled modules", the `module/<name>` mount point, and
 * the `modules:` and `allowList:` keys. Phase 1 has no `module install`
 * or `module enable`, so a module reaches the dispatcher only when the
 * config gives its source under `modules:` and names it on `allowList:`.
 * This module is that reading, and the answer `rafa module list` prints.
 *
 * ## Sources
 *
 * A source names its module by what phase 1 can read of it:
 *
 *   - `path`: the directory, resolved against the project root when the
 *     project's `.rafa/config.yaml` gives `modules:` and against the home
 *     when the user scope's does. Its `package.json` is read, and the
 *     module's name is that file's `name`, its manifest the `rafa` key.
 *   - `npm`: the package name. Refused: installing a package is phase 7's.
 *   - `github`: the `owner/repo` it names. Refused, for the same reason.
 *
 * `allowList:` is matched against those names, so a scoped package is
 * enabled as `@scope/name`. A name two sources give is refused at the
 * second. A name `allowList:` holds that no source gives is warned about.
 *
 * ## What a module goes through
 *
 * Every `path` source's `package.json` is read and its manifest checked
 * with `validateManifest` (`manifest.ts`), whether or not it is enabled,
 * so `rafa module list` can say why a disabled module would not load.
 * Only an enabled module goes further, and only with no problem so far:
 *
 *   1. Each `tracker`, `store`, `planner` and `output` entry is resolved
 *      against the module directory and imported. Its default export is
 *      the adapter's `create`, called with an `AdapterContext` and
 *      answering the port. It is registered under its port type and the
 *      `kind` the manifest names, at the port version `requires.ports`
 *      states, so the registry's own refusals apply: a kind core or an
 *      earlier module holds, and a port version core does not serve,
 *      naming both numbers.
 *   2. The `commands` entry, resolved the same way, becomes a
 *      `ModuleCommandEntry`. It is not imported here: the dispatcher's
 *      loader imports it (`src/cli/modules.ts`) and skips it with a
 *      warning naming the file when it fails, a syntax error included.
 *
 * An entry resolving outside its module directory is refused, as is one
 * whose import throws or whose default export is no function. A module is
 * loaded whole or refused whole: its adapters are registered only when
 * every one of them is, and a refused module hands no command entry on.
 *
 * `skills`, `agents`, `mcp` and `prerequisites` are validated with the
 * manifest and placed nowhere. Phase 7 installs the files, writes the MCP
 * declarations and folds the prerequisites into preflight.
 *
 * Validation runs in this process. The spec's subprocess with a timeout
 * is install and enable's, which are phase 7's.
 *
 * ## States and warnings
 *
 * Each source answers one {@link ConfiguredModule}: `loaded`, `refused`,
 * or `disabled` when `allowList:` does not name it, each with the
 * problems found. An enabled module that is refused gives one warning per
 * problem, `module "<name>": <problem>`, and a disabled one gives none:
 * a module an operator has not enabled is no reason to warn on every
 * command. Nothing is written here. The warnings are answered as data,
 * and the dispatcher writes them after its start event.
 *
 * ## Where the answer goes
 *
 * `src/rafa.ts` calls {@link loadInvocationModules} before it dispatches,
 * handing the dispatcher the command entries and the warnings. The
 * adapter registry it answers reaches no reader yet: `resolveTracker`,
 * `selectEffortStore` and `rafa plan` resolve through
 * `CORE_ADAPTER_REGISTRY`, so a module's `tracker.default: linear` is
 * registered and listed by `rafa module list`, and selected by nothing.
 *
 * ## Prototype keys
 *
 * `package.json` is parsed with `JSON.parse`, which keeps `__proto__` as
 * an own key. `name`, `version` and `rafa` are read with `Object.hasOwn`,
 * so none is answered by the prototype, and the manifest reads every key
 * as data (`manifest.ts`).
 */
import type { AdapterRegistry, AnyAdapter } from '../adapters/registry.js';
import type { ModuleCommandEntry, ModuleImporter } from '../cli/modules.js';
import type { ModuleSource } from '../config-sections.js';
import type { ResolvedConfig } from '../config.js';
import type { ManifestSeams, ModuleFeatureType, ModuleManifest } from './manifest.js';

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { CORE_ADAPTER_REGISTRY } from '../adapters/registry.js';
import { importModuleEntry } from '../cli/modules.js';
import { loadConfig } from '../config-load.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';
import { ConfigError } from '../config.js';
import { resolveScope, ScopeError } from '../project/scope.js';

import { RUNNING_MANIFEST_SEAMS, validateManifest } from './manifest.js';

/** What a configured module came to. */
export type ModuleState = 'loaded' | 'refused' | 'disabled';

/** One `modules:` source, as {@link loadModules} read it. */
export interface ConfiguredModule {
  /** Where the config gives it: `modules[0]`. */
  readonly at: string;
  readonly source: ModuleSource;
  /** The name `allowList:` matches, or null for a `path` source whose `package.json` gave none. */
  readonly name: string | null;
  /** The `version` of its `package.json`, or null. */
  readonly version: string | null;
  /** The directory a `path` source names, absolute, or null. */
  readonly directory: string | null;
  /** The types its manifest lists, or empty when the manifest was not read clean. */
  readonly types: readonly ModuleFeatureType[];
  /** Whether `allowList:` names it. */
  readonly enabled: boolean;
  readonly state: ModuleState;
  /** Each adapter registered, as `<port>/<kind>`. Empty unless loaded. */
  readonly adapters: readonly string[];
  /** The absolute command entry handed to the dispatcher, or null. */
  readonly commands: string | null;
  /** Why it was refused, or why it would be. Empty when nothing is wrong. */
  readonly problems: readonly string[];
}

/** What the loader answers. */
export interface LoadedModules {
  /** The base registry with every loaded module's adapters registered. */
  readonly adapters: AdapterRegistry;
  /** The command entries of the loaded modules, in `modules:` order. */
  readonly commands: readonly ModuleCommandEntry[];
  /** Every `modules:` source, in order. */
  readonly modules: readonly ConfiguredModule[];
  /** One sentence per problem of an enabled module, and per `allowList:` name no source gives. */
  readonly warnings: readonly string[];
}

/** What {@link loadModules} reads of a config. */
export interface ModuleSettings {
  readonly modules: readonly ModuleSource[];
  readonly allowList: readonly string[];
  /** The absolute directory a relative `path` source resolves against. */
  readonly base: string;
}

/** What the loader reaches the system through. Each left out is the running one. */
export interface ModuleLoadSeams {
  /** Imports an adapter entry. A dynamic import of the file when left out. */
  readonly importModule?: ModuleImporter;
  /** Reads a file as text, throwing when it cannot. `readFileSync` when left out. */
  readonly readText?: (path: string) => string;
  /** The rafa and port versions a manifest is held to. The running ones when left out. */
  readonly manifest?: ManifestSeams;
  /** The registry adapters are registered on. `CORE_ADAPTER_REGISTRY` when left out. */
  readonly adapters?: AdapterRegistry;
}

/** Where an invocation runs: the working directory and the home, both absolute. */
export interface InvocationPlace {
  readonly cwd: string;
  readonly home: string;
}

/** The port types a manifest can provide an adapter for, in the order they are registered. */
const ADAPTER_TYPES = ['tracker', 'store', 'planner', 'output'] as const;

/** Why a source kind phase 1 does not read is refused. */
const PHASE_7 = 'phase 1 loads path sources alone, and installing a package or a repository is phase 7\'s';

/** What one module came to before `allowList:` is consulted. */
interface Read {
  readonly name: string | null;
  readonly version: string | null;
  readonly directory: string | null;
  readonly manifest: ModuleManifest | null;
  readonly problems: readonly string[];
}

/** What loading an enabled module came to. */
interface Loading {
  readonly adapters: AdapterRegistry;
  readonly registered: readonly string[];
  readonly commands: string | null;
  readonly problems: readonly string[];
}

/** The first line of what was thrown that holds anything. */
function firstLine(error: unknown): string {
  const text = messageOf(error);
  return text.split('\n').find((line) => line.trim() !== '') ?? describeValue(text);
}

/** An own string value of a mapping, or undefined. */
function ownString(record: Record<string, unknown>, key: string): string | undefined {
  const value = Object.hasOwn(record, key)
    ? record[key]
    : undefined;
  return typeof value === 'string'
    ? value
    : undefined;
}

/** A read with nothing but problems. */
function unread(name: string | null, directory: string | null, ...problems: string[]): Read {
  return { name, version: null, directory, manifest: null, problems };
}

/** Reads a `path` source's `package.json` and validates its manifest. */
function readPathSource(source: ModuleSource, settings: ModuleSettings, seams: ModuleLoadSeams): Read {
  const directory = resolve(settings.base, source.location);
  const file = join(directory, 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse((seams.readText ?? ((path) => readFileSync(path, 'utf8')))(file));
  } catch (error) {
    return unread(null, directory, `${file} cannot be read as JSON: ${firstLine(error)}`);
  }
  if (!isMapping(parsed)) return unread(null, directory, `${file} is ${describeValue(parsed)}, expected a mapping`);

  const problems: string[] = [];
  const named = ownString(parsed, 'name');
  const name = named !== undefined && /^[^\s-]\S*$/.test(named)
    ? named
    : null;
  if (name === null) problems.push(`${file}: name is ${describeValue(parsed['name'])}, expected a package name with no space and no leading dash`);
  if (!Object.hasOwn(parsed, 'rafa')) {
    return { name, version: ownString(parsed, 'version') ?? null, directory, manifest: null, problems: [...problems, `${file} carries no rafa manifest`] };
  }
  const validation = validateManifest(parsed['rafa'], `${file}: rafa`, seams.manifest ?? RUNNING_MANIFEST_SEAMS);
  if (!validation.ok) problems.push(...validation.problems);
  return {
    name,
    version: ownString(parsed, 'version') ?? null,
    directory,
    manifest: validation.ok
      ? validation.manifest
      : null,
    problems,
  };
}

/** Reads one source; see the module note. */
function readSource(source: ModuleSource, settings: ModuleSettings, seams: ModuleLoadSeams): Read {
  if (source.kind === 'path') return readPathSource(source, settings, seams);
  return unread(source.location, null, `${source.kind} source ${describeValue(source.location)} is refused: ${PHASE_7}`);
}

/** An entry resolved against its module directory, or the problem keeping it out. */
function resolveEntry(directory: string, entry: string, label: string): { path: string } | { problem: string } {
  const path = resolve(directory, entry);
  const inside = relative(directory, path);
  return inside === '' || inside.startsWith('..') || isAbsolute(inside)
    ? { problem: `${label} is ${describeValue(entry)}, which resolves outside the module directory ${directory}` }
    : { path };
}

/** Imports and registers each adapter entry, then resolves the command entry; see the module note. */
async function loadEnabled(
  read: Read & { readonly manifest: ModuleManifest; readonly directory: string },
  adapters: AdapterRegistry,
  importModule: ModuleImporter,
): Promise<Loading> {
  const { manifest, directory } = read;
  let registry = adapters;
  const registered: string[] = [];
  const problems: string[] = [];

  for (const port of ADAPTER_TYPES) {
    const provision = manifest.provides[port];
    if (provision === undefined) continue;
    const label = `provides.${port}.entry`;
    const entry = resolveEntry(directory, provision.entry, label);
    if ('problem' in entry) {
      problems.push(entry.problem);
      continue;
    }
    let loaded: unknown;
    try {
      loaded = await importModule(entry.path);
    } catch (error) {
      problems.push(`${label} ${entry.path} failed to import: ${firstLine(error)}`);
      continue;
    }
    const create = isMapping(loaded) && Object.hasOwn(loaded, 'default')
      ? loaded['default']
      : undefined;
    if (typeof create !== 'function') {
      problems.push(`${label} ${entry.path} has default export ${describeValue(create)}, expected the adapter's create function`);
      continue;
    }
    try {
      // The registry checks the port, the kind, `create` and the version before holding it.
      registry = registry.register({ port, kind: provision.kind, portVersion: manifest.requires.ports[port], create } as AnyAdapter);
      registered.push(`${port}/${provision.kind}`);
    } catch (error) {
      problems.push(firstLine(error));
    }
  }

  const commandsEntry = manifest.provides.commands === undefined
    ? null
    : resolveEntry(directory, manifest.provides.commands.entry, 'provides.commands.entry');
  if (commandsEntry !== null && 'problem' in commandsEntry) problems.push(commandsEntry.problem);
  const commands = commandsEntry !== null && 'path' in commandsEntry
    ? commandsEntry.path
    : null;

  // The caller keeps the registry and the entry only when no problem was found.
  return { adapters: registry, registered, commands, problems };
}

/** The name a later source repeats, as a problem, or null. */
function repeatedName(name: string | null, at: string, seen: ReadonlyMap<string, string>): string | null {
  const first = name === null
    ? undefined
    : seen.get(name);
  return first === undefined
    ? null
    : `${at} gives the module ${describeValue(name)}, which ${first} gives already`;
}

/**
 * Reads every `modules:` source and loads the ones `allowList:` names,
 * answering the registry, the command entries, each source's state and
 * the warnings. Never throws for a module; see the module note.
 */
export async function loadModules(settings: ModuleSettings, seams: ModuleLoadSeams = {}): Promise<LoadedModules> {
  const importModule = seams.importModule ?? importModuleEntry;
  const allowed = new Set(settings.allowList);
  let adapters = seams.adapters ?? CORE_ADAPTER_REGISTRY;
  const seen = new Map<string, string>();
  const modules: ConfiguredModule[] = [];
  const commands: ModuleCommandEntry[] = [];
  const warnings: string[] = [];

  for (const [index, source] of settings.modules.entries()) {
    const at = `modules[${index}]`;
    const read = readSource(source, settings, seams);
    const repeated = repeatedName(read.name, at, seen);
    if (read.name !== null && repeated === null) seen.set(read.name, at);
    const problems = repeated === null
      ? [...read.problems]
      : [...read.problems, repeated];
    const enabled = read.name !== null && allowed.has(read.name);

    let state: ModuleState = 'disabled';
    let loading: Loading | null = null;
    if (enabled && problems.length === 0 && read.manifest !== null && read.directory !== null) {
      loading = await loadEnabled({ ...read, manifest: read.manifest, directory: read.directory }, adapters, importModule);
      problems.push(...loading.problems);
    }
    if (enabled) {
      state = problems.length === 0
        ? 'loaded'
        : 'refused';
    }
    if (state === 'loaded' && loading !== null && read.name !== null) {
      adapters = loading.adapters;
      if (loading.commands !== null) commands.push(Object.freeze({ name: read.name, entry: loading.commands }));
    }
    if (state === 'refused') warnings.push(...problems.map((problem) => `module ${describeValue(read.name)}: ${problem}`));

    modules.push(Object.freeze({
      at,
      source,
      name: read.name,
      version: read.version,
      directory: read.directory,
      types: read.manifest?.types ?? Object.freeze([]),
      enabled,
      state,
      adapters: Object.freeze(state === 'loaded'
        ? [...(loading?.registered ?? [])]
        : []),
      commands: state === 'loaded'
        ? loading?.commands ?? null
        : null,
      problems: Object.freeze(problems),
    }));
  }

  for (const name of allowed) {
    if (!seen.has(name)) warnings.push(`allowList names the module ${describeValue(name)}, which no modules: source gives`);
  }
  return Object.freeze({
    adapters,
    commands: Object.freeze(commands),
    modules: Object.freeze(modules),
    warnings: Object.freeze(warnings),
  });
}

/** What {@link loadModules} reads of a resolved config, relative `path` sources resolving against the layer that gave them. */
export function moduleSettings(resolved: ResolvedConfig, place: { readonly root: string; readonly home: string }): ModuleSettings {
  return {
    modules: resolved.config.modules,
    allowList: resolved.config.allowList,
    base: resolved.sources.modules === 'user'
      ? place.home
      : place.root,
  };
}

/** An answer holding no module and no warning. */
function noModules(): LoadedModules {
  return Object.freeze({
    adapters: CORE_ADAPTER_REGISTRY,
    commands: Object.freeze([]),
    modules: Object.freeze([]),
    warnings: Object.freeze([]),
  });
}

/**
 * The modules of the project an invocation runs in, read before the line
 * is routed so a module's actions route, render help and are described.
 *
 * Outside a project there are none and nothing is warned. A config
 * `loadConfig` refuses, and a working directory or home the walk refuses,
 * load none and warn nothing either: every command reading the config
 * refuses it, `rafa module list` included, and the dispatcher refuses a
 * command needing a project with the walk's message, so a warning here
 * would say it twice. Measured when this landed, it did: the spawned
 * refusals of `effort collect`, `effort report` and `loop start` gained a
 * `warn: modules not loaded` line ahead of their own. The cost is that a
 * command reading neither, `rafa describe` or a help request, lists no
 * module action under such a config and says nothing of why. The config's
 * unknown keys are not warned about here either: a command reading the
 * config warns about them once.
 */
export async function loadInvocationModules(place: InvocationPlace, seams: ModuleLoadSeams = {}): Promise<LoadedModules> {
  try {
    const scope = resolveScope(place.cwd, { home: place.home });
    if (!scope.found) return noModules();
    const resolved = loadConfig({ root: scope.root, home: scope.home }, {}, () => {});
    return await loadModules(moduleSettings(resolved, scope), seams);
  } catch (error) {
    if (error instanceof ConfigError || error instanceof ScopeError) return noModules();
    throw error;
  }
}
