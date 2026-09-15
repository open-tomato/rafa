/**
 * `rafa module list`: every module the config gives a source for, what
 * it came to, and whether its commands are mounted.
 *
 * ## What is listed
 *
 * Each `modules:` source, in order, as `loadModules` reads it
 * (`src/modules/load.ts`): its name, version and types, whether
 * `allowList:` names it, its state (`loaded`, `refused` or `disabled`),
 * the adapters it registered, its command entry, and every problem. A
 * disabled module is read and validated too, so its problems say why it
 * would not load once enabled.
 *
 * The config is read as `loop start` reads it, and the modules are
 * loaded again from it. `mounted` is read off the registry the line was
 * routed through, so it is what this invocation's dispatcher mounted: a
 * loaded module whose command entry the dispatcher skipped reads
 * `mounted: false`, and the dispatcher's warning names the file.
 *
 * ## What it writes
 *
 * In json mode the terminal result's `data` holds `modules`, each a
 * `ConfiguredModule` with `mounted` added. Text mode writes `Modules:` and
 * one row per module with its details below, or `No modules configured.`
 * alone.
 *
 * ## Refusals
 *
 * Exit code 1 for an argument, and for a config `loadConfig` refuses. The
 * command declares no flag.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ModuleSource } from '../../config-sections.js';
import type { ConfiguredModule, ModuleLoadSeams } from '../../modules/load.js';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { loadModules, moduleSettings } from '../../modules/load.js';
import { expectNoArgument } from '../plan/plan-files.js';

/** The usage line a refusal names. */
const USAGE = 'rafa module list';

/** One module as the list holds it. */
export interface ModuleListing extends ConfiguredModule {
  /** Whether the registry the line was routed through mounts it under `module/<name>`. */
  readonly mounted: boolean;
}

/** Every configured module. */
export interface ModuleList {
  readonly modules: readonly ModuleListing[];
}

/** A source as a row names it: `path ../my-output`, `github someone/repo@v0.3.0`. */
export function sourceText(source: ModuleSource): string {
  const ref = source.ref === null
    ? ''
    : `@${source.ref}`;
  return `${source.kind} ${source.location}${ref}`;
}

/** The lines text mode writes for one module. */
function moduleLines(listing: ModuleListing): string[] {
  const types = listing.types.length === 0
    ? 'no types read'
    : listing.types.join(', ');
  const commands = listing.commands === null
    ? []
    : [`    commands: ${listing.commands} (${listing.mounted
      ? 'mounted'
      : 'not mounted'})`];
  return [
    `  ${listing.name ?? listing.at} ${listing.version ?? '(no version)'}: ${listing.state}, ${listing.enabled
      ? 'enabled'
      : 'disabled'}; types ${types}; from ${sourceText(listing.source)}`,
    ...listing.adapters.map((adapter) => `    adapter: ${adapter}`),
    ...commands,
    ...listing.problems.map((problem) => `    problem: ${problem}`),
  ];
}

/** The lines text mode writes for a list. */
export function renderModuleList(list: ModuleList): string[] {
  if (list.modules.length === 0) return ['No modules configured.'];
  return ['Modules:', ...list.modules.flatMap(moduleLines)];
}

/** Lists the configured modules. See the module note. */
async function runList(context: RafaContext, seams: ModuleLoadSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const { project } = context;
  if (project === null) throw new CommandExit(1, `❌ ${USAGE} runs inside a project`);

  let loaded;
  try {
    const resolved = loadConfig({ root: project.root, home: project.home });
    loaded = await loadModules(moduleSettings(resolved, project), seams);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, ['❌ rafa module list: the config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'));
  }

  const list: ModuleList = {
    modules: loaded.modules.map((module): ModuleListing => ({
      ...module,
      mounted: module.name !== null && context.registry.mountOf(module.name) !== undefined,
    })),
  };
  if (context.outputMode === 'json') {
    context.output.result(list);
    return;
  }
  for (const line of renderModuleList(list)) context.output.info(line);
}

/** The command, loading modules through `seams`. See the module note. */
export function createModuleListCommand(seams: ModuleLoadSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'module list',
    subject: 'module',
    action: 'list',
    summary: 'list the modules the config gives a source for, and what each came to',
    description: 'Lists every source under `modules:` in the config, in order: the module\'s name,'
      + ' version and types, whether `allowList:` names it, whether it loaded, was refused or is'
      + ' disabled, the adapters it registered, its command entry and whether that is mounted, and'
      + ' every problem found. Phase 1 loads `path` sources alone and refuses `npm` and `github` ones.'
      + ' A disabled module is validated too, so its problems say why it would not load. With'
      + ' `--output=json` the modules are the data of the terminal result event.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa module list',
        note: 'Prints one row per configured module: its name, version, state, types and source.',
      },
      {
        cmd: 'rafa module list --output=json',
        note: 'Writes a start event, then a result event whose data is the modules.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runList(context, seams),
  };
  return Object.freeze(command);
}

export default createModuleListCommand();
