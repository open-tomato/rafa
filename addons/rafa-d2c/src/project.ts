/**
 * The project root a command works in. `module exec` resolves no
 * project, so a module command walks the scope itself, through core's
 * own walk: a linked worktree, whose `.rafa/` is gitignored, resolves to
 * its main checkout, where the d2c config and the store live.
 */
import type { RafaContext } from '@open-tomato/rafa-core/core/command';

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
