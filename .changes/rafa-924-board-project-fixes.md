---
plan: rafa-924-board-project-fixes
title: Fill a long-lived repository's project in one run, with progress
level: minor
---

- configuration: five new `board.project` keys set the project refresh's retries (`retries`, `retryWaitSeconds`), progress interval (`progressSeconds`), write batch size (`writeBatchSize`) and write pause (`writePauseMs`), replacing the fixed write batch and pause.
- board: the project refresh reads an issue's labels, closing pull requests and cross-references in full, past GitHub's 100-entry page; an issue that still cannot be read no longer stops the refresh, the rest is written and it is named as `#<n> not refreshed: <reason>`, in `rafa init --board --project` (whose `project fields` part reads `created` with the refused issues listed) and in `rafa board sync` (which exits 0 and lists them as `refused` in json mode).
- board: project calls that fail on a network error (a timeout, a reset connection, an HTTP 502/503/504) are retried with a doubling wait by every command that writes the project, each retry printing `retrying #<n> (<k> of <m>): <reason>` or one `retry` event in json mode; GitHub's deliberate refusals are never retried.
- board: `rafa init --board --project` and `rafa board sync` print a start line, throttled progress lines and an end line for adding issues, reading facts and writing fields, or `progress` events with `--output=json`.
- documentation: `context/board-project.md` covers the full list reads, per-issue refusals, the retry and its classes, the progress lines and the new config keys.
