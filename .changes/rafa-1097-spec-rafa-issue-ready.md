---
plan: rafa-1097-spec-rafa-issue-ready
title: `rafa issue ready <n> --dry-run`, the reading with no question and no write
level: patch
---

- CLI: `rafa issue ready <n> --dry-run` prints the trust and completeness readings, asking nothing and writing nothing whatever the terminal: it exits 0 when the issue would be marked or already carries `spec:ready`, 2 when a check refuses, and 1 beside `--yes`, since the two ask for opposite things.
