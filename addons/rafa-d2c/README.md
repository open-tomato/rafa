# @open-tomato/rafa-d2c

Design-to-code as a rafa module. This first part keeps a project's
visual baselines in a store you choose, so a fresh worktree compares
against the set instead of seeding a new one. It wraps the visual suite
your project already has; it does not write one for you.

It never adds a CI job, never uploads baselines, and never pushes. Every
step that writes to the store is one you run.

## Enabling it

Name the add-on as a `path` source in the project's `.rafa/config.yaml`
and put it on `allowList:`:

```yaml
modules:
  - path: /path/to/rafa/addons/rafa-d2c
allowList: ["@open-tomato/rafa-d2c"]
```

Then write `.rafa/d2c.yaml` at the project root.

## The config, `.rafa/d2c.yaml`

```yaml
visual:
  suite:
    kind: storybook-jest            # the only kind in this version
    package: packages/ui            # where the suite runs, from the root
    snapshots: visual/__image_snapshots__   # default
    diffs: visual/__diff_output__           # default
    report: visual-report.json              # the jest --json report; default
    index: storybook-static/index.json      # storybook build index; default
    command: bun run test:visual    # your own command; rafa never edits it
  runner:
    kind: host                      # host, container (later), remote
  store:
    kind: side-repo                 # local-dir | side-repo | same-repo (later)
    dir: /absolute/path/to/store    # not for same-repo
    set: packages-ui                # the set's folder inside the store
```

Every key is checked: an unknown key is refused by name, because a typo
in `store` would point the baselines somewhere else. Paths inside the
project are relative and never climb out with `..`. The suite command
is split on spaces and run without a shell; put anything that needs
quoting or `&&` in a package script.

A `remote` runner takes `host`, `workdir` and `command`. rafa reads
them and runs nothing on them in this version: a remote runner is your
own setup.

## Where a set lives

```text
<store dir>/<set>/<playwright version>/<runner key>/__image_snapshots__/*.png
<store dir>/<set>/<playwright version>/<runner key>/set.json
<store dir>/.staging/<set>/<runner key>/<run id>/
```

The playwright version pins the browser build, and the runner key
(`host-darwin-arm64`) names what drew the pixels, so two sets drawn
differently never stand in for each other. `set.json` records the
project commit, the host's OS and the last run's counts.

## A Git LFS server for a side-repo store

A set is hundreds of PNGs, and every re-record replaces some of them.
With Git LFS on `*.png`, git keeps small pointers in the history and
the images on an LFS server, so a fresh clone downloads only the set it
checks out. The `git-lfs` client installs from your package manager,
but the remote needs a server that speaks LFS: a plain bare repository
over ssh has none, and its first push fails with no LFS endpoint.

We recommend [Gitea](https://about.gitea.com), self-hosted, with LFS
over plain ssh turned on in its `app.ini`:

```ini
[server]
LFS_START_SERVER = true
LFS_ALLOW_PURE_SSH = true
```

Then, in the store:

```bash
git lfs install --local
git lfs track "*.png"
git remote add origin <your Gitea repository's ssh URL>
```

The pick came from a health read on 2026-11-08 of every server on the
[git-lfs implementations list](https://github.com/git-lfs/git-lfs/wiki/Implementations)
that keeps files on its own disk: Gitea releases often, has many
contributors, closes issues faster than they open, and serves LFS over
ssh as well as HTTPS. Several pure-SSH servers on that list had no
release or commit in over a year. Any working LFS server will do: the
add-on never talks to it, git does, and `promote` never pushes.

## The verbs, in run order

Each is `rafa module exec @open-tomato/rafa-d2c <verb>`.

1. `check` names every gap with its fix, then whether the next run
   compares against a set or seeds one. It writes nothing.
2. `seed` moves what the package's snapshot folder holds into a new run
   folder under `.staging/`, then copies the set in.
3. Your suite runs.
4. `place` reads the jest report and says what kind of run it was. A
   seed run prints `seed run: 732 written, 0 compared — not a pass`. It
   stages new and changed PNGs; an assert run stages nothing.
5. `promote` copies a placed run's staged files into the set, writes
   `set.json`, and in a side repo makes one commit. It warns when the
   set changed since the run was seeded. You push.

`run` does 1 to 4 in order: `run -- --update` passes `--update` to your
suite. `orphans` lists set files whose story the storybook build no
longer has. `migrate --dry-run` shows how an older flat set
(`<set>/__image_snapshots__` with an `ENVIRONMENT` file) moves into the
layout above; `migrate` does it, and you commit.

## Before you publish visual tests

You choose and own what gets published; this add-on only says what it
would expose. Baseline file names are story ids, so an unreleased
component's id names it. The pixels show whatever the stories render.
Paths, host names and remote URLs in config, records or reports
describe your local and private setup. Keep baselines, reports and
runner config local unless you can guarantee none of it reaches the
public repository. `same-repo` publishes every baseline with the
repository; `side-repo` and `local-dir` keep them off it.

`check` warns when git tracks `.rafa/d2c.yaml` and it names a local
folder or a host.
