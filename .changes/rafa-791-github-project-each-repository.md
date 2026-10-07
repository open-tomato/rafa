---
plan: rafa-791-github-project-each-repository
title: A GitHub project for each repository, kept in step by rafa
level: minor
---

- config: New `board.project.template` (defaulting to the open-tomato template) and `board.project.number` keys, exported from the package root and written by the config template.
- board: rafa keeps the repository's GitHub project in step with its issues: claims, the readiness gate, `issue ready`, `issue unblock`, `issue move`, `issue create`, the loop's own pull requests, `pr merge` and `epic new`/`promote`/`defer`/`move`/`cancel`/`close` refresh the issues they touch, a failed project write is a warning that keeps the command's exit code, and the new `rafa board sync` (with `--dry-run`) repairs drift made outside rafa; `epic cancel`'s json result now names the epic a moved dependent left as `answer.from`.
- release: `rafa release settle` refreshes the issues closed by the pull requests whose fragments it released.
- init: `rafa init --board` asks once whether to create the GitHub project; `--project` says yes, `--no-project` says no, and a run with no terminal leaves it out.
- doctor: `rafa doctor` checks the `project` token scope, the project at `board.project.number` and its five fields, each naming its fix.
- docs: New `context/board-project.md` page covering the template, fields, rules, refresh, callers and warnings, with the project added to the README and `rafa board sync` to `context/cli.md`.
