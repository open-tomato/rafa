---
plan: rafa-951-bug-record
title: Bug record — one set of fields, and a title rendered from them
level: minor
---

- issues: `rafa issue create --type=bug` files a bug from its fields (`--module`, `--action`, `--summary`, `--cause`, `--reproduce`, and optionally `--env`, `--proposed`, `--rerun`, `--project`, `--path`), each also read from a section of the body; it renders the title from a template, fills the rafa version, the commit, the workspace package and the place, takes local paths and named secrets out, and refuses a record missing a required field, naming each; a bug typed with a bare `--title` is refused the same way, and `--title` is required for every other type as before
- issues: `rafa issue create --dry-run` prints the title and the body of an issue of any type, resolves no tracker and files nothing
- issues: `rafa issue list --type=bug` prints a header and the columns id, state, module, action and summary, read back from each title; a title filed before the template lists whole under summary
- config: an `issues` section with `titles.bug`, `titles.summaryMax`, `environments`, `vocabulary.modules` and `vocabulary.actions`
- ports: an issue draft carries an optional `cause`, filed as the label `cause:<code>` on GitHub and kept in a local issue's file
- extras: the tooling hook's gap report and the `qa-bug-reporter` agent file a bug through the new fields; a GitHub issue form, `.github/ISSUE_TEMPLATE/bug.yml`, holds the same fields
