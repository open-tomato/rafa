# rafa

## Install

The package is `@open-tomato/rafa`, published to npm from this
repository by an operator running `npm publish` with their own
credentials. Once it is on the registry, it installs globally under
either package manager:

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
- [ ] A health check for skills: one format, and a checker that refuses
  a broken skill before an agent can follow it
- [ ] The agents a plan needs are checked before the run, and copied
  into the project with one command
- [ ] A version bump and a changelog entry with every pull request
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
- **Instinct model**: Task routing and priority logic adapted from
  [`continuous-learning-v2`](https://github.com/affaan-m/continuous-learning-v2) by affaan-m.
- **Sync protocol**: The session state and artifact synchronization design is drawn from
  open-tomato's hive-learning pattern.
