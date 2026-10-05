---
plan: rafa-818-bug-sweep-11
title: Planned under assumptions
level: patch
---

- loop: The runner's task step now type-checks the test files a task changed against the task's base commit, and turns red only on type errors the base did not already hold.
- tests: Fixed the test type errors named in the bug sweep (timeout options in bun's argument order, readonly and possibly-undefined values reaching `toEqual`, and stale stand-ins), and added an end-to-end test of the type step over a real git repository.
- documentation: `context/verification.md` lists the type step beside the lint step and records the measured backlog of test-file type errors.
