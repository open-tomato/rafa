/**
 * The files the cut table names for each feature package (#808, pass 1):
 * root files that reach a feature package, placed by name whatever their
 * folder. They keep their path; no named file moves. Each list is sorted
 * by UTF-16 code unit, and `CUT_RULES` of `cut-table.ts` reads them, so
 * a file named here is placed in its package and is not left to place.
 *
 * @module
 */

/**
 * The files named for `rafa-board`: the fourteen `src/board/` files
 * `docs/survey/cluster-map.json` puts in cluster c6, and the eight root
 * files that reach the board. The fifteenth reaches only core and moved
 * into it in the first decouple item, as `packages/rafa/src/board/naming.ts`.
 */
export const BOARD_NAMED: readonly string[] = [
  'src/board/flags.ts',
  'src/board/gate.ts',
  'src/board/issue.ts',
  'src/board/leak.ts',
  'src/board/plan-field.ts',
  'src/board/plan-spec.ts',
  'src/board/previous-copy.ts',
  'src/board/readiness.ts',
  'src/board/review-comment.ts',
  'src/board/review-stamp.ts',
  'src/board/snapshot-settle.ts',
  'src/board/spec-review.ts',
  'src/board/spec-source.ts',
  'src/board/trust.ts',
  'src/bugs/cause-rule.ts',
  'src/commands/doctor-refs.ts',
  'src/commands/plan/refs-check.ts',
  'src/config-schema-board-project.ts',
  'src/config-schema-issues.ts',
  'src/epic/verify-plan.ts',
  'src/next/hop-chain.ts',
  'src/next/relation-readings.ts',
];

/** The files named for `rafa-pr`, the root files that reach the pull-request package. */
export const PR_NAMED: readonly string[] = [
  'src/bugs/filed-values.ts',
  'src/bugs/fill.ts',
  'src/bugs/versions.ts',
  'src/cleanup/branches.ts',
  'src/cleanup/groups.ts',
  'src/cleanup/steps.ts',
  'src/config-schema-readings.ts',
  'src/config-schema-triage.ts',
  'src/docs/open-lines.ts',
  'src/docs/release-issue.ts',
  'src/docs/task-reading.ts',
  'src/next/owner-gate.ts',
  'src/next/relations-mode.ts',
  'src/next/settle-step.ts',
  'src/next/sources.ts',
  'src/plan/risk.ts',
  'src/plan/risk/accounts.ts',
];

/** The files named for `rafa-run`, the root files that reach the run package, `src/next/preconditions.ts` among them. */
export const RUN_NAMED: readonly string[] = [
  'src/cleanup/index.ts',
  'src/cleanup/remote-only.ts',
  'src/cleanup/runs.ts',
  'src/cleanup/worktrees.ts',
  'src/commands/switch.ts',
  'src/config-schema-checks.ts',
  'src/config-schema-loop-continue.ts',
  'src/config-schema-loop-retries.ts',
  'src/config-schema-tests.ts',
  'src/config-schema-wrap-up.ts',
  'src/epic/verify-run.ts',
  'src/loop/events-file.ts',
  'src/next/actions.ts',
  'src/next/ending.ts',
  'src/next/hint.ts',
  'src/next/hop-action.ts',
  'src/next/hop-rows.ts',
  'src/next/preconditions.ts',
  'src/next/readings.ts',
  'src/next/state.ts',
  'src/plan/index.ts',
  'src/plan/list.ts',
  'src/plan/store-rules.ts',
  'src/plan/validate.ts',
  'src/runtime/install.ts',
];

/** The files named for `rafa-release`, the root files that reach the release package. */
export const RELEASE_NAMED: readonly string[] = [
  'src/cleanup/past-head.ts',
  'src/commands/doctor-ladder.ts',
  'src/config-schema-release.ts',
  'src/next/epic-end.ts',
  'src/project/lock.ts',
];

/** The files named for `rafa-effort`, the root files that reach the effort package. */
export const EFFORT_NAMED: readonly string[] = [
  'src/config-schema-hub.ts',
];

/**
 * The files named for `rafa-inventory`, the root files that reach the
 * inventory package. `src/start/serving.ts` reaches only inventory files
 * (`src/tiers/` and `src/inventory/trees.ts`) and sits in `src/start/`,
 * so it is named here under pass 1's rule that a file goes with the
 * latest feature it reaches.
 */
export const INVENTORY_NAMED: readonly string[] = [
  'src/adapters/learning/held.ts',
  'src/adapters/learning/local.ts',
  'src/plan/risk/commands.ts',
  'src/plan/risk/long-runs.ts',
  'src/report/lessons.ts',
  'src/start/serving.ts',
];

/**
 * The files named for the CLI, `@open-tomato/rafa`. The first, third and
 * fourth were the CLI rule's inline names: the roster
 * (`src/commands/index.ts`), the bin entry (`src/rafa.ts`) and the agent
 * schema (`src/schema/agent.ts`), as the module note of `cut-table.ts`
 * says. `src/inventory/browse.ts`, the view behind `rafa skill list -i`
 * and `rafa agent list -i`, reaches `src/cli/prompt/page.ts`, `select.ts`
 * and `terminal.ts`, CLI files, so under pass 1's rule that a file goes
 * with the latest package it reaches it is the CLI's, which comes after
 * every feature package. The file does not move.
 */
export const CLI_NAMED: readonly string[] = [
  'src/commands/index.ts',
  'src/inventory/browse.ts',
  'src/rafa.ts',
  'src/schema/agent.ts',
];
