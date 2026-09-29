import { execSync } from 'child_process';

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
