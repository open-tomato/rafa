# Changelog

One section per released version, newest first, headed
`## <version> — <date>, <what the release is>`. One line per area a
user would notice, written from the pull request rather than from the
commit list. Versions follow semver; a phase is a minor, a fix between
phases is a patch. Each released version is tagged `v<version>`
(`v0.1.0` was never tagged; `f9954e2..da0a76c` is its range).

## 0.2.0 — 2026-09-15, phase 1: installable

- `rafa init`, project and user scope under `.rafa/` and `~/.rafa/`, config schema with declared prerequisites.
- Preflight before the loop and each worktree fork; `rafa doctor`; `known-missing:` in task prompts.
- Ports (Tracker, Store, Learning, Output, Planner) with core adapters; adapter registry; `rafa` module manifest.
- Subject-verb CLI (`plan`, `loop`, `issue`, `effort`, `describe`), three-level help, `describe --output=json` schema 2; flat commands kept as aliases.
- Loop-owned triage through the Tracker port; session records and `loop stop|pause|resume|status|list`.
- `status: blocked` marks the task; `effort=` passed beside `agent=`; `budget=` to `--max-budget-usd`; `--setting-sources project,local` with the routing agents vendored.
- Snapshot bin at `~/.rafa/bin/rafa`, `rafa self-update`, `loop start --runtime`.

## 0.1.0 — 2026-09-13, phase 0 and 0b

Released as one version; the three pull requests are listed apart
because no tag separates them.

Phase 0 (#1):

- The loop imported from `marcostomatti/template-agentic-research` as the package `@open-tomato/rafa`, binary `rafa`, suite under `bun test`.
- Store port with SQLite and NDJSON backends; differential and lineage parity tests over the sibling's session logs.
- Structured plan blocks (`rafa:plan`, `rafa:context`, `rafa:stage-context`) and `plan.inject: full | stage | task`, default `stage`.
- Structured task report (`rafa:report`), the `findings` table, and `progress.txt` rendered from it.
- Cutover runbook in `docs/CUTOVER.md`.

Phase 0b (#2):

- Review fixes: store schema-version guard on empty writes, `effort report` reading through the selected backend, repo hygiene tests, control-byte gate ported to `bun:test`.
- Runtime snapshot under `~/.rafa/runtime/<version>/`, so a loop never runs from the source it edits.

Fix (#3, 2026-09-14, merged without a version bump):

- Prompt audit findings 1 to 5: wrap-up prompt targets and the `@` marker note, `PROMPT.md` finish-or-blocked wording, `eslint --fix` in the agents, `gate:control-bytes` script.
