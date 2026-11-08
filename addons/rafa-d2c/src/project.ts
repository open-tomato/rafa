/**
 * The two roots a command works in. `module exec` resolves no project,
 * so a module command walks the scope itself, through core's own walk:
 * a linked worktree, whose `.rafa/` is gitignored, resolves to its main
 * checkout, where the d2c config lives. That is the project root.
 *
 * The suite still runs in the checkout the command runs from, so a
 * branch's worktree tests the branch and two worktrees never seed one
 * folder. That is the work root: the linked worktree when the project
 * root is its main checkout, and the project root in every other case.
 */
import type { ProcessRunner } from './process.js';
import type { RafaContext } from '@open-tomato/rafa-core/core/command';

import { realpath } from 'node:fs/promises';
import { dirname, sep } from 'node:path';

import { resolveScope } from '@open-tomato/rafa-core/project/scope';

/** The project root: the context's project, or the scope walk from `cwd`. Throws with the `rafa init` hint outside a project. */
export function projectRootOf(context: RafaContext, cwd: string = process.cwd()): string {
  if (context.project !== null) return context.project.root;
  const home = context.env['HOME'];
  if (home === undefined || home === '') throw new Error('HOME is not set, so the project scope cannot be resolved');
  const scope = resolveScope(cwd, { home });
  if (!scope.found) throw new Error(scope.hint);
  return scope.root;
}

/** One git answer in `cwd`, as a real path, or null when git answers nothing. */
async function gitPath(run: ProcessRunner, cwd: string, args: readonly string[]): Promise<string | null> {
  const result = await run(['git', ...args], { cwd });
  const answer = result.stdout.trim();
  if (result.exitCode !== 0 || answer === '') return null;
  return realpath(answer);
}

/**
 * The checkout the suite runs in, seen from `cwd`. It is the top of the
 * linked worktree holding `cwd` when `projectRoot` is that worktree's
 * main checkout, and `projectRoot` otherwise: outside git, in the main
 * checkout itself, and for a project at or below the working tree's top.
 */
export async function workRootOf(projectRoot: string, cwd: string, run: ProcessRunner): Promise<string> {
  const top = await gitPath(run, cwd, ['rev-parse', '--show-toplevel']);
  if (top === null) return projectRoot;
  const root = await realpath(projectRoot);
  if (root === top || root.startsWith(`${top}${sep}`)) return projectRoot;
  const common = await gitPath(run, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return common !== null && dirname(common) === root
    ? top
    : projectRoot;
}
