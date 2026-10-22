# Test index

Coverage: 2167 of 2167 tracked files read (src/ and packages/*/src/).

1232 test files indexed, 445 of them spawning a process; 884 source files, 7 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

## The 20 highest indexes

| Rank | Test | Index | Folders | Spawns via | Support-only folders |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/cli/help.test.ts` | 146 | 73 | `src/cli/help.test.ts`, `src/tests/cli-capture.ts` | - |
| 2 | `src/commands/index.test.ts` | 146 | 73 | `src/tests/cli-capture.ts` | - |
| 3 | `src/commands/module/list.test.ts` | 146 | 73 | `src/tests/cli-capture.ts` | - |
| 4 | `src/commands/doctor-refs-roadmap.test.ts` | 144 | 72 | `src/commands/doctor-refs-roadmap.test.ts` | - |
| 5 | `src/commands/doctor-refs.test.ts` | 144 | 72 | `src/commands/doctor-refs.test.ts` | - |
| 6 | `src/commands/index.roster.sweep.test.ts` | 144 | 72 | `src/commands/index.roster.sweep.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output` |
| 7 | `src/commands/issue/ready.test.ts` | 144 | 72 | `src/tests/cli-capture.ts` | `src/adapters/output` |
| 8 | `src/commands/plan/refs-check.test.ts` | 144 | 72 | `src/commands/plan/refs-check.test.ts` | - |
| 9 | `src/refs/reading.test.ts` | 144 | 72 | `src/refs/reading.test.ts` | - |
| 10 | `src/refs/verify.test.ts` | 144 | 72 | `src/refs/verify.test.ts` | - |
| 11 | `src/release/templates-shape.test.ts` | 144 | 72 | `src/release/templates-shape.test.ts` | - |
| 12 | `src/tests/config-parity.test.ts` | 144 | 72 | `src/tests/cli-capture.ts` | `src/adapters/output` |
| 13 | `src/tests/refs-reading-integration.test.ts` | 144 | 72 | `src/tests/refs-reading-integration.test.ts` | - |
| 14 | `src/tests/package-build.test.ts` | 98 | 49 | `src/tests/cli-capture.ts`, `src/tests/package-build.test.ts` | `src/errors` |
| 15 | `src/index.test.ts` | 94 | 47 | `src/index.test.ts` | - |
| 16 | `src/commands/doctor.test.ts` | 92 | 46 | `src/tests/cli-capture.ts` | - |
| 17 | `src/commands/doctor-ladder.command.test.ts` | 88 | 44 | `src/commands/doctor-ladder.command.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 18 | `src/commands/doctor-release.test.ts` | 88 | 44 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 19 | `src/commands/doctor-stretch.test.ts` | 88 | 44 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |
| 20 | `src/commands/tiers-scratch.test.ts` | 88 | 44 | `src/tests/cli-capture.ts` | `src/adapters/output`, `src/errors` |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `packages/rafa/src/core/plan/declaration.ts` | 989 | 1071 | 29 |
| 2 | `packages/rafa/src/effort/store/effort-levels.ts` | 989 | 1072 | 29 |
| 3 | `packages/rafa/src/core/plan/blocks.ts` | 976 | 1049 | 32 |
| 4 | `packages/rafa/src/core/plan/plan-stamp.ts` | 972 | 1042 | 32 |
| 5 | `packages/rafa/src/core/config/config-sections.ts` | 971 | 1049 | 36 |
| 6 | `packages/rafa/src/schema/tiers.ts` | 971 | 1051 | 36 |
| 7 | `packages/rafa/src/core/config/branch-template.ts` | 967 | 1036 | 36 |
| 8 | `packages/rafa/src/core/config/config-readers.ts` | 967 | 1040 | 36 |
| 9 | `packages/rafa/src/core/config/merge-method.ts` | 967 | 1036 | 36 |
| 10 | `packages/rafa/src/core/config/sections.ts` | 967 | 1035 | 36 |
| 11 | `packages/rafa/src/core/git/commit.ts` | 957 | 1025 | 39 |
| 12 | `packages/rafa/src/core/git/gh-runner.ts` | 957 | 1024 | 39 |
| 13 | `packages/rafa/src/core/git/git.ts` | 957 | 1025 | 39 |
| 14 | `packages/rafa/src/core/git/index.ts` | 957 | 1024 | 39 |
| 15 | `packages/rafa/src/core/plan/block-reader.ts` | 950 | 1021 | 39 |
| 16 | `packages/rafa/src/effort/store/session-row-types.ts` | 943 | 1011 | 39 |
| 17 | `packages/rafa/src/effort/store/plan-stubs.ts` | 940 | 1008 | 39 |
| 18 | `packages/rafa/src/core/command/version.ts` | 939 | 1005 | 39 |
| 19 | `packages/rafa/src/core/runtime/identity.ts` | 939 | 1006 | 39 |
| 20 | `packages/rafa/src/effort/store/commit-stats.ts` | 939 | 1007 | 39 |
