---
plan: rafa-1018-bug-sweep-21
title: Bug sweep 21 — loop start reads its branch and its base one way
level: patch
---

- loop: `rafa loop start` reads its branch and its base one way. Two `--as-worktree` runs started at once both keep their upstream, which is now set in its own step and tried again while git's config file is locked. `--as-worktree` takes its base from `pr.base`, else `origin/HEAD`, never from the branch the run was started on, and names that base in one line when the two differ. On a detached HEAD, `--create-branch` or a yes to the offer creates `feat/<stub>` from the latest `origin/<base>`; without it the run is refused, naming `--create-branch` first and `--as-worktree` second, and `--any-branch` waives nothing there.
