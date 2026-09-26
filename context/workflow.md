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

**`loop start --create-branch` creates the feature branch automatically**
when run on `main` or `master`, instead of printing a checkout instruction.
The branch is created as `feat/<stub>` from the latest `origin/<base>`,
where `<base>` is the tracking branch of the default branch. This feature
requires `--create-branch` to be explicit, preserving the safety of the
existing print-only behavior when the flag is absent. Use it alongside
`--plan=<path>` or the default plan under `plan.dir`, the default being
`.rafa/plans/` unless the config `plan.dir` names another.

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

### Marking a spec ready

**`rafa issue ready <n>` marks an issue as ready for planning** after
checking two things: the author must have write access (or be listed as
trusted in config), and the body must fill the spec template completely.
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
loop computes the next version from the plan's declared `release` level or
its highest change-note level, and rewrites `package.json` and the
changelog — in loop code, before the wrap-up session is spawned, off a base
version read with `git show origin/main:<versionFile>` rather than from the
working tree. The wrap-up agent then polishes the raw notes into one line
per area and leaves both files unstaged. Loop code verifies that edit,
restores its own text on any failure, commits `chore: release <version>`
over those two files alone, pushes, and attaches the entry — or the failure
sentence — to the PR body. Details at `context/release.md`; config in
`src/release/setting.ts`.
