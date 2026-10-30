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
  },
] satisfies Config as Config;
