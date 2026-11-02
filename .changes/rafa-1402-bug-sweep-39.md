---
plan: rafa-1402-bug-sweep-39
title: Two readings that throw away good data
level: patch
---

- effort: the skill-use collector now reads a Claude Code session log by skill name whenever every record is at or above the floor of 2.1.280, instead of storing every version other than 2.1.280 as unknown; sessions logged above the recorded fixture's version are counted as unvouched beside read and unknown on the skills line of `rafa effort collect`, and `--verbose` names each session's versions
- doctor: `rafa doctor` warns only when the installed Claude Code is below the skill-use floor, and prints a note when it is newer than the version the skill-use fixture was recorded under
- board: `rafa board sync` sends a `gh` call again when it fails with `unexpected end of JSON input`, as it already does on an HTTP 502, instead of stopping
