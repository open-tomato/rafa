#!/usr/bin/env bun

/**
 * rafa's command line: the words after `rafa`, dispatched through the
 * core registry.
 *
 *   rafa plan create --spec=.specs/<file>.md [--stub=<name>]
 *   rafa loop start [--plan=.plans/PLAN-<stub>.md] [--start-at=HH:MM] [--inject=<mode>]
 *   rafa usage
 *   rafa describe [--output=json]
 *   rafa effort collect|report [flags]
 *
 * From a checkout, `bun src/rafa.ts <words>`. `rafa start` and
 * `rafa plan --spec=` still run, each after one deprecation line on
 * stderr.
 *
 * The module holds nothing but the dispatch. `src/commands/index.ts`
 * holds the roster, `src/cli/help.ts` renders `rafa --help` and the help
 * of each subject and action from it, and `src/cli/dispatch.ts` routes
 * the line, runs the command, writes its events and answers the exit
 * code, which this module sets on the process. It sets `process.exitCode`
 * rather than calling `process.exit`, so nothing a command wrote is
 * truncated mid-flush.
 *
 * Importing the module dispatches `process.argv`, so no library module
 * imports it (`src/index.ts`).
 */
import { dispatch } from './cli/dispatch.js';
import { renderHelp } from './cli/help.js';
import { CORE_REGISTRY } from './commands/index.js';

const { exitCode } = await dispatch(process.argv.slice(2), { registry: CORE_REGISTRY, renderHelp });
process.exitCode = exitCode;
