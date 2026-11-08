/**
 * What every command does before and around its step: find the project,
 * load the config, read the host, and refuse the way a module must.
 *
 * A module cannot throw core's `CommandExit` reliably, since the repo's
 * source can be a second copy of core beside the runtime that loaded it,
 * so a refusal is `output.error` for each line and then a plain `Error`,
 * which the dispatcher ends with exit code 1 (`context/atlas.md`).
 */

import type { LoadedConfig } from '../config/load.js';
import type { HostFacts } from '../host.js';
import type { ProcessRunner } from '../process.js';
import type { CheckReport } from '../steps/check.js';
import type { RafaContext } from '@open-tomato/rafa-core/core/command';

import { loadD2cConfig } from '../config/load.js';
import { D2cConfigError } from '../config/read.js';
import { readHostFacts } from '../host.js';
import { spawnProcess } from '../process.js';
import { projectRootOf } from '../project.js';

/** What a command works with. */
export interface CommandEnv {
  readonly loaded: LoadedConfig;
  readonly run: ProcessRunner;
  readonly host: HostFacts;
}

/** The subject every d2c command is grouped under. */
export const SUBJECT = 'visual';

/** The module name a person types after `exec`. */
export const MODULE = '@open-tomato/rafa-d2c';

/** The line a person types for `action`. */
export function execLine(action: string, rest = ''): string {
  return `rafa module exec ${MODULE} ${action}${rest === ''
    ? ''
    : ` ${rest}`}`;
}

/** Prints each line as an error, then throws the summary. */
export function refuse(context: RafaContext, lines: readonly string[], summary: string): never {
  for (const line of lines) context.output.error(line);
  throw new Error(summary);
}

/** Runs `body`, printing whatever it throws as an error line before rethrowing. */
export async function refusing<T>(context: RafaContext, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof D2cConfigError) refuse(context, error.problems, error.message);
    if (error instanceof Error && error.message.startsWith('check: ')) throw error;
    refuse(context, [error instanceof Error
      ? error.message
      : String(error)], error instanceof Error
      ? error.message
      : String(error));
  }
}

/** Finds the project, loads its config and reads the host. */
export async function prepare(context: RafaContext): Promise<CommandEnv> {
  const root = projectRootOf(context);
  const loaded = await loadD2cConfig(root, spawnProcess);
  return { loaded, run: spawnProcess, host: await readHostFacts(spawnProcess) };
}

/** Prints a check report; refuses when it holds a gap. */
export function printCheck(context: RafaContext, report: CheckReport): void {
  for (const line of report.warnings) context.output.warn(line);
  for (const line of report.notes) context.output.info(line);
  if (report.gaps.length > 0) {
    const noun = report.gaps.length === 1
      ? 'gap'
      : 'gaps';
    refuse(context, report.gaps, `check: ${report.gaps.length} ${noun}; fix each line above, then run ${execLine('check')}`);
  }
  context.output.info(report.runLine);
}
