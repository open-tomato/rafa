---
plan: rafa-902-spec-measure-which-permission
title: Measure which permission rules and hooks reach a loop session
level: minor
---

- Notices: The skip-permissions notice of `loop start` and `plan create` now names `loop.settingSources`, the scopes it resolved to and the scopes left out, whose permission rules and hooks do not reach the session
- context/workflow.md: A new "What reaches a loop session" section records, per `loop.settingSources` value and with the Claude Code version, whether a user-scope deny rule and hook reach a loop session
- tests: The danger notice's wording is held for `project,local` and `user,project,local` in a spawned `loop start`, and the recorded measurement's rows and version are held in `context/workflow.md`
