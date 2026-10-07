# Provenance

Coverage: 1577 of 1577 tracked files read (src/ and packages/*/src/).

1577 files read over 106 commits, linking 45 issues: 1149 spec, 86 imported, 0 proof of concept, 147 bug-sweep patch, 195 unclassified. 179 files took their class from a commit after the one that added them; 195 of the 195 unclassified files have a history that names no issue.

## Rules

A subject links an issue as `rafa-<n>:` or `(#<n>)`, when `gh issue list --state all` holds `<n>`. A commit is read by the first rule below it meets. A file takes the class of the commit that added it, renames followed, or else of the earliest later commit with a class.

The import pattern is `^Phase 0(?![\w])`.

| Class | Rule | Reads | Commits | Files |
| --- | --- | --- | --- | --- |
| Imported | `root-commit` | the repository's first commit (no parent) | 1 | 8 |
| Imported | `import-subject` | a subject matching the import pattern | 1 | 78 |
| Proof of concept | `spike-label` | a linked issue labelled `type:spike` | 0 | 0 |
| Proof of concept | `spike-subject` | a subject naming a spike, a prototype, a proof of concept or a PoC | 0 | 0 |
| Bug-sweep patch | `bug-label` | a linked issue labelled `type:bug` or `epic:backlog-fixes` | 11 | 100 |
| Bug-sweep patch | `sweep-title` | a linked issue titled `Bug sweep …` or `Sweep …` | 1 | 28 |
| Bug-sweep patch | `fix-subject` | a subject of conventional type `fix` (`fix:`, `fix(<scope>):`) | 16 | 19 |
| Spec | `spec-label` | a linked issue labelled `type:spec` or `spec:*` | 34 | 1149 |

## Classes per cluster

| Cluster | Files | Spec | Imported | Proof of concept | Bug-sweep patch | Unclassified |
| --- | --- | --- | --- | --- | --- | --- |
| `c01-github` | 265 | 254 | 0 | 0 | 9 | 2 |
| `c02-active` | 188 | 88 | 36 | 0 | 29 | 35 |
| `c03-config` | 180 | 151 | 9 | 0 | 13 | 7 |
| `c04-sqlite` | 163 | 105 | 30 | 0 | 10 | 18 |
| `c05-sessions` | 141 | 101 | 0 | 0 | 18 | 22 |
| `c06-command` | 128 | 98 | 1 | 0 | 13 | 16 |
| `c07-index` | 127 | 114 | 3 | 0 | 2 | 8 |
| `c08-cli-capture` | 126 | 87 | 1 | 0 | 28 | 10 |
| `c09-version` | 78 | 69 | 0 | 0 | 9 | 0 |
| `c10-index` | 69 | 25 | 2 | 0 | 10 | 32 |
| `c11-frontmatter` | 46 | 12 | 0 | 0 | 1 | 33 |
| `c12-index` | 45 | 37 | 1 | 0 | 2 | 5 |
| `c13-main` | 2 | 2 | 0 | 0 | 0 | 0 |
| `c14-types.test` | 1 | 0 | 0 | 0 | 1 | 0 |
| `c15-config-schema-readings` | 1 | 1 | 0 | 0 | 0 | 0 |
| `c16-store-sources.sweep.test` | 1 | 1 | 0 | 0 | 0 | 0 |
| `c17-agent-gates.test` | 1 | 0 | 0 | 0 | 1 | 0 |
| `c18-agents-split-accounting.test` | 1 | 0 | 1 | 0 | 0 | 0 |
| `c19-context-page-imports.sweep.test` | 1 | 0 | 1 | 0 | 0 | 0 |
| `c20-epic-guard-workflow.test` | 1 | 0 | 0 | 0 | 0 | 1 |
| `c21-eslint-stand-in` | 1 | 0 | 0 | 0 | 0 | 1 |
| `c22-git-identity.sweep.test` | 1 | 0 | 0 | 0 | 0 | 1 |
| `c23-learning-boundary.test` | 1 | 1 | 0 | 0 | 0 | 0 |
| `c24-relations-import-boundary.sweep.test` | 1 | 1 | 0 | 0 | 0 | 0 |
| `c25-repo-hygiene.sweep.test` | 1 | 0 | 0 | 0 | 0 | 1 |
| `c26-routing-table-agents.sweep.test` | 1 | 0 | 1 | 0 | 0 | 0 |
| `c27-skill-gap-section.test` | 1 | 0 | 0 | 0 | 0 | 1 |
| `c28-spawned-exit-code.sweep.test` | 1 | 0 | 0 | 0 | 1 | 0 |
| `c29-sweep-suffix.sweep.test` | 1 | 0 | 0 | 0 | 0 | 1 |
| `c30-verify-workflow.test` | 1 | 0 | 0 | 0 | 0 | 1 |
| `c31-cli.test` | 1 | 1 | 0 | 0 | 0 | 0 |
| `c32-cli` | 1 | 1 | 0 | 0 | 0 | 0 |

## Unclassified files

| File | Cluster | Commits | Issues named |
| --- | --- | --- | --- |
| `packages/rafa-hub/src/testdata/scratch-home-env.test.ts` | `c12-index` | 1 | none |
| `packages/rafa-hub/src/testdata/scratch-home-env.ts` | `c12-index` | 2 | none |
| `src/adapters/output/active.test.ts` | `c06-command` | 1 | none |
| `src/adapters/output/active.ts` | `c02-active` | 1 | none |
| `src/adapters/output/json.ts` | `c06-command` | 1 | none |
| `src/adapters/output/stream.ts` | `c06-command` | 1 | none |
| `src/adapters/tracker/contract.test.ts` | `c10-index` | 2 | none |
| `src/adapters/tracker/contract.ts` | `c10-index` | 2 | none |
| `src/adapters/tracker/github-fake.test.ts` | `c10-index` | 1 | none |
| `src/adapters/tracker/local.ts` | `c10-index` | 3 | none |
| `src/adapters/tracker/resolve.test.ts` | `c10-index` | 1 | none |
| `src/adapters/tracker/resolve.ts` | `c10-index` | 1 | none |
| `src/backfill/backup.test.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/backup.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/derive.test.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/derive.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/proposal-batch.test.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/proposal-batch.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/proposal-file.test.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/proposal-file.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/propose.test.ts` | `c11-frontmatter` | 1 | none |
| `src/backfill/propose.ts` | `c11-frontmatter` | 1 | none |
| `src/check/layout.test.ts` | `c11-frontmatter` | 1 | none |
| `src/check/layout.ts` | `c11-frontmatter` | 1 | none |
| `src/cli/core/parseArgs.test.ts` | `c06-command` | 1 | none |
| `src/cli/core/parseArgs.ts` | `c06-command` | 1 | none |
| `src/cli/modules.test.ts` | `c06-command` | 1 | none |
| `src/cli/version.test.ts` | `c04-sqlite` | 1 | none |
| `src/cli/version.ts` | `c04-sqlite` | 1 | none |
| `src/commands/check-report.ts` | `c11-frontmatter` | 1 | none |
| `src/commands/describe.test.ts` | `c06-command` | 1 | none |
| `src/commands/describe.ts` | `c06-command` | 1 | none |
| `src/commands/doctor-tab-config.test.ts` | `c03-config` | 1 | none |
| `src/commands/instinct/check.ts` | `c11-frontmatter` | 1 | none |
| `src/commands/instinct/instinct-records.test.ts` | `c02-active` | 1 | none |
| `src/commands/instinct/instinct-records.ts` | `c02-active` | 1 | none |
| `src/commands/instinct/show.test.ts` | `c02-active` | 1 | none |
| `src/commands/instinct/show.ts` | `c02-active` | 1 | none |
| `src/commands/issue/comment.test.ts` | `c10-index` | 1 | none |
| `src/commands/issue/comment.ts` | `c10-index` | 1 | none |
| `src/commands/issue/create-blocked.test.ts` | `c10-index` | 1 | none |
| `src/commands/issue/create-blocked.ts` | `c10-index` | 1 | none |
| `src/commands/issue/create.ts` | `c10-index` | 2 | none |
| `src/commands/issue/issue-tracker.test.ts` | `c03-config` | 1 | none |
| `src/commands/issue/move.test.ts` | `c10-index` | 1 | none |
| `src/commands/issue/move.ts` | `c10-index` | 1 | none |
| `src/commands/issue/show.test.ts` | `c10-index` | 1 | none |
| `src/commands/issue/show.ts` | `c10-index` | 1 | none |
| `src/commands/loop/pause.test.ts` | `c05-sessions` | 1 | none |
| `src/commands/loop/pause.ts` | `c05-sessions` | 1 | none |
| `src/commands/loop/resume.test.ts` | `c05-sessions` | 1 | none |
| `src/commands/loop/resume.ts` | `c05-sessions` | 1 | none |
| `src/commands/loop/stop.test.ts` | `c05-sessions` | 1 | none |
| `src/commands/loop/stop.ts` | `c05-sessions` | 1 | none |
| `src/commands/loop/wait.test.ts` | `c05-sessions` | 1 | none |
| `src/commands/loop/wait.ts` | `c05-sessions` | 1 | none |
| `src/commands/module/exec.test.ts` | `c06-command` | 1 | none |
| `src/commands/module/list.test.ts` | `c06-command` | 1 | none |
| `src/commands/pr/merge-loop-holder.test.ts` | `c05-sessions` | 2 | none |
| `src/commands/pr/merge-loop-worktree.test.ts` | `c05-sessions` | 1 | none |
| `src/commands/pr/merge-loop-worktree.ts` | `c05-sessions` | 1 | none |
| `src/commands/skill/backfill.test.ts` | `c11-frontmatter` | 1 | none |
| `src/commands/skill/demote.test.ts` | `c11-frontmatter` | 1 | none |
| `src/commands/skill/demote.ts` | `c11-frontmatter` | 1 | none |
| `src/commands/wrap.test.ts` | `c06-command` | 1 | none |
| `src/commands/wrap.ts` | `c06-command` | 2 | none |
| `src/config-schema-triage.test.ts` | `c03-config` | 1 | none |
| `src/config-schema-triage.ts` | `c03-config` | 1 | none |
| `src/demote/apply.test.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/apply.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/classify.test.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/draft.test.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/draft.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/report.test.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/report.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/select.test.ts` | `c11-frontmatter` | 1 | none |
| `src/demote/select.ts` | `c11-frontmatter` | 1 | none |
| `src/effort/report-budgets.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/report-budgets.ts` | `c04-sqlite` | 1 | none |
| `src/effort/report-format.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/session-log-dirs.test.ts` | `c12-index` | 1 | none |
| `src/effort/session-log-dirs.ts` | `c12-index` | 1 | none |
| `src/effort/store/legacy.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/store/rebuild-identity.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/store/session-worktree.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/store/store-generation.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/store/store-generation.ts` | `c04-sqlite` | 1 | none |
| `src/effort/store/task-finishes.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/store/testdata/store-rows.test.ts` | `c04-sqlite` | 1 | none |
| `src/effort/store/testdata/store-rows.ts` | `c04-sqlite` | 1 | none |
| `src/fixtures/fixture-guard.sweep.test.ts` | `c04-sqlite` | 1 | none |
| `src/fixtures/fixture-path.test.ts` | `c04-sqlite` | 1 | none |
| `src/fixtures/fixture-path.ts` | `c04-sqlite` | 1 | none |
| `src/fixtures/scrub.test.ts` | `c04-sqlite` | 1 | none |
| `src/fixtures/scrub.ts` | `c04-sqlite` | 1 | none |
| `src/loop/awake-clock.test.ts` | `c05-sessions` | 1 | none |
| `src/loop/awake-clock.ts` | `c05-sessions` | 1 | none |
| `src/loop/events-file.test.ts` | `c05-sessions` | 1 | none |
| `src/loop/events-file.ts` | `c05-sessions` | 1 | none |
| `src/loop/wait-reasons.test.ts` | `c05-sessions` | 1 | none |
| `src/loop/wait-reasons.ts` | `c05-sessions` | 1 | none |
| `src/modules/testdata/seam-fixture/commands.ts` | `c06-command` | 1 | none |
| `src/pr/gh-closing-issues.test.ts` | `c07-index` | 1 | none |
| `src/pr/gh-closing-issues.ts` | `c07-index` | 1 | none |
| `src/pr/workflow-triggers.test.ts` | `c06-command` | 1 | none |
| `src/pr/workflow-triggers.ts` | `c06-command` | 1 | none |
| `src/preflight/fork.test.ts` | `c02-active` | 3 | none |
| `src/preflight/run.test.ts` | `c02-active` | 3 | none |
| `src/preflight/run.ts` | `c02-active` | 1 | none |
| `src/project/bin-path.test.ts` | `c05-sessions` | 1 | none |
| `src/project/roots.test.ts` | `c08-cli-capture` | 2 | none |
| `src/runtime/install.ts` | `c05-sessions` | 2 | none |
| `src/schema/frontmatter.test.ts` | `c11-frontmatter` | 1 | none |
| `src/schema/frontmatter.ts` | `c11-frontmatter` | 1 | none |
| `src/schema/project-id.test.ts` | `c07-index` | 2 | none |
| `src/schema/project-id.ts` | `c07-index` | 1 | none |
| `src/schema/stack.test.ts` | `c11-frontmatter` | 1 | none |
| `src/schema/stack.ts` | `c11-frontmatter` | 1 | none |
| `src/start/base-prompts.sweep.test.ts` | `c05-sessions` | 1 | none |
| `src/start/budget.test.ts` | `c02-active` | 1 | none |
| `src/start/budget.ts` | `c02-active` | 1 | none |
| `src/start/claim-catch-up-integration.test.ts` | `c02-active` | 1 | none |
| `src/start/claim-catch-up.test.ts` | `c07-index` | 1 | none |
| `src/start/claim-catch-up.ts` | `c07-index` | 1 | none |
| `src/start/inherited-notice.test.ts` | `c02-active` | 1 | none |
| `src/start/inherited-notice.ts` | `c02-active` | 1 | none |
| `src/start/lint-step.test.ts` | `c02-active` | 1 | none |
| `src/start/lint-step.ts` | `c02-active` | 1 | none |
| `src/start/pause.test.ts` | `c02-active` | 1 | none |
| `src/start/pause.ts` | `c02-active` | 1 | none |
| `src/start/pr-retarget.test.ts` | `c07-index` | 1 | none |
| `src/start/pr-retarget.ts` | `c02-active` | 1 | none |
| `src/start/stamp.test.ts` | `c02-active` | 1 | none |
| `src/start/stamp.ts` | `c02-active` | 1 | none |
| `src/start/suite-blocker.test.ts` | `c02-active` | 1 | none |
| `src/start/suite-blocker.ts` | `c02-active` | 2 | none |
| `src/start/suite-stage-step.test.ts` | `c02-active` | 1 | none |
| `src/start/suite-stage-step.ts` | `c02-active` | 1 | none |
| `src/start/sweep-timing.test.ts` | `c02-active` | 1 | none |
| `src/start/sweep-timing.ts` | `c02-active` | 1 | none |
| `src/start/task-always-run.test.ts` | `c02-active` | 2 | none |
| `src/start/task-always-run.ts` | `c02-active` | 2 | none |
| `src/start/task-gate-lines.test.ts` | `c10-index` | 1 | none |
| `src/start/task-gate-lines.ts` | `c02-active` | 1 | none |
| `src/start/triage-inherited.test.ts` | `c10-index` | 1 | none |
| `src/suite/unhandled.test.ts` | `c02-active` | 1 | none |
| `src/suite/unhandled.ts` | `c02-active` | 1 | none |
| `src/tests/backfill-pipeline.test.ts` | `c11-frontmatter` | 1 | none |
| `src/tests/cleanup-base-worktree-spawned.test.ts` | `c08-cli-capture` | 2 | none |
| `src/tests/demotion-pass.test.ts` | `c11-frontmatter` | 1 | none |
| `src/tests/effort-collect-worktrees-integration.test.ts` | `c12-index` | 1 | none |
| `src/tests/epic-guard-workflow.test.ts` | `c20-epic-guard-workflow.test` | 1 | none |
| `src/tests/eslint-stand-in.mjs` | `c21-eslint-stand-in` | 1 | none |
| `src/tests/git-identity-spawn.test.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/git-identity.sweep.test.ts` | `c22-git-identity.sweep.test` | 3 | none |
| `src/tests/git-identity.test.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/git-identity.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/issue-create-spec-integration.test.ts` | `c10-index` | 1 | none |
| `src/tests/loop-events-file-integration.test.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/loop-session-fixtures.ts` | `c05-sessions` | 1 | none |
| `src/tests/loop-wait-spawned.test.ts` | `c05-sessions` | 1 | none |
| `src/tests/module-seams.test.ts` | `c06-command` | 1 | none |
| `src/tests/output-sinks.test.ts` | `c02-active` | 1 | none |
| `src/tests/output-sinks.ts` | `c02-active` | 1 | none |
| `src/tests/plan-create-refs-gate-integration.test.ts` | `c01-github` | 1 | none |
| `src/tests/pr-event-text-mode-integration.test.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/pr-show-closes-integration.test.ts` | `c07-index` | 1 | none |
| `src/tests/refs-readings-integration.test.ts` | `c01-github` | 1 | none |
| `src/tests/repo-hygiene.sweep.test.ts` | `c25-repo-hygiene.sweep.test` | 2 | none |
| `src/tests/report-ask-live.test.ts` | `c02-active` | 1 | none |
| `src/tests/report-ask.test.ts` | `c02-active` | 1 | none |
| `src/tests/schema-records.test.ts` | `c11-frontmatter` | 1 | none |
| `src/tests/scratch-home-env.test.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/scratch-home-env.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/skill-gap-section.test.ts` | `c27-skill-gap-section.test` | 1 | none |
| `src/tests/source-uses.ts` | `c08-cli-capture` | 1 | none |
| `src/tests/stage-green-without-live-parity.test.ts` | `c03-config` | 2 | none |
| `src/tests/sweep-suffix.sweep.test.ts` | `c29-sweep-suffix.sweep.test` | 1 | none |
| `src/tests/verify-workflow.test.ts` | `c30-verify-workflow.test` | 1 | none |
| `src/triage/bug-key.test.ts` | `c10-index` | 1 | none |
| `src/triage/bug-key.ts` | `c10-index` | 1 | none |
| `src/triage/inherited.test.ts` | `c10-index` | 1 | none |
| `src/triage/inherited.ts` | `c10-index` | 1 | none |
| `src/triage/issue-text.ts` | `c10-index` | 1 | none |
| `src/triage/scoring-fixture.test.ts` | `c10-index` | 2 | none |
| `src/triage/scoring-fixture.ts` | `c10-index` | 2 | none |
| `src/triage/similarity-scoring.test.ts` | `c10-index` | 2 | none |
| `src/triage/similarity-triage.test.ts` | `c10-index` | 1 | none |
| `src/triage/similarity.test.ts` | `c10-index` | 1 | none |
| `src/triage/similarity.ts` | `c10-index` | 1 | none |
| `src/triage/test-failure-triage.test.ts` | `c10-index` | 1 | none |
| `src/triage/test-failure.test.ts` | `c10-index` | 1 | none |
| `src/triage/test-failure.ts` | `c10-index` | 1 | none |
| `src/utils/agent-definition.test.ts` | `c03-config` | 1 | none |
| `src/utils/agent-definition.ts` | `c03-config` | 2 | none |
