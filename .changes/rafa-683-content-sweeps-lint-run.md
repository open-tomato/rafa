---
plan: rafa-683-content-sweeps-lint-run
title: Content sweeps and ESLint run at every task's own gate
level: minor
---

- Configuration: new `tests.alwaysRun` glob list (default `src/**/*.sweep.test.ts`) names the content sweeps a task's gate runs beside its changed-file tests.
- Loop: the task prompt tells the session to run the `tests.alwaysRun` files as well, and the runner's task step runs them beside an `affected` or `module` scope, runs ESLint over the task's changed files, and blocks the next task on a new sweep or lint failure; each sweep over 10 seconds is named in one line of the run output.
- Fixtures: the scoring and merge fixture extracts share one scrub that redacts home paths, email addresses, the host name and named secrets, and refuses to write when one is left; the fixture guard checks every file under a `testdata/` folder and `src/tests/fixtures/`.
- Triage: the scoring fixture is re-extracted through the scrub, limited to the issues its judgement covers, and the similarity bounds are re-measured at 84% of repeats right and 4% of new causes wrong.
- Documentation: `context/verification.md` and `context/workflow.md` describe `tests.alwaysRun`, the `.sweep.test.ts` suffix, the ESLint task step and the fixture scrub.
