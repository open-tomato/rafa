---
plan: rafa-1441-bug-sweep-43
title: Bug sweep 43 — the stretch's own lines, and the 0.50.0 doc lines
level: minor
---

- plan: `plan create --issue` and `--next` append the stretch rules file named by `RAFA_STRETCH_RULES` to the planner snapshot under `## Stretch rules`, after the local notes, name it on the snapshot and `--dry-run` lines, and rebuild the snapshot as a notes change when the rules change.
- stretch: `rafa stretch item` hands the stretch's `rules.md` to `plan create` and prints the file it appends, also under `--dry-run` and on a kept plan; `rafa stretch end` run again refreshes the open stretch pull request's body when the report or ledger changed, printing `body updated` or `body unchanged`.
- docs: The stretch operators page documents `rules.md` and the body refresh of a second `rafa stretch end`.
- cli: `rafa stretch end`'s help says it prints `body updated` or `body unchanged`.
