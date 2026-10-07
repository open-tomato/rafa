/**
 * The `node_modules` this repository's tests link into planted
 * repositories, found by the walk the type step uses.
 *
 * A loop worktree at `.rafa/worktrees/<stub>` holds no `node_modules` of
 * its own; `bun` and `tsc` resolve imports through the main checkout's.
 * Joining `node_modules` to the repository root therefore dangles there,
 * so a test needing the real directory asks {@link realNodeModules}.
 *
 * @module tests/real-node-modules
 */

import { join } from 'node:path';

import { createGitRunner } from '../pr/index.js';
import { findNodeModules } from '../start/type-step.js';

const REPO_ROOT = join(import.meta.dir, '..', '..');

/**
 * The `node_modules` of the first directory from this repository's root
 * up that holds `node_modules/.bin/tsc`, stopping at the parent of git's
 * common dir. Throws when none holds one.
 */
export function realNodeModules(): string {
  const found = findNodeModules(REPO_ROOT, createGitRunner(REPO_ROOT));
  if (found === null) throw new Error(`no node_modules/.bin/tsc found from ${REPO_ROOT} upward`);
  return found;
}
