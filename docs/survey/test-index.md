# Test index

Coverage: 1577 of 1577 tracked files read (src/ and packages/*/src/).

908 test files indexed, 349 of them spawning a process; 633 source files, 3 of them reached by no test outside support files. A test's index is the number of folders (a package counts as one) its transitive imports reach through source files, doubled when it spawns a process; folders reached only through `src/tests/` support files and fakes are listed apart and not counted.

## The 20 highest indexes

| Rank | Test | Index | Folders | Spawns via | Support-only folders |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/fixtures/fixture-guard.sweep.test.ts` | 130 | 65 | `src/fixtures/fixture-guard.sweep.test.ts` | - |
| 2 | `src/board/roadmap-claims-remote.test.ts` | 128 | 64 | `src/board/roadmap-claims-remote.test.ts` | - |
| 3 | `src/cleanup/branches.test.ts` | 128 | 64 | `src/cleanup/branches.test.ts` | - |
| 4 | `src/cleanup/groups.test.ts` | 128 | 64 | `src/cleanup/groups.test.ts` | - |
| 5 | `src/cleanup/held-stale-branch.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 6 | `src/cleanup/index.test.ts` | 128 | 64 | `src/cleanup/index.test.ts` | - |
| 7 | `src/cleanup/steps.test.ts` | 128 | 64 | `src/cleanup/steps.test.ts` | - |
| 8 | `src/cli/help.test.ts` | 128 | 64 | `src/cli/help.test.ts`, `src/tests/cli-capture.ts` | - |
| 9 | `src/commands/board/list.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 10 | `src/commands/claim/accept.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 11 | `src/commands/claim/hand.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 12 | `src/commands/claim/release-after-merge.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 13 | `src/commands/claim/release.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 14 | `src/commands/claim/take.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 15 | `src/commands/cleanup.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 16 | `src/commands/doctor-refs-roadmap.test.ts` | 128 | 64 | `src/commands/doctor-refs-roadmap.test.ts` | - |
| 17 | `src/commands/doctor-refs.test.ts` | 128 | 64 | `src/commands/doctor-refs.test.ts` | - |
| 18 | `src/commands/doctor-release.test.ts` | 128 | 64 | `src/commands/doctor-release.test.ts`, `src/tests/cli-capture.ts` | - |
| 19 | `src/commands/doctor.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |
| 20 | `src/commands/epic/cancel-native.test.ts` | 128 | 64 | `src/tests/cli-capture.ts` | - |

## The 20 source files reached by the most test files from other folders

| Rank | Source file | Tests from other folders | All tests | Support-only tests |
| --- | --- | --- | --- | --- |
| 1 | `src/utils/declaration.ts` | 787 | 792 | 21 |
| 2 | `src/schema/tiers.ts` | 781 | 783 | 28 |
| 3 | `src/learning/identity.ts` | 777 | 782 | 28 |
| 4 | `src/plan/blocks.ts` | 774 | 781 | 24 |
| 5 | `src/utils/plan-stamp.ts` | 774 | 778 | 24 |
| 6 | `src/pr/checks.ts` | 764 | 782 | 28 |
| 7 | `src/pr/types.ts` | 764 | 781 | 28 |
| 8 | `src/config-sections.ts` | 761 | 777 | 28 |
| 9 | `src/report/parse.ts` | 759 | 762 | 31 |
| 10 | `src/schema/stack.ts` | 758 | 762 | 31 |
| 11 | `src/check/shell-lines.ts` | 757 | 760 | 31 |
| 12 | `src/schema/failure-strings.ts` | 757 | 760 | 31 |
| 13 | `src/schema/frontmatter.ts` | 757 | 762 | 31 |
| 14 | `src/schema/provenance.ts` | 757 | 761 | 31 |
| 15 | `src/schema/skill.ts` | 757 | 760 | 31 |
| 16 | `src/learning/types.ts` | 756 | 760 | 31 |
| 17 | `src/utils/session-env.ts` | 756 | 761 | 31 |
| 18 | `src/check/layout.ts` | 755 | 757 | 31 |
| 19 | `src/check/references.ts` | 755 | 757 | 31 |
| 20 | `src/check/run.ts` | 755 | 756 | 31 |
