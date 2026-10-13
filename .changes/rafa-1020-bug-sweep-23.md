---
plan: rafa-1020-bug-sweep-23
title: Bug sweep 23 — the lines run between loops do their step and refuse where they should
level: patch
---

- config: `rafa config set` refuses every key of the `dangerous` section in a shell an agent runs (`CLAUDECODE` set). It writes nothing and prints the line to run in your own terminal.
- self-update: `rafa self-update` and `bun run snapshot` no longer wait on a plan tracker that still holds a task when no loop of the project is live. They warn once, naming each such tracker, and install. Under a live loop the refusal stays, and `--force` installs anyway.
- pr: `rafa pr triage` assesses a pull request that conflicts with its base even when every check passed, and `--resolve` hands it the plan for its conflict class instead of reporting it green. `rafa pr wait` no longer answers `none` seconds after a push: it keeps polling a head under two minutes old until its first check registers, and says a pull request does not merge cleanly only when it reads as conflicting.
- next: `rafa next` no longer lets a loop running in a worktree of its own hide changes to tracked files in the main checkout. They are reported with the checkout named.
- cleanup: `rafa cleanup` no longer asks about the commits of a ticked Not-pushed branch it will not delete because a ticked worktree holds it. The branch is reported as not removed, under `--dry-run` too.
- stretch: `rafa stretch item` reads each open bug's filing time from the tracker's one listing call, with no `gh issue view` call per bug.
