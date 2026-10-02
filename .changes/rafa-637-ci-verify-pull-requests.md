---
plan: rafa-637-ci-verify-pull-requests
title: CI verifies pull requests into main, asynchronously on stretch branches
level: patch
---

- CI: A `verify` workflow runs the test, lint and type gates on every pull request into `main` and on every push to a `stretch/**` branch.
- operators: The stretch engineer merges stretch pull requests on a local pass with `--skip-checks`, waits for `verify` before merging into `main`, and keeps no foreground command waiting past 60 seconds; the pit stop reads CI as its fifth check.
- documentation: `context/verification.md` and the `rafa-tooling` skill describe the `verify` workflow and how to hand over a merge into `main` versus into a stretch branch.
