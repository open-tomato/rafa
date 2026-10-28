/**
 * The files the cut table names for each feature package (#808, pass 1):
 * root files that reach a feature package, placed by name whatever their
 * folder. A named file keeps its path until its package moves; the board,
 * release and pr lists follow their files since passes 4c, 4d and 4e.
 * Each list is sorted by UTF-16 code unit, and `CUT_RULES` of
 * `cut-table.ts` reads them, so a file named here is placed in its
 * package and is not left to place.
 *
 * @module
 */

/**
 * The files named for `rafa-board`: the fourteen `src/board/` files
 * `docs/survey/cluster-map.json` puts in cluster c6, and the eight root
 * files that reach the board. The fifteenth reaches only core and moved
 * into it in the first decouple item, as `packages/rafa/src/board/naming.ts`.
 * Since pass 4c the list names each file at its path in board's package,
 * `packages/rafa-board/src/`, where the `packages/rafa-board/` folder of
 * `CUT_RULES` would place it too; the order is the one it had, since the
 * paths share the prefix. The section files `config-schema-board-project.ts`
 * and `config-schema-issues.ts` left the list in the third decouple item
 * (rafa-1325), which moves them into core's package, where the
 * `packages/rafa/` folder of `CUT_RULES` places them. The fourth decouple
 * item (rafa-1333) added `packages/rafa-board/src/claims/ahead.ts` and
 * `packages/rafa-board/src/epic/verify-run.ts` by pass 1's rule: once its
 * cuts are made, each reaches only board and core, so each is board's.
 */
export const BOARD_NAMED: readonly string[] = [
  'packages/rafa-board/src/board/flags.ts',
  'packages/rafa-board/src/board/gate.ts',
  'packages/rafa-board/src/board/issue.ts',
  'packages/rafa-board/src/board/leak.ts',
  'packages/rafa-board/src/board/plan-field.ts',
  'packages/rafa-board/src/board/plan-spec.ts',
  'packages/rafa-board/src/board/previous-copy.ts',
  'packages/rafa-board/src/board/readiness.ts',
  'packages/rafa-board/src/board/review-comment.ts',
  'packages/rafa-board/src/board/review-stamp.ts',
  'packages/rafa-board/src/board/snapshot-settle.ts',
  'packages/rafa-board/src/board/spec-review.ts',
  'packages/rafa-board/src/board/spec-source.ts',
  'packages/rafa-board/src/board/trust.ts',
  'packages/rafa-board/src/bugs/cause-rule.ts',
  'packages/rafa-board/src/claims/ahead.ts',
  'packages/rafa-board/src/commands/doctor-refs.ts',
  'packages/rafa-board/src/commands/plan/refs-check.ts',
  'packages/rafa-board/src/epic/verify-plan.ts',
  'packages/rafa-board/src/epic/verify-run.ts',
  'packages/rafa-board/src/next/hop-chain.ts',
  'packages/rafa-board/src/next/relation-readings.ts',
];

/**
 * The files named for `rafa-pr`, the root files that reach the
 * pull-request package. The section files `config-schema-readings.ts`
 * and `config-schema-triage.ts` left the list in the third decouple item
 * (rafa-1325), which moves them into core's package, where the
 * `packages/rafa/` folder of `CUT_RULES` places them. The fourth decouple
 * item (rafa-1333) moved `packages/rafa/src/bugs/fill.ts` and
 * `packages/rafa/src/bugs/versions.ts` into core's package too, and the
 * same folder places them. The sixth decouple item (rafa-1362) moved the
 * stale-docs files `packages/rafa-release/src/docs/open-lines.ts` and
 * `packages/rafa-release/src/docs/release-issue.ts` to the release list,
 * since each reaches only release and core. The seventh decouple item
 * (rafa-1368) placed `packages/rafa-pr/src/cleanup/worktrees.ts` and
 * `packages/rafa-pr/src/start/pr-retarget.ts` here by pass 1's rule,
 * since each reaches only pr and core (`worktrees.ts` `parseWorktrees`
 * of `packages/rafa-pr/src/pr/merge.ts`, `pr-retarget.ts` the port types
 * of `packages/rafa-pr/src/pr/index.ts`), and moved
 * `src/cleanup/steps.ts`, `src/next/owner-gate.ts`,
 * `src/next/relations-mode.ts`, `src/next/settle-step.ts` and
 * `src/next/sources.ts` to the run list. Since pass 4e the list names
 * each file at its path in pr's package, `packages/rafa-pr/src/`, where
 * the `packages/rafa-pr/` folder of `CUT_RULES` would place it too; the
 * order is the one it had, since the paths share the prefix.
 */
export const PR_NAMED: readonly string[] = [
  'packages/rafa-pr/src/bugs/filed-values.ts',
  'packages/rafa-pr/src/cleanup/branches.ts',
  'packages/rafa-pr/src/cleanup/groups.ts',
  'packages/rafa-pr/src/cleanup/worktrees.ts',
  'packages/rafa-pr/src/docs/task-reading.ts',
  'packages/rafa-pr/src/plan/risk.ts',
  'packages/rafa-pr/src/plan/risk/accounts.ts',
  'packages/rafa-pr/src/start/pr-retarget.ts',
];

/**
 * The files named for `rafa-run`, the root files that reach the run
 * package, `src/next/preconditions.ts` among them. The five section
 * files, `config-schema-checks.ts`, `config-schema-loop-continue.ts`,
 * `config-schema-loop-retries.ts`, `config-schema-tests.ts` and
 * `config-schema-wrap-up.ts`, left the list in the third decouple item
 * (rafa-1325), which moves them into core's package, where the
 * `packages/rafa/` folder of `CUT_RULES` places them. The fourth decouple
 * item (rafa-1333) moved `packages/rafa/src/plan/validate.ts` into core's
 * package too, and the same folder places it, and placed
 * `packages/rafa-board/src/epic/verify-run.ts` in board by name, since it
 * reaches only board and core. The seventh decouple item (rafa-1368)
 * placed `src/cleanup/steps.ts`, `src/next/owner-gate.ts`,
 * `src/next/relations-mode.ts`, `src/next/settle-step.ts` and
 * `src/next/sources.ts` here by the same rule read with type edges, since
 * each reads run's types and is imported only by run and the CLI, and
 * moved `packages/rafa-pr/src/cleanup/worktrees.ts` to the pr list,
 * since it reaches only pr and core. Pass 4f moved `src/plan/index.ts`,
 * the published `./plan` entry, to the CLI's list.
 */
export const RUN_NAMED: readonly string[] = [
  'src/cleanup/index.ts',
  'src/cleanup/remote-only.ts',
  'src/cleanup/runs.ts',
  'src/cleanup/steps.ts',
  'src/commands/switch.ts',
  'src/loop/events-file.ts',
  'src/next/actions.ts',
  'src/next/ending.ts',
  'src/next/hint.ts',
  'src/next/hop-action.ts',
  'src/next/hop-rows.ts',
  'src/next/owner-gate.ts',
  'src/next/preconditions.ts',
  'src/next/readings.ts',
  'src/next/relations-mode.ts',
  'src/next/settle-step.ts',
  'src/next/sources.ts',
  'src/next/state.ts',
  'src/plan/list.ts',
  'src/plan/store-rules.ts',
  'src/runtime/install.ts',
];

/**
 * The files named for `rafa-release`, the root files that reach the
 * release package. The section file `config-schema-release.ts` left the
 * list in the third decouple item (rafa-1325), which moves it into core's
 * package, where the `packages/rafa/` folder of `CUT_RULES` places it.
 * The sixth decouple item (rafa-1362) placed the two stale-docs files
 * here by pass 1's rule: each reaches only release and core
 * (`release-issue.ts` the release forecast and version helpers,
 * `open-lines.ts` only `release-issue.ts`), and a file goes with the
 * latest package it reaches. Since pass 4d the list names each file at its
 * path in release's package, `packages/rafa-release/src/`, where the
 * `packages/rafa-release/` folder of `CUT_RULES` would place it too; the
 * order is the one it had, since the paths share the prefix.
 */
export const RELEASE_NAMED: readonly string[] = [
  'packages/rafa-release/src/cleanup/past-head.ts',
  'packages/rafa-release/src/commands/doctor-ladder.ts',
  'packages/rafa-release/src/docs/open-lines.ts',
  'packages/rafa-release/src/docs/release-issue.ts',
  'packages/rafa-release/src/next/epic-end.ts',
  'packages/rafa-release/src/project/lock.ts',
];

/**
 * The files named for `rafa-effort`: none since the third decouple item
 * (rafa-1325). The one file it named, the section file
 * `config-schema-hub.ts`, moves into core's package in that item, where
 * the `packages/rafa/` folder of `CUT_RULES` places it, so no name is
 * needed.
 */
export const EFFORT_NAMED: readonly string[] = [];

/**
 * The files named for `rafa-inventory`: none since pass 4a. The six
 * root files it named, the two learning adapter files, the two plan risk
 * readings, `report/lessons.ts` and `start/serving.ts`, moved into the
 * package in pass 4a, to their paths below `packages/rafa-inventory/src/`,
 * and the `packages/rafa-inventory/` folder of `CUT_RULES` places them
 * now, so no name is needed.
 */
export const INVENTORY_NAMED: readonly string[] = [];

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
 * `src/effort/store/index.ts` is the published `./store` entry, a build
 * entry of the CLI as `src/rafa.ts` is (`LIBRARY_ENTRIES` of
 * `scripts/build/bundle.ts`), holding one line of core; it does not move
 * in pass 4b, so the build is untouched. `src/plan/index.ts` is the
 * published `./plan` entry, a build entry of the CLI in the same way; it
 * left run's list in pass 4f, stays at the root when run's files move,
 * and takes the preflight names from core, whose subpaths
 * `@open-tomato/rafa/preflight/run` and `prerequisites-md` they sit behind.
 */
export const CLI_NAMED: readonly string[] = [
  'src/commands/index.ts',
  'src/effort/store/index.ts',
  'src/inventory/browse.ts',
  'src/plan/index.ts',
  'src/rafa.ts',
  'src/schema/agent.ts',
];
