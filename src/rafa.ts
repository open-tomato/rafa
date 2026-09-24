#!/usr/bin/env bun

/**
 * rafa's command line: the words after `rafa`, dispatched through the
 * core registry.
 *
 *   rafa plan create --spec=.rafa/specs/<file>.md [--stub=<name>]
 *   rafa plan create --issue=<n> | --next[=<roadmap-issue>] [--refresh] [--dry-run]
 *   rafa plan list | show <stub> [--tracker] | validate <file>
 *   rafa loop start [--plan=.rafa/plans/PLAN-<stub>.md] [--start-at=HH:MM] [--inject=<mode>]
 *   rafa init [--root=<path>] [--yes]
 *   rafa doctor [--plan=<file>]
 *   rafa usage
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
 * in (`src/modules/load.ts`), so a module's actions route, render help
 * and are described, and hands the dispatcher their command entries and
 * the loader's warnings. `src/commands/index.ts`
 * holds the roster, `src/cli/help.ts` renders `rafa --help` and the help
 * of each subject and action from it, and `src/cli/dispatch.ts` routes
 * the line, runs the command, writes its events and answers the exit
 * code, which this module sets on the process. It hands the dispatcher
 * the since-last-command notice as its command hook
 * (`src/status/hook.ts`), which `src/tests/cli-capture.ts` does not, so
 * an in-process test prints no notice and writes no snapshot. It sets
 * `process.exitCode` rather than calling `process.exit`, so nothing a
 * command wrote is truncated mid-flush.
 *
 * Importing the module dispatches `process.argv`, so no library module
 * imports it (`src/index.ts`).
 */
import { homedir } from 'node:os';

import { dispatch } from './cli/dispatch.js';
import { renderHelp } from './cli/help.js';
import { CORE_REGISTRY } from './commands/index.js';
import { loadInvocationModules } from './modules/load.js';
import { createStatusHook } from './status/hook.js';

const modules = await loadInvocationModules({ cwd: process.cwd(), home: homedir() });
const { exitCode } = await dispatch(process.argv.slice(2), {
  registry: CORE_REGISTRY,
  renderHelp,
  modules: modules.commands,
  warnings: modules.warnings,
  commandHook: createStatusHook(),
});
process.exitCode = exitCode;
