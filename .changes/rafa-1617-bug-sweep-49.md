---
plan: rafa-1617-bug-sweep-49
title: Bug sweep 49 — a ticked probe, the lint step's fetch, a triage pre-check, and a cut-table row
level: patch
---

- plan: `rafa plan validate` and `rafa loop start` no longer report `missing-probe` when the schema probe line in a plan's PREREQUISITES file is ticked; an edited probe is still reported.
- loop: The lint step runs the checkout's own ESLint instead of `bunx`, so it never fetches ESLint from the registry; with no ESLint installed it skips with one line, and its blocker names the local `node_modules/.bin/eslint` command.
- triage: `rafa loop start` no longer resolves the public tracker for an entry that a kept red capture routes to a repair task.
