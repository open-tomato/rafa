import type { FileMove } from './types';

/**
 * The third decouple item of the monorepo migration (#808), after pass 4a
 * and before pass 4b: the eleven feature config section files,
 * `src/config-schema-<section>.ts`, each moved to the same path below
 * `packages/rafa/`, beside core's four, so the published config types and
 * every package read them from core. Sorted by `from`. Each section keeps
 * its `package:` name and its registration in `src/config-registry.ts`;
 * only its file moves.
 *
 * This changes the placement of 7 and 19 October, which named each
 * section file to the package that owns the section (#118). The way back:
 * if a feature package ever publishes on its own, its section moves back
 * into it.
 *
 * Each colocated test parks under `src/tests/core-coupled/` instead of
 * moving with its file, because it reads the root's merged registry,
 * which stays at the root. `config-schema-readings.ts` is a note that
 * exports nothing and has no test.
 */
export const DECOUPLE_3_MOVES: readonly FileMove[] = [
  { from: 'src/config-schema-board-project.ts', to: 'packages/rafa/src/config-schema-board-project.ts' },
  { from: 'src/config-schema-checks.ts', to: 'packages/rafa/src/config-schema-checks.ts' },
  { from: 'src/config-schema-hub.ts', to: 'packages/rafa/src/config-schema-hub.ts' },
  { from: 'src/config-schema-issues.ts', to: 'packages/rafa/src/config-schema-issues.ts' },
  { from: 'src/config-schema-loop-continue.ts', to: 'packages/rafa/src/config-schema-loop-continue.ts' },
  { from: 'src/config-schema-loop-retries.ts', to: 'packages/rafa/src/config-schema-loop-retries.ts' },
  { from: 'src/config-schema-readings.ts', to: 'packages/rafa/src/config-schema-readings.ts' },
  { from: 'src/config-schema-release.ts', to: 'packages/rafa/src/config-schema-release.ts' },
  { from: 'src/config-schema-tests.ts', to: 'packages/rafa/src/config-schema-tests.ts' },
  { from: 'src/config-schema-triage.ts', to: 'packages/rafa/src/config-schema-triage.ts' },
  { from: 'src/config-schema-wrap-up.ts', to: 'packages/rafa/src/config-schema-wrap-up.ts' },
];
