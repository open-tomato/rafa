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
 *
 * `pr.base`, `release.settle`, `release.enabled`, `board.project.number`
 * and `roadmap.issue` sit here for the same reason. This file makes
 * every worktree a project root of its own, so the project walk stops in
 * the worktree and never reads the main checkout's gitignored YAML. With
 * the keys only in that YAML, `rafa release tag` in a worktree read the
 * release branch as `main` and refused (measured on 2026-11-08 at
 * 0.52.0), and `rafa release settle` there would have read
 * `release.settle: push` against `main`.
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
    release: { moveLock: true, enabled: true, settle: 'pr' },
    pr: { base: 'integration' },
    board: { project: { number: 7 } },
    roadmap: { issue: 31 },
  },
] satisfies Config as Config;
