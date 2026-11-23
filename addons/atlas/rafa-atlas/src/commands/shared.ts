/**
 * What every Atlas command does around its step: find the project root,
 * and refuse the way a module must.
 *
 * `module exec` resolves no project, so the root is `ATLAS_PROJECT_ROOT`
 * when it is set, the context's project when the dispatcher handed one,
 * and the working directory otherwise. A worktree holds no effort store,
 * so a run from one names the main checkout through `ATLAS_PROJECT_ROOT`;
 * `RAFA_EFFORT_DIR` still wins for the store itself, as the build reads it.
 *
 * A module cannot throw core's `CommandExit` reliably, since the repo's
 * source can be a second copy of core beside the runtime that loaded it,
 * so a refusal is `output.error` for each line and then a plain `Error`,
 * which the dispatcher ends with exit code 1 (`context/atlas.md`).
 */
import type { RafaContext } from '@open-tomato/rafa-core/core/command';

import { resolve } from 'node:path';

import { AtlasConfigError } from '../config.js';

/** The subject every Atlas command is grouped under. */
export const SUBJECT = 'atlas';

/** The module name a person types after `exec`. */
export const MODULE = '@open-tomato/rafa-atlas';

/** The line a person types for `action`. */
export function execLine(action: string, rest = ''): string {
  return `rafa module exec ${MODULE} ${action}${rest === ''
    ? ''
    : ` ${rest}`}`;
}

/** The project root the command reads; see the module note. */
export function projectRootOf(context: RafaContext, cwd: string = process.cwd()): string {
  const named = context.env['ATLAS_PROJECT_ROOT'];
  if (named !== undefined && named !== '') return resolve(named);
  return context.project?.root ?? cwd;
}

/** Prints each line as an error, then throws the summary. */
export function refuse(context: RafaContext, lines: readonly string[], summary: string): never {
  for (const line of lines) context.output.error(line);
  throw new Error(summary);
}

/** The message of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** Runs `body`, printing whatever it throws as error lines before refusing with it. */
export async function refusing<T>(context: RafaContext, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof AtlasConfigError) refuse(context, error.problems.map((problem) => `${error.file}: ${problem}`), error.message);
    refuse(context, [messageOf(error)], messageOf(error));
  }
}

/** A flag read as a whole number of at least `min`; `fallback` when absent. Throws naming the flag otherwise. */
export function wholeFlag(context: RafaContext, name: string, fallback: number, min: number): number {
  const value = context.flags[name];
  if (value === undefined) return fallback;
  const read = typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : Number.NaN;
  if (!Number.isSafeInteger(read) || read < min) {
    throw new Error(`--${name} is ${JSON.stringify(value)}, expected a whole number of at least ${min}`);
  }
  return read;
}
