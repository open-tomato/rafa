---
plan: rafa-1019-bug-sweep-22
title: Bug sweep 22 — a loop's own steps stop misreading its run
level: patch
---

- loop: a suite step whose run exits nonzero with no failing test listed is now red whatever the baseline holds, and a baseline of that shape stops the run before any session with the likely cause and the last lines of output; a PREREQUISITES item can carry a [tasks] or [wrap-up] marker, so a rerun with only the wrap-up left skips the [tasks] items and names each one; a task dispatched after an inserted repair is handed its stage again, and a repair is handed the stage of the task it repairs; under pr.provider none the wrap-up prompt no longer asks for a pull request and says the run ends with the branch pushed
- plan: rafa plan risk notes an open task line that asks its session to run the whole suite, naming the line and the tests=full fix
