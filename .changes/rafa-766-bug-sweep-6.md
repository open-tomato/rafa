---
plan: rafa-766-bug-sweep-6
title: Bug sweep 6 — macOS failures print their cause
level: patch
---

- Tests: a spawned `rafa` run that exits with the wrong code or misses an event now fails with the child's exit code, the last 80 lines of its stdout and stderr, and its scratch paths (`expectExit`, `expectEvent` and `describeRun` in `src/tests/cli-capture.ts`); the effort copy test accepts SQLite's `disk I/O error` as well as `database is locked` for a locked-out writer; and the hub's integration suites probe `Bun.secrets` in the same environment their CLI child runs under, skipping only when that child cannot reach a secret store.
- Documentation: `context/verification.md` says what a spawned case's failure prints and that a new spawned case asserts through `expectExit`/`expectEvent`.
