---
plan: rafa-1478-spec-loop-start-refuses
title: `rafa loop start` refuses a loop whose `tsc` cannot start
level: minor
---

- CLI: `rafa loop start` now refuses, before any config load, deferral or session, when the project's `tsc` cannot start (exit 126 or 127), and names the interpreter to put on the PATH the loop runs under.
- docs: `context/cli.md` and `context/verification.md` document the new `loop start` refusal, its fix line and what a stretch item does with it, and the full suite is now documented as taking 14.6 minutes a pass.
