---
plan: rafa-1524-bug-sweep-48
title: Bug sweep 48: a merged plan, a release tag, a triage wait, and two pit-stop readings
level: patch
---

- next: `rafa next` no longer offers a plan whose branch already has a merged pull request and moves on to the next unstarted plan; when the merged pull requests cannot be read, it keeps its answer and says so.
- loop: `rafa loop start` offers the plan's branch on the project's configured base, not only on `main` or `master`, and `--create-branch` refuses, naming the plan and the base, rather than run on the base.
- release: `rafa release tag` passes over a never-released package (version `0.0.0`, no changelog, no tag) with one Skipped line naming it, and tags the other units.
- pr: `rafa pr triage --resolve` gives a freshly pushed head the same grace for its first check as `rafa pr wait`, instead of ending with no checks on the first empty poll.
- bug: `rafa bug recheck` prints `gone (trigger removed?)` for a bug whose record holds a `## Trigger removed` section, carries `triggerRemoved: true` in JSON, and its comment says the trigger was removed rather than the bug fixed.
- stretch: the pit stop splits the bugs filed since the last item into those filed by the item's own loop, read from their `## Plan` section, and those filed by other sessions.
