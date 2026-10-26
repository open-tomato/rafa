#!/usr/bin/env bun

/**
 * rafa's command line: the words after `rafa`, dispatched through the
 * core registry.
 *
 *   rafa plan create --spec=.rafa/specs/<file>.md [--stub=<name>]
 *   rafa plan create --issue=<n> | --next[=<roadmap-issue>] [--refresh] [--dry-run]
 *   rafa plan list [--open] | show <stub> [--tracker] | validate <file>
 *   rafa loop start [--plan=.rafa/plans/PLAN-<stub>.md] [--start-at=HH:MM] [--inject=<mode>]
 *   rafa init [--root=<path>] [--yes]
 *   rafa doctor [--plan=<file>]
 *   rafa describe [--output=json]
 *   rafa effort collect|report [flags]
 *   rafa module list | exec <module> <action>
 *
 * From a checkout, `bun src/rafa.ts <words>`. `rafa start` and
 * `rafa plan --spec=` still run, each after one deprecation line on
 * stderr.
 *
 * The module holds nothing but the dispatch, the modules loaded for it
 * and the command hook handed to it. It first loads the modules of the project the working directory is
 * in (`packages/rafa/src/modules/load.ts`), so a module's actions route, render help
 * and are described, and hands the dispatcher their command entries and
 * the loader's warnings. Before it dispatches, it makes the adapters
 * those modules registered the active registry with
 * `activateModuleAdapters` (`packages/rafa/src/modules/activate.ts`), so a module's
 * kind resolves through `CORE_ADAPTER_REGISTRY` for the invocation.
 * It then builds the registry it dispatches through with
 * `createRosterRegistry` (`src/commands/index.ts`), core's commands
 * plus every bundled feature the project's config does not turn off
 * (`LoadedModules.disabledFeatures`), so a feature turned off neither
 * routes nor renders help. `src/commands/index.ts` holds the roster, `src/cli/help.ts` renders `rafa --help` and the help
 * of each subject and action from it, and `src/cli/dispatch.ts` routes
 * the line, runs the command, writes its events and answers the exit
 * code, which this module sets on the process. It hands the dispatcher
 * the since-last-command notice as its command hook
 * (`src/status/hook.ts`), which `src/tests/cli-capture.ts` does not, so
 * an in-process test prints no notice and writes no snapshot. It sets
 * `process.exitCode` rather than calling `process.exit`, so nothing a
 * command wrote is truncated mid-flush.
 *
 * It imports `src/config-registry.ts` and `src/adapter-registry.ts`,
 * neither of which registers anything as it is imported: once its
 * imports have loaded, the module calls `registerCoreConfigSections`,
 * which hands the fourteen sections of the config schema to core, then
 * `registerCoreAdapters`, both before it loads the project's modules,
 * so every setting is registered before anything run here reads a
 * config and core's adapters before anything resolves one. From
 * `src/commands/index.ts` it imports `createRosterRegistry` rather than
 * the default `CORE_REGISTRY`, since the roster it dispatches through
 * depends on the features the loaded config turns off, which is known
 * only after `loadInvocationModules` has run. A call
 * survives a bundler that drops an import kept for its effect alone.
 *
 * Importing the module dispatches `process.argv`, so no library module
 * imports it (`src/index.ts`).
 */
import { homedir } from 'node:os';

import { activateModuleAdapters } from '@open-tomato/rafa/modules/activate';
import { loadInvocationModules } from '@open-tomato/rafa/modules/load';

import { registerCoreAdapters } from './adapter-registry.js';
import { dispatch } from './cli/dispatch.js';
import { renderHelp } from './cli/help.js';
import { createRosterRegistry } from './commands/index.js';
import { registerCoreConfigSections } from './config-registry.js';
import { createStatusHook } from './status/hook.js';

registerCoreConfigSections();
registerCoreAdapters();

const modules = await loadInvocationModules({ cwd: process.cwd(), home: homedir() });
activateModuleAdapters(modules);
const registry = createRosterRegistry({ off: modules.disabledFeatures });
const { exitCode } = await dispatch(process.argv.slice(2), {
  registry,
  renderHelp,
  modules: modules.commands,
  warnings: modules.warnings,
  commandHook: createStatusHook(),
});
process.exitCode = exitCode;
