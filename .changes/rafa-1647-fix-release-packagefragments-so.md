---
plan: rafa-1647-fix-release-packagefragments-so
title: `release.packageFragments` — refuse package fragments where no package release exists yet
level: minor
---

- release: A new `release.packageFragments` setting (`allow` or `refuse`, default `allow`) decides whether a change fragment may name a package; under `refuse`, `rafa release fragment --package` stops before writing and names where the key is set, and `rafa pr merge` refuses a branch whose `.changes/` holds a package fragment, naming each file and the key
