---
plan: rafa-991-spec-bug-record-loop
title: The loop files the bug record
level: minor
---

- report: The report prompt names the optional module, action, reproduce and cause keys on an out-of-scope bug entry, and the parser reads them.
- skills: The dev-planner skill documents the four optional out-of-scope bug keys and their defaults.
- triage: A bug the loop files now carries the bug record: a title from the title template, its module and cause on the issue, the record's sections in the body, and the rafa and code versions on a recurrence comment; triage is handed the checkout it ran in, so a worktree's paths and its .rafa/worktrees/<stub>/ prefix are redacted and Refs are read there.
- loop: A bug the loop files from a worktree no longer carries the worktree's path in its body.
- docs: The bug record and triage pages say triage builds the record a loop-filed bug carries, and list what triage fills itself.
