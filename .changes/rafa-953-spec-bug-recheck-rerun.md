---
plan: rafa-953-spec-bug-recheck-rerun
title: `rafa bug recheck` reruns a bug's test reference
level: minor
---

- suite: the suite runner can run a test under a deadline that kills the whole process group and reports the timeout, narrow a run to a test name pattern, and report every case it ran with its outcome
- config: `bugs.recheck.runs` and `bugs.recheck.timeoutSeconds` set how many further runs a bug recheck makes after a first pass and each run's deadline
- bugs: `rafa bug recheck` reruns the test a bug's `Rerun` section names, as `bun test <file> [-t "<case>"]` and nothing else, and judges whether the bug reproduces, is gone or is flaky
- CLI: `rafa bug recheck [<n>…] [--all] [--comment]` is registered as the `bug` subject's second action, with text and json output
- operators: the stretch sweep rechecks open bugs first, closing a gone bug as fixed with the comment as evidence and grouping a flaky one as a bug of its own
