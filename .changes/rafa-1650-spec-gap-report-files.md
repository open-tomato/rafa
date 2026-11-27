---
plan: rafa-1650-spec-gap-report-files
title: Gap reports file as `type:debt` unless they break something
level: minor
---

- board: Added the `debt` issue type: `rafa init --board` creates a `type:debt` label, `rafa doctor` reports whether the board holds it, and the github and local trackers can move an issue between types while keeping its other labels and body.
- issue: `rafa issue create --type=debt` files a full bug record (titled through `issues.titles.bug`, filable `--upstream`), and the new `rafa issue edit <n> --type=bug|debt` moves a report between the two record types, with `--dry-run` printing the swap such as `type: debt → bug`.
- CLI: `rafa issue create`'s usage line and refusals now name `--type=bug|debt` as the record types.
- extras: The tooling hook's gap-report offer asks whether the missing line breaks something, names both the `--type=bug` and `--type=debt` create lines, and maps a `type:debt` label onto `--type=debt`.
- operators: The stretch gap log files a gap as debt unless it breaks something, and the stretch sweep reads the cli-gap debt list beside the bug list and moves mislabelled reports to bug.
- docs: The tooling skill and context pages describe gap reports as debt unless the missing line breaks something, document `issue edit --type`, and name the Atlas QA bug metrics as leaving cli-gap reports out of bug counts.
