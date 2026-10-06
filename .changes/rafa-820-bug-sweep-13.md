---
plan: rafa-820-bug-sweep-13
title: Bug sweep 13
level: patch
---

- loop: A session that backgrounds a command and ends its turn is no longer held with a bare "no report"; the prompt now says to run commands in the foreground, and the runner names the background wait it saw.
- plan: `rafa plan create` now checks the plan it writes against the store rules `loop start` enforces, so it no longer writes a plan the preflight refuses.
- release: A release's title is no longer "Planned under assumptions".
- pr: The pinned resolve plans and the planner's close-out guidance name the run's base branch instead of `main`.
