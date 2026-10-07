# Doc inventory

Coverage: 1577 of 1577 tracked files read (src/ and packages/*/src/).

Module notes: 631 of 633 source files, 890 of 908 test files and 34 of 36 test-support files open with one. `{@link}`s read: 5626; 5344 inside one cluster, 195 across clusters, 1 to a URL or a file outside the graph, 86 bound to no import or declaration of their file. 67 concept placements are named by no module note in their cluster.

## Source files with no module note, by cluster

### `c02-active` (1 of 85 source files)

- `src/utils/tracker.ts`

### `c07-index` (1 of 54 source files)

- `src/utils/git.ts`

Every source file has a module note in: `c01-github`, `c03-config`, `c04-sqlite`, `c05-sessions`, `c06-command`, `c08-cli-capture`, `c09-version`, `c10-index`, `c11-frontmatter`, `c12-index`, `c15-config-schema-readings`, `c32-cli`.

## Links across clusters

172 distinct links (file, target, file reached), 195 written.

| From | Cluster | Link | Times | To | Cluster |
| --- | --- | --- | --- | --- | --- |
| `src/adapters/planner/claude.ts` | `c02-active` | `GeneratedPlan` | 1 | `src/ports/index.ts` | `c10-index` |
| `src/adapters/tracker/github-fake.ts` | `c10-index` | `GhRunner` | 1 | `src/adapters/tracker/github.ts` | `c01-github` |
| `src/adapters/tracker/resolve.ts` | `c10-index` | `AdapterRegistry` | 1 | `src/adapters/registry.ts` | `c03-config` |
| `src/board/board-body.ts` | `c05-sessions` | `parseRoadmapBody` | 2 | `src/board/roadmap.ts` | `c01-github` |
| `src/board/epic-body.ts` | `c10-index` | `parseRoadmapBody` | 3 | `src/board/roadmap.ts` | `c01-github` |
| `src/board/epic-checklist.test.ts` | `c10-index` | `TICK_ATTEMPTS` | 1 | `src/board/roadmap-tick.ts` | `c01-github` |
| `src/board/epic-context.ts` | `c01-github` | `readEpicBody` | 1 | `src/board/epic-body.ts` | `c10-index` |
| `src/board/gate.ts` | `c02-active` | `validatePlan` | 1 | `src/commands/plan/validate.ts` | `c06-command` |
| `src/board/issue-board.ts` | `c07-index` | `CREATED_ISSUE_URL` | 1 | `src/board/setup.ts` | `c01-github` |
| `src/board/issue-board.ts` | `c07-index` | `GhRunner` | 1 | `src/adapters/tracker/github.ts` | `c01-github` |
| `src/board/owner-resolve.ts` | `c05-sessions` | `GhRunner` | 1 | `src/adapters/tracker/github.ts` | `c01-github` |
| `src/board/plan-spec.ts` | `c01-github` | `GateIssue` | 1 | `src/board/gate.ts` | `c02-active` |
| `src/board/plan-spec.ts` | `c01-github` | `requireTrustedBoardAuthor` | 1 | `src/board/trust.ts` | `c07-index` |
| `src/board/roadmap-claims-remote.test.ts` | `c07-index` | `scanClaimBranches` | 1 | `src/board/roadmap.ts` | `c01-github` |
| `src/board/roadmap-rows.ts` | `c01-github` | `stubOfPlanFile` | 1 | `src/commands/plan/plan-files.ts` | `c05-sessions` |
| `src/board/roadmap-tick.test.ts` | `c01-github` | `createFakeGh` | 1 | `src/adapters/tracker/github-fake.ts` | `c10-index` |
| `src/board/setup.ts` | `c01-github` | `CLAIMED_LABEL` | 1 | `src/claims/stale.ts` | `c07-index` |
| `src/board/setup.ts` | `c01-github` | `IN_DEVELOPMENT_LABEL` | 1 | `src/claims/stale.ts` | `c07-index` |
| `src/board/setup.ts` | `c01-github` | `SPEC_NEEDS_WORK_LABEL` | 1 | `src/board/gate.ts` | `c02-active` |
| `src/board/trust.ts` | `c07-index` | `GhRunner` | 1 | `src/adapters/tracker/github.ts` | `c01-github` |
| `src/check/references.ts` | `c03-config` | `AGNOSTIC_STACK` | 1 | `src/schema/stack.ts` | `c11-frontmatter` |
| `src/check/run.test.ts` | `c03-config` | `CHECK_STAGES` | 1 | `src/check/run.ts` | `c11-frontmatter` |
| `src/claims/drift.ts` | `c01-github` | `STAGE_LABELS` | 3 | `src/claims/labels.ts` | `c07-index` |
| `src/cleanup/branches.ts` | `c05-sessions` | `GitRunner` | 2 | `src/pr/git.ts` | `c01-github` |
| `src/cleanup/groups.ts` | `c05-sessions` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/cleanup/past-head.ts` | `c05-sessions` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/cleanup/steps.ts` | `c05-sessions` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/commands/check-report.ts` | `c11-frontmatter` | `CommandExit` | 1 | `src/cli/command.ts` | `c06-command` |
| `src/commands/cleanup.ts` | `c05-sessions` | `Prompter` | 1 | `src/cli/prompt/confirm.ts` | `c01-github` |
| `src/commands/cleanup.ts` | `c05-sessions` | `ghPullRequestsIn` | 2 | `src/pr/index.ts` | `c07-index` |
| `src/commands/doctor.test.ts` | `c01-github` | `SERVE_CLI_VERSION` | 1 | `src/tiers/delivery.ts` | `c03-config` |
| `src/commands/init-release.ts` | `c08-cli-capture` | `Prompter` | 1 | `src/cli/prompt/confirm.ts` | `c01-github` |
| `src/commands/instinct/flag.ts` | `c06-command` | `CORE_ADAPTER_REGISTRY` | 2 | `src/adapters/registry.ts` | `c03-config` |
| `src/commands/instinct/instinct-records.ts` | `c02-active` | `tierExists` | 1 | `src/schema/tiers.ts` | `c03-config` |
| `src/commands/instinct/promote.ts` | `c02-active` | `CORE_ADAPTER_REGISTRY` | 2 | `src/adapters/registry.ts` | `c03-config` |
| `src/commands/issue/create.ts` | `c10-index` | `IssueSeams` | 1 | `src/commands/issue/issue-tracker.ts` | `c01-github` |
| `src/commands/issue/ready.test.ts` | `c01-github` | `endingProbe` | 1 | `src/tests/ending-probe.ts` | `c06-command` |
| `src/commands/issue/ready.ts` | `c01-github` | `IssueBoard` | 1 | `src/board/issue-board.ts` | `c07-index` |
| `src/commands/issue/ready.ts` | `c01-github` | `answeredYes` | 1 | `src/start/branch-decision.ts` | `c07-index` |
| `src/commands/issue/unblock.ts` | `c01-github` | `IssueBoard` | 1 | `src/board/issue-board.ts` | `c07-index` |
| `src/commands/plan/risk.test.ts` | `c03-config` | `runRafa` | 1 | `src/tests/cli-capture.ts` | `c08-cli-capture` |
| `src/commands/pr/merge-cleanup.test.ts` | `c09-version` | `GitRunner` | 1 | `src/pr/index.ts` | `c07-index` |
| `src/commands/pr/merge-cleanup.ts` | `c09-version` | `GitRunner` | 1 | `src/pr/index.ts` | `c07-index` |
| `src/commands/pr/merge-followups.ts` | `c06-command` | `RAFA_PACKAGE_NAME` | 2 | `src/runtime/install.ts` | `c05-sessions` |
| `src/commands/pr/merge.test.ts` | `c01-github` | `endingProbe` | 1 | `src/tests/ending-probe.ts` | `c06-command` |
| `src/commands/pr/merge.ts` | `c06-command` | `Prompter` | 1 | `src/cli/prompt/confirm.ts` | `c01-github` |
| `src/commands/pr/pr-context.ts` | `c06-command` | `ghPullRequestsIn` | 1 | `src/pr/index.ts` | `c07-index` |
| `src/commands/pr/show.ts` | `c07-index` | `SEPARATOR` | 1 | `src/commands/pr/current.ts` | `c06-command` |
| `src/commands/pr/triage-report.ts` | `c07-index` | `skipChecksCommand` | 1 | `src/pr/unchecked.ts` | `c06-command` |
| `src/commands/pr/triage.test.ts` | `c07-index` | `endingProbe` | 1 | `src/tests/ending-probe.ts` | `c06-command` |
| `src/commands/pr/wait.ts` | `c06-command` | `waitForChecks` | 1 | `src/pr/index.ts` | `c07-index` |
| `src/commands/release/tag.ts` | `c09-version` | `CommandExit` | 1 | `src/cli/command.ts` | `c06-command` |
| `src/config-sections.ts` | `c03-config` | `CONFIDENCE_MAX` | 2 | `src/learning/identity.ts` | `c02-active` |
| `src/config-sections.ts` | `c03-config` | `CONFIDENCE_MIN` | 2 | `src/learning/identity.ts` | `c02-active` |
| `src/config-sections.ts` | `c03-config` | `MergeMethod` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/effort/attribution.ts` | `c02-active` | `SessionStats` | 1 | `src/effort/session-log.ts` | `c04-sqlite` |
| `src/effort/classify.ts` | `c02-active` | `readLines` | 1 | `src/effort/session-log.ts` | `c04-sqlite` |
| `src/effort/collect.test.ts` | `c02-active` | `CollectOptions.readCommits` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/effort/collect.test.ts` | `c02-active` | `collectEffort` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/effort/collect.test.ts` | `c02-active` | `selectCommits` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/effort/collect.test.ts` | `c02-active` | `selectSessionLogs` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/effort/collect.ts` | `c03-config` | `EffortStore` | 1 | `src/effort/store/types.ts` | `c04-sqlite` |
| `src/effort/collect.ts` | `c03-config` | `SessionEffortRow.modifiedAt` | 1 | `src/effort/store/types.ts` | `c04-sqlite` |
| `src/effort/collect.ts` | `c03-config` | `SessionEffortRow.sizeBytes` | 1 | `src/effort/store/types.ts` | `c04-sqlite` |
| `src/effort/epic-cost.test.ts` | `c04-sqlite` | `EpicCostRow` | 1 | `src/effort/epic-cost.ts` | `c10-index` |
| `src/effort/report-trend-read.ts` | `c04-sqlite` | `summariseTrend` | 1 | `src/effort/report-trend.ts` | `c05-sessions` |
| `src/effort/report.test.ts` | `c04-sqlite` | `PROMPT_SHAPES` | 1 | `src/effort/classify.ts` | `c02-active` |
| `src/effort/report.ts` | `c04-sqlite` | `SessionEffortRow` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/effort/store/dispatches.ts` | `c04-sqlite` | `SKILL_RESOLVERS` | 1 | `src/config-sections.ts` | `c03-config` |
| `src/effort/store/index.ts` | `c12-index` | `mergeStore` | 1 | `src/effort/store/merge-store.ts` | `c04-sqlite` |
| `src/effort/store/search-row.test.ts` | `c04-sqlite` | `SessionEffortRow` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/epic/verify-run.ts` | `c10-index` | `DEFAULT_BASE_BRANCH` | 2 | `src/next/sources.ts` | `c05-sessions` |
| `src/fixtures/scrub.ts` | `c04-sqlite` | `HOME_MARKER` | 1 | `src/triage/local-paths.ts` | `c10-index` |
| `src/fixtures/scrub.ts` | `c04-sqlite` | `localPathRedactor` | 1 | `src/triage/local-paths.ts` | `c10-index` |
| `src/index.ts` | `c03-config` | `ScopeError` | 1 | `src/project/scope.ts` | `c05-sessions` |
| `src/index.ts` | `c03-config` | `effortReportCommand` | 1 | `src/effort/report.ts` | `c04-sqlite` |
| `src/index.ts` | `c03-config` | `initHint` | 1 | `src/project/scope.ts` | `c05-sessions` |
| `src/index.ts` | `c03-config` | `planCommand` | 1 | `src/plan.ts` | `c02-active` |
| `src/index.ts` | `c03-config` | `resolveScope` | 1 | `src/project/scope.ts` | `c05-sessions` |
| `src/index.ts` | `c03-config` | `scopeAt` | 1 | `src/project/scope.ts` | `c05-sessions` |
| `src/index.ts` | `c03-config` | `startCommand` | 1 | `src/start.ts` | `c02-active` |
| `src/inventory/browse.ts` | `c06-command` | `readShowView` | 1 | `src/inventory/show.ts` | `c03-config` |
| `src/inventory/browse.ts` | `c06-command` | `renderShowView` | 1 | `src/inventory/show.ts` | `c03-config` |
| `src/inventory/search/index.test.ts` | `c03-config` | `CapturingSpawner` | 1 | `src/utils/claude.ts` | `c02-active` |
| `src/next/epic-end.ts` | `c06-command` | `NextRoadmapReading.dryEpic` | 1 | `src/next/readings.ts` | `c05-sessions` |
| `src/next/hop-after-loop.test.ts` | `c05-sessions` | `homeAfterLoop` | 1 | `src/next/hop-rows.ts` | `c01-github` |
| `src/next/hop-after-loop.test.ts` | `c05-sessions` | `readHomeAfterLoop` | 1 | `src/next/state.ts` | `c06-command` |
| `src/next/hop-rows.ts` | `c01-github` | `NextHopReading.target` | 1 | `src/next/readings.ts` | `c05-sessions` |
| `src/next/hop-rows.ts` | `c01-github` | `NextRoadmapReading.hop` | 1 | `src/next/readings.ts` | `c05-sessions` |
| `src/next/hop-rows.ts` | `c01-github` | `NextRoadmapSources.ownerApproval` | 1 | `src/next/readings.ts` | `c05-sessions` |
| `src/next/hop-rows.ts` | `c01-github` | `NextStateId` | 1 | `src/next/state.ts` | `c06-command` |
| `src/next/state.ts` | `c06-command` | `NextSources.board` | 1 | `src/next/readings.ts` | `c05-sessions` |
| `src/next/state.ts` | `c06-command` | `NextSources.roadmap` | 3 | `src/next/readings.ts` | `c05-sessions` |
| `src/plan.ts` | `c02-active` | `CORE_ADAPTER_REGISTRY` | 1 | `src/adapters/registry.ts` | `c03-config` |
| `src/plan/index.ts` | `c02-active` | `FINDING_KINDS` | 1 | `src/report/parse.ts` | `c04-sqlite` |
| `src/plan/index.ts` | `c02-active` | `FINDING_SIGNALS` | 1 | `src/report/parse.ts` | `c04-sqlite` |
| `src/plan/index.ts` | `c02-active` | `INJECT_MODES` | 1 | `src/config.ts` | `c03-config` |
| `src/plan/index.ts` | `c02-active` | `REPORT_STATUSES` | 1 | `src/report/parse.ts` | `c04-sqlite` |
| `src/plan/index.ts` | `c02-active` | `parseReport` | 1 | `src/report/parse.ts` | `c04-sqlite` |
| `src/ports/index.ts` | `c10-index` | `BlessedBundle` | 1 | `src/learning/types.ts` | `c02-active` |
| `src/ports/index.ts` | `c10-index` | `InstinctRecord` | 1 | `src/learning/types.ts` | `c02-active` |
| `src/ports/index.ts` | `c10-index` | `MergeDecision` | 2 | `src/learning/types.ts` | `c02-active` |
| `src/ports/index.ts` | `c10-index` | `MergeResult` | 2 | `src/learning/types.ts` | `c02-active` |
| `src/ports/index.ts` | `c10-index` | `MergeRule` | 2 | `src/learning/types.ts` | `c02-active` |
| `src/ports/index.ts` | `c10-index` | `Store` | 2 | `src/effort/store/types.ts` | `c04-sqlite` |
| `src/ports/index.ts` | `c10-index` | `SyncPayload` | 1 | `src/learning/types.ts` | `c02-active` |
| `src/pr/gh-closing-issues.ts` | `c07-index` | `ClosingIssue` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/gh-fake.ts` | `c07-index` | `GhRunner` | 1 | `src/adapters/tracker/github.ts` | `c01-github` |
| `src/pr/gh.ts` | `c07-index` | `GhRunner` | 1 | `src/adapters/tracker/github.ts` | `c01-github` |
| `src/pr/gh.ts` | `c07-index` | `MERGE_METHODS` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/gh.ts` | `c07-index` | `PullRequestAuthor` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/gh.ts` | `c07-index` | `PullRequests` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/gh.ts` | `c07-index` | `PullRequests.checks` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/gh.ts` | `c07-index` | `PullRequests.get` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/plans/budget.ts` | `c07-index` | `parseBudgetUsd` | 1 | `src/utils/declaration.ts` | `c02-active` |
| `src/pr/plans/load.ts` | `c07-index` | `MECHANICAL_CONFLICT_SENTENCE` | 1 | `src/pr/conflict-sentence.ts` | `c02-active` |
| `src/pr/triage/classes.ts` | `c07-index` | `PullRequestSummary` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/triage/classify.ts` | `c07-index` | `PullRequestDetail` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/triage/classify.ts` | `c07-index` | `PullRequestDetail.mergeable` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/triage/comment.ts` | `c07-index` | `PullRequests` | 1 | `src/pr/types.ts` | `c05-sessions` |
| `src/pr/triage/conflict.ts` | `c07-index` | `gitSaid` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/pr/types.ts` | `c05-sessions` | `CheckRow` | 1 | `src/pr/checks.ts` | `c07-index` |
| `src/pr/worktree.ts` | `c07-index` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/project/gitignore.ts` | `c08-cli-capture` | `RafaConfig` | 1 | `src/config.ts` | `c03-config` |
| `src/project/root-choice.ts` | `c08-cli-capture` | `Prompter` | 1 | `src/cli/prompt/confirm.ts` | `c01-github` |
| `src/project/scaffold.ts` | `c08-cli-capture` | `CONFIG_DEFAULTS` | 1 | `src/config.ts` | `c03-config` |
| `src/project/scope.test.ts` | `c03-config` | `ScopeFileSystem` | 1 | `src/project/scope.ts` | `c05-sessions` |
| `src/project/worktree-root.ts` | `c08-cli-capture` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/refs/verify.ts` | `c01-github` | `DescribeDocument` | 1 | `src/cli/describe.ts` | `c06-command` |
| `src/release/enabled.ts` | `c09-version` | `ReleaseEnabled` | 1 | `src/config-sections.ts` | `c03-config` |
| `src/release/level.ts` | `c09-version` | `ChangeLevel` | 1 | `src/report/parse.ts` | `c04-sqlite` |
| `src/release/level.ts` | `c09-version` | `PlanReleaseLevel` | 2 | `src/plan/parse.ts` | `c02-active` |
| `src/release/settle-pr.ts` | `c09-version` | `PullRequests` | 1 | `src/pr/index.ts` | `c07-index` |
| `src/release/settle-push.ts` | `c09-version` | `gitSaid` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/release/settle-worktree.ts` | `c09-version` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/release/version.test.ts` | `c09-version` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/release/version.ts` | `c09-version` | `GitRunner` | 1 | `src/pr/git.ts` | `c01-github` |
| `src/schema/instinct.test.ts` | `c11-frontmatter` | `INSTINCT_ISSUE_CODES` | 1 | `src/schema/instinct.ts` | `c02-active` |
| `src/schema/instinct.ts` | `c02-active` | `projectIdFromRemote` | 1 | `src/schema/project-id.ts` | `c07-index` |
| `src/start/checkout-watch.ts` | `c02-active` | `CHECKOUT_MOVED` | 2 | `src/start/checkout-guard.ts` | `c08-cli-capture` |
| `src/start/checkout-watch.ts` | `c02-active` | `CheckoutExpectation` | 1 | `src/start/checkout-guard.ts` | `c08-cli-capture` |
| `src/start/checkout-watch.ts` | `c02-active` | `CommandExit` | 1 | `src/cli/command.ts` | `c06-command` |
| `src/start/checkout.ts` | `c02-active` | `CommandExit` | 1 | `src/cli/command.ts` | `c06-command` |
| `src/start/pr-lifecycle.test.ts` | `c07-index` | `createPullRequestsDouble` | 1 | `src/pr/pull-requests-double.ts` | `c05-sessions` |
| `src/start/pr-lifecycle.ts` | `c07-index` | `spawnClaude` | 1 | `src/utils/claude.ts` | `c02-active` |
| `src/start/promoted-check.test.ts` | `c02-active` | `GitRunner` | 1 | `src/pr/index.ts` | `c07-index` |
| `src/start/release-stage.ts` | `c09-version` | `ASSUMPTIONS_HEADING` | 1 | `src/board/review-stamp.ts` | `c02-active` |
| `src/start/release-stage.ts` | `c09-version` | `GitResult` | 1 | `src/pr/index.ts` | `c07-index` |
| `src/start/run-setup.ts` | `c02-active` | `DEFAULT_CI_ATTEMPTS` | 1 | `src/start/pr-lifecycle.ts` | `c07-index` |
| `src/start/run-setup.ts` | `c02-active` | `DEFAULT_CI_TIMEOUT_MIN` | 1 | `src/start/pr-lifecycle.ts` | `c07-index` |
| `src/start/runner-pr.test.ts` | `c07-index` | `gitIdentityEnv` | 1 | `src/tests/git-identity.ts` | `c08-cli-capture` |
| `src/start/runner-pr.ts` | `c07-index` | `pullRequestTitle` | 1 | `src/board/naming.ts` | `c01-github` |
| `src/start/serving.ts` | `c02-active` | `ServedSet` | 1 | `src/tiers/serve.ts` | `c03-config` |
| `src/start/session-worktree.test.ts` | `c05-sessions` | `openRunSession` | 1 | `src/start/session.ts` | `c02-active` |
| `src/start/suite-step-no-owns-full-suite-tally-integration.test.ts` | `c08-cli-capture` | `SLOW_SWEEP_SECONDS` | 2 | `src/start/sweep-timing.ts` | `c02-active` |
| `src/start/suite-step.ts` | `c02-active` | `SessionStep` | 2 | `src/loop/sessions.ts` | `c05-sessions` |
| `src/start/worktree.ts` | `c02-active` | `readBranchOffer` | 1 | `src/start/branch-decision.ts` | `c07-index` |
| `src/start/worktree.ts` | `c02-active` | `worktreeDirAt` | 1 | `src/start/worktree-dir.ts` | `c05-sessions` |
| `src/start/wrap-up.ts` | `c02-active` | `ReleaseSkipped.sentence` | 1 | `src/release/prepare.ts` | `c09-version` |
| `src/tests/agent-roster-preflight.test.ts` | `c08-cli-capture` | `import('../plan/parse.js').PlanModel.tasks` | 1 | `src/plan/parse.ts` | `c02-active` |
| `src/tests/board-trust-integration.test.ts` | `c01-github` | `ghBoardTrust` | 1 | `src/board/trust.ts` | `c07-index` |
| `src/tests/effort-pipeline.test.ts` | `c04-sqlite` | `PROMPT_SHAPES` | 1 | `src/effort/classify.ts` | `c02-active` |
| `src/tests/effort-pipeline.test.ts` | `c04-sqlite` | `collectEffort` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/tests/effort-skills-collect-integration.test.ts` | `c08-cli-capture` | `SKILL_USE_CLI_VERSION` | 1 | `src/effort/skill-use.ts` | `c03-config` |
| `src/tests/effort-skills-collect-integration.test.ts` | `c08-cli-capture` | `sessionLogDir` | 1 | `src/effort/collect.ts` | `c03-config` |
| `src/tests/loop-output.test.ts` | `c02-active` | `Planting.claudeWork` | 1 | `src/tests/loop-scratch.ts` | `c08-cli-capture` |
| `src/tests/loop-sessions.test.ts` | `c05-sessions` | `NOTHING_REPORTED_OR_COMMITTED` | 1 | `src/start/commit.ts` | `c02-active` |
| `src/tests/parity-differential.test.ts` | `c03-config` | `SessionEffortRow.sizeBytes` | 1 | `src/effort/store/types.ts` | `c04-sqlite` |
| `src/tests/parity-lineage.test.ts` | `c03-config` | `readStoreRows` | 1 | `src/effort/store.ts` | `c04-sqlite` |
| `src/tests/worktree-shared-store-integration.test.ts` | `c08-cli-capture` | `withSqliteStore` | 1 | `src/effort/store/sqlite.ts` | `c04-sqlite` |
| `src/triage/triage.ts` | `c10-index` | `machineFaultSentence` | 1 | `src/triage/machine-fault.ts` | `c04-sqlite` |
| `src/utils/agent-definition.ts` | `c03-config` | `readFrontmatter` | 1 | `src/schema/frontmatter.ts` | `c11-frontmatter` |

## Concepts no note in their cluster names

A concept is placed in a cluster when a comment of one of its files names it (`concepts.json`); listed here when no module note of that cluster does.

### `c01-github` (3; 67 named in notes)

- The snapshot file
- The version
- Verification

### `c02-active` (7; 64 named in notes)

- Drift check:
- The events output
- Inherited failures
- labels mode
- Naming convention
- Pull requests
- unreviewed

### `c03-config` (5; 85 named in notes)

- Config keys
- Loading modules
- native mode
- One invocation
- Takeover:

### `c04-sqlite` (4; 56 named in notes)

- Learning
- One invocation
- Skill signals.
- Tables outside the port

### `c05-sessions` (6; 56 named in notes)

- One invocation
- Pinned.
- The readiness gate
- References
- Routing
- The plan stub.

### `c06-command` (5; 82 named in notes)

- A position
- An action's Spends: block
- The pr subject
- The trail
- Trust

### `c07-index` (3; 51 named in notes)

- A hop
- Describe
- The registry

### `c08-cli-capture` (3; 65 named in notes)

- References
- The plan stub.
- unreadable

### `c09-version` (4; 42 named in notes)

- The events file
- One invocation
- The readiness gate
- Registered

### `c10-index` (4; 46 named in notes)

- labels mode
- The readiness gate
- The ledger
- Where it lives

### `c11-frontmatter` (4; 28 named in notes)

- Describe
- Imports
- One invocation
- The signals

### `c12-index` (6; 29 named in notes)

- clean
- Commands
- Describe
- The readiness gate
- The signals
- unreadable

### `c14-types.test` (1; 6 named in notes)

- Imports

### `c18-agents-split-accounting.test` (2; 4 named in notes)

- Claims
- Workflow

### `c22-git-identity.sweep.test` (3; 0 named in notes)

- CLI
- Home
- Source

### `c24-relations-import-boundary.sweep.test` (1; 4 named in notes)

- Source

### `c26-routing-table-agents.sweep.test` (2; 10 named in notes)

- Home
- Pinned.

### `c28-spawned-exit-code.sweep.test` (1; 3 named in notes)

- Imports

### `c32-cli` (3; 5 named in notes)

- Help
- missing
- rafa
