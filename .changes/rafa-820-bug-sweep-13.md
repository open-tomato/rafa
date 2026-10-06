---
plan: rafa-820-bug-sweep-13
title: Planned under assumptions
level: patch
---

- loop: Loop sessions are told to run every command in the foreground and end only after their report, and a task whose session ended its turn waiting on a background command is now held with a line naming that wait instead of a bare "no report".
- plan: `rafa plan create` now refuses a generated plan that breaks the effort-store rules `loop start` enforces, moving it to `rejected/` and naming each broken line as `rafa plan validate` does, and the planner prompt names the rule.
- release: A release and its pull request are titled after the plan's own `# Plan:` title, no longer "Planned under assumptions".
- pr: `rafa pr triage --resolve` now merges a conflicting pull request with the branch it targets instead of always with `main`, and the dev-planner close-out guidance names the run's base.
