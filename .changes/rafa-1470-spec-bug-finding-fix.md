---
plan: rafa-1470-spec-bug-finding-fix
title: A filed bug and the loop that fixed it become one lesson
level: minor
---

- effort: `rafa effort collect` now pairs each filed bug with the loop that fixed it, pushes every new pair as one lesson with both sessions as sources, and prints how many pairs it pushed; a failing pass warns and never changes the exit code.
- loop: Each loop task runs the same bug-fix pass after its store sync, so a fix becomes a lesson without a separate collect.
- instinct: New `rafa instinct pairs [--unpaired]` shows which filed bugs paired with their fix, how many are already logged as lessons, and with `--unpaired` why each other bug found none; `--output=json` gives the counts and both lists.
- learning: Bugs are paired by issue id only, through a `rafa-<n>` plan or a stage context naming `#<n>`, matching task lines with or without their declaration block; nothing is guessed, and a pair already logged as `bug-fix-pair` is never pushed twice.
- rafa-effort: New `readBugFixRows` export reads the bug findings, their reported words, resolved findings and done task reports from the effort store.
- docs: The learning page describes how bug findings become lessons, when the pass runs, the unpaired reasons and the sweep that names no issue.
