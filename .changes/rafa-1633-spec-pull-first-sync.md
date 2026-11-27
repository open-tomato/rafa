---
plan: rafa-1633-spec-pull-first-sync
title: A device pulls before it pushes, and holds the rows in conflict
level: minor
---

- config: New locked setting `effort.syncMerge` (`ff-only` by default, or `merge`), shared by every device of a project, chooses whether a service sync pulls before it pushes or pushes first.
- effort store: The store entry now exports `readConflictedRows`, which reads by table the local rows that `merge_conflicts` names.
- effort sync: Under `ff-only`, `rafa effort collect`, the loop and `rafa effort sync` pull before they push, skip the push when the pull does not complete, and leave out rows that differ from the hub's copy.
- effort: `rafa effort sync` reports how many rows it held back from a push, and `--dry-run` says how many rows would be held.
