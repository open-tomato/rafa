# Changelog

One section per released version, newest first, headed
`## <version> — <date>, <what the release is>`. One line per area a
user would notice, written from the pull request rather than from the
commit list. Versions follow semver; a phase is a minor, a fix between
phases is a patch. Each released version is tagged `v<version>`
(`v0.1.0` was never tagged; `f9954e2..da0a76c` is its range).

## 0.4.0 — 2026-09-19, phase 3: pull requests and the board

- Pull-request provider: read and list pull requests from GitHub; fetch, merge and triage GitHub pull requests.
- Pull-request subjects in plans: `pr fetch`, `pr merge`, `pr assess`, `pr resolve`, `pr trust`; merge conflict detection and clean-up.
- Triage and --resolve: assess pull request readiness, surface blockers, and resolve issues before merge.
- Trust mechanism: declare trusted authors and branches; refuse merge from untrusted sources.
- Readiness gate: verify merge safety before planning; no plan without a passing gate.
- Board setup: `rafa init --board` creates labels and board structure; `spec:ready` label gates plan creation.
- Plans from the board: `rafa plan create --issue <n>` reads GitHub issues marked `spec:ready` and creates plans.

## 0.3.0 — 2026-09-18, phase 2: schema, checker, demotion

- Stack vocabulary, skill frontmatter v2 schema with `prevents`, `signal`, `when_to_use`, `paths`, `tags`, `stack`, and instinct record schema.
- Skill checker: layout, schema, resolution, locality, and instinct verification; rafa skill check|list commands.
- Skill demotion pass: classify auto-extracted skills as observations or procedures, convert observations to instinct records.
- Instinct commands: rafa instinct check|list|show to verify and browse instinct records in project and user scopes.
- Backfill pass: proposal and derivation to fill missing `prevents`, `signal`, `when_to_use`, and `stack` fields across skill tiers.
- Agent roster validation in preflight and rafa plan validate; declared agents checked before run.
- Runtime refusal on installed version without --force; git-workflow and cli docs updated for phase 2 and 1 fixes.

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
