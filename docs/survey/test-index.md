# Test index

Coverage: 2186 of 2186 tracked files read (src/ and packages/*/src/).

1242 test files indexed, 447 of them spawning a process; 893 source files, 7 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

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
| 14 | `src/commands/doctor.test.ts` | 78 | 39 | `src/tests/cli-capture.ts` | - |
| 15 | `src/tests/package-build.test.ts` | 76 | 38 | `src/tests/cli-capture.ts`, `src/tests/package-build.test.ts` | `src/errors` |
| 16 | `src/commands/doctor-ladder.command.test.ts` | 72 | 36 | `src/commands/doctor-ladder.command.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli/core`, `src/errors` |
| 17 | `src/commands/doctor-release.test.ts` | 72 | 36 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli/core`, `src/errors` |
| 18 | `src/commands/doctor-stretch.test.ts` | 72 | 36 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli/core`, `src/errors` |
| 19 | `src/commands/tiers-scratch.test.ts` | 72 | 36 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/cli/core`, `src/errors` |
| 20 | `src/index.test.ts` | 72 | 36 | `src/index.test.ts` | - |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `packages/rafa/src/core/plan/declaration.ts` | 981 | 1077 | 29 |
| 2 | `packages/rafa/src/effort/store/effort-levels.ts` | 981 | 1078 | 29 |
| 3 | `packages/rafa/src/core/plan/blocks.ts` | 965 | 1048 | 32 |
| 4 | `packages/rafa/src/core/config/config-sections.ts` | 964 | 1055 | 36 |
| 5 | `packages/rafa/src/schema/tiers.ts` | 964 | 1057 | 36 |
| 6 | `packages/rafa/src/core/plan/plan-stamp.ts` | 962 | 1041 | 32 |
| 7 | `packages/rafa/src/core/config/branch-template.ts` | 960 | 1041 | 36 |
| 8 | `packages/rafa/src/core/config/config-readers.ts` | 960 | 1045 | 36 |
| 9 | `packages/rafa/src/core/config/merge-method.ts` | 960 | 1041 | 36 |
| 10 | `packages/rafa/src/core/config/sections.ts` | 960 | 1040 | 36 |
| 11 | `packages/rafa/src/core/git/commit.ts` | 953 | 1031 | 39 |
| 12 | `packages/rafa/src/core/git/gh-runner.ts` | 953 | 1030 | 39 |
| 13 | `packages/rafa/src/core/git/git.ts` | 953 | 1031 | 39 |
| 14 | `packages/rafa/src/core/git/index.ts` | 953 | 1030 | 39 |
| 15 | `packages/rafa/src/core/plan/block-reader.ts` | 939 | 1018 | 39 |
| 16 | `packages/rafa/src/effort/store/session-row-types.ts` | 931 | 1008 | 39 |
| 17 | `packages/rafa/src/effort/store/plan-stubs.ts` | 930 | 1005 | 39 |
| 18 | `packages/rafa/src/core/command/version.ts` | 929 | 1002 | 39 |
| 19 | `packages/rafa/src/core/runtime/identity.ts` | 929 | 1003 | 39 |
| 20 | `packages/rafa/src/effort/store/commit-stats.ts` | 929 | 1004 | 39 |
