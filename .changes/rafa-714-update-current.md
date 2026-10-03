---
plan: rafa-714-update-current
title: rafa update current, and the stretch launcher for any project
level: patch
---

- CLI: New `rafa update current [--dry-run] [--yes]` brings a project to the installed rafa within its patch range: it creates the missing `.rafa/` folders and the missing board labels on a GitHub board, and records the version in `rafa.lock` at the repository root, adopting a project that has none. It prints every change first and asks once; a newer minor or major, or an older installed rafa, is refused. `rafa update self`, `project`, `board`, `next` and `latest` are registered and say they are in development, naming their issues.
- Stretch: `scripts/stretch/stretch.sh` starts a stretch in any project: the engineer's prompt is the project's own `.rafa/stretch/engineer-prompt.md`, rafa's own only in the rafa checkout, or a new default, and a first stretch no longer asks for a previous report. `link` takes the operators from the rafa checkout the script sits in.
