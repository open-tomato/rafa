---
plan: rafa-841-stretch-operators-run-each
title: Stretch operators run each rafa line as one command
level: patch
---

- operators: the stretch operators now run every `rafa` line as one command, as each agent file and `context/operators.md` state, so Claude Code's auto-mode classifier no longer stops them on a compound line; the engineer merges with `rafa pr merge <pr> --skip-checks --yes`.
