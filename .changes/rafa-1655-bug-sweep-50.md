---
plan: rafa-1655-bug-sweep-50
title: rafa-1655 — the 26 low-impact CodeQL alerts: local-input regexes and script escaping
level: patch
---

- atlas: The fetch transport and fetch adapter now trim trailing slashes from the base URL and mount in linear time.
- core: Reading test output, plan contexts, config files, git remotes, bug stack paths and release paths no longer slows to seconds or minutes on long runs of spaces, slashes, tabs or path characters.
- triage: Reading a test name from a bug report's case line no longer slows down on long whitespace runs.
- inventory: Skill reference checks and demotion now read long function lines, words, headings and names in linear time.
- run: The cleanup force-flag guard, the plan title reader and the config-lock check no longer slow down on long crafted input.
