---
plan: rafa-767-bug-sweep-7
title: Bug sweep 7 — scoped test steps without `Owns:`, a repaired pre-wrap-up, exact blocker paths
level: minor
---

- Loop: with no `Owns:` folder, a `tests=module` task step and a stage step now run `bun test --changed` (a stage step from its own base) plus the `tests.alwaysRun` files instead of the full suite; a red pre-wrap-up step inserts a blocked repair task after the last task, dispatches it in the same run and runs the full suite again, halting with the blocker on that repair's line only if it is red a second time; each task and stage step on the run record now carries a `reason` (`declared`, `trigger`, `fallback`, `no-module-tests` or `stage`), and an older record reads as before; a red test step's blocker names each relative test file with `./`, so `bun test` runs that file alone.
- Documentation: `context/verification.md` and `context/workflow.md` describe the `fallback` reason, the step's `reason` key and the pre-wrap-up repair.
