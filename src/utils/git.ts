import { execSync, spawnSync } from 'child_process';

/** The exit status `git symbolic-ref --quiet` answers when `HEAD` is not a symbolic ref. */
const NOT_SYMBOLIC_STATUS = 1;

export function getRepoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

/**
 * The branch checked out in `cwd`, or in the process's own working
 * directory when none is named. The loop names its checkout
 * (`start/checkout.ts`), so a run whose checkout is a linked worktree
 * reads that worktree's branch and never the one its process stands in.
 */
export function getCurrentBranch(cwd?: string): string {
  return execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8',
    ...(cwd === undefined
      ? {}
      : { cwd }),
  }).trim();
}

/**
 * The branch checked out in `cwd`, or in the process's own working
 * directory when none is named, and null on a detached HEAD.
 *
 * It stands beside {@link getCurrentBranch}, which answers the word
 * `HEAD` there: a caller that would pass that word on as a branch name
 * reads this one, and tells the two apart by type rather than by
 * comparing against a string that is also a legal ref.
 *
 * It runs `git symbolic-ref --quiet --short HEAD` and reads the exit
 * status alone, so no git message is matched. Measured on git 2.53.0
 * under Linux with `LC_ALL=C` (2026-10-12):
 *
 *  - on a branch it wrote the branch's name and exited 0, and so it did
 *    on a branch that holds no commit yet, where `git rev-parse
 *    --abbrev-ref HEAD` exited 128;
 *  - on a detached HEAD it wrote nothing to either stream and exited 1,
 *    where `git rev-parse --abbrev-ref HEAD` wrote `HEAD` and exited 0;
 *  - outside a repository it exited 128 with `fatal: not a git
 *    repository`.
 *
 * Only the exit of 1 is a detached HEAD. Every other failure, a git that
 * could not be started among them, throws naming the directory and what
 * git said, as {@link getCurrentBranch} throws on a checkout it cannot
 * read.
 */
export function readCheckedOutBranch(cwd?: string): string | null {
  const run = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    encoding: 'utf8',
    ...(cwd === undefined
      ? {}
      : { cwd }),
  });
  if (run.error === undefined && run.status === 0) {
    return run.stdout.trim();
  }
  if (run.error === undefined && run.status === NOT_SYMBOLIC_STATUS) {
    return null;
  }
  const said = run.error?.message ?? run.stderr.trim();
  throw new Error(`Could not read the branch checked out in ${cwd ?? process.cwd()}: ${said}`);
}
