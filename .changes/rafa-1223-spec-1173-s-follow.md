---
plan: rafa-1223-spec-1173-s-follow
title: Every reader of a claim branch follows `naming.branch`
level: patch
---

- claims: `rafa claim take`, `rafa claim hand` and `rafa claim accept` find and push to the claim branch named by the project's `naming.branch` template, no longer only `feat/rafa-<n>-<slug>`, and the drift warning for a stage label with no branch names the shape it looked for, such as `work/rafa-30-*`
- board: `rafa init --board` opens the Roadmap issue with a naming paragraph built from the project's `naming.branch` template, and `rafa issue list --roadmap` and `rafa epic show` read claim branches under that template
- plan: `plan create --next` reads claim branches under the configured `naming.branch` template rather than always under `feat/{stub}`
- epic: `rafa epic defer`, `promote`, `move` and `cancel` read claim branches under the project's `naming.branch` template, so a `work/{stub}` project's branches count as started work and are named as open work
- next: `rafa next` reads claim branches under the configured `naming.branch` template
