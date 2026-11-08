---
plan: rafa-1523-bug-sweep
title: Session rows store their log path relative to the log root
level: patch
---

- effort: Collected session rows store their log path as `<folder>/<file>` under `~/.claude/projects/` rather than an absolute path holding the home directory, and a stored path can be classified with a "not on this machine" answer instead of an error.
- effort store: Reading a session row written with an older absolute log path answers the relative form, for Linux and macOS homes alike, while the stored row stays as written; merging two stores no longer records a conflict for a session held in the two forms.
- docs: The merge page names the two edited-field rules, set-once and recomputed, and the full scope of the merge-rules sweep.
