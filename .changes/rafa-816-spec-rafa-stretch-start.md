---
plan: rafa-816-spec-rafa-stretch-start
title: Stretches run on rafa lines alone
level: minor
---

- CLI: New `rafa config set <key>=<value>` edits the project's `.rafa/config.yaml` in place, keeping every comment, and `rafa ci status --branch=<branch> [--workflow=<name>]` reports a branch's newest CI run with its failed cases, exiting 0 green, 1 red, 2 no run and 3 in progress.
- pr: New `rafa pr open` opens a pull request with its body read from a file (or names the one already open for the head), and `rafa pr retarget <n> --base=<branch>` moves a pull request to another base.
- stretch: New `rafa stretch start`, `rafa stretch item <issue>` and `rafa stretch end` run a whole stretch on rafa lines — branch push, `pr.base`, operator copy from the installed package, a detached loop per item, the merge into `stretch/*` with the CI wait, ledger and pit-stop readings, and the closing pull request — each with `--dry-run`; `scripts/stretch/stretch.sh` is now a deprecated wrapper over `rafa stretch start`.
- Doctor: `rafa doctor` warns when `pr.base` names a `stretch/*` branch that no live stretch holds.
- operators: The engineer operator, the pit-stop skill and the sweep skill now use `rafa stretch item`/`end`, `rafa ci status` and `rafa issue create` in place of hand `git`, `gh` and `setsid nohup` steps.
- documentation: `context/operators.md` and `context/cli.md` describe the stretch commands, the new `config`, `ci` and `pr` lines and the doctor stretch row.
