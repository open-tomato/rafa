import type { FileMove } from './types';

/**
 * Pass 1 of the monorepo migration (#808): the root files that reach no
 * feature, each moved to the same path below `packages/rafa/`. Sorted by
 * `from`; colocated tests move with the pass that runs it, except the
 * integration test of `src/modules/activate.ts`, which stays at the root as
 * `src/modules/activate-integration.test.ts` (#1289).
 */
export const PASS_1_MOVES: readonly FileMove[] = [
  { from: 'src/adapters/logger/active.ts', to: 'packages/rafa/src/adapters/logger/active.ts' },
  { from: 'src/adapters/logger/api-filter.ts', to: 'packages/rafa/src/adapters/logger/api-filter.ts' },
  { from: 'src/adapters/logger/colour.ts', to: 'packages/rafa/src/adapters/logger/colour.ts' },
  { from: 'src/adapters/logger/console.ts', to: 'packages/rafa/src/adapters/logger/console.ts' },
  { from: 'src/adapters/logger/contract.ts', to: 'packages/rafa/src/adapters/logger/contract.ts' },
  { from: 'src/adapters/logger/settings.ts', to: 'packages/rafa/src/adapters/logger/settings.ts' },
  { from: 'src/adapters/output/events.ts', to: 'packages/rafa/src/adapters/output/events.ts' },
  { from: 'src/bugs/closest.ts', to: 'packages/rafa/src/bugs/closest.ts' },
  { from: 'src/bugs/fenced.ts', to: 'packages/rafa/src/bugs/fenced.ts' },
  { from: 'src/bugs/places.ts', to: 'packages/rafa/src/bugs/places.ts' },
  { from: 'src/bugs/record.ts', to: 'packages/rafa/src/bugs/record.ts' },
  { from: 'src/bugs/stack-path.ts', to: 'packages/rafa/src/bugs/stack-path.ts' },
  { from: 'src/bugs/title.ts', to: 'packages/rafa/src/bugs/title.ts' },
  { from: 'src/commands/plan/plan-files.ts', to: 'packages/rafa/src/commands/plan/plan-files.ts' },
  { from: 'src/config-schema-bugs.ts', to: 'packages/rafa/src/config-schema-bugs.ts' },
  { from: 'src/config-schema-errors.ts', to: 'packages/rafa/src/config-schema-errors.ts' },
  { from: 'src/config-schema-features.ts', to: 'packages/rafa/src/config-schema-features.ts' },
  { from: 'src/config-schema-logger.ts', to: 'packages/rafa/src/config-schema-logger.ts' },
  { from: 'src/modules/activate.ts', to: 'packages/rafa/src/modules/activate.ts' },
  { from: 'src/modules/load.ts', to: 'packages/rafa/src/modules/load.ts' },
  { from: 'src/modules/manifest.ts', to: 'packages/rafa/src/modules/manifest.ts' },
  { from: 'src/next/hop-record.ts', to: 'packages/rafa/src/next/hop-record.ts' },
  { from: 'src/plan/doc-task.ts', to: 'packages/rafa/src/plan/doc-task.ts' },
  { from: 'src/plan/inject.ts', to: 'packages/rafa/src/plan/inject.ts' },
  { from: 'src/plan/risk/patterns.ts', to: 'packages/rafa/src/plan/risk/patterns.ts' },
  { from: 'src/plan/risk/secrets.ts', to: 'packages/rafa/src/plan/risk/secrets.ts' },
  { from: 'src/project/bin-path.ts', to: 'packages/rafa/src/project/bin-path.ts' },
  { from: 'src/project/package-of.ts', to: 'packages/rafa/src/project/package-of.ts' },
  { from: 'src/project/position.ts', to: 'packages/rafa/src/project/position.ts' },
  { from: 'src/project/roots.ts', to: 'packages/rafa/src/project/roots.ts' },
  { from: 'src/project/scope.ts', to: 'packages/rafa/src/project/scope.ts' },
  { from: 'src/project/worktree-root.ts', to: 'packages/rafa/src/project/worktree-root.ts' },
  { from: 'src/runtime/live-loops.ts', to: 'packages/rafa/src/runtime/live-loops.ts' },
  { from: 'src/utils/git.ts', to: 'packages/rafa/src/utils/git.ts' },
  { from: 'src/utils/progress.ts', to: 'packages/rafa/src/utils/progress.ts' },
  { from: 'src/utils/tracker.ts', to: 'packages/rafa/src/utils/tracker.ts' },
];
