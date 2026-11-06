---
plan: rafa-1484-bug-sweep-47
title: Bug sweep 47 — a plan names every issue it closes, and a bug's reproduce is a command
level: minor
---

- plan: The `rafa:plan` header reads a `closes:` list of GitHub issue numbers, refused whole when any entry is not a positive whole number, and the plan skill documents it and how a sweep spec fills it.
- loop: The loop's pull request now closes every issue in the plan's `closes:` list beside the plan's own issue, whether the wrap-up session or the runner opens it.
- agents: Out-of-scope reports from the loop implementer and doc updater give a reproduce command run from the checkout root, with prose only when no command can show the bug.
- board: `rafa issue create`'s `--reproduce` help and its missing-reproduce message ask for one command run from the checkout root, with the condition only when no command can show the bug.
- docs: Bug reports and the bug issue template ask for one reproduce command run from the checkout root, and the plan header documentation lists `release` and `closes`.
