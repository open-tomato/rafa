---
plan: rafa-799-bug-sweep-10
title: Planned under assumptions
level: patch
---

- tests: The claim catch-up integration test now hands `addRunWorktree` a git runner with its own isolated identity, so it passes on a host with no global git identity, and a new sweep fails any test file that sets `GIT_CONFIG_GLOBAL` yet calls `addRunWorktree` without a git seam.
