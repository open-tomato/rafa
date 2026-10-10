---
plan: rafa-947-board-project-follow-ups
title: Board project follow-ups — quiet pauses, and every added issue filled
level: minor
---

- board: `rafa board sync` now fills every issue it adds in the same run, even when GitHub's item listing does not show the new item yet, warns with `#<n> added but not filled: <reason>` for one it could not fill, and counts added and filled issues separately in its closing line and json result; it and `rafa init --board --project` no longer print a line for every routine pause between writes, only `pausing <n> s between writes (board.project.writePauseMs)` for a pause at least `board.project.progressSeconds` long, and never with `progressSeconds: false`
- board project: `rafa issue create` now fills the new issue's project fields even when GitHub's item listing does not show it yet, and prints `#<n> added but not filled: <reason>` when it could not
