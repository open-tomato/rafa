import type { FileMove } from './types';

/**
 * Decouple 6 of the monorepo migration (#808), cutting release's imports
 * into pr and run before release's move: the five files release reaches
 * through pr that belong to core, each moved to the same path below
 * `packages/rafa/`. Sorted by `from`.
 *
 * Pass 1's rule places a file with the latest package it reaches. Each of
 * the five reaches only core: `types.ts` core's `store/check-rows` and
 * `core/config/sections`, `provider.ts` the `core/command` barrel,
 * `core/config/sections` and `schema/project-id`,
 * `pull-requests-double.ts` only `types.ts`, `git-identity.ts` nothing,
 * and `scratch-home-env.ts` only `git-identity.ts`. So core takes them.
 *
 * The six colocated tests move with them. `git-identity.sweep.test.ts` is
 * a colocated test of `git-identity.ts` by the stem rule, and it reads
 * `src/tests/sweep-timeout.ts`, which stays: the tool parks it under
 * `src/tests/core-coupled/`, and the move task takes it back by hand to
 * `src/tests/`.
 *
 * Without this list, release's own move would park 23 tests (the spec's
 * count) for the two test helpers alone.
 */
export const DECOUPLE_6_CORE_MOVES: readonly FileMove[] = [
  { from: 'src/pr/provider.ts', to: 'packages/rafa/src/pr/provider.ts' },
  { from: 'src/pr/pull-requests-double.ts', to: 'packages/rafa/src/pr/pull-requests-double.ts' },
  { from: 'src/pr/types.ts', to: 'packages/rafa/src/pr/types.ts' },
  { from: 'src/tests/git-identity.ts', to: 'packages/rafa/src/tests/git-identity.ts' },
  { from: 'src/tests/scratch-home-env.ts', to: 'packages/rafa/src/tests/scratch-home-env.ts' },
];
