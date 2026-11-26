---
plan: rafa-1657-bug-sweep-50
title: Bug sweep 50 — a held stop's halt, the freed worktree's notes, the hub timeout test, the git-lfs promote case, a checkout warning, and a cut-table row
level: patch
---

- loop: a task held for leaving neither a report nor a commit now ends the run's events with a halt naming the hold and the task, so `loop wait` and `stretch item` report why the run stopped; `rafa loop start` without `--as-worktree` now warns before its first task that edits made in this checkout during the run go into task commits, and the `--create-branch` help names the same trade-off.
- pr: `rafa pr merge` now copies the run's notes file back into `.rafa/notes/` when it frees a loop worktree, instead of deleting it with the worktree.
- docs: the cut table lists the hub's stand-in OAuth test data beside the login tests.
