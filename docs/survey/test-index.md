# Test index

Coverage: 2193 of 2193 tracked files read (src/ and packages/*/src/).

1246 test files indexed, 448 of them spawning a process; 896 source files, 7 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

## The 20 highest indexes

| Rank | Test | Index | Folders | Spawns via | Support-only folders |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/cli/help.test.ts` | 108 | 54 | `src/cli/help.test.ts`, `src/tests/cli-capture.ts` | - |
| 2 | `src/commands/index.test.ts` | 108 | 54 | `src/tests/cli-capture.ts` | - |
| 3 | `src/commands/module/list.test.ts` | 108 | 54 | `src/tests/cli-capture.ts` | - |
| 4 | `src/commands/index.roster.sweep.test.ts` | 104 | 52 | `src/commands/index.roster.sweep.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli` |
| 5 | `src/release/templates-shape.test.ts` | 104 | 52 | `src/release/templates-shape.test.ts` | - |
| 6 | `src/tests/board-coupled/commands/doctor-refs-roadmap.test.ts` | 104 | 52 | `src/tests/board-coupled/commands/doctor-refs-roadmap.test.ts` | - |
| 7 | `src/tests/board-coupled/commands/doctor-refs.test.ts` | 104 | 52 | `src/tests/board-coupled/commands/doctor-refs.test.ts` | - |
| 8 | `src/tests/board-coupled/commands/issue/ready.test.ts` | 104 | 52 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli` |
| 9 | `src/tests/board-coupled/commands/plan/refs-check.test.ts` | 104 | 52 | `src/tests/board-coupled/commands/plan/refs-check.test.ts` | - |
| 10 | `src/tests/board-coupled/refs/reading.test.ts` | 104 | 52 | `src/tests/board-coupled/refs/reading.test.ts` | - |
| 11 | `src/tests/board-coupled/refs/verify.test.ts` | 104 | 52 | `src/tests/board-coupled/refs/verify.test.ts` | - |
| 12 | `src/tests/config-parity.test.ts` | 104 | 52 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli` |
| 13 | `src/tests/refs-reading-integration.test.ts` | 104 | 52 | `src/tests/refs-reading-integration.test.ts` | - |
| 14 | `src/commands/doctor.test.ts` | 66 | 33 | `src/tests/cli-capture.ts` | - |
| 15 | `src/tests/package-build.test.ts` | 60 | 30 | `src/tests/cli-capture.ts`, `src/tests/package-build.test.ts` | `src/cli`, `src/errors` |
| 16 | `src/commands/doctor-ladder.command.test.ts` | 58 | 29 | `src/commands/doctor-ladder.command.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 17 | `src/commands/doctor-release.test.ts` | 58 | 29 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 18 | `src/commands/doctor-stretch.test.ts` | 58 | 29 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 19 | `src/commands/tiers-scratch.test.ts` | 58 | 29 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |
| 20 | `src/tests/epic-labels-cross-command-integration.test.ts` | 58 | 29 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli`, `src/cli/core`, `src/errors` |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `packages/rafa/src/core/plan/declaration.ts` | 981 | 1079 | 29 |
| 2 | `packages/rafa/src/effort/store/effort-levels.ts` | 981 | 1080 | 29 |
| 3 | `packages/rafa/src/core/plan/blocks.ts` | 965 | 1050 | 32 |
| 4 | `packages/rafa/src/core/config/config-sections.ts` | 964 | 1057 | 36 |
| 5 | `packages/rafa/src/schema/tiers.ts` | 964 | 1059 | 36 |
| 6 | `packages/rafa/src/core/plan/plan-stamp.ts` | 962 | 1043 | 32 |
| 7 | `packages/rafa/src/core/config/branch-template.ts` | 960 | 1043 | 36 |
| 8 | `packages/rafa/src/core/config/config-readers.ts` | 960 | 1047 | 36 |
| 9 | `packages/rafa/src/core/config/merge-method.ts` | 960 | 1043 | 36 |
| 10 | `packages/rafa/src/core/config/sections.ts` | 960 | 1042 | 36 |
| 11 | `packages/rafa/src/core/git/commit.ts` | 953 | 1033 | 39 |
| 12 | `packages/rafa/src/core/git/gh-runner.ts` | 953 | 1032 | 39 |
| 13 | `packages/rafa/src/core/git/git.ts` | 953 | 1033 | 39 |
| 14 | `packages/rafa/src/core/git/index.ts` | 953 | 1032 | 39 |
| 15 | `packages/rafa/src/core/plan/block-reader.ts` | 939 | 1020 | 39 |
| 16 | `packages/rafa/src/effort/store/session-row-types.ts` | 931 | 1010 | 39 |
| 17 | `packages/rafa/src/effort/store/plan-stubs.ts` | 930 | 1007 | 39 |
| 18 | `packages/rafa/src/core/command/version.ts` | 929 | 1004 | 39 |
| 19 | `packages/rafa/src/core/runtime/identity.ts` | 929 | 1005 | 39 |
| 20 | `packages/rafa/src/effort/store/commit-stats.ts` | 929 | 1006 | 39 |
