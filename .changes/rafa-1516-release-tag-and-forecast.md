---
plan: rafa-1516-release-tag-and-forecast
title: Tag after settle, and the forecast of a stamp that merges in
level: patch
---

- release: `rafa release tag` on a release branch behind the ref it tracks now refuses with the `behind` reason and names the `git merge --ff-only` to run, so `rafa release settle && rafa release tag` no longer reads the release settle just pushed as already tagged (#1516).
- release: The release forecast `rafa pr merge` prints now folds from the version the merge leaves when only the branch moved the version file, so a branch that sets the version back forecasts what settle will write (#1517).
