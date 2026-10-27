# Test index

Coverage: 2197 of 2197 tracked files read (src/ and packages/*/src/).

1248 test files indexed, 448 of them spawning a process; 898 source files, 7 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

## The 20 highest indexes

| Rank | Test | Index | Folders | Spawns via | Support-only folders |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/cli/help.test.ts` | 92 | 46 | `src/cli/help.test.ts`, `src/tests/cli-capture.ts` | - |
| 2 | `src/commands/index.test.ts` | 92 | 46 | `src/tests/cli-capture.ts` | - |
| 3 | `src/commands/module/list.test.ts` | 92 | 46 | `src/tests/cli-capture.ts` | - |
| 4 | `src/commands/index.roster.sweep.test.ts` | 88 | 44 | `src/commands/index.roster.sweep.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli` |
| 5 | `src/tests/board-coupled/commands/doctor-refs-roadmap.test.ts` | 88 | 44 | `src/tests/board-coupled/commands/doctor-refs-roadmap.test.ts` | - |
| 6 | `src/tests/board-coupled/commands/doctor-refs.test.ts` | 88 | 44 | `src/tests/board-coupled/commands/doctor-refs.test.ts` | - |
| 7 | `src/tests/board-coupled/commands/issue/ready.test.ts` | 88 | 44 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli` |
| 8 | `src/tests/board-coupled/commands/plan/refs-check.test.ts` | 88 | 44 | `src/tests/board-coupled/commands/plan/refs-check.test.ts` | - |
| 9 | `src/tests/board-coupled/refs/reading.test.ts` | 88 | 44 | `src/tests/board-coupled/refs/reading.test.ts` | - |
| 10 | `src/tests/board-coupled/refs/verify.test.ts` | 88 | 44 | `src/tests/board-coupled/refs/verify.test.ts` | - |
| 11 | `src/tests/config-parity.test.ts` | 88 | 44 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli` |
| 12 | `src/tests/refs-reading-integration.test.ts` | 88 | 44 | `src/tests/refs-reading-integration.test.ts` | - |
| 13 | `src/tests/release-coupled/release/templates-shape.test.ts` | 88 | 44 | `src/tests/release-coupled/release/templates-shape.test.ts` | - |
| 14 | `src/commands/doctor.test.ts` | 56 | 28 | `src/tests/cli-capture.ts` | - |
| 15 | `src/commands/doctor-release.test.ts` | 48 | 24 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 16 | `src/commands/doctor-stretch.test.ts` | 48 | 24 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 17 | `src/commands/tiers-scratch.test.ts` | 48 | 24 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 18 | `src/tests/epic-labels-cross-command-integration.test.ts` | 48 | 24 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 19 | `src/tests/relations-move-round-trip.test.ts` | 48 | 24 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 20 | `src/tests/release-coupled/commands/doctor-ladder.command.test.ts` | 48 | 24 | `src/tests/cli-capture.ts`, `src/tests/release-coupled/commands/doctor-ladder.command.test.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `packages/rafa/src/core/plan/declaration.ts` | 978 | 1080 | 29 |
| 2 | `packages/rafa/src/effort/store/effort-levels.ts` | 978 | 1081 | 29 |
| 3 | `packages/rafa/src/core/plan/blocks.ts` | 963 | 1051 | 32 |
| 4 | `packages/rafa/src/core/config/config-sections.ts` | 961 | 1058 | 36 |
| 5 | `packages/rafa/src/schema/tiers.ts` | 961 | 1060 | 36 |
| 6 | `packages/rafa/src/core/plan/plan-stamp.ts` | 960 | 1044 | 32 |
| 7 | `packages/rafa/src/core/config/branch-template.ts` | 957 | 1044 | 36 |
| 8 | `packages/rafa/src/core/config/config-readers.ts` | 957 | 1048 | 36 |
| 9 | `packages/rafa/src/core/config/merge-method.ts` | 957 | 1044 | 36 |
| 10 | `packages/rafa/src/core/config/sections.ts` | 957 | 1043 | 36 |
| 11 | `packages/rafa/src/core/git/commit.ts` | 951 | 1034 | 39 |
| 12 | `packages/rafa/src/core/git/gh-runner.ts` | 951 | 1033 | 39 |
| 13 | `packages/rafa/src/core/git/git.ts` | 951 | 1034 | 39 |
| 14 | `packages/rafa/src/core/git/index.ts` | 951 | 1033 | 39 |
| 15 | `packages/rafa/src/core/plan/block-reader.ts` | 936 | 1020 | 39 |
| 16 | `packages/rafa/src/effort/store/session-row-types.ts` | 924 | 1006 | 40 |
| 17 | `packages/rafa/src/effort/store/plan-stubs.ts` | 923 | 1003 | 40 |
| 18 | `packages/rafa/src/core/command/version.ts` | 922 | 1000 | 40 |
| 19 | `packages/rafa/src/core/runtime/identity.ts` | 922 | 1001 | 40 |
| 20 | `packages/rafa/src/effort/store/commit-stats.ts` | 922 | 1002 | 40 |
