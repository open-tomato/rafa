import type { FileMove } from './types';

/**
 * Pass 4c of the monorepo migration (#808), board's move: the three CLI
 * files board reads, each moved to the same path below `packages/rafa/`
 * ahead of board's own list. Sorted by `from`.
 *
 * Pass 1's rule places a file with the latest package it reaches. Each of
 * the three reaches only core: `describe.ts` imports the `core/command`
 * barrel and `mountKey` of `registry.ts`, `registry.ts` the `core/command`
 * barrel and `core/config/sections`, and `output-sinks.ts` core's ports.
 * So core takes them.
 *
 * `registry.test.ts` moves colocated. `describe.test.ts` stays at
 * `src/cli/` for the CLI's `CORE_REGISTRY` and `routeLine` it reads: the
 * tool parks it under `src/tests/core-coupled/`, and the move task takes
 * it back out of core's parked folder by hand.
 *
 * The three are the CLI's files board reads, so board imports no CLI file
 * after this list has moved.
 */
export const PASS_4C_CORE_MOVES: readonly FileMove[] = [
  { from: 'src/cli/describe.ts', to: 'packages/rafa/src/cli/describe.ts' },
  { from: 'src/cli/registry.ts', to: 'packages/rafa/src/cli/registry.ts' },
  { from: 'src/tests/output-sinks.ts', to: 'packages/rafa/src/tests/output-sinks.ts' },
];
