import type { FileMove } from './types';

/**
 * Pass 4b of the monorepo migration (#808), the second move of pass 4: the
 * 32 source files of the `rafa-effort` row of `docs/survey/cut-table.json`
 * less `src/effort/store/index.ts`, each moved to the same path below
 * `packages/rafa-effort/`. Pass 4 moves the feature packages in the order
 * of 23 October: inventory, effort, board, release, pr, run. The store
 * entry stays at the root: it is the published `./store` build entry and
 * goes to the CLI by name, as `src/rafa.ts` does. Sorted by `from`;
 * colocated tests move with the pass, except `classify.test.ts`, which the
 * move task parks by hand for the root sources it reads by path.
 */
export const PASS_4B_MOVES: readonly FileMove[] = [
  { from: 'src/effort/attribution.ts', to: 'packages/rafa-effort/src/effort/attribution.ts' },
  { from: 'src/effort/classify.ts', to: 'packages/rafa-effort/src/effort/classify.ts' },
  { from: 'src/effort/collect-args.ts', to: 'packages/rafa-effort/src/effort/collect-args.ts' },
  { from: 'src/effort/collect-skills.ts', to: 'packages/rafa-effort/src/effort/collect-skills.ts' },
  { from: 'src/effort/collect.ts', to: 'packages/rafa-effort/src/effort/collect.ts' },
  { from: 'src/effort/commits.ts', to: 'packages/rafa-effort/src/effort/commits.ts' },
  { from: 'src/effort/dashboard-format.ts', to: 'packages/rafa-effort/src/effort/dashboard-format.ts' },
  { from: 'src/effort/dashboard-status.ts', to: 'packages/rafa-effort/src/effort/dashboard-status.ts' },
  { from: 'src/effort/dashboard.ts', to: 'packages/rafa-effort/src/effort/dashboard.ts' },
  { from: 'src/effort/epic-cost.ts', to: 'packages/rafa-effort/src/effort/epic-cost.ts' },
  { from: 'src/effort/file-stamp.ts', to: 'packages/rafa-effort/src/effort/file-stamp.ts' },
  { from: 'src/effort/recurrence.ts', to: 'packages/rafa-effort/src/effort/recurrence.ts' },
  { from: 'src/effort/report-args.ts', to: 'packages/rafa-effort/src/effort/report-args.ts' },
  { from: 'src/effort/report-budgets.ts', to: 'packages/rafa-effort/src/effort/report-budgets.ts' },
  { from: 'src/effort/report-doc-bugs.ts', to: 'packages/rafa-effort/src/effort/report-doc-bugs.ts' },
  { from: 'src/effort/report-format.ts', to: 'packages/rafa-effort/src/effort/report-format.ts' },
  { from: 'src/effort/report-kinds.ts', to: 'packages/rafa-effort/src/effort/report-kinds.ts' },
  { from: 'src/effort/report-skills-format.ts', to: 'packages/rafa-effort/src/effort/report-skills-format.ts' },
  { from: 'src/effort/report-skills-read.ts', to: 'packages/rafa-effort/src/effort/report-skills-read.ts' },
  { from: 'src/effort/report-skills.ts', to: 'packages/rafa-effort/src/effort/report-skills.ts' },
  { from: 'src/effort/report-trend-format.ts', to: 'packages/rafa-effort/src/effort/report-trend-format.ts' },
  { from: 'src/effort/report-trend-read.ts', to: 'packages/rafa-effort/src/effort/report-trend-read.ts' },
  { from: 'src/effort/report-trend.ts', to: 'packages/rafa-effort/src/effort/report-trend.ts' },
  { from: 'src/effort/report.ts', to: 'packages/rafa-effort/src/effort/report.ts' },
  { from: 'src/effort/skill-facts.ts', to: 'packages/rafa-effort/src/effort/skill-facts.ts' },
  { from: 'src/effort/skill-signals.ts', to: 'packages/rafa-effort/src/effort/skill-signals.ts' },
  { from: 'src/effort/skill-use.ts', to: 'packages/rafa-effort/src/effort/skill-use.ts' },
  { from: 'src/effort/sync/contact.ts', to: 'packages/rafa-effort/src/effort/sync/contact.ts' },
  { from: 'src/effort/sync/doctor-reading.ts', to: 'packages/rafa-effort/src/effort/sync/doctor-reading.ts' },
  { from: 'src/effort/sync/file.ts', to: 'packages/rafa-effort/src/effort/sync/file.ts' },
  { from: 'src/effort/sync/select.ts', to: 'packages/rafa-effort/src/effort/sync/select.ts' },
  { from: 'src/effort/trend-stats.ts', to: 'packages/rafa-effort/src/effort/trend-stats.ts' },
];
