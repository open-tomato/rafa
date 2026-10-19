# Check time baseline

The before-the-cut number for the epic's third criterion (#801): the seconds of case time each check of decision 0009's
table runs for this project, read from `docs/survey/test-timing.md` and the `escalation` template's globs
(`src/config/templates.ts`). Per-change test time after the cut is measured against the table below, not against the
full run.

**Taken at commit `04d0162`** (`04d016235b3c4174860c65520caf0ef6d73bb828`, "Stretch 4 (#888)"), the commit that last
wrote `test-timing.md`. The report does not name a commit itself; this is the one whose tree it was committed with.
Its run: green, 925 test files, 18356 pass, 0 fail, 17 skipped, **366.11 s** of time in test cases (wall clock
382.99 s, 16.88 s of it outside any case).

## What the report can and cannot give

`test-timing.md` holds the total and its 20 slowest files, not a time for every file. So:

- **`full`** is the total: **366.11 s**. Exact.
- **`contract`** (`**/*.contract.test.ts`): no file at `04d0162` matches, so **0 s**. Exact.
- **`integration`** (`**/*-integration.test.ts`, `**/*.integration.test.ts`, `**/*-spawned*.test.ts`,
  `**/*-cli.test.ts`): 115 tracked test files match; four are among the 20 slowest and sum to **36.29 s**:

  | Test file | Time | Glob |
  | --- | --- | --- |
  | `src/start/suite-step-no-owns-full-suite-tally-integration.test.ts` | 11.42 s | `*-integration.test.ts` |
  | `src/tests/loop-wait-spawned.test.ts` | 10.55 s | `*-spawned*.test.ts` |
  | `packages/rafa-hub/src/hub-unreachable.integration.test.ts` | 8.67 s | `*.integration.test.ts` |
  | `src/tests/status-spawned.test.ts` | 5.65 s | `*-spawned*.test.ts` |

  The other 111 are each under 3.90 s (the 20th file's time) and not listed, so **36.29 s is a floor** for
  `integration`, not the figure. `src/tools/ts-symbols/cli.test.ts` (7.15 s) is not counted: `*-cli.test.ts` needs the
  hyphen.
- **`unit`** is the rest: `full` − `contract` − `integration`, so **at most 329.82 s** (the floor's complement).
- **`related`** and **`affected`** are per change (the test files of the module touched, or the files `--changed` /
  turbo `--affected` reach). They cannot be measured from a whole-suite report and are noted as such.

`unit + contract + integration` is `full` whatever the split, so the one entry that sums all three is exact.

## The seven check points

Entries are this project's `.rafa/config.yaml` (`templates: [escalation]` plus the `checks.*` keys, as
`context/verification.md` records them). Seconds are case time.

| Check point | Entry | Seconds |
| --- | --- | --- |
| `task` | `affected` | per change, not measurable from the report |
| `stage` | `related` | per change, not measurable from the report |
| `loop` | `related`, `contract`, `integration` | ≥ 36.29 (0 + ≥ 36.29) plus `related`, per change |
| `pullRequest` | `unit`, `contract`, `integration` | 366.11 (the three sum to `full`) |
| `stretch` | `related`, `contract`, `integration` | ≥ 36.29 (0 + ≥ 36.29) plus `related`, per change |
| `releasePullRequest` | `integration` | ≥ 36.29 |
| `publish` | `full` | 366.11 |

The ≥ figures become exact when the full per-file report is taken again (`bun scripts/survey/test-timing.ts` over a
`--reporter=junit` run); the `integration` sum is then the matching files' times and `unit` the remainder.
