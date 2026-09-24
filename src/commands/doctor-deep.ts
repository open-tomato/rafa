/**
 * `rafa doctor --deep`'s whole reading: every deep section read once per
 * run into one {@link DeepReading}, the lines text mode prints of it,
 * and the seams `DoctorSeams` (`./doctor.ts`) takes for it.
 *
 * A module of its own, as `./doctor.ts` is near the 800-line cap
 * (`context/source.md`). It re-derives nothing: each section is read and
 * turned into rows by its own module, and this one decides only what
 * each is read UNDER, in which order, and how the Environment reading
 * reads as rows, which no other module renders.
 *
 * ## Read once, in order
 *
 *   1. **Environment** (`./doctor-deep-env.ts`): the environment a
 *      session is handed — `sessionSpawnEnv` of the invocation's
 *      `RafaContext.env` with each loaded settings file's `env` over it —
 *      and the directory it runs in, the rafa process's own
 *      ({@link DeepDoctorSeams.sessionCwd}).
 *   2. **Settings** (`./doctor-deep-settings.ts`) and **Stack tools**
 *      (`./doctor-deep-needs.ts`), both over ONE set of inventory seams
 *      built as `rafa plan needs` builds its own: the project root and
 *      home, `loop.settingSources`, `tiers.rafa`, `tiers.skills` and
 *      `tiers.agents`, the config's loaded modules, the rafa
 *      tier beside the entry, and the `PATH` of step 1's environment,
 *      not the shell's, so a program is looked up where a session looks.
 *   3. **Providers** (`./doctor-deep-providers.ts`): every `gh` probe
 *      found and spawned under step 1's environment, in the project root.
 *   4. **Plan needs**, for a plan `--plan` names alone: its `isUnmet`
 *      needs, read over step 2's seams.
 *
 * A reader warning the Settings section prints is left out of the
 * sections after it, so a file that does not parse is named once.
 *
 * ## The Environment rows
 *
 * | Row | Status |
 * | --- | --- |
 * | the working directory, when it is the project root | `ok` |
 * | the working directory, when it is not | `note` |
 * | the environment, when no key and no `PATH` entry differs | `ok` |
 * | `PATH` losing a directory the shell searches | `warn` |
 * | `PATH` gaining a directory, or searching in another order | `note` |
 * | each other key added, changed or removed, and who set it | `note` |
 * | each settings file whose `env` a session is not handed | `note` |
 * | each settings file, or `env` entry, that did not read | `warn` |
 *
 * A row names keys and directories, never a value: an environment holds
 * tokens, and a doctor report is pasted into issues. A `PATH` a settings
 * file sets replaces the shell's whole, as Claude Code expands nothing
 * in it, so a lost directory's fix names that file.
 *
 * ## The json shape
 *
 * {@link DeepReading} is plain data, every section as the rows text mode
 * prints, so json mode can give it as is: it holds no `Map`, no function
 * and no environment value, and `JSON.stringify` loses nothing of it
 * but a row's absent `fix`.
 *
 * No reading here changes doctor's exit code or adds a preflight item:
 * every row is `ok`, `warn` or `note` (`./doctor-deep-row.ts`).
 */
import type { DeepRow, DeepSection } from './doctor-deep-row.js';
import type { GhRunner, GhRunnerOptions } from '../adapters/tracker/github.js';
import type { ClaudeSettingSource } from '../config-sections.js';
import type { ResolvedConfig } from '../config.js';
import type { EnvDifference, EnvLayer, PathDifference, SessionEnvReading } from './doctor-deep-env.js';
import type { ModuleLoadSeams } from '../modules/load.js';
import type { NeedsSeams, NeedsWarning } from '../plan/needs.js';
import type { ResolvePrProviderOptions } from '../pr/provider.js';
import type { ProjectFound } from '../project/scope.js';

import { pathDirectories } from '../check/references.js';
import { loadModules, moduleSettings } from '../modules/load.js';

import { PATH_KEY, readSessionEnv, SETTINGS_ENV_KEY } from './doctor-deep-env.js';
import { planNeedsSection, readDeepPlanNeeds, readDeepStackTools, stackToolsSection } from './doctor-deep-needs.js';
import { providersSection, readDeepProviders } from './doctor-deep-providers.js';
import { renderDeepSection } from './doctor-deep-row.js';
import { readDeepSettings, SETTING_SOURCES_KEY, settingsSection } from './doctor-deep-settings.js';
import { labelOf } from './plan/needs.js';

/** The Environment section's title. */
export const ENVIRONMENT_SECTION_TITLE = 'Environment';

/** How the inventory both inventory sections read is built. */
export interface DeepInventorySeams {
  /** This process's entry, which the rafa tier sits beside. `Bun.main` when left out. */
  readonly entry?: () => string;
  /** What the config's modules are loaded through. The loader's own when left out. */
  readonly modules?: ModuleLoadSeams;
}

/** What `--deep` adds to `DoctorSeams`; each left out is the runner's own. */
export interface DeepDoctorSeams {
  /** The directory a session would run in: the rafa process's. `process.cwd()` when left out. */
  readonly sessionCwd?: () => string;
  /** Opens the runner the Providers probes go through, handed the session's environment. `createGhRunner` when left out. */
  readonly openProviderGh?: (options: GhRunnerOptions) => GhRunner;
  /** How the inventory is built. */
  readonly inventory?: DeepInventorySeams;
}

/** What {@link readDeep} reads through: `DeepDoctorSeams`, and doctor's `origin` probe. */
export interface ReadDeepSeams extends DeepDoctorSeams {
  /** The `origin` probe the provider is read through. `gitRemoteUrl` when left out. */
  readonly readRemote?: ResolvePrProviderOptions['readRemote'];
}

/** What one run hands {@link readDeep}. */
export interface DeepInput {
  /** The project doctor runs in. */
  readonly project: ProjectFound;
  /** The shell's environment: the invocation's `RafaContext.env`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The config as it resolves for the project, with where each key came from. */
  readonly resolved: ResolvedConfig;
  /** The plan `--plan` names, absolute; null without the flag. */
  readonly plan: string | null;
}

/** Every deep section of one run, as json mode gives it; see the module note. */
export interface DeepReading {
  /** The directory a session runs in. */
  readonly cwd: string;
  /** The project root the settings and stack were read under. */
  readonly projectRoot: string;
  /** `loop.settingSources`, which decided every section. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The plan `--plan` names, relative to the project root when under it; null without the flag. */
  readonly plan: string | null;
  readonly environment: DeepSection;
  readonly settings: DeepSection;
  readonly providers: DeepSection;
  readonly stackTools: DeepSection;
  /** Null without `--plan`. */
  readonly planNeeds: DeepSection | null;
}

/** Who set a key, as a phrase: rafa's spawn, or a settings file. */
function layerPhrase(layer: EnvLayer | null, reading: SessionEnvReading): string {
  if (layer === null) return 'no layer';
  if (layer === 'spawn') return 'rafa\'s spawn';
  const path = reading.scopes.find((scope) => scope.scope === layer)?.path;
  return path === undefined
    ? `the ${layer} settings`
    : `the ${layer} settings file ${path}`;
}

/** The working directory's row; see the module note. */
function cwdRow(reading: SessionEnvReading): DeepRow {
  const name = 'working directory';
  if (reading.cwd === reading.projectRoot) return { status: 'ok', name, detail: `the project root, ${reading.cwd}` };
  return {
    status: 'note',
    name,
    detail: `${reading.cwd}, not the project root ${reading.projectRoot ?? '(none)'}:`
      + ' a session reads .claude/settings.json under the directory it runs in',
    fix: `run rafa from ${reading.projectRoot ?? 'the project root'}`,
  };
}

/** The directories of a list, joined for a row. */
function joined(directories: readonly string[]): string {
  return directories.join(', ');
}

/** The `PATH` row of a difference; see the module note. */
function pathRow(path: PathDifference, reading: SessionEnvReading): DeepRow {
  const setBy = `set by ${layerPhrase(path.layer, reading)}`;
  const parts = [
    ...(path.added.length === 0
      ? []
      : [`gains ${joined(path.added)}`]),
    ...(path.reordered
      ? ['searches the directories both hold in another order']
      : []),
  ];
  if (path.removed.length === 0) return { status: 'note', name: PATH_KEY, detail: `${parts.join('; ')}; ${setBy}` };

  const detail = [`loses ${joined(path.removed)}, which the shell searches`, ...parts, setBy].join('; ');
  const file = path.layer === null || path.layer === 'spawn'
    ? null
    : reading.scopes.find((scope) => scope.scope === path.layer)?.path ?? null;
  return file === null
    ? { status: 'warn', name: PATH_KEY, detail }
    : {
      status: 'warn',
      name: PATH_KEY,
      detail,
      fix: `add the lost directories to ${SETTINGS_ENV_KEY}.${PATH_KEY} in ${file}, which replaces the shell's ${PATH_KEY} whole`,
    };
}

/** One key's `note` row: how it differs, and who set it. Never its value. */
function differenceRow(difference: EnvDifference, reading: SessionEnvReading): DeepRow {
  const detail = difference.kind === 'removed'
    ? 'removed: the shell has it and a session does not'
    : `${difference.kind} by ${layerPhrase(difference.layer, reading)}`;
  return { status: 'note', name: difference.key, detail };
}

/** A `note` per settings file holding an `env` a session is not handed. */
function unloadedRows(reading: SessionEnvReading): readonly DeepRow[] {
  return reading.scopes
    .filter((scope) => !scope.loaded && scope.entries.size > 0)
    .map((scope): DeepRow => ({
      status: 'note',
      name: `${scope.scope} settings ${SETTINGS_ENV_KEY}`,
      detail: `${scope.path} sets ${[...scope.entries.keys()].join(', ')}, which a session is not handed:`
        + ` ${SETTING_SOURCES_KEY} leaves out ${scope.scope}`,
    }));
}

/** The key a warning is compared under. */
function warningKey(warning: NeedsWarning): string {
  return `${warning.path}\u0000${warning.reason}`;
}

/** The Environment section of a reading, leaving out the warnings `shown` holds; see the module note. */
export function environmentSection(reading: SessionEnvReading, shown: readonly NeedsWarning[] = []): DeepSection {
  const same = reading.differences.length === 0 && reading.path === null;
  const seen = new Set(shown.map(warningKey));
  const warnings = reading.warnings
    .filter((warning) => !seen.has(warningKey(warning)))
    .map((warning): DeepRow => ({
      status: 'warn',
      name: warning.path,
      detail: warning.loaded
        ? warning.reason
        : `${warning.reason} (a file sessions do not load)`,
    }));
  return {
    title: ENVIRONMENT_SECTION_TITLE,
    rows: [
      cwdRow(reading),
      ...(same
        ? [{ status: 'ok', name: 'environment', detail: 'the same as the shell\'s' } satisfies DeepRow]
        : []),
      ...(reading.path === null
        ? []
        : [pathRow(reading.path, reading)]),
      ...reading.differences.map((difference) => differenceRow(difference, reading)),
      ...unloadedRows(reading),
      ...warnings,
    ],
  };
}

/** The inventory seams both inventory sections read, under the session's `PATH`; see the module note. */
async function inventorySeams(input: DeepInput, sessionPath: string | undefined, seams: DeepInventorySeams): Promise<NeedsSeams> {
  const { project, resolved } = input;
  const loaded = await loadModules(moduleSettings(resolved, project), seams.modules);
  const entry = seams.entry ?? ((): string => Bun.main);
  return {
    home: project.home,
    projectRoot: project.root,
    entry: entry(),
    pathDirs: pathDirectories(sessionPath),
    settingSources: resolved.config.settingSources,
    tiersRafa: resolved.config.tiersRafa,
    tiersSkills: resolved.config.tiersSkills,
    tiersAgents: resolved.config.tiersAgents,
    modules: loaded.modules,
  };
}

/** Every deep section of one run, each read once; see the module note. Never throws for what it reads. */
export async function readDeep(input: DeepInput, seams: ReadDeepSeams = {}): Promise<DeepReading> {
  const { project, resolved } = input;
  const { config } = resolved;
  const cwd = (seams.sessionCwd ?? ((): string => process.cwd()))();
  const session = readSessionEnv({
    env: input.env,
    settingSources: config.settingSources,
    home: project.home,
    projectRoot: project.root,
    cwd,
  });

  const needs = await inventorySeams(input, session.env[PATH_KEY], seams.inventory ?? {});
  const settings = readDeepSettings(needs);
  const shown = settings.warnings;
  const providers = await readDeepProviders({
    env: session.env,
    cwd: project.root,
    config,
    readRemote: seams.readRemote,
    openGh: seams.openProviderGh,
  });
  const stack = await readDeepStackTools(needs);
  const plan = input.plan === null
    ? null
    : { path: input.plan, label: labelOf(project.root, input.plan) };
  const planNeeds = plan === null
    ? null
    : planNeedsSection(await readDeepPlanNeeds(plan.path, plan.label, needs), shown);

  return Object.freeze({
    cwd,
    projectRoot: project.root,
    settingSources: Object.freeze([...config.settingSources]),
    plan: plan?.label ?? null,
    environment: environmentSection(session, shown),
    settings: settingsSection(settings),
    providers: providersSection(providers),
    stackTools: stackToolsSection(stack, needs, shown),
    planNeeds,
  });
}

/** The sections of a reading in the order they print: Plan needs last, and only with `--plan`. */
export function deepSections(reading: DeepReading): readonly DeepSection[] {
  return [
    reading.environment,
    reading.settings,
    reading.providers,
    reading.stackTools,
    ...(reading.planNeeds === null
      ? []
      : [reading.planNeeds]),
  ];
}

/** The lines text mode writes for a reading: each section, in order, through the shared rows. */
export function renderDeep(reading: DeepReading): readonly string[] {
  return deepSections(reading).flatMap(renderDeepSection);
}
