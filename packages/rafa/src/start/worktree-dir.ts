/**
 * The directory a loop adds its worktrees under: `loop.worktreeDir`,
 * `.rafa/worktrees` unless a layer names another,
 * resolved against the PROJECT ROOT (`checkout.ts` says which directory
 * that is).
 *
 * The project root and never the checkout, and never the process's
 * working directory: a loop started from inside a linked worktree still
 * adds the next worktree under the main checkout's `.rafa/`, beside the
 * config and the session records, so every worktree a project's loops
 * made sits in one directory whichever of them started it. A relative
 * value is read from the project root, `../trees` included, which puts
 * the worktrees beside the repository. An absolute value is taken as
 * written, as `path.resolve` takes it.
 *
 * Nothing here reads the disk or creates the directory: git creates it
 * when a worktree is added under it.
 */
import { resolve } from 'node:path';

/** `worktreeDir`, as `loop.worktreeDir` resolved it, read from `projectRoot`. */
export function worktreeDirAt(projectRoot: string, worktreeDir: string): string {
  return resolve(projectRoot, worktreeDir);
}
