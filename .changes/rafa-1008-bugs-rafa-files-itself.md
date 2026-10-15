---
plan: rafa-1008-bugs-rafa-files-itself
title: Bugs rafa files itself reach the project
level: patch
---

- loop: A bug the loop files on the GitHub tracker from a task's report is now added to the repository's project and filled in the same run; any problem with the add is printed as a warning and the task carries on.
- epic: A bug `rafa epic close` files for a failed acceptance check on GitHub is now added to the repository's project and filled in the same run; any problem with the add is printed as a warning and the gate's verdict is unchanged.
- docs: `context/board-project.md` names the loop's triage and the epic close gate as callers of the add-then-refresh, and describes which filed bugs `add-filed.ts` passes over and the warnings it prints (#1007).
