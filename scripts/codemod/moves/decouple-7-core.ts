import type { FileMove } from './types';

/**
 * Decouple 7 of the monorepo migration (#808), cutting pr's imports into
 * run before pr's move: the three files of the suite runner, each moved to
 * the same path below `packages/rafa/`. Sorted by `from`.
 *
 * Pass 1's rule moves a file that reaches only core into core. Each of the
 * three reaches only core and each other: `run.ts` core's `loop` barrel by
 * type and the other two by value, `failure-lines.ts` `run.ts` by type and
 * `unhandled.ts` by value, and `unhandled.ts` nothing. So core takes them.
 *
 * The three colocated tests move with them. The two integration tests,
 * `run-baseline-integration.test.ts` and `run-recheck-integration.test.ts`,
 * stay at the root with their imports rewritten. The testdata files move
 * by hand: the fixtures only the three moved tests read go beside them,
 * and the `no-message` pair stays at `src/suite/testdata/` for the
 * inherited-failure test.
 *
 * Without this list, pr's `src/triage/base-run.ts` and `inherited.ts`
 * would keep two back edges into run.
 */
export const DECOUPLE_7_CORE_MOVES: readonly FileMove[] = [
  { from: 'src/suite/failure-lines.ts', to: 'packages/rafa/src/suite/failure-lines.ts' },
  { from: 'src/suite/run.ts', to: 'packages/rafa/src/suite/run.ts' },
  { from: 'src/suite/unhandled.ts', to: 'packages/rafa/src/suite/unhandled.ts' },
];
