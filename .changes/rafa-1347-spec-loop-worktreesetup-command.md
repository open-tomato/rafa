---
plan: rafa-1347-spec-loop-worktreesetup-command
title: A project names the command a loop runs in its worktree
level: minor
---

- config: `loop.worktreeSetup` names a shell command that a `--as-worktree` run executes in its worktree, right after the worktree is added or reused and before the preflight and the first session. Null, the default, runs nothing; a nonzero exit or the ten-minute limit refuses the run and leaves the worktree for a rerun. The `rafa init` template lists the key under `loop`, and this repository sets it to `bun install --frozen-lockfile` so a worktree resolves its workspace packages to itself (#1345).
