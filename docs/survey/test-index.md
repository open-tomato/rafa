# Test index

Coverage: 2176 of 2176 tracked files read (src/ and packages/*/src/).

1237 test files indexed, 446 of them spawning a process; 888 source files, 7 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

## The 20 highest indexes

| Rank | Test | Index | Folders | Spawns via | Support-only folders |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/cli/help.test.ts` | 124 | 62 | `src/cli/help.test.ts`, `src/tests/cli-capture.ts` | - |
| 2 | `src/commands/index.test.ts` | 124 | 62 | `src/tests/cli-capture.ts` | - |
| 3 | `src/commands/module/list.test.ts` | 124 | 62 | `src/tests/cli-capture.ts` | - |
| 4 | `src/commands/doctor-refs-roadmap.test.ts` | 122 | 61 | `src/commands/doctor-refs-roadmap.test.ts` | - |
| 5 | `src/commands/doctor-refs.test.ts` | 122 | 61 | `src/commands/doctor-refs.test.ts` | - |
| 6 | `src/commands/index.roster.sweep.test.ts` | 122 | 61 | `src/commands/index.roster.sweep.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output` |
| 7 | `src/commands/issue/ready.test.ts` | 122 | 61 | `src/tests/cli-capture.ts` | `src/adapters/output` |
| 8 | `src/commands/plan/refs-check.test.ts` | 122 | 61 | `src/commands/plan/refs-check.test.ts` | - |
| 9 | `src/refs/reading.test.ts` | 122 | 61 | `src/refs/reading.test.ts` | - |
| 10 | `src/refs/verify.test.ts` | 122 | 61 | `src/refs/verify.test.ts` | - |
| 11 | `src/release/templates-shape.test.ts` | 122 | 61 | `src/release/templates-shape.test.ts` | - |
| 12 | `src/tests/config-parity.test.ts` | 122 | 61 | `src/tests/cli-capture.ts` | `src/adapters/output` |
| 13 | `src/tests/refs-reading-integration.test.ts` | 122 | 61 | `src/tests/refs-reading-integration.test.ts` | - |
| 14 | `src/commands/doctor.test.ts` | 80 | 40 | `src/tests/cli-capture.ts` | - |
| 15 | `src/commands/doctor-ladder.command.test.ts` | 76 | 38 | `src/commands/doctor-ladder.command.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 16 | `src/commands/doctor-release.test.ts` | 76 | 38 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 17 | `src/commands/doctor-stretch.test.ts` | 76 | 38 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 18 | `src/commands/tiers-scratch.test.ts` | 76 | 38 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 19 | `src/tests/epic-labels-cross-command-integration.test.ts` | 76 | 38 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 20 | `src/tests/package-build.test.ts` | 76 | 38 | `src/tests/cli-capture.ts`, `src/tests/package-build.test.ts` | `src/errors` |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `packages/rafa/src/core/plan/declaration.ts` | 980 | 1074 | 29 |
| 2 | `packages/rafa/src/effort/store/effort-levels.ts` | 980 | 1075 | 29 |
| 3 | `packages/rafa/src/core/plan/blocks.ts` | 964 | 1045 | 32 |
| 4 | `packages/rafa/src/core/config/config-sections.ts` | 963 | 1052 | 36 |
| 5 | `packages/rafa/src/schema/tiers.ts` | 963 | 1054 | 36 |
| 6 | `packages/rafa/src/core/plan/plan-stamp.ts` | 961 | 1038 | 32 |
| 7 | `packages/rafa/src/core/config/branch-template.ts` | 959 | 1038 | 36 |
| 8 | `packages/rafa/src/core/config/config-readers.ts` | 959 | 1042 | 36 |
| 9 | `packages/rafa/src/core/config/merge-method.ts` | 959 | 1038 | 36 |
| 10 | `packages/rafa/src/core/config/sections.ts` | 959 | 1037 | 36 |
| 11 | `packages/rafa/src/core/git/commit.ts` | 952 | 1028 | 39 |
| 12 | `packages/rafa/src/core/git/gh-runner.ts` | 952 | 1027 | 39 |
| 13 | `packages/rafa/src/core/git/git.ts` | 952 | 1028 | 39 |
| 14 | `packages/rafa/src/core/git/index.ts` | 952 | 1027 | 39 |
| 15 | `packages/rafa/src/core/plan/block-reader.ts` | 938 | 1015 | 39 |
| 16 | `packages/rafa/src/effort/store/session-row-types.ts` | 930 | 1005 | 39 |
| 17 | `packages/rafa/src/effort/store/plan-stubs.ts` | 929 | 1002 | 39 |
| 18 | `packages/rafa/src/core/command/version.ts` | 928 | 999 | 39 |
| 19 | `packages/rafa/src/core/runtime/identity.ts` | 928 | 1000 | 39 |
| 20 | `packages/rafa/src/effort/store/commit-stats.ts` | 928 | 1001 | 39 |
