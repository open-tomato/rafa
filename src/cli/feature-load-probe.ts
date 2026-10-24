/**
 * The probe `feature-load-cli.test.ts` spawns fresh: it does what
 * `src/rafa.ts` does before it dispatches, then prints, as one JSON line
 * on stdout, which modules the process holds loaded, so a test can read
 * what a roster, a help render or a module load pulled in and not what a
 * second import in the test's own process left behind.
 *
 * ## The modes
 *
 *   - No argument: registers core's config sections, adapters and
 *     services, builds `createRosterRegistry()`, renders every help
 *     level (the root, each subject, each action) and
 *     `describeRegistry`, and prints `{ loaded, featureActions }`.
 *   - `--run=<subject> <action>`: the same, then runs that command's
 *     `run` over a context holding no project and no argument, catching
 *     what it throws, and prints `refusal` beside the two fields above:
 *     the thrown message, or null when nothing was thrown.
 *   - `--project=<dir> --home=<dir>`: registers core's sections,
 *     adapters and services, reads the core adapter kinds, calls
 *     `loadInvocationModules` over that working directory and home and
 *     `activateModuleAdapters` over what it loaded, and prints
 *     `{ loaded, kindsBefore, kindsAfter, syncGitResolves }`. No roster
 *     is built in this mode.
 *
 * `loaded` is every module of `require.cache` under the repository root,
 * as a path relative to it with `/` for a separator, sorted.
 * `featureActions` lists each action the bundled features declare, as
 * `{ feature, subject, action }`, so the test spells no feature's
 * commands of its own.
 */
import type { CommandFeature, RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';

import { createRequire } from 'node:module';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';
import { commandSpelling, isTopLevel } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activateModuleAdapters } from '@open-tomato/rafa/modules/activate';
import { loadInvocationModules } from '@open-tomato/rafa/modules/load';

import { registerCoreAdapters } from '../adapter-registry.js';
import { BUNDLED_FEATURES, createRosterRegistry } from '../commands/index.js';
import { registerCoreConfigSections } from '../config-registry.js';
import { registerCoreServices } from '../service-registry.js';

import { describeRegistry } from './describe.js';
import { renderHelp } from './help.js';

/** The repository root, with a trailing separator. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The version `describeRegistry` is stamped with: the probe reads nothing of it. */
const DESCRIBE_VERSION = '0.0.0';

/** A flag of the probe: its name and the text after `=`. */
function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((word) => word.startsWith(prefix))
    ?.slice(prefix.length);
}

/** The modules of `require.cache` under the repository root, relative to it and sorted. */
function loadedModules(): string[] {
  return Object.keys(createRequire(import.meta.url).cache)
    .filter((file) => isAbsolute(file))
    .map((file) => relative(REPOSITORY_ROOT, file))
    .filter((path) => path !== '' && !path.startsWith('..'))
    .map((path) => path.split(sep).join('/'))
    .sort();
}

/** Every port type's kinds on the registry `resolve` reads, by port type. */
function adapterKinds(): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.keys(PORT_VERSIONS).map((port) => [port, CORE_ADAPTER_REGISTRY.kinds(port as keyof typeof PORT_VERSIONS)]),
  );
}

/** Renders the root help, each subject's and each action's, and the `describe` document. */
function renderEverything(registry: ReturnType<typeof createRosterRegistry>): void {
  renderHelp({ level: 'root' }, registry);
  for (const subject of registry.subjects()) renderHelp({ level: 'subject', subject }, registry);
  for (const command of registry.commands()) {
    renderHelp({ level: 'action', command, spelling: commandSpelling(command), module: null }, registry);
  }
  JSON.stringify(describeRegistry(registry, DESCRIBE_VERSION));
}

/** The actions the bundled features declare, by feature, as the test reads them. */
function featureActions(features: readonly CommandFeature[]): { feature: string; subject: string; action: string }[] {
  return features.flatMap((feature) => feature.commands
    .filter((command) => !isTopLevel(command))
    .map((command) => ({ feature: feature.name, subject: command.subject, action: command.action })));
}

/** The message `command.run` throws over a context holding no project and no argument, or null for none. */
async function refusalOf(command: RafaCommand, registry: ReturnType<typeof createRosterRegistry>): Promise<string | null> {
  const silent = { info: () => {}, warn: () => {}, error: () => {}, result: () => {} };
  const context = { argv: [], args: [], flags: {}, registry, project: null, output: silent, outputMode: 'text' };
  try {
    await command.run(context as unknown as RafaContext);
    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/** The roster mode, with the command `--run` names run when it is given. */
async function probeRoster(run: string | undefined): Promise<Record<string, unknown>> {
  registerCoreConfigSections();
  registerCoreAdapters();
  registerCoreServices();
  const registry = createRosterRegistry();
  renderEverything(registry);
  const actions = featureActions(BUNDLED_FEATURES);
  if (run === undefined) return { loaded: loadedModules(), featureActions: actions };

  const [subject, action] = run.split(' ');
  const command = registry.commands().find((candidate) => candidate.subject === subject && candidate.action === action);
  if (command === undefined) throw new Error(`the roster holds no command "${run}"`);
  const refusal = await refusalOf(command, registry);
  return { loaded: loadedModules(), featureActions: actions, refusal };
}

/** The module mode over a scratch project and home. */
async function probeModules(cwd: string, home: string): Promise<Record<string, unknown>> {
  registerCoreConfigSections();
  registerCoreAdapters();
  registerCoreServices();
  const kindsBefore = adapterKinds();
  const modules = await loadInvocationModules({ cwd, home });
  activateModuleAdapters(modules);
  return {
    loaded: loadedModules(),
    kindsBefore,
    kindsAfter: adapterKinds(),
    syncGitResolves: CORE_ADAPTER_REGISTRY.find('sync', 'git') !== undefined,
    warnings: modules.warnings,
  };
}

const project = flagValue('project');
const home = flagValue('home');
const reading = project !== undefined && home !== undefined
  ? await probeModules(project, home)
  : await probeRoster(flagValue('run'));
process.stdout.write(`${JSON.stringify(reading)}\n`);
