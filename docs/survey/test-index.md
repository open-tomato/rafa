# Test index

Coverage: 2197 of 2197 tracked files read (src/ and packages/*/src/).

1248 test files indexed, 448 of them spawning a process; 898 source files, 7 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

## The 20 highest indexes

| Rank | Test | Index | Folders | Spawns via | Support-only folders |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/cli/help.test.ts` | 82 | 41 | `src/cli/help.test.ts`, `src/tests/cli-capture.ts` | - |
| 2 | `src/commands/index.test.ts` | 82 | 41 | `src/tests/cli-capture.ts` | - |
| 3 | `src/commands/module/list.test.ts` | 82 | 41 | `src/tests/cli-capture.ts` | - |
| 4 | `src/commands/index.roster.sweep.test.ts` | 76 | 38 | `src/commands/index.roster.sweep.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core` |
| 5 | `src/tests/board-coupled/commands/doctor-refs-roadmap.test.ts` | 76 | 38 | `src/tests/board-coupled/commands/doctor-refs-roadmap.test.ts` | - |
| 6 | `src/tests/board-coupled/commands/doctor-refs.test.ts` | 76 | 38 | `src/tests/board-coupled/commands/doctor-refs.test.ts` | - |
| 7 | `src/tests/board-coupled/commands/issue/ready.test.ts` | 76 | 38 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core` |
| 8 | `src/tests/board-coupled/commands/plan/refs-check.test.ts` | 76 | 38 | `src/tests/board-coupled/commands/plan/refs-check.test.ts` | - |
| 9 | `src/tests/board-coupled/refs/reading.test.ts` | 76 | 38 | `src/tests/board-coupled/refs/reading.test.ts` | - |
| 10 | `src/tests/board-coupled/refs/verify.test.ts` | 76 | 38 | `src/tests/board-coupled/refs/verify.test.ts` | - |
| 11 | `src/tests/config-parity.test.ts` | 76 | 38 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core` |
| 12 | `src/tests/refs-reading-integration.test.ts` | 76 | 38 | `src/tests/refs-reading-integration.test.ts` | - |
| 13 | `src/tests/release-coupled/release/templates-shape.test.ts` | 76 | 38 | `src/tests/release-coupled/release/templates-shape.test.ts` | - |
| 14 | `src/commands/doctor.test.ts` | 48 | 24 | `src/tests/cli-capture.ts` | - |
| 15 | `src/commands/describe.test.ts` | 41 | 41 | - | - |
| 16 | `src/commands/module/exec.test.ts` | 41 | 41 | - | - |
| 17 | `src/tests/module-seams.test.ts` | 41 | 41 | - | - |
| 18 | `src/commands/doctor-release.test.ts` | 40 | 20 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 19 | `src/commands/doctor-stretch.test.ts` | 40 | 20 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 20 | `src/commands/tiers-scratch.test.ts` | 40 | 20 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `packages/rafa/src/core/plan/declaration.ts` | 976 | 1080 | 29 |
| 2 | `packages/rafa/src/effort/store/effort-levels.ts` | 976 | 1081 | 29 |
| 3 | `packages/rafa/src/core/plan/blocks.ts` | 961 | 1051 | 32 |
| 4 | `packages/rafa/src/core/config/config-sections.ts` | 959 | 1058 | 36 |
| 5 | `packages/rafa/src/schema/tiers.ts` | 959 | 1060 | 36 |
| 6 | `packages/rafa/src/core/plan/plan-stamp.ts` | 958 | 1044 | 32 |
| 7 | `packages/rafa/src/core/config/branch-template.ts` | 955 | 1044 | 36 |
| 8 | `packages/rafa/src/core/config/config-readers.ts` | 955 | 1048 | 36 |
| 9 | `packages/rafa/src/core/config/merge-method.ts` | 955 | 1044 | 36 |
| 10 | `packages/rafa/src/core/config/sections.ts` | 955 | 1043 | 36 |
| 11 | `packages/rafa/src/core/git/commit.ts` | 949 | 1034 | 39 |
| 12 | `packages/rafa/src/core/git/gh-runner.ts` | 949 | 1033 | 39 |
| 13 | `packages/rafa/src/core/git/git.ts` | 949 | 1034 | 39 |
| 14 | `packages/rafa/src/core/git/index.ts` | 949 | 1033 | 39 |
| 15 | `packages/rafa/src/core/plan/block-reader.ts` | 934 | 1020 | 39 |
| 16 | `packages/rafa/src/effort/store/session-row-types.ts` | 922 | 1006 | 40 |
| 17 | `packages/rafa/src/effort/store/plan-stubs.ts` | 921 | 1003 | 40 |
| 18 | `packages/rafa/src/core/command/version.ts` | 920 | 1000 | 40 |
| 19 | `packages/rafa/src/core/runtime/identity.ts` | 920 | 1001 | 40 |
| 20 | `packages/rafa/src/effort/store/commit-stats.ts` | 920 | 1002 | 40 |
