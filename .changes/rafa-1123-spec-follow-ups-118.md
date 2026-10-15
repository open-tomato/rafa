---
plan: rafa-1123-spec-follow-ups-118
title: The follow-ups of config as code
level: patch
---

- Configuration: the published `@open-tomato/rafa/config` types now carry every section's keys (`hub`, `pr`, `release`, `logger`, `tests` and the rest), not only core's, and the package type check passes again; rafa refuses a config section that defines another section's file key under a different setting name, naming both packages and both setting names; and a setting merged by key across the user and project files is marked on its own spec, so a section outside core can declare a map setting
- Loop: `rafa loop start`'s refusal on `main` or a detached HEAD, and its branch-convention warning, now name the branch your `naming.branch` template makes instead of always `feat/<stub>`
- CLI: a command declares what it does under a `dangerous.*` key, and the config pass line for that key ends with the phrase; `rafa plan create` and `rafa pr merge` print that one line per dangerous setting, in place of their own second warning
- Release: `rafa release settle`'s repository-rule refusal names the project's own config file, `rafa.config.ts` in a project that holds one, instead of always `.rafa/config.yaml`
