---
plan: rafa-1266-base-worktree
title: rafa pr merge cleans up when another worktree holds the base
level: patch
---

- pr: rafa pr merge pulls a base another worktree holds in that worktree and detaches the current checkout at it, where git switch used to fail after the merge
