# Test index

Coverage: 1993 of 1993 tracked files read (src/ and packages/*/src/).

1124 test files indexed, 410 of them spawning a process; 821 source files, 6 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

## The 20 highest indexes

| Rank | Test | Index | Folders | Spawns via | Support-only folders |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/cli/help.test.ts` | 148 | 74 | `src/cli/help.test.ts`, `src/tests/cli-capture.ts` | - |
| 2 | `src/commands/doctor-refs-roadmap.test.ts` | 148 | 74 | `src/commands/doctor-refs-roadmap.test.ts` | - |
| 3 | `src/commands/doctor-refs.test.ts` | 148 | 74 | `src/commands/doctor-refs.test.ts` | - |
| 4 | `src/commands/index.roster.sweep.test.ts` | 148 | 74 | `src/commands/index.roster.sweep.test.ts`, `src/tests/cli-capture.ts` | - |
| 5 | `src/commands/index.test.ts` | 148 | 74 | `src/tests/cli-capture.ts` | - |
| 6 | `src/commands/issue/ready.test.ts` | 148 | 74 | `src/tests/cli-capture.ts` | - |
| 7 | `src/commands/module/list.test.ts` | 148 | 74 | `src/tests/cli-capture.ts` | - |
| 8 | `src/commands/plan/refs-check.test.ts` | 148 | 74 | `src/commands/plan/refs-check.test.ts` | - |
| 9 | `src/refs/reading.test.ts` | 148 | 74 | `src/refs/reading.test.ts` | - |
| 10 | `src/refs/verify.test.ts` | 148 | 74 | `src/refs/verify.test.ts` | - |
| 11 | `src/tests/config-parity.test.ts` | 148 | 74 | `src/tests/cli-capture.ts` | - |
| 12 | `src/tests/refs-reading-integration.test.ts` | 148 | 74 | `src/tests/refs-reading-integration.test.ts` | - |
| 13 | `src/tests/package-build.test.ts` | 104 | 52 | `src/tests/cli-capture.ts`, `src/tests/package-build.test.ts` | - |
| 14 | `src/commands/doctor-release.test.ts` | 100 | 50 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | - |
| 15 | `src/commands/doctor-stretch.test.ts` | 100 | 50 | `src/tests/cli-capture.ts` | - |
| 16 | `src/commands/doctor.test.ts` | 100 | 50 | `src/tests/cli-capture.ts` | - |
| 17 | `src/commands/tiers-scratch.test.ts` | 100 | 50 | `src/tests/cli-capture.ts` | - |
| 18 | `src/tests/epic-labels-cross-command-integration.test.ts` | 100 | 50 | `src/tests/cli-capture.ts` | - |
| 19 | `src/tests/relations-move-round-trip.test.ts` | 100 | 50 | `src/tests/cli-capture.ts` | - |
| 20 | `src/index.test.ts` | 98 | 49 | `src/index.test.ts` | - |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `packages/rafa/src/core/plan/declaration.ts` | 923 | 987 | 27 |
| 2 | `packages/rafa/src/effort/store/effort-levels.ts` | 923 | 988 | 27 |
| 3 | `packages/rafa/src/core/plan/blocks.ts` | 915 | 971 | 30 |
| 4 | `packages/rafa/src/core/plan/plan-stamp.ts` | 911 | 964 | 30 |
| 5 | `packages/rafa/src/core/config/config-sections.ts` | 903 | 965 | 34 |
| 6 | `packages/rafa/src/schema/tiers.ts` | 903 | 967 | 34 |
| 7 | `packages/rafa/src/core/config/config-readers.ts` | 899 | 956 | 34 |
| 8 | `packages/rafa/src/core/config/sections.ts` | 899 | 952 | 34 |
| 9 | `packages/rafa/src/core/plan/block-reader.ts` | 895 | 949 | 37 |
| 10 | `packages/rafa/src/core/git/commit.ts` | 893 | 947 | 37 |
| 11 | `packages/rafa/src/core/git/gh-runner.ts` | 893 | 946 | 37 |
| 12 | `packages/rafa/src/core/git/git.ts` | 893 | 947 | 37 |
| 13 | `packages/rafa/src/core/git/index.ts` | 893 | 946 | 37 |
| 14 | `packages/rafa/src/effort/store/session-row-types.ts` | 885 | 939 | 37 |
| 15 | `packages/rafa/src/effort/store/plan-stubs.ts` | 882 | 936 | 37 |
| 16 | `packages/rafa/src/core/command/version.ts` | 881 | 933 | 37 |
| 17 | `packages/rafa/src/core/runtime/identity.ts` | 881 | 934 | 37 |
| 18 | `packages/rafa/src/effort/store/commit-stats.ts` | 881 | 935 | 37 |
| 19 | `packages/rafa/src/ports/spec-review.ts` | 881 | 933 | 37 |
| 20 | `packages/rafa/src/schema/project-id.ts` | 881 | 933 | 37 |
