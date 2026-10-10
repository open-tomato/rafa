---
plan: rafa-903-spec-break-import-cycle
title: Break the import cycle that crosses future package lines
level: minor
---

- library: `planCommand` now takes the command roster as its third argument and the adapter registry as its fourth; a call on `--issue` or `--next` must hand a roster in
- references: `rafa plan create`, `rafa issue check`, `rafa doctor`, `rafa roadmap` and `rafa epic show` read a spec's commands and flags against the roster of the running invocation, so a flag only a mounted module declares now reads as present
- testing: a new sweep test fails on any non-test runtime import cycle that crosses two clusters of `docs/survey/cluster-map.json`, and new tests hold the roster seam: a spec's command references are read against the roster handed in, and a roster lacking a named command reads it as dangling
- internal: `rejectedPath` and `REJECTED_DIR` moved from `board/gate.ts` to `commands/plan/plan-files.ts`, breaking a c2/c6 import cycle the new sweep caught
- docs: `context/source.md` describes the runtime import cycle sweep, its map and what to do when it fails
