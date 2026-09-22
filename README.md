# rafa

Run a plan through the ralph loop: one Claude Code session per task, one
commit per task, then a pull request and a wait for CI, from one
terminal.

What guides it:

- **Tools before judgement.** Whatever code can decide, code decides: the
  next task, the branch, the version, whether a pull request is green.
  The agent is asked for the work itself and little else, which leaves
  less to chance.
- **Repeatable wherever it can be.** The steps around the agent are
  scripts with tests, each run once and in a fixed order, so everything
  that is not the agent's own writing comes out the same on a second
  run, on another machine and after a resume.
- **Your tools, not ours.** rafa drives what you already use (git, the
  GitHub CLI, GitHub Issues) instead of rebuilding it, and keeps each of
  those behind a small interface. Swapping one is meant to be an add-on,
  not a migration: other issue trackers are on the way, starting with
  Linear, and support for coding agents beyond Claude Code is being
  specified.

> **Alpha.** rafa is built with rafa, in the open, and it is not
> finished: commands, files and defaults still change between versions,
> and the [Roadmap](#roadmap) below says what is and is not there yet.
> Feedback and bug reports are welcome at
> [github.com/open-tomato/rafa/issues](https://github.com/open-tomato/rafa/issues/new/choose);
> the order things are being built in is the pinned
> [Roadmap issue](https://github.com/open-tomato/rafa/issues/31).

## Before you run it

Read this once; rafa also says it the first time you start a run.

- **Every Claude Code session rafa starts runs with
  `--dangerously-skip-permissions`.** That is what lets a plan run
  unattended, and it means a task can edit, delete and run anything your
  user account can, without asking. There is no switch for it yet.
- **A run acts under your accounts.** It commits, pushes its branch,
  opens a pull request with `gh`, waits for CI, and may file the
  blockers and unrelated bugs it meets as issues on the project's
  tracker.
- **It spends your Claude usage**, one session per task plus the plan
  and the wrap-up. `budget=` on a task caps that task.
- So run it in a repository, on a branch and on a machine where all of
  that is acceptable: a container or a disposable checkout is a good
  first home. Nothing here is a sandbox.

On a terminal, `rafa loop start` and `rafa plan create` print these
notices and ask `Continue? [y] yes  [d] yes, and do not show this again
[N] cancel`. Answering `d` records it in `~/.rafa/notices.json`
(`{"dismissed": ["alpha", "danger"]}`); delete the file to see them
again. Without a terminal they are printed as warnings and the run goes
on.

## Install

The package is `@open-tomato/rafa` on npm (`publishConfig` names
`https://registry.npmjs.org/` for the scope as well as in general, so a
machine that maps `@open-tomato` to another registry still publishes
there, and `npm publish` builds first through `prepack`). It installs globally under either package manager:

```bash
npm i -g @open-tomato/rafa
```

```bash
bun add -g @open-tomato/rafa
```

Either one puts the `rafa` binary on `PATH`. The package declares no
runtime dependency — `dependencies`, `peerDependencies` and
`optionalDependencies` are all absent — so the install resolves nothing
beyond the package itself. The binary and every export run under bun,
which `engines` names: see [Runtime](#runtime) below.

## How to use it

The cycle is always the same five steps, and most commands end by naming
the next one, so you rarely have to remember it.

1. **Set the project up, once.** In the repository you want to work on:

   ```bash
   rafa init
   rafa doctor
   ```

   `init` writes `.rafa/config.yaml`, keeps `.rafa/` out of git, and on a
   GitHub repository offers to set up the board (labels, the spec issue
   template, a pinned Roadmap issue). `doctor` runs every check
   `loop start` runs before its first session, and starts nothing: the
   prerequisites your config and the plan name, `gh` and its login when
   the repository is on GitHub, and the install itself.

2. **Write a spec.** A spec says what you get, where things stand, the
   design, what can go wrong, the tasks the plan must carry, and how you
   will know it is done. Either a file, `.rafa/specs/my-feature.md`, or
   an issue opened from the "Spec" template and labelled `spec:ready`.
   [docs/specs-and-roadmap.md](docs/specs-and-roadmap.md) has the
   template and a prompt for drafting one.

3. **Turn the spec into a plan.** One Claude Code session reads the spec
   and the repository and writes a checklist the loop can parse:

   ```bash
   rafa plan create --spec=.rafa/specs/my-feature.md
   rafa plan create --issue=42        # the spec is issue #42's body
   rafa plan create --next            # the first undone line of the Roadmap issue
   rafa plan show my-feature          # read it before you run it
   ```

   The plan lands in `.rafa/plans/PLAN-<stub>.md`, with a
   `PREREQUISITES-<stub>.md` beside it when something has to be true
   before the run. Read both. A plan is plain markdown: edit a task, drop
   one, add one.

4. **Run it.**

   ```bash
   rafa loop start --plan=.rafa/plans/PLAN-my-feature.md
   ```

   On `main` it offers to create `feat/<stub>` from the latest base and
   run there. Then, per task: one Claude Code session, the task's report
   stored, one commit. A task that reports `blocked` is marked and the
   run stops with the reason; fix what it names and start again, and the
   blocked task goes first. After the last task a wrap-up session syncs
   with the base, bumps the version and the changelog when the project
   has them, pushes, opens the pull request and waits for CI, spending
   repair sessions on a red one.

   From another terminal: `rafa loop status`, `rafa loop pause` (after the
   running task), `rafa loop stop` (now).

5. **Land it and look at what it cost.**

   ```bash
   rafa pr current        # number, title, checks, URL
   rafa pr triage         # why is it red, and is the fix simple
   rafa pr merge          # asks y/N, merges, switches to the base, pulls, deletes both branches
   rafa release tag       # tag the merged version
   rafa effort collect && rafa effort report
   ```

   Then step 2 again, or `rafa plan create --next`.

### Which agents and skills are involved

A task line may end with a declaration, for example
`{agent=tdd-guide effort=medium}`. The planner writes it; you can change
it.

- `agent=` routes the task to a Claude Code subagent. The planner picks
  by the task's SHAPE: implementation, tests, prose, a red build, a
  review. This repository's own roster is in `.claude/agents/` and its
  routing table in `context/workflow.md`; yours is whatever your project
  holds.
- Sessions load the project's agents and skills only
  (`--setting-sources project,local`), which keeps each turn smaller and
  makes a run behave the same on every machine. So an agent that exists
  only in `~/.claude/agents` is invisible to a run: `rafa agent list`
  shows what a run sees, `rafa agent vendor <name>` copies one in, and
  `loop start` refuses a plan that names an agent it cannot resolve,
  before any session is paid for.
- The plan format itself is a skill, `dev-planner`, shipped inside the
  package and used when the project has none of its own.
- `rafa skill check .claude/skills --project=.` refuses a skill an agent
  could not follow (a path that does not resolve, a missing field)
  before it costs a task.
- `model=`, `effort=`, `tools=` and `budget=` on a task line set the
  session's model, reasoning effort, tool list and spending cap when no
  agent decides them.

Every command has help at three levels (`rafa --help`,
`rafa loop --help`, `rafa loop start --help`), and
`rafa describe --output=json` is the same roster for a tool or an agent.

## Specs, issues and the roadmap

You can plan from a local file and never touch a board. When you want
the queue, the specs and their history in one shared place, rafa works
from GitHub Issues:

- **A spec is an issue**, opened from a template with six headings (what
  you get, starting position, design, what can go wrong, tasks,
  definition of done). `rafa init --board` sets up the template, the
  labels and a pinned "Roadmap" issue.
- **The roadmap is one ordered task list** in that pinned issue.
  `rafa plan create --next` takes the first line that is neither done
  nor already being worked on, and stops rather than skipping ahead when
  that issue is not ready. `rafa plan create --issue=<n>` plans from one
  issue directly.
- **A few labels carry the state**: `type:spec`, `spec:ready` (a person
  says a plan may be made from it), `spec:needs-work` (details pending,
  or the planner's review found gaps and listed them), and `type:bug`
  with `needs-triage` for what a run files on its own.
- **Safety, in short.** An issue's text ends up in an agent's prompt, so
  rafa plans only from an issue whose author can write to the
  repository, that a maintainer has labelled `spec:ready`, that is
  complete, and that holds no local path or token. Comments are never
  read into a plan, rafa never applies `spec:ready` by itself, and
  machine-specific failures a run meets stay off your public tracker.
- **Other trackers.** GitHub Issues is what works today. Linear support
  is being ported from the project rafa grew out of, as an optional
  add-on in a later version. For anything else, open or upvote a request
  in [the issues](https://github.com/open-tomato/rafa/issues).

The full guide, with the spec template explained, a prompt for drafting
a spec and every gate in order, is
[docs/specs-and-roadmap.md](docs/specs-and-roadmap.md).

## From a checkout

To install dependencies:

```bash
bun install
```

To run the loop from a checkout (no arguments prints the help):

```bash
bun src/rafa.ts loop start --plan=<file>
```

Every command but `init`, the help and `describe` runs inside a rafa
project: the nearest directory at or above the working directory holding
`.rafa/config.yaml`. Outside one it prints the `rafa init` hint and exits
1; `bun src/rafa.ts init --yes` sets up the git toplevel as one.

`bun run build` writes `dist/`, which the `rafa` bin and the package's
`exports` point at.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Running rafa from a snapshot

Run the global `rafa` from a copy of the build, never from this
checkout's `dist/`: `bun run build` opens with `rm -rf dist`, so a loop
running from `dist/` has its runner replaced by the first task that
builds. `bun run snapshot` in this checkout, or `rafa self-update` run
inside it, builds, copies `dist/` into `~/.rafa/runtime/<version>/` with
the version from `package.json`, points `~/.rafa/bin/rafa` at the copied
`cli.js`, and prints the path the link resolves to, exiting 0. Both
install the same way (`src/runtime/install.ts`). The bin is not in
`~/.bun/bin`, where `bun link` in this checkout re-points `rafa` at the
checkout's `dist/` with no message, so put `~/.rafa/bin` on `PATH` ahead
of `~/.bun/bin`; both warn when it is not, and `rafa doctor` checks it.
Both exit 1 before building anything while a plan tracker in `plan.dir`
(`.rafa/plans` unless `.rafa/config.yaml` names another) still holds an
open or blocked task, and name every such tracker. `rafa self-update`
runs only inside a project, so `rafa init` the checkout first. They exit
2 when they could not run: a `package.json` that is not rafa's or cannot
be read, a config or tracker they could not read, or a build, copy or
link that failed.

A version is installed once. Both also exit 1, before building, when
`~/.rafa/runtime/<version>/` is already there, naming that directory and
the version `package.json` gave: a loop may be running from it, and a
second build under the same version would swap its runner. Raise the
version to install beside it. `bun run snapshot --force` and
`rafa self-update --force` install over it anyway, replacing the
directory whole, so nothing the old build left is kept: the replacement
is copied beside the directory and renamed into its place, and only then
is the old one removed, so no reader meets a half-replaced runtime. The
link lands by a rename too, so a shell meets the old link or the new one
and never none.

## Runtime

The build targets bun, and `engines` names `bun` alone: there is no
`engines.node`, because no node version runs the binary. The package
root, `./cli` and `./store` import `bun:sqlite`, which node's ESM loader
refuses before any module code runs, so only `./plan` and `./ports` load
under node at all. `module` points at `./dist/index.js`, the same build
the root of `exports` names. The package ships no type declarations:
`exports` names no `types`, and a TypeScript consumer gets TS7016 under
`strict`.

## Roadmap

What rafa does today and what is planned, in the order it is being
built. A box is ticked by the change that finishes the feature.

- [x] Run a plan task by task: one Claude Code session per task, one
  commit per task, then a pull request and a wait for CI
- [x] Plans that carry their own background, so each task reads only the
  part of the plan it needs
- [x] Every task reports back what it did, what it found and what
  blocked it, and rafa keeps the record
- [x] See what each plan cost: sessions, tokens and commits per plan
- [x] Install once, set up any project with `rafa init`
- [x] Checks before a run: a missing tool or key stops the run with its
  name, before any session is paid for
- [x] A spending cap per task
- [x] One consistent command line, with help at every level that people
  and agents can both read
- [x] Stop, pause, resume and check on a running plan
- [x] Blockers and unrelated bugs found along the way are filed as
  issues, once each
- [x] rafa can safely work on its own code and update itself
- [x] Usable as a library inside other services, not only as a command
- [x] A health check for skills: one format, and a checker that refuses
  a broken skill before an agent can follow it
- [x] The agents a plan needs are checked before the run, and copied
  into the project with one command
- [x] Plan straight from the issue board, or from whatever is next on the roadmap
- [x] Review, merge and clean up pull requests from the command line
- [x] A failing pull request is diagnosed, and fixed when the fix is simple
- [x] A version bump and a changelog entry with every pull request
- [x] Start a plan from the main branch and rafa makes the branch for you
- [x] One command takes you to the next step: merge, clean up, plan,
  branch, start
- [ ] The right skills reach the right task, chosen when the plan is
  written
- [ ] Know which skills earn their place and which are ignored
- [ ] rafa learns from its own runs: what one task works out is handed
  to the tasks that need it later
- [ ] Skills and lessons shared across projects and machines
- [ ] Work on several issues or specs at the same time
- [ ] Add-ons: install a tracker, an output or a set of skills (Linear,
  Obsidian and others) without changing rafa
- [ ] A live terminal dashboard

## Attribution

rafa stands on other people's work and on earlier work of ours.
[NOTICE](NOTICE) carries the licences; this is the story.

- **The Ralph technique.** Running an agent in a plain loop, one fresh
  session per step over a plan kept on disk, is the "Ralph" technique
  described by Geoffrey Huntley in
  [Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/).
  The name "ralph loop" in this project is a nod to it. What rafa adds
  around the loop (plans with declared routing, structured task reports,
  preflight, effort records, the pull request and CI stage) is ours; the
  idea of the loop is not.
- **Open Tomato.** rafa's first loop, its issue-tracker port, its CLI
  event format and the learning design below come from projects in the
  [open-tomato](https://github.com/open-tomato) organisation. Most of
  them are not public yet; this section will link the specific
  repositories as they are published.
- **Loop implementation.** The code rafa started from was imported from
  [`marcostomatti/template-agentic-research`](https://github.com/marcostomatti/template-agentic-research)
  (Apache-2.0), where the loop had grown its plan and report parsers,
  effort collection and tracker.
- **Instinct model.** The instinct record (trigger, action, confidence,
  evidence, scope) is adapted from the `continuous-learning-v2` skill of
  [`affaan-m/everything-claude-code`](https://github.com/affaan-m/everything-claude-code)
  by Affaan Mustafa (MIT).
- **Shared learning (coming).** The design for merging what separate
  runs learn (one record per lesson, a rule for conflicting lessons,
  promotion on recurrence) follows Open Tomato's hive-learning design.
  In rafa it is partly built: lessons are recorded per project today, and
  sharing them across runs, projects and machines is on the
  [Roadmap](#roadmap) and not available yet.

## License

Apache-2.0; see [LICENSE](LICENSE). [NOTICE](NOTICE) names the works
rafa builds on and their licences. rafa drives Claude Code and is not
affiliated with or endorsed by Anthropic.
