---
plan: rafa-1561-spec-evidence-first-kind
title: Evidence-first kind check for out-of-scope entries
level: minor
---

- prompt: Out-of-scope entries for a failing test now quote bun's `(fail)` line with the test file's header line above it.
- triage: The kind check now reads evidence before the session's word: it no longer takes a folder for a file and matches `.js` specifiers and `./` or `../` paths to the plan's own files, reads an entry outside the plan as the plan's own gap when the plan's commits added a symbol it names, routes a case red in a suite step's kept capture as the plan's own fallout joined to that step's repair task, shares one leftover repair task between reports of one cause, and says so in its note when an entry joins an existing repair line.
- loop: A red suite step now keeps its output as `<kind>.<sha>.red.output.txt` under `.rafa/runs/<session>/suite/`, which a later green rerun no longer removes.
- docs: The triage page's decision table now lists the step-capture and plan-symbol rows with the path, capture and repair-dedupe rules in the check's order, and says a run keeps the similarity step on at the default threshold of 0.3.
