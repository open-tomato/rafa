---
plan: rafa-1483-bug-sweep-46
title: Bug sweep 46 — the stretch's rules reach every planner and every task
level: patch
---

- operators: The stretch engineer and the sweep skill now say how `rules.md` is drafted beside the bucket, changed in the conversation, written once the person calls it final, or read back after an edit in the terminal; `context/operators.md` names the person and the engineer as its writers.
- plan: `rafa plan needs --issue` now reads the stretch rules file `RAFA_STRETCH_RULES` names, as `rafa plan create` does, so a snapshot saved with rules no longer reads them as removed, and a value naming no file is refused.
- loop: Each task prompt now names the plan tracker by its absolute path and says close-out notes go indented below the task line, so a task running in a worktree can find it.
