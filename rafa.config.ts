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
 *
 * `hints.skills` follows each handed-over step whose case has a file in
 * `.claude/skills/rafa-release/` with a `skill: rafa-release › <case>`
 * line (#1565): this repository ships those skills, so the pointer
 * always lands on a file a session can read.
 *
 * `atlas.layers` is the ordered list of columns Atlas's import flow card
 * draws (spec C8): the spec's six layers, config, core, platform,
 * feature, addon and app, holding every module the module scan finds.
 * It sits here, not in `.rafa/atlas/config.json`, because that file is
 * gitignored: the layers would live in one checkout and every other
 * machine, the hub included, would draw each module `unassigned`. No
 * layer goes into a `package.json` (the spec's rule). The empty type
 * import of `config-section.js` loads the declaration that merges the
 * `atlas` key into `ModuleSections`; without it `tsc` refuses the key as
 * unknown (measured: TS2353 on `atlas`). The
 * workspace holds no lint or TypeScript config package, so the config
 * layer holds the root's config folders.
 */

import type {} from './addons/atlas/rafa-atlas/src/config-section.js';
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
    hints: { skills: true },
    atlas: {
      layers: [
        { name: 'config', modules: ['src/config', 'src/schema'] },
        {
          name: 'core',
          modules: ['@open-tomato/rafa-core', 'src/ports', 'src/errors', 'src/utils', 'src/adapters', 'src/project'],
        },
        {
          name: 'platform',
          modules: [
            '@open-tomato/rafa-inventory',
            '@open-tomato/rafa-index',
            '@open-tomato/rafa-sync-service',
            '@open-tomato/rafa-effort',
            'src/modules',
            'src/tiers',
            'src/notices',
            'src/fixtures',
          ],
        },
        {
          name: 'feature',
          modules: [
            '@open-tomato/rafa-board',
            '@open-tomato/rafa-pr',
            '@open-tomato/rafa-release',
            '@open-tomato/rafa-run',
            '@open-tomato/rafa-hub',
            'src/board',
            'src/bugs',
            'src/ci',
            'src/cleanup',
            'src/effort',
            'src/inventory',
            'src/learning',
            'src/loop',
            'src/next',
            'src/plan',
            'src/pr',
            'src/release',
            'src/start',
            'src/status',
            'src/stretch',
            'src/triage',
          ],
        },
        { name: 'addon', modules: ['addons/atlas', '@open-tomato/dyno', '@open-tomato/rafa-d2c'] },
        {
          name: 'app',
          modules: ['src/cli', 'src/commands', 'src/bundled', 'src/tools', 'src/suite', 'src/tests'],
        },
      ],
    },
  },
] satisfies Config as Config;
