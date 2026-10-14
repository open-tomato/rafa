---
plan: rafa-1072-spec-loop-files-no
title: The loop files no bugs about documentation
level: minor
---

- report: Task reports gain an eighth field, `stale_docs`, for documentation lines that no longer match the code; the task prompt tells sessions to repair doc lines their own change falsified and list any other stale line there rather than filing a bug, and a report written without the field still reads cleanly.
- effort store: A new `stale_docs` table, added by the additive migration `stale-docs`, stores each reported stale doc line as a sighting row, and the report summary line counts them.
- triage: Stale doc lines are answered on a new `docs` channel that files and searches nothing on any tracker; the loop prints one Triage note per line.
- effort: `rafa effort report` shows how many filed bugs name only documentation, carried in its JSON as `docOnlyBugs`.
- plan: A task line can declare `docs=repair` to mark a plan's closing doc task, and plan validation warns with `missing-doc-task` when a plan that changes code does not end on one.
- loop: The closing doc task is handed the stale doc lines the plan's sessions reported and the files the plan touched; whatever it cannot settle is added to the release's stale-docs issue, or printed once after the last task when no tracker can hold it, and a finished task of a doc-update plan ticks its line in that issue.
- epic: `rafa epic close` adds a failed criterion that names only documentation to the release's stale-docs issue instead of filing a bug.
- CLI: New `rafa docs plan` command writes a doc-update plan from the open lines of the stale-docs issues, one `doc-updater` task per line.
- release: `rafa release status` shows the number of open stale-docs lines (`none` at zero, `?` when the tracker cannot be read) without changing its exit code.
- agents: `doc-updater` and `loop-implementer` report stale doc lines in `stale_docs` instead of as bugs.
- operators: A stale doc line found at a pit stop becomes one line on the release's stale-docs issue instead of a filed issue.
- docs: `context/triage.md` and `context/workflow.md` describe the `docs` channel, the stale-doc rows, the closing doc task and the per-release stale-docs issue.
