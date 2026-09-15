# Changelog

## 0.2.0 — 2026-09-15, phase 1: installable

- `rafa init`, project and user scope under `.rafa/` and `~/.rafa/`, config schema with declared prerequisites.
- Preflight before the loop and each worktree fork; `rafa doctor`; `known-missing:` in task prompts.
- Ports (Tracker, Store, Learning, Output, Planner) with core adapters; adapter registry; `rafa` module manifest.
- Subject-verb CLI (`plan`, `loop`, `issue`, `effort`, `describe`), three-level help, `describe --output=json` schema 2; flat commands kept as aliases.
- Loop-owned triage through the Tracker port; session records and `loop stop|pause|resume|status|list`.
- `status: blocked` marks the task; `effort=` passed beside `agent=`; `budget=` to `--max-budget-usd`; `--setting-sources project,local` with the routing agents vendored.
- Snapshot bin at `~/.rafa/bin/rafa`, `rafa self-update`, `loop start --runtime`.

## 0.1.0 — 2026-09-13, phase 0 and 0b

- Sibling loop imported, `bun test`, Store port with SQLite and NDJSON, parity tests, structured plan and report, `plan.inject`, cutover runbook, review fixes, runtime snapshot.
