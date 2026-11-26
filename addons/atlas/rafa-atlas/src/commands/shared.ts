/**
 * What every Atlas command does around its step: find the project root,
 * read the `--github` switch into the build's options, and refuse the way
 * a module must.
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
 *
 * `--github` (D9) is the one switch that lets a build call `gh`: bare, or
 * `--github=true`, it is on; left out, `--no-github` or `--github=false`,
 * it is off, and any other value refuses naming the flag.
 *
 * The layers come from `context.moduleConfig`: the raw `atlas` section of
 * the project's config, the key the manifest declares under
 * `provides.config`, which the runtime hands the command unread. It is
 * read through `readAtlasLayers` (`../layers.ts`), so a section that does
 * not parse throws `AtlasConfigError`, which `refusing` prints as one
 * error line per problem before the build starts; an unset section is
 * no layers, and every `module_facts.layer` reads NULL.
 */
import type { BuildOptions } from '../build/index.js';
import type { GhRunner } from '@open-tomato/rafa-board';
import type { RafaContext, RafaFlagSpec } from '@open-tomato/rafa-core/core/command';

import { resolve } from 'node:path';

import { AtlasConfigError } from '../config.js';
import { readAtlasLayers } from '../layers.js';

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

/** The `--github` flag `build` and `serve` declare. */
export const GITHUB_FLAG: RafaFlagSpec = {
  name: 'github',
  description: 'also read pull requests and issue times from GitHub with gh; a failed read warns, and the rest is built without it',
  type: 'boolean',
};

/** Whether the context asks for the GitHub read; see the module note. Throws naming the flag on another value. */
export function githubFlagOf(context: RafaContext): boolean {
  const value = context.flags[GITHUB_FLAG.name];
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new Error(`--${GITHUB_FLAG.name} is ${JSON.stringify(value)}, expected no value, true or false`);
}

/**
 * The build options of the context: its root, its environment, `--github`
 * and the layers of its `atlas` section; `gh`, when given, stands in for
 * `gh`. Throws `AtlasConfigError` for a section that does not parse.
 */
export function buildOptionsOf(context: RafaContext, gh?: GhRunner): BuildOptions {
  return {
    projectRoot: projectRootOf(context),
    env: context.env,
    github: githubFlagOf(context),
    layers: readAtlasLayers(context.moduleConfig),
    ...(gh === undefined
      ? {}
      : { gh }),
  };
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
