---
plan: fix-rafa-863-spend-guard-warns
title: The spend guard warns instead of refusing a session
level: patch
---

- Sessions: a command whose `spends` declaration does not cover the Claude session it starts gets one `warn` line naming the command and saying to declare `spends`, and the session runs; it no longer fails with `UndeclaredSpendError` and exit 1. Usage is at most a warning, never a gate.
- Tests: the seven-reasons case of `rafa effort schema` runs its in-process dispatches one at a time, so it no longer leaves `effort schema` recorded as the running command for every later test file in the process (#863).
- Documentation: `context/cli.md` and the module notes of the session doors, `skill search`, the inventory search and the epic verify run say the guard warns.
