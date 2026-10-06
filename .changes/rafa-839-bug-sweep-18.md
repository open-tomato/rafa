---
plan: rafa-839-bug-sweep-18
title: The type step in a loop worktree
level: patch
---

- loop: The runner's type step now finds `tsc` through the main checkout's `node_modules` when a loop runs in a worktree, instead of running nothing, and its tests pass there.
- loop: Task sessions are told that a test type error the base already held is backlog, not a bug, and the type step's line names how many errors the base held.
- tests: The five held test type errors in `doctor`, `conflict-sentence`, `plans/validate`, `board-switch-status-cli` and `epic-show-cli` are fixed without changing what a case asserts.
