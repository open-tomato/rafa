---
plan: rafa-994-bug-sweep-19
title: Bug sweep 19 — a device keeps its claims when its store file moves
level: patch
---

- claims: a device keeps its claims when its effort store file gets a new device or inode at the same host and path, such as a project directory copied to a new disk or a backup restored in place: the store remembers the ids it replaced, and `rafa claim release`, `hand`, `take` and `accept`, `rafa plan create` and the claim-lost report read a claim or a handover naming one of them as this device's own, while every commit they push names the store's current id; a store copied to another host or path still inherits no claim
- loop start: `rafa loop start` reads a claim made under a replaced store id as owned, on the remote and on the local branch, and re-signs the remote claim branch to the store's new id with one `take` commit, printing one line that names both ids; offline or on a refused push the run goes on with a warning; its refusal of another store's claim now says when this store's id was minted after the claim was made, with the date the claim goes stale under `claims.staleAfter` and the line `rafa claim take <n> --stale`
- docs: `context/effort-store.md` describes the `store_replaced` table, which mints record into it or empty it, and how a copy differs from a clone
