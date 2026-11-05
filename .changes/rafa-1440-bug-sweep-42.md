---
plan: rafa-1440-bug-sweep-42
title: Bug sweep 42 — two release lines that act on something other than what was asked
level: minor
---

- CLI: Every command now refuses a flag it does not declare, before it runs, with exit code 2 and the cause `cli:unknown-flag`, naming the stray flags and the command's own; `rafa release tag --dry-run` no longer writes the tag, `rafa roadmap --state` and `--roadmap` are refused this way (exit 2, formerly exit 1 from the command), and scripts that passed stray flags must drop them.
- release: `rafa release fragment` run in a linked worktree now writes the fragment into that worktree rather than the main checkout, and prints its absolute path.
