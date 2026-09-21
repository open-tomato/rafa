# Changelog

One section per released version, newest first, headed
`## <version> — <date>, <release title>`. The sections are generated
from change notes in task reports (`changes` field in `rafa:report`):
the loop inserts raw notes grouped by area, then the wrap-up agent
rewrites each area into one user-facing line. Versions follow semver;
a phase is a minor, a fix between phases is a patch. Each released
version is tagged `v<version>` (`v0.1.0` was never tagged;
`f9954e2..da0a76c` is its range).

## 0.7.0 — 2026-09-21, ready to publish: licence, notices, npm

- Notices: `loop start` and `plan create` print an alpha notice and the `--dangerously-skip-permissions` notice, ask once on a terminal (`y`, `d` to stop showing them, anything else cancels), and warn without one; dismissals live in `~/.rafa/notices.json`.
- Licence: `LICENSE` (Apache-2.0) and `NOTICE`, naming template-agentic-research, open-tomato and everything-claude-code's `continuous-learning-v2`; the README's instinct-model link, which pointed at a repository that does not exist, now points at the real one.
- Package: `publishConfig.registry` names npmjs, `prepack` builds before every pack or publish, `NOTICE` ships, and `description`, `repository`, `homepage`, `bugs` and `keywords` are filled in.
- README: an alpha banner with feedback links and a "Before you run it" section.

## 0.6.0 — 2026-09-20, rafa keeps its own plans and specs where it tells every project to

- plans and specs: This repository now keeps its own plans and specs where rafa tells every project to keep them, under `.rafa/plans` and `.rafa/specs`: the two config overrides naming the pre-default directories are gone, and every agent file, skill, context page, doc comment, prompt and root document was swept onto the defaults, with a regression test that fails if a tracked file outside the test suite names the old paths again.
- doctor: `rafa doctor` tells a project that still points `plan.dir` or `specs.dir` at the directories rafa used before it had defaults of its own that a default exists, as a warning that leaves the exit code alone, and json mode carries the reading in its result data.
- loop start: Started on `main` or `master`, `rafa loop start` now offers to create the plan's own branch, `feat/<stub>`, from the latest `origin/<base>` and run there: it refuses while a tracked file is modified, fetches, fast-forwards the base and refuses rather than branch from a diverged or unfetchable one, and switches to `feat/<stub>` instead when that branch already exists locally or on the remote. `--create-branch` takes the offer without asking, `--any-branch` still runs where it is, and the refusal a run without either meets names the flag instead of printing a `git checkout -b` line to copy.
- plan create: The plan session is asked for its `rafa:spec-review` block at the end of its final message, where a `-p` session can actually write one, and the last block is read rather than the first. A plan whose session returned no readable block now stands, stamped `review: missing`, when `plan validate` passes; only an explicit `not-ready` verdict posts the review comment and swaps `spec:ready` for `spec:needs-work`; and a plan the readiness gate does refuse is moved to `rejected/` under the plans directory, with its prerequisites, instead of being deleted. `rafa plan create` also names the branch the run will use beside its `Execute with` hint.
- plan parsing: A plan may write its issue as a bare number, `issue: 49`, as well as quoted.
- docs: `rafa loop start --help` shows an example using `--create-branch`, the `loop start` rows of `context/cli.md` and the branch section of `context/workflow.md` record branch creation, and the README roadmap ticks starting a plan from the main branch and letting rafa make the branch.

## 0.5.1 — 2026-09-20, rafa-22 — sweep the untriaged bugs filed by loop runs

- plan create: `rafa plan create` refuses an issue whose body does not fill the spec template, naming every heading that is missing, empty or itemless, before it writes a plan file.
- loop: A task whose session wrote neither a report nor a commit is held rather than ticked, with the hold naming both absences; `loop start` and `rafa plan validate` refuse a plan whose unresolvable agent sits on a task line hidden by a fence that was never closed, naming the file and the line; and a repository configured with no pull-request provider no longer waits on `gh` to write a release failure it cannot write, printing instead which sentence went unwritten.
- doctor: `rafa doctor` probes a plan's `[start]` prerequisite items on a first dispatch, the way `loop start` does, and says in one line how many a resume passed over.
- pr triage: `--resolve` hands the session the failing job's log excerpt, quoted line by line and capped at 40 lines, in the CI install and lint plans, instead of telling the agent to fetch it; and pull requests opened under dependabot's `app/dependabot` login are recognised as dependency bumps, so a failing install or lint on one is eligible for `--resolve`.
- triage: An out-of-scope bug is deduplicated by its artifact together with the plan tracker file it was reported against, so two defects quoting one error string no longer land on one issue; and a bug whose evidence names the machine's own toolchain, SDK or package build is filed to no tracker at all, kept as a machine-scoped row with one line saying why nothing was filed.
- store: Each stored out-of-scope bug records whether it is a fault of the machine the session ran on or of rafa.
- skill check: Another language's code in a `bash` fence no longer reads as a missing tool or a dead path, because such a fence now carries no command at all; and an HTTP route like `/openapi.json` no longer reads as a path outside the project, while a real foreign path and a home-rooted one still fail.
- plan: `rafa plan` tells you to run `rafa loop start --plan=<path>` instead of the checkout-only `bun src/rafa.ts start`.
- docs: The parity-differential section of `context/verification.md` describes the frozen log copy and no longer tells a reader to expect a red case; `src/config.ts`'s note records how many modules import `config-sections.js` directly; the `findNextTask` test header cites `src/start.ts`; the command roster's count and its unregistered list match the code; and the `dev-planner` change-note table follows the parser's own column order.
- testing: A regression test proves `rafa doctor` and `rafa loop start` name the same required items in the same order on a plan's first dispatch.

## 0.5.0 — 2026-09-20, rafa-21: changelog and release in the loop

- release: The loop writes the version bump and the changelog entry for every pull request: the base version is read from `origin/main`, the level comes from the plan or its change notes, and the entry is inserted under a fresh heading.
- report: Task reports carry a `changes` list — one entry per user-visible change, with a level, an optional area and a summary.
- store: Change notes are stored in a `changes` table in the effort SQLite store, deduplicated per session and readable per plan.
- cli: New `release` subject: `rafa release status` reads the version, the latest tag, the untagged releases and the pending notes, and `rafa release tag` tags `main` and prints the publish line.
- preflight: PREREQUISITES items can be tagged `[start]` to be probed on a plan’s first dispatch only, and skipped with a named line on a resume.
- config: `rafa init` asks for the four `release` settings — `enabled`, `versionFile`, `changelog` and `heading`.

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
