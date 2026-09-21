# rafa

Run a plan through the ralph loop: one Claude Code session per task, one
commit per task, then a pull request and a wait for CI, from one
terminal.

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
`https://registry.npmjs.org/`, and `npm publish` builds first through
`prepack`). It installs globally under either package manager:

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

The agent task loop at the core of this project draws on several key sources:

- **Loop implementation**: Imported from
  [`marcostomatti/template-agentic-research`](https://github.com/marcostomatti/template-agentic-research),
  which provides the structured task runner and plan/report parsing layer.
- **Ralph method**: The core agent orchestration pattern originates from
  [`open-tomato/open-tomato`](https://github.com/open-tomato/open-tomato).
- **Instinct model**: the instinct record (trigger, action, confidence,
  evidence, scope) is adapted from the `continuous-learning-v2` skill of
  [`affaan-m/everything-claude-code`](https://github.com/affaan-m/everything-claude-code)
  by Affaan Mustafa (MIT).
- **Sync protocol**: The session state and artifact synchronization design is drawn from
  open-tomato's hive-learning pattern.

## License

Apache-2.0; see [LICENSE](LICENSE). [NOTICE](NOTICE) names the works
rafa builds on and their licences. rafa drives Claude Code and is not
affiliated with or endorsed by Anthropic.
