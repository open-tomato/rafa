---
plan: rafa-1439-bug-sweep-41
title: Bug sweep 41 — four readings of a state that is not there
level: minor
---

- ci: `rafa ci status --branch` reads every workflow on the branch's head commit and takes the worst as the verdict, so a newer skipped run no longer hides a failed one; `skipped` and `neutral` pass, and `--output=json` now writes the commit with one entry per workflow in place of a single run.
- stretch: the pit stop after a stretch item reads every CI workflow on the branch's head commit, so a skipped run no longer hides a failed one.
- release: one stale-docs chore per release — the wrap-up and `rafa epic close` read the newest release tag, retitle an open unreleased chore when the forecast version moves, leave a released chore alone, and fold a racing second create into the older chore, closing the new one as a duplicate.
- run: the type step reads a `tsc` that cannot start (exit 126 or 127) as cannot start rather than a type error, with a blocker saying to put `node` on the PATH the loop runs under.
- loop: a task step whose `tsc` cannot start halts on its blocker without inserting a repair task.
- doctor: `rafa doctor` prints a `tsc` row in projects with a `tsconfig.json` and exits 1 when `tsc` cannot start, naming the interpreter to put on the PATH.
