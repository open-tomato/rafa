import type { FileMove } from './types';

/**
 * Pass 4d of the monorepo migration (#808), the fourth move of pass 4:
 * release's 56 files, each moved to the same path below
 * `packages/rafa-release/`. Pass 4 moves the feature packages in the order
 * of 23 October: inventory, effort, board, release, pr, run.
 *
 * The 56 are the non-test files of the `rafa-release` row of
 * `docs/survey/cut-table.json`, its 56 sources (the row has no
 * test-support file): `src/release/` 34, `src/commands/release/` 16
 * and the six `RELEASE_NAMED` files of `scripts/survey/cut-names.ts`
 * outside those folders, listed by name.
 *
 * The four workflow templates of `src/release/templates/` are no code
 * file and move by hand beside `templates.ts`, their reader. Colocated
 * tests move with the pass; the three integration tests among them stay
 * at the root until #913. `src/release/fold-spawned.test.ts` stems no
 * listed file, so it stays in `src/release/` with its spawned-module
 * paths pointed by hand (#1360). Sorted by `from`.
 */
export const PASS_4D_MOVES: readonly FileMove[] = [
  { from: 'src/cleanup/past-head.ts', to: 'packages/rafa-release/src/cleanup/past-head.ts' },
  { from: 'src/commands/doctor-ladder.ts', to: 'packages/rafa-release/src/commands/doctor-ladder.ts' },
  { from: 'src/commands/release/declarations.ts', to: 'packages/rafa-release/src/commands/release/declarations.ts' },
  { from: 'src/commands/release/fragment.ts', to: 'packages/rafa-release/src/commands/release/fragment.ts' },
  { from: 'src/commands/release/index.ts', to: 'packages/rafa-release/src/commands/release/index.ts' },
  { from: 'src/commands/release/list.ts', to: 'packages/rafa-release/src/commands/release/list.ts' },
  { from: 'src/commands/release/publish.ts', to: 'packages/rafa-release/src/commands/release/publish.ts' },
  { from: 'src/commands/release/release-commit.ts', to: 'packages/rafa-release/src/commands/release/release-commit.ts' },
  { from: 'src/commands/release/settle-project.ts', to: 'packages/rafa-release/src/commands/release/settle-project.ts' },
  { from: 'src/commands/release/settle.ts', to: 'packages/rafa-release/src/commands/release/settle.ts' },
  { from: 'src/commands/release/status-fragments.ts', to: 'packages/rafa-release/src/commands/release/status-fragments.ts' },
  { from: 'src/commands/release/status-packages.ts', to: 'packages/rafa-release/src/commands/release/status-packages.ts' },
  { from: 'src/commands/release/status-stale-docs.ts', to: 'packages/rafa-release/src/commands/release/status-stale-docs.ts' },
  { from: 'src/commands/release/status.ts', to: 'packages/rafa-release/src/commands/release/status.ts' },
  { from: 'src/commands/release/tag-follow-ups.ts', to: 'packages/rafa-release/src/commands/release/tag-follow-ups.ts' },
  { from: 'src/commands/release/tag-units.ts', to: 'packages/rafa-release/src/commands/release/tag-units.ts' },
  { from: 'src/commands/release/tag.ts', to: 'packages/rafa-release/src/commands/release/tag.ts' },
  { from: 'src/commands/release/workflows.ts', to: 'packages/rafa-release/src/commands/release/workflows.ts' },
  { from: 'src/docs/open-lines.ts', to: 'packages/rafa-release/src/docs/open-lines.ts' },
  { from: 'src/docs/release-issue.ts', to: 'packages/rafa-release/src/docs/release-issue.ts' },
  { from: 'src/next/epic-end.ts', to: 'packages/rafa-release/src/next/epic-end.ts' },
  { from: 'src/project/lock.ts', to: 'packages/rafa-release/src/project/lock.ts' },
  { from: 'src/release/audit.ts', to: 'packages/rafa-release/src/release/audit.ts' },
  { from: 'src/release/body-forecast.ts', to: 'packages/rafa-release/src/release/body-forecast.ts' },
  { from: 'src/release/branch-forecast.ts', to: 'packages/rafa-release/src/release/branch-forecast.ts' },
  { from: 'src/release/changelog.ts', to: 'packages/rafa-release/src/release/changelog.ts' },
  { from: 'src/release/enabled.ts', to: 'packages/rafa-release/src/release/enabled.ts' },
  { from: 'src/release/forecast.ts', to: 'packages/rafa-release/src/release/forecast.ts' },
  { from: 'src/release/fragment-tree.ts', to: 'packages/rafa-release/src/release/fragment-tree.ts' },
  { from: 'src/release/guard-merge.ts', to: 'packages/rafa-release/src/release/guard-merge.ts' },
  { from: 'src/release/guard.ts', to: 'packages/rafa-release/src/release/guard.ts' },
  { from: 'src/release/ladder.ts', to: 'packages/rafa-release/src/release/ladder.ts' },
  { from: 'src/release/level.ts', to: 'packages/rafa-release/src/release/level.ts' },
  { from: 'src/release/package-base-version.ts', to: 'packages/rafa-release/src/release/package-base-version.ts' },
  { from: 'src/release/prepare.ts', to: 'packages/rafa-release/src/release/prepare.ts' },
  { from: 'src/release/receipt.ts', to: 'packages/rafa-release/src/release/receipt.ts' },
  { from: 'src/release/release-delivery.ts', to: 'packages/rafa-release/src/release/release-delivery.ts' },
  { from: 'src/release/release-move.ts', to: 'packages/rafa-release/src/release/release-move.ts' },
  { from: 'src/release/scaffold.ts', to: 'packages/rafa-release/src/release/scaffold.ts' },
  { from: 'src/release/setting.ts', to: 'packages/rafa-release/src/release/setting.ts' },
  { from: 'src/release/settle-groups.ts', to: 'packages/rafa-release/src/release/settle-groups.ts' },
  { from: 'src/release/settle-lock.ts', to: 'packages/rafa-release/src/release/settle-lock.ts' },
  { from: 'src/release/settle-pr.ts', to: 'packages/rafa-release/src/release/settle-pr.ts' },
  { from: 'src/release/settle-push.ts', to: 'packages/rafa-release/src/release/settle-push.ts' },
  { from: 'src/release/settle-tag.ts', to: 'packages/rafa-release/src/release/settle-tag.ts' },
  { from: 'src/release/settle-worktree.ts', to: 'packages/rafa-release/src/release/settle-worktree.ts' },
  { from: 'src/release/settle.ts', to: 'packages/rafa-release/src/release/settle.ts' },
  { from: 'src/release/status-readings.ts', to: 'packages/rafa-release/src/release/status-readings.ts' },
  { from: 'src/release/strategies/semver-by-level.ts', to: 'packages/rafa-release/src/release/strategies/semver-by-level.ts' },
  { from: 'src/release/strategy.ts', to: 'packages/rafa-release/src/release/strategy.ts' },
  { from: 'src/release/tag-push.ts', to: 'packages/rafa-release/src/release/tag-push.ts' },
  { from: 'src/release/templates.ts', to: 'packages/rafa-release/src/release/templates.ts' },
  { from: 'src/release/verify.ts', to: 'packages/rafa-release/src/release/verify.ts' },
  { from: 'src/release/version-tag.ts', to: 'packages/rafa-release/src/release/version-tag.ts' },
  { from: 'src/release/version.ts', to: 'packages/rafa-release/src/release/version.ts' },
  { from: 'src/release/workspace-packages.ts', to: 'packages/rafa-release/src/release/workspace-packages.ts' },
];
