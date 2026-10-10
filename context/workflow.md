## Workflow

Feature-branch → PR → merge. Conventional commit types (feat, fix, refactor,
docs, test, chore, perf, ci).

### Task shape to agent

**A task's `agent=` key routes its dispatch, and the key is the task's
SHAPE rather than its subject or its verb.** A documentation task's verb
is whatever the edit happens to be (`Remove ...`, `Rewrite ...`,
`Split ...`) while the thing it names is reliably a markdown file, so
the shape discriminates where the verb does not.

<!-- routing-table:start (generated from DEFAULT_ROUTES in src/tiers/routing.ts; do not edit by hand) -->
| Task shape | Agent | Where it lives |
|---|---|---|
| `prose` — an `AGENTS.md` map, a `context/` page, a README, a skill or an agent file | `doc-updater` | `src/bundled/agents/doc-updater.md` |
| `tests` — a suite over code that already exists, or a red-first case | `tdd-guide` | `src/bundled/agents/tdd-guide.md` |
| `repair` — a red gate, a type error, a broken build | `build-error-resolver` | `src/bundled/agents/build-error-resolver.md` |
| `review` — a change as a whole | `code-reviewer` | `src/bundled/agents/code-reviewer.md` |
| `implementation` — a module plus its TSDoc plus its colocated tests | `loop-implementer` | `src/bundled/agents/loop-implementer.md` |
<!-- routing-table:end -->

**This table is generated from rafa's `routing` defaults**
(`DEFAULT_ROUTES` in `src/tiers/routing.ts`) by `src/tiers/routing-table.ts`,
and `routing-table.test.ts` fails when the page and the generator
disagree, so change a row there and regenerate the table rather than
editing it here. A project's own `.rafa/config.yaml` can add, re-point
or remove a row under `routing`, and the planner reads the resolved map
from its `{ROUTING}` slot rather than from this page.

Every agent the table names lives in `src/bundled/agents/`, the rafa
tier that ships with the package, so the bundled file is the one to
edit. This repository's `.claude/agents/<name>.md` for each is a
symbolic link into it, and `dev-planner`, `git-workflow` and the
`documentation` skill's `SKILL.md` under `.claude/skills/` are linked
the same way into `src/bundled/skills/`. The five tracked rows
travel with the package.

**The defaults carry no user-level agent.** `cleanup` →
`refactor-cleaner` and a TypeScript review → `typescript-reviewer`
left the table because rafa does not ship either agent, and a project
that has them routes them in its own file, for instance
`routing: { cleanup: refactor-cleaner }`. Such a row is a portability
warning rather than a footnote: the definition lives outside the repo,
so a fresh clone receives none of it. Under the default
`loop.settingSources` of `project,local` it resolves against nothing on
any machine: every loop session is spawned with `--setting-sources`,
and the CLI lists no agent from `~/.claude/agents` until the sources
include `user`. A project file also SHADOWS a user-level agent of the same name
rather than merging with it, and the roster is blind to the difference:
a shadowed name appears exactly ONCE in the CLI's own list of available
agents, so only a behavioural probe separates a shadow from an
unshadowed name — ask for a literal each definition carries and the
other does not, and require each side to answer its own plus a refusal
token for the other's, since a resolver that MERGED the two would
answer both questions from one column.

**A name that resolves to nothing STOPS the dispatch**, which is what
makes a wrong row something a test can find rather than a silent
downgrade: an unresolvable agent exits 1 with NO JSON at all and the
whole roster on stderr, before any model call. `loop start` no longer
waits for that: its preflight resolves the roster from the three agent
tiers, the project's and the home's `.claude/agents` and rafa's own
`bundled/agents`, through `resolveTiers` (`src/agents/roster.ts`), and
refuses the run, ahead of every prerequisite probe, when a still-to-run
task of the plan or the tracker names an agent no loaded tier serves:
one no tier holds, one `tiers.agents` switches off, one only an unloaded
tier holds, or one two loaded tiers hold with different contents, whose
refusal names both paths and the pin line that settles it
(`src/start/preflight.ts`). The same resolution covers the three skill
trees, so a `skills=` name of those tasks that two loaded tiers hold
with different contents refuses the run too, naming both paths and its
`tiers.skills` pin line, and so does one the resolution resolves to no
winner, exactly as an agent does: one no tier holds, one `tiers.skills`
switches off, or one only an unloaded tier holds.
`rafa plan validate` runs the same check and exits 1 on the same plan.

**`agent=` outranks `model` and `tools` because routing supplies
both.** A declaration carrying an agent never passes `--model` or
`--tools`: the agent file's own frontmatter names its model and tool
set, and every tracked file the table names carries a `model:`.
`effort` is the exception, being the cost lever a plan most needs to
reach the session: `--effort` joins `--agent` unless the definition
declares an `effort` of its own. `src/utils/agent-definition.ts`
answers that from `.claude/agents/<name>.md` under the repo root, then
under the home directory when `loop.settingSources` includes `user`,
and takes a file only when its frontmatter
`name` is the name asked for, because the CLI resolves `--agent` by
that `name` and not by the file name. A name found in neither still
passes `--effort`, leaving the CLI to refuse the name. `budget` is
outranked by nothing, since a definition supplies no budget:
`--max-budget-usd` joins whatever the block resolved to, ahead of
`--tools`, whose variadic value has to end the argument list. Every key
stays on the dispatch record whatever reached the CLI, and on the
session's `dispatches` row beside the flags that did
(`src/effort/store/dispatches.ts`), and the `Routed as:` line names the
ones left to the agent.

**Routing also changes what a session can be read back from.** The
prompt is untouched, byte-identical to what was piped in, but record 0
becomes an agent-setting record and the enqueue moves to record 1, so
every prompt-keyed reader has to key on the type/operation pair and
never on position.

### Task session scope and test configuration

**A task line declares `tests=affected` (the default), `tests=module`, or
`tests=full` to control what its session checks.** Alongside `agent=` and
other declaration keys, a task line can end with `{tests=<scope>}` to set
the scope of verification the session will run. The three scopes cover
both the task session's gates and the runner's stage step that follows
the stage's last task.

**Task session gates** run in every task, reading one exit code from each:
- `bun test --changed=<base>` scoped to the changed tests (default, or when
  `tests=affected` is declared or the changed files do not trigger a
  module or full-suite rerun)
- `bunx tsc --noEmit` to type-check changed files (TypeScript only, test
  files excluded by `tsconfig.json`)
- `bunx eslint <changed files>` to lint changed files

All three redirect output to a file and read the exit code with `$?`
immediately after, never piping through `tail`, `grep`, or polling with
`until`/`while` + `sleep`. Through a pipe, only the downstream tool's exit
code is captured, and polling wastes time when the runner records the same
gate later anyway.

**Runner recorded steps** run at fixed points in the loop to establish
baseline expectations and stage-end failures:
- `baseline` — Full suite once at plan start (first dispatch)
- `task` — Full suite after each task's session ends and commits
- `stage` — After a stage's last task: the tests under `Owns:` folders
  changed by the stage, or `bun test --changed=<since>` with `tests.alwaysRun`
  files when the plan has no `Owns:` folder (reason `fallback`)
- `pre-wrap-up` — Full suite before wrap-up session starts

Each recorded step names its scope, its reason (`declared`, `trigger`,
`fallback`, `no-module-tests`, or `stage`), the command, exit code, Bun's
summary line, every failing test (file + full test name pairs), and which
failures are new against the baseline (not present in `baseline`'s captured
failures).

**The baseline is the `baseline` step's recorded failures.** A failure is
identified by its test file path and full test name. When a step reports
failures after the baseline, the runner compares each failure's file + name
pair against the baseline's captured set: a match means the failure was
already present, a mismatch means it is new. Only new failures block the
next task.

**Declaration key `tests=` on a task line** sets what the task's session
will run; the stage step scope after that stage completes follows from the
plan's `Owns:` folders (scope `full`) or falls back to `bun test
--changed=<since>` (scope `affected`, reason `fallback`):
- `tests=affected` (default): task session runs `bun test --changed=<base>`
  plus types and lint on the changed files; stage step is determined by
  the `Owns:` rule above
- `tests=module`: task session skips to `bun test <module-files>` when the
  task touches files whose enclosing module is listed in
  `tests.integration`, otherwise same as `tests=affected`; stage step is
  determined by the `Owns:` rule above
- `tests=full`: task session runs full suite when the task changes a config
  file or a globally-used module; stage step always runs full suite, not
  a fallback

**Config keys determine when a task triggers `tests=module` or `tests=full`
automatically, and which tests always run:**
- `tests.alwaysRun` (glob list; defaults to `src/**/*.sweep.test.ts`) —
  content sweeps that always run alongside scoped tests in every task's
  gates, since they read files at run time and `bun test --changed=<base>`
  follows only the import graph
- `tests.fullSuiteTriggers` (glob list; defaults include `bunfig.toml`,
  `tsconfig*.json`, `package.json`, `bun.lock`, `bun.lockb`, and files
  named in `[test] preload` of `bunfig.toml`) — when a task touches any
  file matching these globs, the task scope escalates to `tests=full`
- `tests.integration` (glob list; defaults to `**/*-integration.test.ts`,
  `**/*.integration.test.ts`, `**/*-spawned*.test.ts`, `**/*-cli.test.ts`)
  — when a task touches files in any module matching these globs (files in
  the same directory or a sibling at a known depth), the scope escalates
  to `tests=module`

**A stage-end step with new failures blocks the next task.** After a
stage's last task, the stage step runs the tests under the `Owns:`
folders the stage changed (scope `full`), or, with no `Owns:` folder,
`bun test --changed=<since>` with the `tests.alwaysRun` files (scope
`affected`, reason `fallback`), joining the always-run files so they still
pass the slow-sweep share guard. The step captures failures. If any
failure is new against the baseline, the runner inserts a `[BLOCKED]`
repair task above the first open task (`src/start/suite-blocker.ts`), its
blocker the failures, which the repair session receives through
`BLOCKER_PROMPT_PREFIX` in its prompt, and the run stops. A restarted run
dispatches that repair first and runs no stage step before it, or before
any `[BLOCKED]` task, because a due step run there would meet the same
failures and stop the run again before the repair got its session. The
stage steps still due run before the first open task after it. The blocked
task holds until its session completes or a human unblocks it by removing
the `[BLOCKED]` mark on its line in the tracker.

### What reaches a loop session

**Loop sessions enforce a limited permission scope.** A loop session 
operates under project and local setting scopes (`loop.settingSources: 
project,local`) by default and does not enforce user-scope denies or hooks. 
This measurement records what reaches a session under two configurations of 
`loop.settingSources`, and confirms that the measurement added nothing to 
any scope.

The measurement tested two probes against each scope: an `scp` command to 
copy from a nonexistent source to a nonexistent target, and an `ssh` 
command to connect to `rafa-902-probe.invalid`, a reserved `.invalid` host. 
The deny held when both commands failed with permission errors. The hook 
fired when either result carried a PreToolUse Bash hook error message.

**Measured on 2026-10-10 with Claude Code version 2.1.283:**

| Setting sources | Deny held | Hook fired | scp result | ssh result |
|---|---|---|---|---|
| `project,local` | No | No | Exit 1: no such file | Exit 255: host not resolved |
| `user,project,local` | Yes | Yes | Permission denied by Bash | Denied by ssh-host-fence hook |

**No scope was modified.** The measurement added nothing to the project 
scope, the local scope, or the user scope. `rafa doctor` confirmed every 
setting and hook unchanged. When a person adds `user` to 
`loop.settingSources`, a loop session will enforce their user-scope denies 
and hooks, as shown in the second row. The default value remains 
`project,local`; no text suggests adding `user`, and the person picks the 
scopes.

### Skills and lessons at dispatch

**Every task's prompt holds a skill index, and at dispatch the session is
handed both the skills it needs and the lessons it learned from earlier
work.** The planner reads a compact skill index (`renderSkillIndex` in
`src/task/skill-index.ts`) that lists every enabled skill a loop session
will see, one line per skill with its bare name, tags and either its
prevents clause or a one-line summary. A plan can name the skills each
task needs with `skills=` beside its text; a task declaring none gets
none. At dispatch, one of three resolvers (`src/task/resolve-skills.ts`)
picks the skills to offer, and (`src/task/select-lessons.ts`) picks up to 5
blessed lessons from the learning store when they are enabled. Both go into
the task's prompt as two sections, after the blocker line and before
`PROMPT.md`, rendered by (`src/task/sections.ts`).

**The three resolvers are `planner`, `tag` and `none`.** The planner
resolver uses the task's `skills=` declaration and offers exactly those
skills by name, in order. The tag resolver is a model-free control arm:
it ignores `skills=`, ranks every offered skill against the task text
and its stage context with `rankCandidates`, and keeps the top 3 scoring
above a floor of zero (at least one question word matched one field).
The none resolver offers nothing; it is the "before" condition. The
resolver that runs is set by `task.skills` in the config (defaulting to
`planner`), which the `--skills-resolver=` flag overrides. The resolver's
name is recorded on the dispatch row and carried in the store, but never
printed into the prompt, so a session cannot tell which arm it is in.

**The prompt sections are `## Skills for this task` and `## Lessons from
earlier tasks`.** Skills are listed with their session name (the name the
session invokes with the Skill tool), a colon, and a one-line description
of what the skill covers, or the skill name alone when it has no
description. Lessons are listed with a trigger clause, an action, a
confidence score with two decimals, the count of distinct tasks that
confirmed the lesson, and the lesson's id. When a section has nothing to
offer, it is rendered as the empty string and left out of the prompt, so
a task with no skills and lessons disabled gets the prompt it would have
gotten before.

**`task.skills` names the resolver and `task.lessons` gates whether blessed
lessons join the prompt.** Both are configuration settings: `task.skills`
takes `planner`, `tag` or `none` and defaults to `planner`; `task.lessons`
takes the words `on` and `off` and defaults to `on`. `task.skills` is a
command-line setting (the `--skills-resolver=` flag), so it overrides
the project's `.rafa/config.yaml` and any user-level `~/.rafa/config.yaml`.
`task.lessons` has no flag. Both are optional, so a config file spelling
neither uses the defaults, and a file spelling one but not the other
keeps the other at its default.

**The dispatch record holds what skills and lessons reached the prompt.**
The `dispatches` table in the store (`src/effort/store/dispatches.ts`)
carries three new columns: `resolver` (the name that ran, one of
`planner`, `tag` or `none`, or NULL when not recorded), `skills_offered`
(a JSON array of the bare names, in order, or NULL), and `lessons_offered`
(a JSON array of lesson ids, or NULL). A dispatch that ran no resolver or
handed no handout writes NULL for the resolver and `[]` for both lists, so
an empty offer and an unrecorded one stay apart. A session's use of a skill
can be read against what it was handed by matching the names in
`skills_offered` against the skill invocations in the `skill_invocations`
table (`src/effort/store/skill-invocations.ts`).

### Naming convention

All rafa work follows a consistent naming scheme across specifications,
plans, branches, and pull requests. The board is GitHub Issues on
`open-tomato/rafa`; every spec has one issue labelled `type:spec`,
whose ID appears as `rafa-<n>`.

| Artifact | Pattern | Example |
|---|---|---|
| Specification file | `.rafa/specs/rafa-<n>-<slug>.md` | `.rafa/specs/rafa-20-pr-commands.md` |
| Plan stub and directory | `rafa-<n>-<slug>` | `rafa-20-pr-commands` |
| `issue:` field in `rafa:plan` | `<n>` (number only) | `issue: 20` |
| Git branch | `feat/rafa-<n>-<slug>` | `feat/rafa-20-pr-commands` |
| Pull request title | `rafa-<n>: <title>` | `rafa-20: Add pull-request commands` |
| Pull request body | `Closes #<n>` | `Closes #20` |

The slug summarizes what the user gets, using two to four words joined
by hyphens.

### Branch creation with loop start

**Branch creation happens in the CHECKOUT, not the project root.** A single
`rafa` project has one PROJECT ROOT (the main checkout, first entry of
`git worktree list`) and one or more CHECKOUTS where loops run. The
project root owns `.rafa/` and the config; the checkout is where
`loop start` creates the feature branch and runs. Under
`--as-worktree`, the checkout is a new worktree beside the main checkout
(or in a directory you configure); without it, the checkout IS the project
root, and you run the loop where you already are.

**`loop start --create-branch` creates the feature branch automatically**
when run on `main` or `master`, instead of printing a checkout instruction.
The branch is created as `feat/<stub>` from the latest `origin/<base>`,
where `<base>` is the tracking branch of the default branch. This feature
requires `--create-branch` to be explicit, preserving the safety of the
existing print-only behavior when the flag is absent. Use it alongside
`--plan=<path>` or the default plan under `plan.dir`, the default being
`.rafa/plans/` unless the config `plan.dir` names another.

**An existing branch under `--as-worktree` catches up with its base when it
holds only claims.** `rafa plan create` claims a plan by pushing
`feat/<stub>` at the base's tip, so a run started later finds a branch cut
from a base that has moved since. When `--as-worktree` takes a branch that
already exists (local, remote-only, or held by the worktree an earlier
start left), it fetches `origin/<base>` (the base, never the branch) and
reads the branch's commits past it (`src/start/claim-catch-up.ts`). A
branch holding only `claim(rafa-<n>): …` commits is merged with
`git merge origin/<base>` in the run's worktree before the first task, a
merge and never a rewrite of the pushed branch, and one line names the
commits taken and their range. A branch holding any other commit is never
merged: one warning says how many commits behind `origin/<base>` it is, and
the run goes on. A branch at or ahead of `origin/<base>` prints nothing
new. A failed fetch is a warning, the branch then read against
`origin/<base>` as it stood; a failed merge is aborted and refuses the run.
`--create-branch` without `--as-worktree` switches to an existing branch as
it is, with no catch-up.

**The loop guard halts the loop if the checkout's branch changes.** Every
loop watches the checkout's branch and HEAD. If you switch branches in
another terminal (or pull changes that move `main`), the guard compares
what it finds against what the run was given when it started, and halts
with the work kept and nothing committed. The guard never interferes with
the loop's own commits; it fires only on external changes. This replaces
the old behavior of carrying a task's edits onto a different branch
without warning.

**A resumed `loop start` takes its tasks from `PLAN_TRACKER-<stub>.md`,
not the plan.** Once the tracker exists, a task line appended to the plan
file is never dispatched: the loop prints `All tasks completed!`. Append
the open line to the tracker as well before running again. This replaces
nothing.

**The order of all work lives in ONE place: the pinned "Roadmap" issue**
on the `open-tomato/rafa` board. The word "phase" and its letters are
retired; merged work keeps its old file names and a table in the Roadmap
issue maps them.

### The next workflow

**`rafa next` orchestrates the entire delivery cycle** from the roadmap
through planning, PR merge, and the next step. One invocation reads the
board state, prints what is ready and the one thing to do next, runs that
action, reads again, and repeats until nothing is left to do. The eight
action ids are `sync`, `plan`, `ready`, `start`, `commit`, `next-base`,
`review`, and `resume`. Only `sync` and `plan` run without asking by
default; `--yes` allows others unasked and `--dry-run` prints without
running. A session can be started, resumed mid-plan, or moved to the
next issue when the roadmap advances. After every action, `next` names
the step that follows — the merge to run, the loop to resume, or the
loop already running — unless `--no-hint` turns off the hint.

### Board relationships: labels and native modes

**Epics and blockers are recorded through the board relationships port**
(`src/board/relations/port.ts`), which offers two modes selected by the
`board.relationships` config key. The **default is `labels`**, today's
system unchanged; setting it to **`native`** uses GitHub's sub-issue and
blocked-by links. Both modes are read through the same interface, so every
command (roadmap, next, status, etc.) works the same way whichever mode
is set. A project picks by budget and preference: `labels` keeps the
cheaper board read (about 2 GraphQL points for a 287-issue board) and works
on any tracker with labels; `native` shows the relationships in GitHub's
own UI and needs no write when a blocker closes (about 8 points per full
read, but fewer writes). The cache's incremental read stays on the REST
endpoint in `labels` mode; `native` uses one `gh api graphql` query with
`filterBy: {since}` because REST answers counts only.

In **`labels` mode**, membership is the `epic:<slug>` label; order is
the epic's checklist; waiting is `spec:blocked` and the `Blocked by:` line.
Blocked specs are those marked `spec:blocked` with a `Blocked by:` line
naming one or more open blockers. `plan create --next` skips them,
offers the first unblocked spec instead, and asks whether to plan that
one. Once a blocker closes, `rafa issue unblock [<n>]` checks the line,
asks when every blocker is closed, and removes the label. `pr merge`
runs that same `issue unblock` logic after a clean merge, so closing
issue #24 automatically unblocks any issue naming it in a `Blocked by:`
line, with no extra commands needed. An `owner/repo#<n>` token on the
line is kept as written in `BlockedReading.foreign`
(`src/board/blocked.ts`) and never read as local `#<n>`; a line naming
only such tokens reads as the `no-ids` fault, so `issue unblock` never
takes a foreign-only line for "every blocker closed" and drops the label.

In **`native` mode**, membership is the issue's `parent` field; waiting
is any open `blockedBy` node. An issue frees any issues that blocked on
it when it closes, regardless of the reason. `rafa issue unblock` prints
that the tracker clears a blocker when it closes, writes nothing and
exits 0. `rafa next` offers no `unblock` action in this mode because
nothing has to be cleared by hand. `pr merge` prints the freed issues
read from the port's `freedBy` over the board listing it already holds,
never writes, and the step that would unblock in `labels` mode is dropped.

**Moving between modes** happens through `rafa init --board` when the
config key is set. It finds the other mode's marks on the board listing
and offers to move them: from `labels` to `native`, each epic's labelled
members become its sub-issues (in checklist order) and each `Blocked by:`
line becomes blocked-by links; the reverse moves sub-issues back to labels
and blocked-by links back to lines. It prints every write before asking,
writes nothing on a no, and a second run finds nothing to move. Removing
the old mode's marks is asked separately, only after every write succeeded;
any marks kept are named by `rafa doctor` alongside the marks of the
other mode that are still on the board.

### The epic guard

In `labels` mode an issue belongs to one epic at most, and
`.github/workflows/epic-guard.yml` can hold that on GitHub as labels
land: when an issue gains an `epic:` label while it carries another, the
guard removes the one just added and comments why. It is rafa's
template (`src/board/templates/epic-guard.yml`, the file
`rafa init --board --epic-guard` writes) committed unchanged, and
`src/tests/epic-guard-workflow.test.ts` holds the two identical.

It is installed **disabled**: while only rafa writes epic labels, no
issue gets two, since `rafa epic move` swaps the old label for the new
one in a single `gh issue edit`. Measured on 2026-10-03: none of the
last 500 issues ever carried two `epic:` labels, and `rafa doctor`
lists one that does whether or not the guard runs. The person turns it
on when another person or tool starts adding epic labels:
`gh workflow enable "Epic guard"`, and `gh workflow disable "Epic guard"`
turns it off. A disabled workflow starts no run on any event.

While it is on, moving an issue between epics by hand on GitHub means
removing the old `epic:` label before adding the new one, since a new
label added beside the old one is the one the guard removes.

### Marking a spec ready

**`rafa issue ready <n>` marks an issue as ready for planning** after
checking three things: the author must have write access (or be listed as
trusted in config), the body must fill the spec template completely, and
in `labels` mode only, the issue must carry at most one `epic:` label
(in `native` mode an epic is the one sub-issue parent, so the check is
skipped).
Once all three pass it asks `Mark #<n> spec:ready? [y/N]`. Typed with
`--yes` it marks the issue with no question, with or without a terminal,
so a script or an agent can run it. `--yes` skips the question only: an
issue whose author has no write access, whose body leaves a gap, or that
carries two `epic:` labels is still refused with exit code 2, and
nothing is written. `rafa next` never passes `--yes` to this step.
The command is offered automatically by `plan create --issue` and
`plan create --next` in a terminal, where a yes labels the issue with
`spec:ready` and proceeds to plan it, or a no exits with the check result.
A spec without the label cannot be planned from the board routes. See
`context/pull-requests.md` for the readiness gate's five checks and how
the planner's own review can keep a plan when assumptions are named.

### The interaction rule

**A person fills in a form, rafa runs ONE fixed-template session, code
validates the result, and the person accepts or rejects. No conversation
inside rafa.** The command reads the form through the prompt kit in
`src/cli/prompt/`, collects answers into a payload, passes them to a
Claude session with a fixed prompt template and receives one response.
A gate code checks the response against a schema — validating the
structure, running any custom checks, and reporting every failure. If all
checks pass, the person is offered the result: a yes confirms the action
and the command ends successfully, a no discards it and the command exits
with no state written, asking why only in a test. Commands that read a
form declare their own `spends` on their `RafaCommand` (`src/cli/spends.ts`)
for the one session they will start if the person reaches the form. No
command spawns a second Claude session, no prompt asks the person to
continue in Claude Code, and no runtime dependency enters the package:
the prompt kit runs in raw mode on `stdio` and every session reads the
API from the `RafaContext.env` values or the `.rafa/config.yaml`, so the
loop's own machinery (`src/utils/claude.ts` for the session and
`src/effort/store/` for the record) runs all the code.

### Bug sweep convention

**When a tooling phase completes, the first group of the bug sweep that
follows is every open `module:cli-gap` issue.** As new rafa commands or
fields are shipped, the hook denies `gh` equivalents with a gap report
offering to file a bug for each missing capability. Those bugs are filed
with the `module:cli-gap` label. When the feature that closed the gap
completes and ships, `rafa next` or a manual `rafa issue list
--module=cli-gap` sweeps those issues: each one names a `gh` command or
flag the hook denied, matched against the rafa line that can now do the
step. The person running the sweep confirms each equivalence or corrects
the report, and closes the issue. This establishes a clear pipeline from
tooling promise (the hook's denial) to tooling completion (the rafa
command) to closure (the verification sweep), and leaves no gap report
buried in a list of general bugs.

### Files beside the tree

**`.rafa/plans/` and `.rafa/specs/` are gitignored**, so they live only in the
checkout that wrote them. A sweep over tracked files never reaches a plan
or a spec, and nothing reviews their text: leave a plan's or a spec's
illustrative text, and a test quoting it verbatim, alone when a sweep
turns up its subject.

**The loop owns staging, so a task's own work is always unstaged.** No
task runs `git add`; the loop stages and commits after the session ends.
That puts every edit a task has made in the blast radius of
`git checkout <file>` and `git restore <file>`, which restore from
`HEAD` and not from the working tree of a moment ago — a task that
mutates a module to prove a test reddens and then "reverts" that way
throws away its own implementation along with the mutation. Copy the
file to a scratch path first, restore from the copy, and verify with
`shasum -c`.

**`progress.txt` is not tracked**, living only via `.gitignore`. It is
derived: `src/utils/progress.ts` rewrites it whole from the store's `findings`
rows before every dispatch, so a render over an empty store blanks what a
session wrote there by hand. The stray `@progress.txt` file has been
deleted.

### Release

**Versioning and changelog are automated at wrap-up and owned by the loop,
not by a task.** No plan carries a version-bump or changelog task; the
loop reads the release level from the plan's declared `release` level or
its highest change-note level, and writes the plan's change fragment under
`release.fragments` — in loop code, before the wrap-up session is spawned,
never touching `package.json` or the changelog, which are written on the
base branch and never by a branch's wrap-up. The wrap-up agent then polishes the raw notes into one line
per area and leaves the fragment unstaged. Loop code verifies that edit,
restores its own text on any failure, commits `chore: release fragment
<plan id>` over the fragment alone, pushes, and writes the release forecast
— or the failure sentence — into the PR body, with a level report when the
plan's declared level is below its notes. Details at `context/release.md`; config in
`src/release/setting.ts`.

### The wrap-up and pull request

**A run never ends `done` without its pull request.** The wrap-up session is
responsible for opening a pull request with the release notes, but the runner
verifies that a pull request exists before marking the run complete. After the
wrap-up session ends, the runner reads the branch's open pull request. With
one found, the run advances to the pull-request phase and waits for CI. With
none, the runner runs `loop.wrapUp.retries` more wrap-up sessions, each told
that the pull request is missing and given the previous session's final message
so it can fix any issue that stopped the PR creation. If retries are exhausted
and still no pull request exists, the runner opens one itself with the title
`rafa-<n>: <plan title>` and a body opening with `Closes #<n>`, the release
fragment's notes, and a line saying the wrap-up did not finish. If opening
fails (for instance, if the branch has not been merged into the base yet or
was pushed while the working tree had conflicts), the run ends `blocked` with
the step and branch named. A pull request a retry or the runner opened is
then given the release forecast or failure sentence the release step found
no pull request to write to (`carryReleaseIntoPullRequest`,
`src/start/release-body.ts`), before the retarget and the CI wait; one the
release step already wrote to is not written again, and a blocked delivery
writes nothing. With `pr.provider: none`, the pull-request check
and creation are both skipped and the run advances directly to CI or closes.

**The wrap-up emits `pr` or `no-pr` once, in every output mode.**
`emitPullRequestEvent` (`src/start/wrap-up-run.ts`) writes the event to
the run's events file whatever the mode, so `rafa loop wait` ends a text
run on it as it does a json or events run. Every mode emits it at the
delivery's place, after the retries and the runner: over the delivered
pull request's number with no lookup, and over a lookup made there when
the delivery holds no number (blocked or interrupted) or when a moved
checkout halts the run first. Under `pr.provider: none` its `no-pr` reason
says no provider is configured, with no lookup. Nothing is emitted right
after the first wrap-up session. Text still prints no line for it; the
output, not the emit, decides what reaches stdout.

**The retry configuration is `loop.wrapUp.retries`.** This config key (in
`.rafa/config.yaml`) controls how many times the runner will retry the
wrap-up session when no pull request is found. Valid values are:
- `1` (default) — retry once if no pull request exists
- `2` or `3` — retry that many times
- `false` — do not retry; proceed directly to the runner opening a pull
  request when wrap-up sessions fail to open one
- `0` or negative numbers are rejected at plan validation time

All values are stored in the run record and named in the `loop status` output.

**`--as-worktree` reuses its worktree.** Before adding a new worktree, the
runner reads `git worktree list --porcelain` to check whether a worktree at
the expected path (under `loop.worktreeDir`, defaulting to `.rafa/worktrees/`)
with the feature branch name already exists. If a worktree at
`<loop.worktreeDir>/<stub>` holds `feat/<stub>`, the runner treats it as the
checkout and resumes the tracker from where it stopped, with blocked tasks
first. The run prints one line saying which worktree is reused. If a worktree
at that path holds a different branch, or the path holds no worktree but the
branch exists in another worktree elsewhere, the run refuses with both paths
named. A resumed `loop start` takes its tasks from the tracker file
`PLAN_TRACKER-<stub>.md`, not the plan; new tasks appended only to the plan
file are never dispatched.

**A run records its phase for display and status.** The run record holds a
`phase` field recording which stage the run is currently in. The phases are:
- `task` — running a task session from the plan
- `wrap-up` — running the wrap-up session to write release notes and open PR
- `pull-request` — pull request exists and waiting for CI/review
- `ci` — CI checks are running on the branch (not implemented yet)
- `repair` — a task session is blocked and waiting to be unblocked or aborted

The phase changes as the runner progresses through the run. The header updates
to show `🍅 #<n> <task>/<total>` when in the `task` phase (before any task
starts), and `🍅 #<n> <phase>` when in any other phase, preventing display of
counts past the total. Commands like `rafa loop status` and `rafa loop list`
print the phase name beside the done/total count. A run record from an older
rafa without a `phase` field reads as `task` for backwards compatibility.

**A detached HEAD is refused at `loop start`.** The branch check that runs
before the first task rejects any `loop start` attempt when the working tree
is on a detached HEAD, whether or not `--create-branch` is passed. The refusal
message names two alternatives: switch to a branch with `git switch <base>`
or use `--as-worktree` to create a separate working tree. No route accepts
`HEAD` as a valid branch name, preventing silent errors from later operations.

**SIGINT during a suite step is a stop, not a suite failure.** When the runner
is recording a suite step (baseline, task, stage, or pre-wrap-up) and receives
SIGINT (from Ctrl-C or from `bun test` exiting on signal 2), the step is
recorded as `interrupted` with no test summary or failure list. The run then
ends as if `rafa loop stop` was called: tasks remain untouched, the work is
unstaged, and the run state is preserved so `loop start` can resume it.
