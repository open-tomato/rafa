---
plan: rafa-730-bug-sweep-5
title: Bug sweep 5 — integration-branch cleanup, loop worktrees at merge, restart order, and red steps that name their cause
level: patch
---

- cleanup: `rafa cleanup` never lists the default branch `origin/HEAD` names, even when `pr.base` names an integration branch, and it now lists the loop's own worktrees under `loop.worktreeDir`, keeping dirty ones and ones a live loop holds.
- pr: `rafa pr merge` frees a clean, ended loop worktree that holds the head branch, copying its close-out and tracker files into the main checkout first, instead of refusing the merge.
- loop: a red task or stage step inserts one blocked repair task above the next open task, naming the commit it ran at, and a restarted run gives that repair its session before any stage step runs; a red step's blocker names each file that threw outside any test with its first error line, and a step whose only red is extra such errors is retaken once and reported as intermittent when the retake is clean.
- lint: the lint step says it could not run ESLint, with the exit code and first stderr line, when ESLint wrote no report, instead of reporting ESLint errors in the diff.
