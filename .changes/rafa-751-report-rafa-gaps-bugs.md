---
plan: rafa-751-report-rafa-gaps-bugs
title: Report rafa gaps and bugs upstream from a sibling project
level: minor
---

- config: Added the `collaborate.rafa` key, off by default and written commented out by `rafa init`, naming the rafa board a sibling project may report to.
- board: `issue create`, `issue comment` and `issue list` now declare `--upstream=<tool>`, with help naming `collaborate.rafa` and the same-owner rule.
- issue: `--upstream=rafa` files a bug (`issue create --type=bug`), posts a redacted comment (`issue comment`) or lists issues (`issue list`, with `--search`, `--type`, `--module` and `--limit`) on the board `collaborate.rafa` names; it is refused before any `gh` call unless the key is set and both boards share an owner, a private sibling is named only as "a private sibling repository", and `--dry-run` prints the upstream body and its target.
- operators: The gap-log skill searches, files and comments on rafa's board upstream when `collaborate.rafa` is set.
- docs: The issue commands' docs describe filing upstream, its same-owner gate and refusals, the bug-only rule and the private-name rule.
