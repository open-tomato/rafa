---
plan: rafa-1017-bug-sweep-20
title: Bug sweep 20 — the spend guard warns, and two moving files are fixed before they move
level: patch
---

- sessions: A command that starts a Claude session its `spends` declaration does not cover now runs with a single warning naming the command and the declaration to add, instead of being refused with exit 1.
