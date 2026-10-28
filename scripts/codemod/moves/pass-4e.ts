import type { FileMove } from './types';

/**
 * Pass 4e of the monorepo migration (#808), the fifth move of pass 4:
 * pr's 82 files, each moved to the same path below `packages/rafa-pr/`.
 * Pass 4 moves the feature packages in the order of 23 October:
 * inventory, effort, board, release, pr, run.
 *
 * 81 of them are the non-test files of the `rafa-pr` row of
 * `docs/survey/cut-table.json`, its 79 sources and its two test-support
 * fakes (`src/pr/gh-fake.ts` and `src/pr/gh-fake-shapes.ts`):
 * `src/commands/pr/` 32, `src/pr/` 28, `src/triage/` 13 and the eight
 * `PR_NAMED` files of `scripts/survey/cut-names.ts` outside those
 * folders, listed by name. The 82nd is `src/commands/pr/open-pull.ts`,
 * the library half this item split out of `open.ts` after the table was
 * read, which `open.ts` imports and so moves beside it.
 *
 * The four resolve plans of `src/pr/plans/` are no code file and move by
 * hand beside `load.ts`, their reader. Colocated tests move with the
 * pass; the four integration tests among them stay at the root until
 * #913. A test reaching only pr, core and pr's declared packages (board,
 * inventory and release) moves with its source under this item's
 * parking rule. Sorted by `from`.
 */
export const PASS_4E_MOVES: readonly FileMove[] = [
  { from: 'src/bugs/filed-values.ts', to: 'packages/rafa-pr/src/bugs/filed-values.ts' },
  { from: 'src/cleanup/branches.ts', to: 'packages/rafa-pr/src/cleanup/branches.ts' },
  { from: 'src/cleanup/groups.ts', to: 'packages/rafa-pr/src/cleanup/groups.ts' },
  { from: 'src/cleanup/worktrees.ts', to: 'packages/rafa-pr/src/cleanup/worktrees.ts' },
  { from: 'src/commands/pr/close.ts', to: 'packages/rafa-pr/src/commands/pr/close.ts' },
  { from: 'src/commands/pr/current.ts', to: 'packages/rafa-pr/src/commands/pr/current.ts' },
  { from: 'src/commands/pr/declarations.ts', to: 'packages/rafa-pr/src/commands/pr/declarations.ts' },
  { from: 'src/commands/pr/index.ts', to: 'packages/rafa-pr/src/commands/pr/index.ts' },
  { from: 'src/commands/pr/last-triage.ts', to: 'packages/rafa-pr/src/commands/pr/last-triage.ts' },
  { from: 'src/commands/pr/list-forecast.ts', to: 'packages/rafa-pr/src/commands/pr/list-forecast.ts' },
  { from: 'src/commands/pr/list.ts', to: 'packages/rafa-pr/src/commands/pr/list.ts' },
  { from: 'src/commands/pr/merge-cleanup.ts', to: 'packages/rafa-pr/src/commands/pr/merge-cleanup.ts' },
  { from: 'src/commands/pr/merge-followups.ts', to: 'packages/rafa-pr/src/commands/pr/merge-followups.ts' },
  { from: 'src/commands/pr/merge-freed.ts', to: 'packages/rafa-pr/src/commands/pr/merge-freed.ts' },
  { from: 'src/commands/pr/merge-guard.ts', to: 'packages/rafa-pr/src/commands/pr/merge-guard.ts' },
  { from: 'src/commands/pr/merge-loop-worktree.ts', to: 'packages/rafa-pr/src/commands/pr/merge-loop-worktree.ts' },
  { from: 'src/commands/pr/merge-project.ts', to: 'packages/rafa-pr/src/commands/pr/merge-project.ts' },
  { from: 'src/commands/pr/merge-refuse.ts', to: 'packages/rafa-pr/src/commands/pr/merge-refuse.ts' },
  { from: 'src/commands/pr/merge-tick.ts', to: 'packages/rafa-pr/src/commands/pr/merge-tick.ts' },
  { from: 'src/commands/pr/merge-unchecked.ts', to: 'packages/rafa-pr/src/commands/pr/merge-unchecked.ts' },
  { from: 'src/commands/pr/merge.ts', to: 'packages/rafa-pr/src/commands/pr/merge.ts' },
  { from: 'src/commands/pr/open-pull.ts', to: 'packages/rafa-pr/src/commands/pr/open-pull.ts' },
  { from: 'src/commands/pr/open.ts', to: 'packages/rafa-pr/src/commands/pr/open.ts' },
  { from: 'src/commands/pr/pr-context.ts', to: 'packages/rafa-pr/src/commands/pr/pr-context.ts' },
  { from: 'src/commands/pr/resolve-loop.ts', to: 'packages/rafa-pr/src/commands/pr/resolve-loop.ts' },
  { from: 'src/commands/pr/retarget.ts', to: 'packages/rafa-pr/src/commands/pr/retarget.ts' },
  { from: 'src/commands/pr/show.ts', to: 'packages/rafa-pr/src/commands/pr/show.ts' },
  { from: 'src/commands/pr/triage-config-trust.ts', to: 'packages/rafa-pr/src/commands/pr/triage-config-trust.ts' },
  { from: 'src/commands/pr/triage-convert.ts', to: 'packages/rafa-pr/src/commands/pr/triage-convert.ts' },
  { from: 'src/commands/pr/triage-guard.ts', to: 'packages/rafa-pr/src/commands/pr/triage-guard.ts' },
  { from: 'src/commands/pr/triage-read.ts', to: 'packages/rafa-pr/src/commands/pr/triage-read.ts' },
  { from: 'src/commands/pr/triage-report.ts', to: 'packages/rafa-pr/src/commands/pr/triage-report.ts' },
  { from: 'src/commands/pr/triage-resolve.ts', to: 'packages/rafa-pr/src/commands/pr/triage-resolve.ts' },
  { from: 'src/commands/pr/triage-trust.ts', to: 'packages/rafa-pr/src/commands/pr/triage-trust.ts' },
  { from: 'src/commands/pr/triage.ts', to: 'packages/rafa-pr/src/commands/pr/triage.ts' },
  { from: 'src/commands/pr/view.ts', to: 'packages/rafa-pr/src/commands/pr/view.ts' },
  { from: 'src/commands/pr/wait.ts', to: 'packages/rafa-pr/src/commands/pr/wait.ts' },
  { from: 'src/docs/task-reading.ts', to: 'packages/rafa-pr/src/docs/task-reading.ts' },
  { from: 'src/plan/risk.ts', to: 'packages/rafa-pr/src/plan/risk.ts' },
  { from: 'src/plan/risk/accounts.ts', to: 'packages/rafa-pr/src/plan/risk/accounts.ts' },
  { from: 'src/pr/checks.ts', to: 'packages/rafa-pr/src/pr/checks.ts' },
  { from: 'src/pr/conflict-sentence.ts', to: 'packages/rafa-pr/src/pr/conflict-sentence.ts' },
  { from: 'src/pr/gh-close.ts', to: 'packages/rafa-pr/src/pr/gh-close.ts' },
  { from: 'src/pr/gh-closing-issues.ts', to: 'packages/rafa-pr/src/pr/gh-closing-issues.ts' },
  { from: 'src/pr/gh-fake-shapes.ts', to: 'packages/rafa-pr/src/pr/gh-fake-shapes.ts' },
  { from: 'src/pr/gh-fake.ts', to: 'packages/rafa-pr/src/pr/gh-fake.ts' },
  { from: 'src/pr/gh.ts', to: 'packages/rafa-pr/src/pr/gh.ts' },
  { from: 'src/pr/index.ts', to: 'packages/rafa-pr/src/pr/index.ts' },
  { from: 'src/pr/merge.ts', to: 'packages/rafa-pr/src/pr/merge.ts' },
  { from: 'src/pr/none.ts', to: 'packages/rafa-pr/src/pr/none.ts' },
  { from: 'src/pr/owner-approval.ts', to: 'packages/rafa-pr/src/pr/owner-approval.ts' },
  { from: 'src/pr/plans/budget.ts', to: 'packages/rafa-pr/src/pr/plans/budget.ts' },
  { from: 'src/pr/plans/load.ts', to: 'packages/rafa-pr/src/pr/plans/load.ts' },
  { from: 'src/pr/preflight-items.ts', to: 'packages/rafa-pr/src/pr/preflight-items.ts' },
  { from: 'src/pr/settle-waiting.ts', to: 'packages/rafa-pr/src/pr/settle-waiting.ts' },
  { from: 'src/pr/triage/attempts.ts', to: 'packages/rafa-pr/src/pr/triage/attempts.ts' },
  { from: 'src/pr/triage/classes.ts', to: 'packages/rafa-pr/src/pr/triage/classes.ts' },
  { from: 'src/pr/triage/classify.ts', to: 'packages/rafa-pr/src/pr/triage/classify.ts' },
  { from: 'src/pr/triage/comment.ts', to: 'packages/rafa-pr/src/pr/triage/comment.ts' },
  { from: 'src/pr/triage/conflict.ts', to: 'packages/rafa-pr/src/pr/triage/conflict.ts' },
  { from: 'src/pr/triage/evidence.ts', to: 'packages/rafa-pr/src/pr/triage/evidence.ts' },
  { from: 'src/pr/triage/follow-up.ts', to: 'packages/rafa-pr/src/pr/triage/follow-up.ts' },
  { from: 'src/pr/triage/rerun.ts', to: 'packages/rafa-pr/src/pr/triage/rerun.ts' },
  { from: 'src/pr/triage/select.ts', to: 'packages/rafa-pr/src/pr/triage/select.ts' },
  { from: 'src/pr/triage/version-convert.ts', to: 'packages/rafa-pr/src/pr/triage/version-convert.ts' },
  { from: 'src/pr/unchecked.ts', to: 'packages/rafa-pr/src/pr/unchecked.ts' },
  { from: 'src/pr/workflow-triggers.ts', to: 'packages/rafa-pr/src/pr/workflow-triggers.ts' },
  { from: 'src/pr/worktree.ts', to: 'packages/rafa-pr/src/pr/worktree.ts' },
  { from: 'src/start/pr-retarget.ts', to: 'packages/rafa-pr/src/start/pr-retarget.ts' },
  { from: 'src/triage/base-run.ts', to: 'packages/rafa-pr/src/triage/base-run.ts' },
  { from: 'src/triage/bug-filing.ts', to: 'packages/rafa-pr/src/triage/bug-filing.ts' },
  { from: 'src/triage/inherited.ts', to: 'packages/rafa-pr/src/triage/inherited.ts' },
  { from: 'src/triage/issue-text.ts', to: 'packages/rafa-pr/src/triage/issue-text.ts' },
  { from: 'src/triage/kind-route.ts', to: 'packages/rafa-pr/src/triage/kind-route.ts' },
  { from: 'src/triage/leftover-repair.ts', to: 'packages/rafa-pr/src/triage/leftover-repair.ts' },
  { from: 'src/triage/own-check.ts', to: 'packages/rafa-pr/src/triage/own-check.ts' },
  { from: 'src/triage/plan-commits.ts', to: 'packages/rafa-pr/src/triage/plan-commits.ts' },
  { from: 'src/triage/refs-section.ts', to: 'packages/rafa-pr/src/triage/refs-section.ts' },
  { from: 'src/triage/scoring-fixture.ts', to: 'packages/rafa-pr/src/triage/scoring-fixture.ts' },
  { from: 'src/triage/similarity.ts', to: 'packages/rafa-pr/src/triage/similarity.ts' },
  { from: 'src/triage/stale-docs.ts', to: 'packages/rafa-pr/src/triage/stale-docs.ts' },
  { from: 'src/triage/triage.ts', to: 'packages/rafa-pr/src/triage/triage.ts' },
];
