---
plan: rafa-1482-bug-sweep-45
title: Bug sweep 45 — a flag the skill says to pass, a CI poll read too early, and the stale-docs lines
level: patch
---

- skills: The rafa-tooling skill now tells sessions to pass `--no-hint` only to the six commands that declare it (`pr merge`, `pr wait`, `pr triage`, `plan create`, `issue ready`, `loop start`), so it no longer leads them into a `cli:unknown-flag` refusal.
- run: The loop's CI gate now reads the pull request's head commit time before polling, so a freshly pushed head whose checks have not appeared yet gets the same first-check grace as `rafa pr wait` instead of ending at once with no checks.
