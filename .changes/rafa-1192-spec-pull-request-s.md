---
plan: rafa-1192-spec-pull-request-s
title: The pull request body's forecast folds a package fragment from the package's own version
level: patch
---

- release: The pull request body's release forecast now folds a workspace package's fragment from that package's own version at the base commit, as the merge guard already did, and names the reason in the guard's words when the base cannot fold it.
