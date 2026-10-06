---
plan: rafa-821-bug-sweep-14
title: Bug sweep 14 — the loop's ending tells the truth
level: patch
---

- loop: The `pr` or `no-pr` event is now emitted once in every output mode, after the pull request delivery, so a pull request opened by a wrap-up retry or by the runner is the one it names; the wrap-up's success line names the open pull request it finds or says none is open yet, instead of always claiming one was opened; a pull request opened late by a retry or the runner now carries the release forecast or sentence; and a worktree removed just before a task's session spawns now blocks the task and halts the loop on `checkout moved` instead of crashing with `ENOENT: posix_spawn`.
- CLI: `rafa loop list` and `rafa loop status` show phase `wrap-up` for a running loop whose every task is ticked, instead of phase `task`.
- extras: The zsh prompt shows `wrap-up` instead of counting past the total once every task of a running loop is ticked.
