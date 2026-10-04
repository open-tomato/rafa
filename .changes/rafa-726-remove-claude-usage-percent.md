---
plan: rafa-726-remove-claude-usage-percent
title: Remove the Claude usage percent
level: minor
---

- cli: The `rafa usage` command is removed; `rafa usage` is now refused as an unknown subject or command.
- loop: Loops no longer read `CLAUDE_USAGE_PERCENT`, so they no longer warn about Claude usage or pause between tasks when it is high.
