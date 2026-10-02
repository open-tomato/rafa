---
plan: rafa-593-store-keeps-identity-through
title: A store keeps its id through rafa's own rebuilds
level: patch
---

- effort store: `rafa effort merge`, `migrate` and `fix-schema` now keep the store's id through the rebuild instead of minting a new one on the next write, so a device still owns its claims after a merge; the backup they leave is a snapshot that takes a new id if renamed back, as `context/effort-store.md` now documents.
- effort: the done lines of `rafa effort merge`, `migrate` and `import`, and the `migrate` and `fix-schema` help, now say the backup is a copy that takes a new store id when renamed back.
