# Changelog

One section per released version, newest first, headed
`## <version> — <date>, <release title>`. The sections are generated
from change notes in task reports (`changes` field in `rafa:report`):
the loop inserts raw notes grouped by area, then the wrap-up agent
rewrites each area into one user-facing line. Versions follow semver;
a phase is a minor, a fix between phases is a patch. Each released
version is tagged `v<version>` (`v0.1.0` was never tagged;
`f9954e2..da0a76c` is its range).

## 0.15.0 — 2026-09-24, `rafa cleanup` — clean up merged, stale and unpushed branches and idle worktrees

- CLI: new `rafa cleanup` lists local branches and worktrees in four groups — Merged (reachable from the base, a merged pull request whose head is the branch, or an upstream gone after `git fetch --prune`), Stale, Not pushed and Worktrees — in code and starting no session, and removes what you tick after one `Delete <n> branches and remove <m> worktrees? [y/N]`, asking again for each Not-pushed branch with the commits it would lose. Nothing is forced and nothing remote is deleted: Stale rows name the `git push origin --delete` to run yourself, and the current branch, the base and `cleanup.keep` matches are never listed. `--dry-run` prints the git commands instead, and without a terminal or with `--output=json` it only lists. `rafa doctor` gains one row counting what `rafa cleanup` would list, read without fetching and given as `cleanup` under `--output=json`, and the multi-select prompt can show titled groups with disabled rows and `a` ticking a whole group.
- Config: `cleanup.staleDays` (default 30), `cleanup.worktreeIdleDays` (default 7) and `cleanup.keep` (default `[]`, branch-name globs), which `rafa init` writes commented out.
- Docs: `context/cli.md` covers `rafa cleanup`, the `src/cleanup/` modules and the doctor row; the README gains a configuration section naming the three keys and ticks the roadmap item "Clean up merged, stale and unpushed branches and idle worktrees".

## 0.14.0 — 2026-09-24, `rafa doctor --deep` — what a loop session can actually reach

- CLI: `rafa doctor --deep` reads the machine the way a loop session sees it, in code and starting no session, and prints four sections: Environment (how the session's environment differs from your shell's once the loaded settings files' `env` is applied, `PATH` compared entry by entry, and the directory sessions run in), Settings (the setting sources a session loads, and each agent, skill and MCP server configured but hidden from sessions, with the fix), Providers (whether `gh` is found, logged in and has write access under the session's environment) and Stack tools (the project's unmet stack tools, with the install hint), plus Plan needs for a plan `--plan` names. Every row is `ok`, `warn` or `note`, so `--deep` never changes doctor's exit code, and `--output=json` gives the reading as the result's `deep` field, `null` without the flag.
- Docs: `context/cli.md` covers `--deep`, its section modules and `src/utils/session-env.ts`, the one function both spawn doors now build a session's environment with; the README adds `rafa doctor --deep` to the getting-started steps and ticks the roadmap item.

## 0.13.0 — 2026-09-24, The roadmap in one table — `rafa issue list --roadmap` and `rafa roadmap`

- CLI: `rafa issue list --roadmap` prints the Roadmap issue's unticked lines in its order as a table with three new columns — `spec` (the readiness gate's reading: `ready`, `gaps: <headings>`, `outline`, or where label and gate disagree), `blocked by` (each blocker with its state) and `has` (`plan`, `branch`, `pr #<n>`) — from one read of the board; `--all` keeps the ticked lines, `--type`, `--module`, `--search` and `--limit` narrow the rows, `--state` beside it is refused, and `--output=json` gives the rows as data. An unreachable board prints a warning and the Roadmap's order alone, exiting 0. New top-level `rafa roadmap` prints the same table.
- Blocked issues: an `owner/repo#<n>` token on a `Blocked by:` line is kept as written and shown as `unknown` instead of being read as local issue `#<n>`.
- Docs: `context/cli.md` covers the roadmap table, its columns, its one board read and its fallback, and why `roadmap` is a command and not an alias; the README walkthrough and `docs/specs-and-roadmap.md` show `rafa roadmap`, and the README ticks the roadmap item "The roadmap in one table".

## 0.12.0 — 2026-09-24, See every skill and agent a run would use

- CLI: `rafa skill list` and `rafa agent list` read one inventory of every skill and agent — project, rafa, user, add-on and plugin — printing each row's source, its state (`enabled`, `shadowed-by:<source>` or `disabled:<how>`) and whether a loop session sees it, and take `--source`, `--state`, `--hidden-from-loop` and `--output=json`, with `--tier` kept as an alias of `--source` for one release; `agent list` no longer lists the Claude Code built-ins. `-i` browses the rows in the terminal (Enter shows one, `f` its whole file, Escape goes back, `q` quits) and without a terminal refuses, pointing at `--output=json`. New `rafa skill show <name>` and `rafa agent show <name>` print one item's record, frontmatter, every other holder of the name and its headings, or the whole file under `--full`. New `rafa skill search "<question>"` and `rafa agent search "<question>"` rank the items in code and ask one read-only session over the top twelve, keeping only matches whose quote is found in the file; `--no-model` prints the ranking without starting a session and `--all` searches both kinds. New `rafa plan needs` lists the agents, skills, MCP servers and programs a plan or spec needs, whether each is on this machine and whether a run can see it, and `--missing` exits 1 when anything is lacking.
- Docs: `context/inventory.md` covers the record, its sources and precedence, the disabled readings and `visibleToLoop`, and `AGENTS.md` points at it; `context/cli.md` covers the rebuilt lists, the `--tier` alias, the new commands and the prompt kit; `context/workflow.md` states the interaction rule (a form, one fixed-template session, a code check, accept or reject); the README ticks the roadmap item "See every skill and agent a run would use, browse them, and ask about them in plain language".

## 0.11.0 — 2026-09-23, Planned under assumptions

- CLI: `rafa plan risk [<plan>]` reads a plan in code, starting no session, and reports what a run of it may do on this machine and under your accounts: each open task's agent, tools, model and budget, destructive commands and writes outside the repository in the shell fences of its skills and the code spans of its task lines, the push remote and its visibility, issue tracker and pull request provider, and the names — never the values — of secret-looking environment variables. Findings are `high` or `note`, `--strict` exits 1 on any `high`, and `--output=json` gives the whole report as data. `rafa loop start` prints the plan's one-line risk total before the standing notices on every run, `rafa doctor --plan=<plan>` prints the same line, and `rafa --help` lists risk-read among the `plan` actions.
- Docs: the README's "Before you run it" and `context/notices.md` point at `rafa plan risk`, and the README ticks the roadmap item "Before a run, see what it can do on this machine and under your accounts".
- Tests: spawned runs of `rafa plan risk` pin the `--strict` exit codes, parse the json output, and prove a planted `FAKE_TOKEN` is reported by name while its value appears in no output.

## 0.10.0 — 2026-09-23, Every command that spends Claude usage says so

- CLI: every command that can start a Claude Code session says so. Help ends its line with 🪙, with the flag a session needs where it needs one (`🪙 with --resolve` on `pr triage`), `rafa --help` closes on a legend line for the mark, and an action's own help gains a `Spends:` block saying what it spends and when. `rafa describe` reports each action's `spends` declaration, or `null`, for core and module actions alike. A command that did not declare what a run spends is refused before any session starts, with an error naming the command and the flag involved.
- Docs: `context/cli.md` covers the `spends` declaration, its four forms, the help marks, the `describe` field and the spend guard; the README ticks the roadmap item and says help and `describe` carry the same 🪙 marks as its "Before you run it" table.

## 0.9.2 — 2026-09-23, two fixes to the board flow

- `rafa pr merge` ticks the roadmap again: the tick called `gh` with the REST path as its first word, so `gh` answered `unknown command` and every tick failed after two attempts (#99).
- `rafa next` reads the board again after each step, instead of answering the labels it had cached before that step, proposing the same step twice and stopping (#103).
- Both are covered by cases that redden when the fix is removed: the roadmap board is driven over a `gh` fake that refuses what `gh` refuses, and the chain over a real two-command run sharing one board.

## 0.9.1 — 2026-09-22, Plan from an edited issue without retyping the command

- `plan create`: `--issue` and `--next` no longer stop on a saved copy that differs from the issue. They print what differs first — an `issue body: +<a> -<r> lines` line naming the headings that changed, and a `local notes:` line — then rebuild a copy whose local notes alone changed without asking, and on a changed body ask `Issue #<n> changed since the saved copy of <date>. Plan from it as it reads now? [y/N]` where there is a terminal. Every check on the issue still runs before the question, a no or an ended input refuses as before and writes nothing, and without a terminal the refusal stands. `--refresh` rebuilds without asking. Every rebuild first moves the old copy to `<specs.dir>/previous/`, stamped with its modification time and never overwriting an earlier one.
- `doctor`: warns once `<specs.dir>/previous/` holds more than fifty previous copies, which are safe to delete, without changing the exit code; the json result carries the count.

## 0.9.0 — 2026-09-22, Merge a pull request that reports no checks

- `pr merge`: `--skip-checks` merges a pull request that reports no checks at all, after a warning that depends on whether the repository has workflows and a `Merge #<n> with no checks? [y/N]` question, then comments on the pull request that it did. `--yes` answers the question only where the repository has no workflow, and the flag is refused on a pull request that reports any check, naming each one and its state. Without the flag, a pull request with no checks is refused with a message naming `--skip-checks` and what it means, instead of pointing at `pr triage`. The json result gains an `unchecked` field.
- `rafa next`: a pull request that reports no checks and does not conflict is now the `pr-no-checks` state, which proposes merging it without checks rather than triaging it, and hands the question to `rafa pr merge --skip-checks` instead of asking its own. A `--yes` list naming `merge-unchecked` is refused with exit code 2, as `ready` is, and the stop line for either step now says to drop `--yes` rather than suggesting a list that would be refused.
- `pr triage`: a pull request that reports no checks is classed `no-checks` rather than `green`, and its report and comment show the repository's workflow count and the `rafa pr merge <n> --skip-checks` line.
- Docs: `context/pull-requests.md`, `context/cli.md` and the README cover `--skip-checks`, its warnings, its `--yes` refusal and its comment, the `no-checks` triage class, the `pr-no-checks` state and the always-asked steps, and no longer say a pull request with no checks goes to triage.
- Tests: driven suites over the gh fake and a scratch repository with a bare remote for every `--skip-checks` refusal and both merges, and integration tests for `rafa next --yes=merge-unchecked`, a conflicting pull request with no checks, and an unchecked merge answered `y`.

## 0.8.0 — 2026-09-22, One command takes you to the next step

- `rafa next`: reads where the project stands as one of twelve states — with a working tree holding changes to tracked files, or a pull request provider it could not ask, reported ahead of them — says it in one line, proposes the one next step in the next, and runs that step on a yes before proposing what follows. `--dry-run` prints the two lines and stops, which is also what it does when there is no terminal to answer on. `--yes` is a risk ceiling: it accepts eight step ids, allows `sync,wait,unblock,plan` bare, refuses a list naming `ready` or an unknown id with exit code 2, and never hands `pr triage` its `--resolve`. It can fast-forward a base that is behind its remote, and refuses one that has diverged.
- Ending hints: `pr merge`, `pr wait`, `pr triage`, `plan create`, `issue ready` and `loop start` now end by naming the one step that follows — asking it where there is a terminal to answer and running it on a yes, printing the `rafa` command where there is not. All six accept `--no-hint`, which ends them as before and costs no board or `gh` call, and the hint gives up after two seconds so a slow board cannot make every command wait.
- New commands: `rafa pr wait` polls one pull request's checks and answers green, red, no checks at all or timed out, writing nothing. `rafa issue ready <n>` checks who opened an issue and whether its body fills the spec template, then asks before marking it `spec:ready`. `rafa issue unblock` reads an issue's blockers off the board and asks whether to take `spec:blocked` off once every one of them is closed, naming the ones still open when they are not.
- Blocked issues: an issue can now say what it waits on with a `Blocked by: #24 #26` line under a `spec:blocked` label. `rafa init --board` creates the label, `rafa doctor` names every blocked issue whose line is missing or unreadable, and `rafa pr merge` ends by offering to clear the label on every issue the merge unblocked. A line rafa cannot read is reported rather than guessed at, and every failure of the post-merge reading is a warning rather than a failed merge.
- Author trust: `plan create` now refuses an issue whose author holds no write access before it reads or snapshots the body — on `--issue`, on the Roadmap issue, and on the issue a `--next` walk picks — and the readiness gate no longer tries to edit a `rafa:spec-review` comment somebody else planted: it reports the comment, leaves it alone, and posts its gap list beside it. A plan run spends one permission lookup per login rather than one per issue it checks.
- Spec review: each gap now says whether it is blocking, and a non-blocking gap names the assumption a plan would be written under. A review that finds only gaps it can plan under gets its plan, opened with the assumptions it named and recorded as `review: assumed`, with the gaps still posted on the issue and no label moved; one blocking gap keeps the old refusal.
- `plan create`: `--issue` and `--next` offer to mark an unmarked issue `spec:ready` instead of just refusing, whenever there is a terminal to answer on; and a blocked next line on the roadmap is named with its open blocker, with the first ready, unblocked and untaken issue offered under it — planning nothing without a yes.
- `loop status`: prints each blocked task's blocker comment, in text and in the json result data.
- Fixed: `rafa plan list` and `rafa plan show` read the plans directory `plan.dir` names under the project root, instead of a hardcoded `.plans` at the git root.
- Changed: after a merge, `pr merge` names `rafa self-update` instead of `bun run snapshot`, and only in a rafa checkout whose version is not installed.
- Docs: `context/cli.md` carries the four new commands with their flags, their exit codes and the ordered state table; `context/pull-requests.md`, `context/workflow.md` and `docs/specs-and-roadmap.md` carry what the trust check now covers, the assumed-review standing of the readiness gate, `pr wait` beside the loop's own CI wait, and the `spec:blocked` label.
- Tests: integration suites over the four trust call sites, over `issue ready`'s real trust, completeness and label-swap run, over blocked issues clearing and staying blocked, and over the assumed-review plan; a scratch-repository suite driving the whole `rafa next` chain from a green pull request to a started loop over a bare remote, with its `--yes` ceilings and `--dry-run`; and sweeps proving no ending hint or merge follow-up ever names `git`, `gh` or `bun`, and that a slashless `.plans` or `.specs` mention is caught.

## 0.7.1 — 2026-09-21, publish to npmjs from any machine

- Package: `publishConfig` names npmjs under `@open-tomato:registry` too. With `registry` alone, a machine whose npm config maps the scope to a private registry still published there, because npm reads a scope's registry first.

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
