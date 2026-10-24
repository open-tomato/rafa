import type { FileMove } from './types';

/**
 * The fourth decouple item of the monorepo migration (#808), after pass 4b
 * and before board's move: the nine files of run and pr that reach only
 * core and each other once core's names have landed, each moved to the
 * same path below `packages/rafa/`. Sorted by `from`.
 *
 * The item ends 17 of board's 21 value imports into run, pr and release,
 * with the names stage before this list and the placements after it.
 * This list ends nine of the 17: board's imports of
 * `src/plan/validate.ts` (from `src/board/gate.ts`), of
 * `src/claims/stale.ts` (from `src/board/issue-edit-state.ts`,
 * `src/board/project/rules.ts`, `src/board/setup.ts` and
 * `src/board/roadmap-claims.ts`), of `src/claims/git.ts` and
 * `src/start/branch-decision.ts` (from `roadmap-claims.ts`), and of
 * `src/bugs/fill.ts` and `src/bugs/versions.ts` (from
 * `src/commands/issue/create-bug.ts`).
 *
 * Pass 1's rule places a file with the latest package it reaches. Each of
 * the nine reaches only core and the other listed files, so core takes
 * it, at the same path below `packages/rafa/`.
 *
 * `plan/validate.ts` has no colocated test; the other eight move with
 * theirs, and none parks under `src/tests/core-coupled/`.
 */
export const DECOUPLE_4_MOVES: readonly FileMove[] = [
  { from: 'src/bugs/fill.ts', to: 'packages/rafa/src/bugs/fill.ts' },
  { from: 'src/bugs/versions.ts', to: 'packages/rafa/src/bugs/versions.ts' },
  { from: 'src/claims/git.ts', to: 'packages/rafa/src/claims/git.ts' },
  { from: 'src/claims/record.ts', to: 'packages/rafa/src/claims/record.ts' },
  { from: 'src/claims/stale.ts', to: 'packages/rafa/src/claims/stale.ts' },
  { from: 'src/plan/validate.ts', to: 'packages/rafa/src/plan/validate.ts' },
  { from: 'src/start/branch-decision.ts', to: 'packages/rafa/src/start/branch-decision.ts' },
  { from: 'src/triage/bug-key.ts', to: 'packages/rafa/src/triage/bug-key.ts' },
  { from: 'src/triage/test-failure.ts', to: 'packages/rafa/src/triage/test-failure.ts' },
];
