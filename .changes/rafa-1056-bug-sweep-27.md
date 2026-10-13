---
plan: rafa-1056-bug-sweep-27
title: Bug sweep 27 — a run with no test file reads green in the fold and in the baseline
level: patch
---

- start: A task with no test file of its own no longer reads as failed beside passing always-run tests.
- loop: The suite baseline of a project with no test file is recorded once and reused quietly, and under `pr.provider: none` the wrap-up makes no `gh` call for a lesson left unanswered: it prints the line and says the lessons stay in the library.
