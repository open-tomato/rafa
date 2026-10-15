---
plan: rafa-1114-spec-rafa-issue-unblock
title: `rafa issue unblock [n] [--all] [--yes]`, the removal with no question
level: patch
---

- issue: `rafa issue unblock [<n>] [--all]` takes `--yes`, which answers the removal question from the line so a script or an agent with no terminal can remove `spec:blocked` once every blocker is closed; each removal names the issue and its blockers, and every refusal (an open blocker, a missing or dangling `Blocked by:` line, a half-read board, native mode) stays as it is
