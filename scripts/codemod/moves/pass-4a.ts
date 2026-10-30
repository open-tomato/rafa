import type { FileMove } from './types';

/**
 * Pass 4a of the monorepo migration (#808), the first move of pass 4: the
 * 56 source files of the `rafa-inventory` row of
 * `docs/survey/cut-table.json`, each moved to the same path below
 * `packages/rafa-inventory/`. Pass 4 moves the feature packages in the
 * order of 23 October: inventory, effort, board, release, pr, run. Sorted
 * by `from`; colocated tests move with the pass, except
 * `src/tiers/resolve.integration.test.ts`, which stays at the root with
 * its imports rewritten (#1289, until #913).
 */
export const PASS_4A_MOVES: readonly FileMove[] = [
  { from: 'src/adapters/learning/held.ts', to: 'packages/rafa-inventory/src/adapters/learning/held.ts' },
  { from: 'src/adapters/learning/local.ts', to: 'packages/rafa-inventory/src/adapters/learning/local.ts' },
  { from: 'src/agents/roster.ts', to: 'packages/rafa-inventory/src/agents/roster.ts' },
  { from: 'src/agents/vendorable.ts', to: 'packages/rafa-inventory/src/agents/vendorable.ts' },
  { from: 'src/backfill/backup.ts', to: 'packages/rafa-inventory/src/backfill/backup.ts' },
  { from: 'src/backfill/derive.ts', to: 'packages/rafa-inventory/src/backfill/derive.ts' },
  { from: 'src/backfill/proposal-batch.ts', to: 'packages/rafa-inventory/src/backfill/proposal-batch.ts' },
  { from: 'src/backfill/proposal-file.ts', to: 'packages/rafa-inventory/src/backfill/proposal-file.ts' },
  { from: 'src/backfill/propose.ts', to: 'packages/rafa-inventory/src/backfill/propose.ts' },
  { from: 'src/check/layout.ts', to: 'packages/rafa-inventory/src/check/layout.ts' },
  { from: 'src/check/references.ts', to: 'packages/rafa-inventory/src/check/references.ts' },
  { from: 'src/check/run.ts', to: 'packages/rafa-inventory/src/check/run.ts' },
  { from: 'src/check/shell-lines.ts', to: 'packages/rafa-inventory/src/check/shell-lines.ts' },
  { from: 'src/demote/apply.ts', to: 'packages/rafa-inventory/src/demote/apply.ts' },
  { from: 'src/demote/classify.ts', to: 'packages/rafa-inventory/src/demote/classify.ts' },
  { from: 'src/demote/draft.ts', to: 'packages/rafa-inventory/src/demote/draft.ts' },
  { from: 'src/demote/report.ts', to: 'packages/rafa-inventory/src/demote/report.ts' },
  { from: 'src/demote/select.ts', to: 'packages/rafa-inventory/src/demote/select.ts' },
  { from: 'src/inventory/disabled.ts', to: 'packages/rafa-inventory/src/inventory/disabled.ts' },
  { from: 'src/inventory/index.ts', to: 'packages/rafa-inventory/src/inventory/index.ts' },
  { from: 'src/inventory/mcp.ts', to: 'packages/rafa-inventory/src/inventory/mcp.ts' },
  { from: 'src/inventory/plugins.ts', to: 'packages/rafa-inventory/src/inventory/plugins.ts' },
  { from: 'src/inventory/record.ts', to: 'packages/rafa-inventory/src/inventory/record.ts' },
  { from: 'src/inventory/search/block.ts', to: 'packages/rafa-inventory/src/inventory/search/block.ts' },
  { from: 'src/inventory/search/index.ts', to: 'packages/rafa-inventory/src/inventory/search/index.ts' },
  { from: 'src/inventory/search/prompt.ts', to: 'packages/rafa-inventory/src/inventory/search/prompt.ts' },
  { from: 'src/inventory/search/quote.ts', to: 'packages/rafa-inventory/src/inventory/search/quote.ts' },
  { from: 'src/inventory/search/rank.ts', to: 'packages/rafa-inventory/src/inventory/search/rank.ts' },
  { from: 'src/inventory/search/scratch.ts', to: 'packages/rafa-inventory/src/inventory/search/scratch.ts' },
  { from: 'src/inventory/show.ts', to: 'packages/rafa-inventory/src/inventory/show.ts' },
  { from: 'src/inventory/trees.ts', to: 'packages/rafa-inventory/src/inventory/trees.ts' },
  { from: 'src/learning/bless.ts', to: 'packages/rafa-inventory/src/learning/bless.ts' },
  { from: 'src/learning/identity.ts', to: 'packages/rafa-inventory/src/learning/identity.ts' },
  { from: 'src/learning/index.ts', to: 'packages/rafa-inventory/src/learning/index.ts' },
  { from: 'src/learning/merge.ts', to: 'packages/rafa-inventory/src/learning/merge.ts' },
  { from: 'src/learning/types.ts', to: 'packages/rafa-inventory/src/learning/types.ts' },
  { from: 'src/plan/risk/commands.ts', to: 'packages/rafa-inventory/src/plan/risk/commands.ts' },
  { from: 'src/plan/risk/long-runs.ts', to: 'packages/rafa-inventory/src/plan/risk/long-runs.ts' },
  { from: 'src/report/lessons.ts', to: 'packages/rafa-inventory/src/report/lessons.ts' },
  { from: 'src/schema/failure-strings.ts', to: 'packages/rafa-inventory/src/schema/failure-strings.ts' },
  { from: 'src/schema/instinct.ts', to: 'packages/rafa-inventory/src/schema/instinct.ts' },
  { from: 'src/schema/provenance.ts', to: 'packages/rafa-inventory/src/schema/provenance.ts' },
  { from: 'src/schema/scope-records.ts', to: 'packages/rafa-inventory/src/schema/scope-records.ts' },
  { from: 'src/schema/skill.ts', to: 'packages/rafa-inventory/src/schema/skill.ts' },
  { from: 'src/schema/stack.ts', to: 'packages/rafa-inventory/src/schema/stack.ts' },
  { from: 'src/start/serving.ts', to: 'packages/rafa-inventory/src/start/serving.ts' },
  { from: 'src/task/resolve-skills.ts', to: 'packages/rafa-inventory/src/task/resolve-skills.ts' },
  { from: 'src/task/sections.ts', to: 'packages/rafa-inventory/src/task/sections.ts' },
  { from: 'src/task/select-lessons.ts', to: 'packages/rafa-inventory/src/task/select-lessons.ts' },
  { from: 'src/task/skill-index.ts', to: 'packages/rafa-inventory/src/task/skill-index.ts' },
  { from: 'src/tiers/delivery.ts', to: 'packages/rafa-inventory/src/tiers/delivery.ts' },
  { from: 'src/tiers/resolve.ts', to: 'packages/rafa-inventory/src/tiers/resolve.ts' },
  { from: 'src/tiers/routing-table.ts', to: 'packages/rafa-inventory/src/tiers/routing-table.ts' },
  { from: 'src/tiers/routing.ts', to: 'packages/rafa-inventory/src/tiers/routing.ts' },
  { from: 'src/tiers/serve.ts', to: 'packages/rafa-inventory/src/tiers/serve.ts' },
  { from: 'src/tiers/skill-names.ts', to: 'packages/rafa-inventory/src/tiers/skill-names.ts' },
];
