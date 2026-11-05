/**
 * This repository's person's file: the project scope's module layer,
 * which rafa reads and never writes. `.rafa/config.yaml`, where a
 * checkout holds one, is the local layer read over it key by key.
 *
 * It adopts the `escalation` template and holds decision 0009's
 * check-point table, with the stage at `related`; `context/verification.md`
 * records it. The `Config` import is type-only, erased before the file
 * runs, so the file needs nothing at run time.
 *
 * `loop.worktreeSetup` runs `bun install --frozen-lockfile` in each
 * `--as-worktree` worktree before the first session (#1345): a loop
 * worktree with no install resolves the feature packages through the
 * main checkout and loads core twice.
 *
 * `release.moveLock` has `rafa release settle` move `rafa.lock` in each
 * release commit (#1438). It sits here, not in a checkout's gitignored
 * YAML, because the key decides what this repository's release commit
 * holds: the 0.50.0 settle ran from a checkout with it unset and left the
 * lock at 0.49.0. A checkout's YAML can still turn it off.
 */

import type { Config } from './src/config/index.js';

export default [
  {
    templates: ['escalation'],
    checks: {
      task: ['affected'],
      stage: ['related'],
      loop: ['related', 'contract', 'integration'],
      pullRequest: ['unit', 'contract', 'integration'],
      stretch: ['related', 'contract', 'integration'],
      releasePullRequest: ['integration'],
      publish: ['full'],
    },
    loop: { worktreeSetup: 'bun install --frozen-lockfile' },
    release: { moveLock: true },
  },
] satisfies Config as Config;
