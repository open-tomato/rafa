---
plan: rafa-468-close-tooling-hook-s
title: Close the tooling hook's dead ends — specs and closing issues through rafa, gap reports from sessions
level: minor
---

- CLI: `rafa issue create` takes `--body-file=<path>` (or `-` for standard input) to read the issue body from a file, and refuses it beside `--body` or when the file cannot be read.
- Issues: `rafa issue create --type=spec` files a spec, labels it `spec:blocked` when its body opens with a `Blocked by: #<n>` line, and refuses a line naming no issue, the issue itself or an issue the board does not hold before anything is filed.
- pull requests: `rafa pr show` lists the issues a pull request closes on merge, Development-panel links and other repositories included, under `closes` in its JSON and as a marked `closes` line in its text.
- extras: the rafa tooling hook translates `gh issue create` and `gh pr view --json` into the matching rafa line only when rafa can do the whole step, lets anything else through with a reason and an offer to report the gap, and leaves `gh issue`/`gh pr` on another repository alone.
- board: `rafa init --board` also creates the `module:cli-gap` label that sessions file gap reports under.
- documentation: the rafa-tooling skill gains a gap-report section and updated mappings, and `context/workflow.md` makes open `module:cli-gap` issues the first group of the next bug sweep.
- cli documentation: `context/cli.md` documents `--type=spec`, `--body-file` and the `Blocked by:` reading of `rafa issue create`, and the `closes` reading of `rafa pr show`.
