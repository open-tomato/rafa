# Test timing

Coverage: 925 of 925 tracked files read (test files `bun test` discovers).

Run: green. Exit code 0; 18356 pass, 0 fail, 17 skipped across 925 test files.

Time in test cases: 366.11 s; wall clock 382.99 s, 16.88 s of it outside any case (hooks, module loading). A file's time is the sum of its cases, every nested `describe` included.

## The 20 slowest files

They take 128.82 s, 35.2% of the time in test cases.

| Rank | Test file | Time | Share | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `src/tests/loop-sessions.test.ts` | 15.02 s | 4.1% | 5 | 0 | 0 |
| 2 | `src/start/suite-step-no-owns-full-suite-tally-integration.test.ts` | 11.42 s | 3.1% | 1 | 0 | 0 |
| 3 | `src/tests/loop-wait-spawned.test.ts` | 10.55 s | 2.9% | 3 | 0 | 0 |
| 4 | `src/start/type-step.test.ts` | 9.95 s | 2.7% | 20 | 0 | 0 |
| 5 | `packages/rafa-hub/src/hub-unreachable.integration.test.ts` | 8.67 s | 2.4% | 1 | 0 | 0 |
| 6 | `src/tools/ts-symbols/cli.test.ts` | 7.15 s | 2.0% | 14 | 0 | 0 |
| 7 | `src/tests/status-spawned.test.ts` | 5.65 s | 1.5% | 3 | 0 | 0 |
| 8 | `src/claims/plan-claim.test.ts` | 5.45 s | 1.5% | 32 | 0 | 0 |
| 9 | `src/release/settle-push.test.ts` | 5.38 s | 1.5% | 19 | 0 | 0 |
| 10 | `src/effort/store/tracker-refs.test.ts` | 5.37 s | 1.5% | 24 | 0 | 0 |
| 11 | `src/commands/claim/accept.test.ts` | 5.17 s | 1.4% | 18 | 0 | 0 |
| 12 | `src/release/settle-pr.test.ts` | 5.02 s | 1.4% | 16 | 0 | 0 |
| 13 | `src/release/settle.test.ts` | 5.02 s | 1.4% | 22 | 0 | 0 |
| 14 | `src/release/settle-tag.test.ts` | 5.00 s | 1.4% | 13 | 0 | 0 |
| 15 | `src/commands/claim/hand.test.ts` | 4.25 s | 1.2% | 21 | 0 | 0 |
| 16 | `src/claims/git.test.ts` | 4.07 s | 1.1% | 32 | 0 | 0 |
| 17 | `src/triage/similarity-scoring.test.ts` | 3.94 s | 1.1% | 7 | 0 | 0 |
| 18 | `src/tests/loop-output.test.ts` | 3.93 s | 1.1% | 35 | 0 | 0 |
| 19 | `src/tests/user-facing-spelling.sweep.test.ts` | 3.92 s | 1.1% | 7 | 0 | 0 |
| 20 | `src/pr/triage/version-convert.test.ts` | 3.90 s | 1.1% | 18 | 0 | 0 |

## Files whose every case was skipped

- `src/tests/parity-differential.test.ts`
- `src/tests/parity-lineage.test.ts`
