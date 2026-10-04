---
plan: rafa-593-store-keeps-identity-through
title: A store keeps its id through rafa's own rebuilds
level: patch
---

- effort store: `rafa effort merge`, `migrate` and `fix-schema` now keep the store's id, so a device still owns its claims after a merge. The backup they leave is a copy written beside the store, which takes a new id if renamed back, and a failed swap leaves the store untouched and names both files.
- sync: a store pulled through a strategy that merges keeps its origin after the merge.
- documentation: the effort-store and effort-merge context pages describe how rafa's own rebuilds carry a store's identity, and why a restored backup mints a new one.
