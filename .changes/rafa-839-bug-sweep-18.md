---
plan: rafa-839-bug-sweep-18
title: Bug sweep 18 — the type step runs in a loop worktree
level: patch
---

- loop: The runner's type step now finds `tsc` and its type definitions through the main checkout's `node_modules` when a loop runs in a worktree with none of its own, instead of running nothing, and its line names how many errors the base already held beside how many are new.
- docs: Task sessions and `context/verification.md` now say a test type error the base already held is backlog, not a bug, and the verification page names the type step's `node_modules` walk.
- tests: The type-step tests pass from a loop worktree, and the five held test type errors in `doctor`, `board-switch-status-cli`, `epic-show-cli`, `plans/validate` and `conflict-sentence` are fixed without changing what a case asserts.
